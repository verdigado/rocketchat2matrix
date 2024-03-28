import lineByLine from 'n-readlines'
import { Entity, entities } from '../Entities'
import log from '../helpers/logger'
import { getMapping, getRoomId, getMessageId } from '../helpers/storage'
import {
  axios,
  getUserSessionOptions, //formatUserSessionOptions,
} from '../helpers/synapse'
import { RcMessage } from './messages'

export type PinnedMessages = { [key: string]: string[] }
export type UserForRoom = { [key: string]: string }
export type PromiseResult = {
    pinnedMessages: PinnedMessages;
    userForRoom: UserForRoom;
};

/**
 * Reads the input file for messages, gets the mappings of each pinned message and returns this collection
 * It also returns a dict to know which user needs to connect to pinned messages in a room
 * @returns A collection with: PinnedMessages collection with messages IDs of rooms & Dict of rooms: users
 */
export async function getPinnedMessages(): Promise<PromiseResult> {
  const pinnedMessages: PinnedMessages = {}
  const userForRoom: UserForRoom = {}
  const rl = new lineByLine(`./inputs/${entities.messages.filename}`)
  let line: false | Buffer
  while ((line = rl.next())) {
    const message: RcMessage = JSON.parse(line.toString())
    if (message.pinned) {
      const matrixRoomId = await getRoomId(message.rid)
      const matrixMessageId = await getMessageId(message._id)
      if (!matrixRoomId) {
        log.warn(
          `Room ${message.rid} has no mapping, thus no pinned messages.`
        )
        continue
      }
      if (message.pinnedBy) {
        log.info(
          `User ${message.pinnedBy.username} has pinned message id ${matrixMessageId} in room ${matrixRoomId}`
        )
        if (message.pinnedBy._id) {
          userForRoom[matrixRoomId] = message.pinnedBy._id
        }
      }
      if (!pinnedMessages[matrixRoomId]) {
        pinnedMessages[matrixRoomId] = [];
      }
      if (matrixMessageId) {
        pinnedMessages[matrixRoomId].push(matrixMessageId);
      }
    }
  }
  const promiseResult: PromiseResult = {pinnedMessages, userForRoom}
  return promiseResult
}

/**
 * Sets the m.room.pinned_events settings for rooms.
 * @param pinnedMessages An object containing rooms and their pinned message, to be set in synapse
 */
export async function setPinnedMessages(
  promiseResult: PromiseResult
) {
  const { userForRoom } = promiseResult;

  for (const room in userForRoom) {
    log.info(
      `User ${userForRoom[room]} will pinn all messages in room ${room}`
    )
    const userSessionOptions = await getUserSessionOptions(userForRoom[room]) || ''
    const listPinnedMessages = {"pinned": promiseResult.pinnedMessages[room]}
    await axios.put(
      `/_matrix/client/v3/rooms/${room}/state/m.room.pinned_events/`,
      listPinnedMessages,
      userSessionOptions
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
