import lineByLine from 'n-readlines'
import { entities } from '../Entities'
import log from '../helpers/logger'
import {
  getAccessToken,
  getMemberships,
  getMessageId,
  getRoomId,
} from '../helpers/storage'
import { axios, formatUserSessionOptions } from '../helpers/synapse'
import { RcMessage } from './messages'

/**
 * Reads the input file for messages and returns the last messages for rooms
 * @returns A record mapping room IDs to their respective last messages
 */
export async function getLastRoomMessages(): Promise<
  Record<string, RcMessage>
> {
  const lastMessages: Record<string, RcMessage> = {}
  let roomId: string = ''
  let messageInMemory: RcMessage | null = null
  const rl = new lineByLine(`./inputs/${entities.messages.filename}`)
  let line: false | Buffer
  while ((line = rl.next())) {
    const message: RcMessage = JSON.parse(line.toString())
    if (message.md) {
      if (roomId === '') {
        roomId = message.rid
        messageInMemory = message
      } else {
        if (roomId !== message.rid && messageInMemory) {
          lastMessages[roomId] = messageInMemory
        }
        roomId = message.rid
        messageInMemory = message
      }
    }
  }
  return lastMessages
}

/**
 * Sets the m.room.pinned_events settings for rooms.
 * @param pinnedMessages An object containing rooms and their pinned message, to be set in synapse
 */
export async function markAllAsRead(
  lastMessages: Record<string, RcMessage>
): Promise<void> {
  const messages: RcMessage[] = Object.values(lastMessages)
  for (const message of messages) {
    const userRcIdList = await getMemberships(message.rid)
    const matrixRoomId = await getRoomId(message.rid)
    const matrixMessageId = await getMessageId(message._id)
    for (const userRcId of userRcIdList) {
      const token = await getAccessToken(userRcId)
      if (typeof token === 'string' && matrixMessageId) {
        const userSessionOptions = formatUserSessionOptions(token)
        log.http(
          `Mark all messages as read in room ${matrixRoomId} for user ${userRcId}`,
          (
            await axios.post(
              `/_matrix/client/v3/rooms/${matrixRoomId}/receipt/m.read/${matrixMessageId}`,
              { thread_id: 'main' },
              userSessionOptions
            )
          ).data
        )
      }
    }
  }
}

/**
 * Handle pinned messages for all rooms, marking pinned messages as such in the room settings
 */
export async function handleMarkAllAsRead() {
  const lastMessages = await getLastRoomMessages()
  await markAllAsRead(lastMessages)
}
