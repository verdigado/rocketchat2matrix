import { existsSync, readdirSync, rmSync, rmdirSync } from 'node:fs'
import { join } from 'node:path'
import { Entity, entities } from '../Entities'
import adminAccessToken from '../config/tuwunel_access_token.json'
import { auditHistory, logAuditReport } from '../e2ee/audit'
import {
  allowSkippedUsers,
  getPassphraseFile,
  getRecoveryKeysFile,
  getStoreDir,
  shouldFinalize,
} from '../e2ee/config'
import { distributeRoomKeys } from '../e2ee/distribution'
import { ScannedRoom, scanRooms } from '../e2ee/history'
import { enc, matrixErrorCode, matrixRequest } from '../e2ee/matrix'
import {
  AlreadyProvisionedError,
  UserRecovery,
  provisionUser,
  writeRecoveryKeysFile,
} from '../e2ee/recovery'
import { closeAllCryptoSessions, getCryptoSession } from '../e2ee/session'
import log from '../helpers/logger'
import { getAllMappingsByType } from '../helpers/storage'
import { axios } from '../helpers/tuwunel'

/**
 * @returns The migrated users (and the admin) with their access tokens
 */
async function getMigratedUsers(): Promise<Map<string, string>> {
  const users = new Map<string, string>()
  for (const mapping of await getAllMappingsByType(
    entities[Entity.Users].mappingType
  )) {
    if (mapping.matrixId && mapping.accessToken) {
      users.set(mapping.matrixId, mapping.accessToken)
    }
  }
  return users
}

/**
 * The admin creates the rooms whose Rocket.Chat creator is unknown or not
 * migrated, and stays in them. In E2EE mode they must not stay in rooms they
 * were not a member of in Rocket.Chat: their devices would receive the keys
 * of every future message there. Their room admin rights are handed over to a
 * member first.
 * @param rooms The scanned migrated rooms (their `joined` list is updated)
 */
async function removeAdminFromForeignRooms(
  rooms: ScannedRoom[]
): Promise<void> {
  const adminId = adminAccessToken.user_id
  for (const room of rooms) {
    if (!room.joined.includes(adminId) || room.members.has(adminId)) continue
    const heir = room.joined.find(
      (userId) => userId !== adminId && room.members.has(userId)
    )
    if (heir) {
      await axios.post(
        `/_synapse/admin/v1/rooms/${enc(room.roomId)}/make_room_admin`,
        { user_id: heir }
      )
    }
    await axios.post(`/_matrix/client/v3/rooms/${enc(room.roomId)}/leave`, {})
    room.joined = room.joined.filter((userId) => userId !== adminId)
    log.info(
      `E2EE: ${adminId} left room ${room.roomId}, which they were not a member of${heir ? `; ${heir} is now its admin` : ''}`
    )
  }
}

/**
 * Log out every migration device. Their private keys must not outlive the
 * migration: as devices of the users, they would otherwise keep receiving the
 * keys of new messages.
 * @param tokens The access tokens of the migration devices, by user
 * @returns The users whose device could not be logged out
 */
async function logoutMigrationDevices(
  tokens: Map<string, string>
): Promise<string[]> {
  const adminId = adminAccessToken.user_id
  // The admin token is needed until the end
  const ordered = [...tokens.keys()].sort(
    (a, b) => Number(a === adminId) - Number(b === adminId)
  )
  const failed: string[] = []
  for (const userId of ordered) {
    try {
      await matrixRequest(
        tokens.get(userId)!,
        'POST',
        '/_matrix/client/v3/logout',
        {}
      )
      log.info(`E2EE: migration device of ${userId} logged out`)
    } catch (error) {
      if (matrixErrorCode(error) === 'M_UNKNOWN_TOKEN') {
        log.info(`E2EE: migration device of ${userId} was already logged out`)
      } else {
        log.error(
          `E2EE: could not log out the migration device of ${userId}: ${error}`
        )
        failed.push(userId)
      }
    }
  }
  return failed
}

/**
 * Delete what the migration created in the store directory: one crypto store
 * per user, and the generated passphrase next to it
 */
function deleteStores(): void {
  const storeDir = getStoreDir()
  if (existsSync(storeDir)) {
    for (const name of readdirSync(storeDir)) {
      if (name.startsWith('@')) {
        rmSync(join(storeDir, name), { recursive: true, force: true })
      }
    }
    if (readdirSync(storeDir).length === 0) {
      rmdirSync(storeDir)
    }
  }
  rmSync(getPassphraseFile(), { force: true })
}

/**
 * Final E2EE phase, once every room, message and membership is migrated:
 * 1. give every user a key backup protected by a personal recovery key,
 * 2. save in each backup the keys of the history the user may read,
 * 3. check the result as a new device of each user would,
 * 4. log out the migration devices and delete their keys.
 */
export async function handleE2EE(): Promise<void> {
  const tokens = await getMigratedUsers()

  log.info('E2EE: preparing key backups and recovery keys')
  const recoveries = new Map<string, UserRecovery>()
  const skipped: string[] = []
  for (const userId of tokens.keys()) {
    try {
      const recovery = await provisionUser(await getCryptoSession(userId))
      recoveries.set(userId, recovery)
    } catch (error) {
      if (error instanceof AlreadyProvisionedError) {
        log.error(
          `E2EE: ${error.message}. It is left untouched: this user will NOT be able to read the migrated history.`
        )
        skipped.push(userId)
      } else {
        throw error
      }
    }
  }
  writeRecoveryKeysFile([...recoveries.values()])
  log.info(
    `E2EE: ${recoveries.size} recovery key(s) written to ${getRecoveryKeysFile()}`
  )

  log.info('E2EE: reading the migrated rooms')
  const rooms = await scanRooms()
  await removeAdminFromForeignRooms(rooms)

  log.info('E2EE: saving the keys of the history in the key backups')
  await distributeRoomKeys(rooms, recoveries)

  log.info('E2EE: checking the migrated history')
  const report = await auditHistory(rooms, recoveries, tokens)
  logAuditReport(report)
  if (!report.ok) {
    throw new Error(
      'E2EE check failed: the migration devices are kept so the migration can be fixed and resumed'
    )
  }
  if (skipped.length > 0) {
    const message = `E2EE: ${skipped.length} user(s) without recovery key, who will not be able to read the migrated history: ${skipped.join(', ')}`
    if (!allowSkippedUsers()) {
      throw new Error(
        `${message}. Nothing was finalized. Fix it (e.g. start again from reset.sh), or set E2EE_ALLOW_SKIPPED_USERS=true to finalize anyway.`
      )
    }
    log.warn(message)
  }

  await closeAllCryptoSessions()
  if (shouldFinalize()) {
    const failed = await logoutMigrationDevices(tokens)
    if (failed.length > 0) {
      throw new Error(
        `E2EE: the migration devices of ${failed.join(', ')} could not be logged out; ${getStoreDir()} is kept. Delete these devices (e.g. from the Tuwunel admin room) before going live, then delete ${getStoreDir()}.`
      )
    }
    deleteStores()
    log.info(`E2EE: migration devices removed and their keys deleted`)
  } else {
    log.warn(
      `E2EE: E2EE_FINALIZE=false: the migration devices and their keys (${getStoreDir()}) are kept. Run again with E2EE_FINALIZE=true before going live.`
    )
  }
  log.warn(
    `E2EE: give each user their own recovery key from ${getRecoveryKeysFile()} through a safe channel, then destroy this file (shred -u) and keep no copy: a recovery key also unlocks the user's future messages.`
  )
}
