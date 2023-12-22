import lineByLine from 'n-readlines'
import { entities } from '../Entities'
import log from '../helpers/logger'
import { getMappingByMatrixId, getRoomId } from '../helpers/storage'
import {
  axios,
  formatUserSessionOptions,
  getMatrixMembers,
} from '../helpers/synapse'
import { RcRoom, RcRoomTypes } from './rooms'
import { AxiosError } from 'axios'

export type DirectChats = { [key: string]: string[] }
export type UserDirectChatMappings = {
  [key: string]: { [key: string]: string[] }
}

/**
 * Reads the input file for rooms, gets the mappings and members of each direct chat and returns this collection
 * @returns The DirectChats collection with Matrix IDs of rooms and users
 */
export async function getDirectChats(): Promise<DirectChats> {
  const rl = new lineByLine(`./inputs/${entities.rooms.filename}`)

  let line: false | Buffer
  const directChats: DirectChats = {}
  while ((line = rl.next())) {
    const room: RcRoom = JSON.parse(line.toString())

    if (room.t === RcRoomTypes.direct) {
      const matrixRoomId = await getRoomId(room._id)

      if (!matrixRoomId) {
        log.warn(
          `Room ${room._id} has no mapping, skipping to mark it as a direct chat.`
        )
        continue
      }
      const members = await getMatrixMembers(matrixRoomId)

      directChats[matrixRoomId] = members
    }
  }
  return directChats
}

/**
 * Parses direct chats and returns a mapping of users and their direct chat connections
 * @param directChats The object containing direct chats and their members
 * @returns An object containing users and their direct chat connections, as needed for setting their m.direct settings
 */
export function parseDirectChats(
  directChats: DirectChats
): UserDirectChatMappings {
  const result: UserDirectChatMappings = {}

  // Iterate over all direct chats
  for (const chat in directChats) {
    const users = directChats[chat]

    // Iterate over all users in the current chat
    for (const user of users) {
      // If the user is not already in the result, add them
      if (!result[user]) {
        result[user] = {}
      }

      // Iterate over all other users in the same chat
      for (const otherUser of users) {
        // Skip the current user
        if (otherUser !== user) {
          // If the other user is not already in the result, add them
          if (!result[user][otherUser]) {
            result[user][otherUser] = []
          }

          // Add the current chat to the list of direct chats between the users
          if (!result[user][otherUser].includes(chat)) {
            result[user][otherUser].push(chat)
          }
        }
      }
    }
  }
  return result
}

/**
 * Sets the m.direct settings for users.
 * If the calculated direct chats differ from any already set ones, it is not changed, but the difference is logged.
 * @param userDirectChatMappings An object containing users and their direct chat connections, to be set in synapse
 */
export async function setDirectChats(
  userDirectChatMappings: UserDirectChatMappings
) {
  log.info(
    `Setting direct chat settings for ${
      Object.keys(userDirectChatMappings).length
    } users`
  )

  // Iterate over all users
  for (const [user, chats] of Object.entries(userDirectChatMappings)) {
    const userSessionOptions = formatUserSessionOptions(
      (await getMappingByMatrixId(user))?.accessToken || ''
    )

    // Check if direct chats are already set
    let settingExists = false
    try {
      const currentDirectChats = (
        await axios.get(
          `/_matrix/client/v3/user/${user}/account_data/m.direct`,
          userSessionOptions
        )
      ).data

      settingExists =
        currentDirectChats && Object.keys(currentDirectChats).length > 0

      if (settingExists) {
        if (JSON.stringify(currentDirectChats) !== JSON.stringify(chats)) {
          // If chats are already set, but different, log the difference
          log.debug(`User ${user} already has a different direct chat setting.`)
          log.debug('Expected:', chats)
          log.debug('Actual:', currentDirectChats)
        } else {
          // If chats are already set, but equal, log it
          log.debug(
            `User ${user} already has the expected direct chats configured, skipping.`
          )
        }
      }
    } catch (error) {
      // Catch errors if setting does not exist, yet
      if (
        !(
          error instanceof AxiosError &&
          error.response &&
          error.response.data.errcode === 'M_NOT_FOUND'
        )
      ) {
        throw error
      }
    }

    if (!settingExists) {
      // Set direct chats if there are non set, yet
      await axios.put(
        `/_matrix/client/v3/user/${user}/account_data/m.direct`,
        chats,
        userSessionOptions
      )
      log.debug(
        `Set ${
          Object.keys(chats).length
        } chats as direct chats for user ${user}`
      )
    }
  }
}

/**
 * Handle direct chat settings for all users, marking direct chats as such in the user's personal settings
 */
export async function handleDirectChats() {
  const directChats = await getDirectChats()
  const userDirectChatMappings = parseDirectChats(directChats)
  await setDirectChats(userDirectChatMappings)
}
