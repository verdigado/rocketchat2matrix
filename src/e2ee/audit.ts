import { createPrivateKey, createPublicKey } from 'node:crypto'
import log from '../helpers/logger'
import { ScannedRoom } from './history'
import { enc, matrixRequest } from './matrix'
import { BACKUP_ALGORITHM, UserRecovery } from './recovery'
import { loadSdk } from './sdk'

type KeyBackupData = {
  first_message_index: number
  forwarded_count: number
  is_verified: boolean
  session_data: { ephemeral: string; ciphertext: string; mac: string }
}

export type AuditReport = {
  ok: boolean
  plaintextEvents: number
  unencryptedRooms: string[]
  foreignMembers: Array<{ roomId: string; users: string[] }> // joined but not Rocket.Chat members
  users: Array<{
    userId: string
    rooms: number
    encryptedEvents: number
    missingKeys: number
    foreignRoomKeys: number // keys of rooms the user was not a member of
    error?: string
  }>
}

/**
 * @param seedBase64 An ed25519 private key seed, base64 encoded
 * @returns The matching public key, unpadded base64 (Matrix encoding)
 */
export function ed25519PublicKeyFromSeed(seedBase64: string): string {
  const seed = Buffer.from(seedBase64, 'base64')
  if (seed.length !== 32) {
    throw new Error('invalid ed25519 seed')
  }
  const privateKey = createPrivateKey({
    key: Buffer.concat([
      Buffer.from('302e020100300506032b657004220420', 'hex'), // PKCS#8 prefix
      seed,
    ]),
    format: 'der',
    type: 'pkcs8',
  })
  const jwk = createPublicKey(privateKey).export({ format: 'jwk' })
  return Buffer.from(String(jwk.x), 'base64url')
    .toString('base64')
    .replace(/=+$/, '')
}

/**
 * Check the migrated history the way a new Element/Tesseract device of each
 * user will see it:
 * - every migrated room is encrypted and contains no plaintext message;
 * - the recovery key unlocks the secret storage, which holds the
 *   cross-signing keys and the key backup's private key;
 * - the key backup holds, readable with that private key, the room key of
 *   every encrypted event of every room the user was a member of.
 * @param rooms The scanned migrated rooms
 * @param recoveries The provisioned users
 * @param tokens The access tokens, by Matrix user ID
 * @returns The audit report
 */
export async function auditHistory(
  rooms: ScannedRoom[],
  recoveries: Map<string, UserRecovery>,
  tokens: Map<string, string>
): Promise<AuditReport> {
  const sdk = loadSdk()
  const report: AuditReport = {
    ok: true,
    plaintextEvents: 0,
    unencryptedRooms: [],
    foreignMembers: [],
    users: [],
  }

  for (const room of rooms) {
    if (!room.encrypted) {
      report.unencryptedRooms.push(room.roomId)
    }
    const foreign = room.joined.filter((userId) => !room.members.has(userId))
    if (foreign.length > 0) {
      report.foreignMembers.push({ roomId: room.roomId, users: foreign })
    }
    const plaintext = room.events.filter(
      (event) => event.type === 'm.room.message' || event.type === 'm.reaction'
    ).length
    if (plaintext > 0) {
      log.error(
        `E2EE: ${plaintext} unencrypted event(s) in room ${room.roomId}`
      )
    }
    report.plaintextEvents += plaintext
  }

  for (const recovery of recoveries.values()) {
    const token = tokens.get(recovery.userId)
    const entry: AuditReport['users'][number] = {
      userId: recovery.userId,
      rooms: 0,
      encryptedEvents: 0,
      missingKeys: 0,
      foreignRoomKeys: 0,
    }
    report.users.push(entry)
    try {
      if (!token) throw new Error('no access token')
      const get = (path: string, params?: Record<string, string>) =>
        matrixRequest<Record<string, unknown>>(
          token,
          'GET',
          path,
          undefined,
          params
        )
      const accountData = (type: string) =>
        get(
          `/_matrix/client/v3/user/${enc(recovery.userId)}/account_data/${enc(type)}`
        )

      // 1. Recovery key -> secret storage -> backup private key
      const defaultKey = await accountData('m.secret_storage.default_key')
      const keyType = `m.secret_storage.key.${defaultKey.key}`
      const secretKey = sdk.SecretStorageKey.fromAccountData(
        recovery.recoveryKey,
        keyType,
        JSON.stringify(await accountData(keyType))
      )
      // The cross-signing keys in secret storage are the published ones:
      // otherwise Element would reset the identity when the key is entered.
      const published = (await matrixRequest(
        token,
        'POST',
        '/_matrix/client/v3/keys/query',
        { device_keys: { [recovery.userId]: [] } }
      )) as Record<string, Record<string, { keys?: Record<string, string> }>>
      for (const [secret, field] of [
        ['m.cross_signing.master', 'master_keys'],
        ['m.cross_signing.self_signing', 'self_signing_keys'],
        ['m.cross_signing.user_signing', 'user_signing_keys'],
      ]) {
        const seed = secretKey.decrypt(
          JSON.stringify(await accountData(secret)),
          secret
        )
        const publicKey = ed25519PublicKeyFromSeed(seed)
        if (
          published[field]?.[recovery.userId]?.keys?.[
            `ed25519:${publicKey}`
          ] !== publicKey
        ) {
          throw new Error(`${secret} does not match the published key`)
        }
      }
      const backupKey = sdk.BackupDecryptionKey.fromBase64(
        secretKey.decrypt(
          JSON.stringify(await accountData('m.megolm_backup.v1')),
          'm.megolm_backup.v1'
        )
      )

      // 2. The latest backup is the one protected by this key
      const backup = (await get('/_matrix/client/v3/room_keys/version')) as {
        version: string
        algorithm: string
        auth_data: { public_key: string }
      }
      if (
        backup.algorithm !== BACKUP_ALGORITHM ||
        backup.version !== recovery.backupVersion ||
        backup.auth_data.public_key !==
          backupKey.megolmV1PublicKey.publicKeyBase64
      ) {
        throw new Error('the key backup does not match the recovery key')
      }

      // 3. Every encrypted event of the user's rooms has its key in the backup
      const keys = (await get('/_matrix/client/v3/room_keys/keys', {
        version: backup.version,
      })) as {
        rooms: Record<string, { sessions: Record<string, KeyBackupData> }>
      }
      const readable = new Map<string, Set<string>>()
      for (const [roomId, room] of Object.entries(keys.rooms || {})) {
        for (const [sessionId, data] of Object.entries(room.sessions || {})) {
          const session = JSON.parse(
            backupKey.decryptV1(
              data.session_data.ephemeral,
              data.session_data.mac,
              data.session_data.ciphertext
            )
          ) as { session_id?: string; session_key?: string; algorithm?: string }
          if (
            session.algorithm === 'm.megolm.v1.aes-sha2' &&
            typeof session.session_key === 'string' &&
            data.first_message_index === 0
          ) {
            if (!readable.has(roomId)) readable.set(roomId, new Set())
            readable.get(roomId)!.add(sessionId)
          }
        }
      }

      for (const [roomId, sessions] of readable) {
        const room = rooms.find((r) => r.roomId === roomId)
        if (room && !room.members.has(recovery.userId)) {
          entry.foreignRoomKeys += sessions.size
        }
      }

      // Element X and Tesseract fetch each key on its own when an event
      // cannot be decrypted: check that route too, once per session.
      const checkedSessions = new Map<string, boolean>()
      const fetchable = async (roomId: string, sessionId: string) => {
        const id = `${roomId}|${sessionId}`
        if (!checkedSessions.has(id)) {
          let ok = false
          try {
            const data = (await get(
              `/_matrix/client/v3/room_keys/keys/${enc(roomId)}/${enc(sessionId)}`,
              { version: backup.version }
            )) as unknown as KeyBackupData
            const session = JSON.parse(
              backupKey.decryptV1(
                data.session_data.ephemeral,
                data.session_data.mac,
                data.session_data.ciphertext
              )
            ) as { session_key?: string }
            ok = typeof session.session_key === 'string'
          } catch {
            ok = false
          }
          checkedSessions.set(id, ok)
        }
        return checkedSessions.get(id)
      }

      for (const room of rooms) {
        if (!room.members.has(recovery.userId)) continue
        entry.rooms++
        for (const event of room.events) {
          if (event.type !== 'm.room.encrypted') continue
          entry.encryptedEvents++
          if (
            !event.session_id ||
            !readable.get(room.roomId)?.has(event.session_id) ||
            !(await fetchable(room.roomId, event.session_id))
          ) {
            entry.missingKeys++
          }
        }
      }
    } catch (error) {
      entry.error = error instanceof Error ? error.message : String(error)
    }
    if (entry.error || entry.missingKeys > 0 || entry.foreignRoomKeys > 0) {
      report.ok = false
    }
  }

  if (
    report.plaintextEvents > 0 ||
    report.unencryptedRooms.length > 0 ||
    report.foreignMembers.length > 0
  ) {
    report.ok = false
  }
  return report
}

/**
 * Log the audit report in a readable way
 * @param report The audit report
 */
export function logAuditReport(report: AuditReport): void {
  log.info('E2EE check of the migrated history:')
  log.info(
    `  unencrypted rooms: ${report.unencryptedRooms.length}, unencrypted messages/reactions: ${report.plaintextEvents}`
  )
  for (const { roomId, users } of report.foreignMembers) {
    log.error(
      `  room ${roomId}: joined by ${users.join(', ')}, who were not Rocket.Chat members of it`
    )
  }
  for (const user of report.users) {
    const status = user.error
      ? `ERROR: ${user.error}`
      : user.missingKeys > 0
        ? `MISSING ${user.missingKeys} key(s)`
        : user.foreignRoomKeys > 0
          ? `HAS ${user.foreignRoomKeys} key(s) of rooms they were not a member of`
          : 'OK'
    log.info(
      `  ${user.userId}: ${user.rooms} room(s), ${user.encryptedEvents} encrypted event(s) readable with the recovery key -> ${status}`
    )
  }
  if (report.ok) {
    log.info('E2EE check: SUCCESS')
  } else {
    log.error('E2EE check: FAILED')
  }
}
