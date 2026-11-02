import log from '../helpers/logger'
import { getMappingByMatrixId } from '../helpers/storage'
import { ScannedRoom } from './history'
import { matrixRequest } from './matrix'
import { UserRecovery } from './recovery'
import { CryptoSession, getCryptoSession } from './session'

type BackupBody = {
  rooms: Record<string, { sessions: Record<string, unknown> }>
}

/**
 * Upload the room keys of one author into the key backup of one recipient,
 * restricted to the rooms the recipient was a member of.
 *
 * The author's crypto engine encrypts its room keys for the recipient's
 * backup public key. Nothing is decrypted or exported in clear.
 * @param author The crypto session of the author of messages
 * @param recipient The backup of the recipient
 * @param recipientToken The recipient's access token
 * @param rooms The rooms whose keys the recipient must receive
 * @returns The number of room keys uploaded
 */
async function backupAuthorKeysFor(
  author: CryptoSession,
  recipient: UserRecovery,
  recipientToken: string,
  rooms: Set<string>
): Promise<number> {
  return author.exclusive(async () => {
    const machine = author.machine
    let uploaded = 0
    await machine.disableBackup()
    await machine.enableBackupV1(
      recipient.backupPublicKey,
      recipient.backupVersion
    )
    try {
      for (;;) {
        const request = await machine.backupRoomKeys()
        if (!request) break

        const body = JSON.parse(request.body) as BackupBody
        const selected: BackupBody = { rooms: {} }
        let count = 0
        for (const [roomId, room] of Object.entries(body.rooms || {})) {
          if (!rooms.has(roomId)) continue
          selected.rooms[roomId] = room
          count += Object.keys(room.sessions || {}).length
        }

        let response: Record<string, unknown> = { count: 0, etag: '0' }
        if (count > 0) {
          response = await matrixRequest(
            recipientToken,
            'PUT',
            '/_matrix/client/v3/room_keys/keys',
            selected,
            { version: recipient.backupVersion }
          )
          uploaded += count
        }
        await machine.markRequestAsSent(
          request.id,
          request.type,
          JSON.stringify(response)
        )
      }
    } finally {
      await machine.disableBackup()
    }
    return uploaded
  })
}

/**
 * Put the key of every encrypted message of the migrated history into the
 * key backup of every Rocket.Chat member of its room.
 * @param rooms The scanned migrated rooms
 * @param recoveries The provisioned backups, by Matrix user ID
 */
export async function distributeRoomKeys(
  rooms: ScannedRoom[],
  recoveries: Map<string, UserRecovery>
): Promise<void> {
  // For each author: the rooms they wrote encrypted events in
  const authorRooms = new Map<string, Set<string>>()
  for (const room of rooms) {
    for (const event of room.events) {
      if (event.type !== 'm.room.encrypted') continue
      if (!authorRooms.has(event.sender))
        authorRooms.set(event.sender, new Set())
      authorRooms.get(event.sender)!.add(room.roomId)
    }
  }
  const membersByRoom = new Map(
    rooms.map((room) => [room.roomId, room.members])
  )

  for (const [authorId, writtenRooms] of authorRooms) {
    let author: CryptoSession
    try {
      author = await getCryptoSession(authorId)
    } catch (error) {
      log.error(
        `E2EE: cannot open the crypto device of ${authorId}, the keys of their messages cannot be distributed: ${error}`
      )
      continue
    }

    // recipient -> rooms (written by this author) the recipient may read
    const recipientRooms = new Map<string, Set<string>>()
    for (const roomId of writtenRooms) {
      for (const member of membersByRoom.get(roomId) || []) {
        if (!recoveries.has(member)) continue
        if (!recipientRooms.has(member)) recipientRooms.set(member, new Set())
        recipientRooms.get(member)!.add(roomId)
      }
    }

    for (const [recipientId, roomsForRecipient] of recipientRooms) {
      const recipientToken = (await getMappingByMatrixId(recipientId))
        ?.accessToken
      if (!recipientToken) {
        log.error(`E2EE: no access token for ${recipientId}, skipping`)
        continue
      }
      const count = await backupAuthorKeysFor(
        author,
        recoveries.get(recipientId)!,
        recipientToken,
        roomsForRecipient
      )
      log.info(
        `E2EE: ${count} room key(s) of ${authorId} saved in the key backup of ${recipientId}`
      )
    }
  }
}
