import lineByLine from 'n-readlines'
import { entities } from '../Entities'
import log from '../helpers/logger'
import {
  getRoomId,
  getMessageId,
  getMappingByMatrixId,
} from '../helpers/storage'
import { axios, formatUserSessionOptions } from '../helpers/synapse'
import { RcMessage } from './messages'

export type PinnedMessages = { [key: string]: string[] }

/**
 * Reads the input file for messages, gets the mappings of each pinned message and returns this collection
 * @returns A PinnedMessages collection with messages IDs of rooms
 */
export async function getPinnedMessages(): Promise<PinnedMessages> {
  const pinnedMessages: PinnedMessages = {}
  const rl = new lineByLine(`./inputs/${entities.messages.filename}`)
  let line: false | Buffer
  while ((line = rl.next())) {
    const message: RcMessage = JSON.parse(line.toString())
    if (message.pinned) {
      const matrixRoomId = await getRoomId(message.rid)
      const matrixMessageId = await getMessageId(message._id)
      if (!matrixRoomId) {
        log.warn(`Room ${message.rid} has no mapping, thus no pinned messages.`)
        continue
      }

      if (!pinnedMessages[matrixRoomId]) {
        pinnedMessages[matrixRoomId] = []
      }
      if (matrixMessageId) {
        pinnedMessages[matrixRoomId].push(matrixMessageId)
      }
    }
  }
  return pinnedMessages
}

/**
 * Sets the m.room.pinned_events settings for rooms.
 * @param pinnedMessages An object containing rooms and their pinned message, to be set in synapse
 */
export async function setPinnedMessages(
  pinnedMessages: PinnedMessages
): Promise<void> {
  for (const room in pinnedMessages) {
    // Get room creator session or use empty axios options
    let userSessionOptions = {}
    const roomCreatorId = (await axios.get(`/_synapse/admin/v1/rooms/${room}`))
      .data.creator
    if (!roomCreatorId) {
      log.warn(
        `Could not determine room creator for room ${room}, using admin credentials.`
      )
    } else {
      const creatorMapping = await getMappingByMatrixId(roomCreatorId)
      if (!creatorMapping?.accessToken) {
        log.warn(
          `Could not access token for ${roomCreatorId}, using admin credentials.`
        )
      } else {
        log.info(
          `User ${creatorMapping.matrixId} will pin all messages in room ${room}`
        )
        userSessionOptions = formatUserSessionOptions(
          creatorMapping.accessToken
        )
      }
    }

    const listPinnedMessages = { pinned: pinnedMessages[room] }
    log.http(
      `Pin messages in room ${room}`,
      (
        await axios.put(
          `/_matrix/client/v3/rooms/${room}/state/m.room.pinned_events/`,
          listPinnedMessages,
          userSessionOptions
        )
      ).data
    )
  }
}

/**
 * Handle pinned messages for all rooms, marking pinned messages as such in the room settings
 */
export async function handlePinnedMessages() {
  const pinnedMessages = await getPinnedMessages()
  await setPinnedMessages(pinnedMessages)
}
