import { AxiosError } from 'axios'
import { Entity, entities } from '../Entities'
import { IdMapping } from '../entity/IdMapping'
import log from '../helpers/logger'
import {
  createMembership,
  getMapping,
  getMappingByMatrixId,
  getMemberships,
  getRoomId,
  save,
} from '../helpers/storage'
import {
  SessionOptions,
  axios,
  formatUserSessionOptions,
  getUserSessionOptions,
} from '../helpers/synapse'
import { RcUser } from './users'

/**
 * Types of Rocket.Chat rooms
 */
export const enum RcRoomTypes {
  direct = 'd',
  chat = 'c',
  private = 'p',
  live = 'l',
}

/**
 * Type of Rocket.Chat rooms
 */
export type RcRoom = {
  _id: string
  t: RcRoomTypes
  usersCount?: number
  lastMessage?: {[key: string]: {[key: string]: string}}
  uids?: string[]
  usernames?: string[]
  name?: string
  u?: RcUser
  topic?: string
  fname?: string
  description?: string
}

/**
 * Presets of Matrix room permission settings
 */
export const enum MatrixRoomPresets {
  private = 'private_chat',
  public = 'public_chat',
  trusted = 'trusted_private_chat',
}

/**
 * Presets of Matrix room visibility settings
 */
export const enum MatrixRoomVisibility {
  private = 'private',
  public = 'public',
}

/**
 * Type of Matrix rooms
 */
export type MatrixRoom = {
  room_id?: string
  name?: string
  creation_content?: object
  room_alias_name?: string
  topic?: string
  is_direct?: boolean
  preset?: MatrixRoomPresets
  visibility?: MatrixRoomVisibility
}

/**
 * Translate a Rocket.Chat room to a Matrix room
 * @param rcRoom The Rocket.Chat room to convert
 * @returns The Matrix room event body
 */
export function mapRoom(rcRoom: RcRoom): MatrixRoom {
  const room: MatrixRoom = {
    creation_content: {
      'm.federate': false,
    },
  }
  rcRoom.name && (room.name = rcRoom.name)
  rcRoom.name && (room.room_alias_name = rcRoom.name)
  rcRoom.description && (room.topic = rcRoom.description)

  switch (rcRoom.t) {
    case RcRoomTypes.direct:
      if (rcRoom.usersCount == 1) {
        rcRoom.lastMessage && (room.name = rcRoom.lastMessage.u.name)
      }
      room.is_direct = true
      room.preset = MatrixRoomPresets.trusted
      break

    case RcRoomTypes.chat:
      room.preset = MatrixRoomPresets.public
      room.visibility = MatrixRoomVisibility.public
      break

    case RcRoomTypes.private:
      room.preset = MatrixRoomPresets.private
      room.visibility = MatrixRoomVisibility.private
      break

    case RcRoomTypes.live:
      const messageLivechat = `Room ${
        rcRoom.name || 'with ID: ' + rcRoom._id
      } is a live chat. Migration not implemented`
      log.warn(messageLivechat)
      throw new Error(messageLivechat)

    default:
      const messageUnknownRoom = `Room ${
        rcRoom.name || 'with ID: ' + rcRoom._id
      } is of type ${rcRoom.t}, which is unknown or unimplemented`
      log.error(messageUnknownRoom)
      throw new Error(messageUnknownRoom)
  }
  return room
}

/**
 * Return the ID of the room creator, depending on room type
 * @param rcRoom The Rocket.Chat room object
 * @returns The Rocket.Chat ID of the creator or empty string
 */
export function getCreator(rcRoom: RcRoom): string {
  if (rcRoom.u && rcRoom.u._id) {
    return rcRoom.u._id
  } else if (rcRoom.uids && rcRoom.uids.length >= 1) {
    return rcRoom.uids[0]
  } else {
    log.warn(
      `Creator ID could not be determined for room ${rcRoom.name} of type ${rcRoom.t}. This is normal for the default room. Using admin user.`
    )
    return ''
  }
}

/**
 * Wrapper function for membership creations for direct chats
 * @param rcRoom The Rocket.Chat room object
 */
export async function createDirectChatMemberships(
  rcRoom: RcRoom
): Promise<void> {
  if (rcRoom.t == RcRoomTypes.direct && rcRoom.uids) {
    await Promise.all(
      [...new Set(rcRoom.uids)] // Deduplicate users
        .map(async (uid) => {
          await createMembership(rcRoom._id, uid)
          log.debug(`${uid} membership in direct chat ${rcRoom._id} created`)
        })
    )
  }
}

/**
 * Get user credentials for Axios
 * @param creatorId The Rocket.Chat ID of the room creator
 * @returns A SessionOptions or empty object
 * @deprecated This has a high similarity with other functions, it might be replaced
 */
export async function getCreatorSessionOptions(
  creatorId: string
): Promise<SessionOptions | object> {
  if (creatorId) {
    try {
      const creatorSessionOptions = await getUserSessionOptions(creatorId)
      log.debug('Room owner session generated:', creatorSessionOptions)
      return creatorSessionOptions
    } catch (error) {
      log.warn(error)
    }
  }
  return {}
}

/**
 * Send a request to Synapse, creating the room
 * @param matrixRoom The Matrix room object to create
 * @param creatorSessionOptions The credentials of the room creator
 * @returns The Matrix room ID
 */
export async function registerRoom(
  matrixRoom: MatrixRoom,
  creatorSessionOptions: SessionOptions | object
): Promise<string> {
  return (
    await axios.post(
      '/_matrix/client/v3/createRoom',
      matrixRoom,
      creatorSessionOptions
    )
  ).data.room_id
}

/**
 * Send events to Synapse, inviting users to a room. Already participating users will not cause problems.
 * @param inviteeId The Matrix ID of the invited user
 * @param roomId The Matrix ID of the room
 * @param creatorSessionOptions The credentials of the room creator
 */
export async function inviteMember(
  inviteeId: string,
  roomId: string,
  creatorSessionOptions: SessionOptions | object
): Promise<void> {
  log.http(`Invite member ${inviteeId}`)
  try {
    await axios.post(
      `/_matrix/client/v3/rooms/${roomId}/invite`,
      { user_id: inviteeId },
      creatorSessionOptions
    )
  } catch (error) {
    if (
      error instanceof AxiosError &&
      error.response &&
      error.response.data.errcode === 'M_FORBIDDEN' &&
      error.response.data.error === `${inviteeId} is already in the room.`
    ) {
      log.debug(
        `User ${inviteeId} is already in room ${roomId}, probably because this user created the room as a fallback.`
      )
    } else if (
      error instanceof AxiosError &&
      error.response &&
      error.response.data.errcode === 'M_FORBIDDEN' &&
      error.response.data.error.includes(`not in room ${roomId}.`)
    ) {
      log.warn(
        `Creator is not in room ${roomId}, skipping invitation for ${inviteeId}.`
      )
    } else {
      throw error
    }
  }
}

/**
 * Send events to Synapse, accepting an invitation to a room
 * @param inviteeMapping The IDMapping of the invited user
 * @param roomId The Matrix ID of the room
 */
export async function acceptInvitation(
  inviteeMapping: IdMapping,
  roomId: string
): Promise<void> {
  log.http(
    `Accepting invitation for member ${inviteeMapping.rcId} aka. ${inviteeMapping.matrixId}`
  )
  await axios.post(
    `/_matrix/client/v3/join/${roomId}`,
    {},
    formatUserSessionOptions(inviteeMapping.accessToken || '')
  )
}

/**
 * Filter out the room creator and non-existent users.
 * Users are non-existent, if they have no mapping, like when they are
 * excluded or have been deleted.
 * @param rcMemberIds An array of Rocket.Chat user IDs
 * @param creatorId The Rocket.Chat user ID of the room creator
 * @returns A filtered array of IdMappings
 */
export async function getFilteredMembers(
  rcMemberIds: string[],
  creatorId: string
): Promise<IdMapping[]> {
  const memberMappings = (
    await Promise.all(
      rcMemberIds
        .filter((rcMemberId) => rcMemberId != creatorId)
        .map(async (rcMemberId) => await getMapping(rcMemberId, 0))
    )
  ).filter((memberMapping): memberMapping is IdMapping => memberMapping != null)
  return memberMappings
}

/**
 * Save an ID mapping in the local database
 * @param rcId Rocket.Chat room ID
 * @param matrixId Matrix room ID
 */
export async function createMapping(
  rcId: string,
  matrixId: string
): Promise<void> {
  const roomMapping = new IdMapping()
  roomMapping.rcId = rcId
  roomMapping.matrixId = matrixId
  roomMapping.type = entities[Entity.Rooms].mappingType

  await save(roomMapping)
  log.debug('Mapping added:', roomMapping)
}

/**
 * Create a Matrix room from a Rocket.Chat room object and handle it's memberships
 * @param rcRoom The Rocket.Chat room object
 * @returns The Matrix room object, including it's ID
 */
export async function createRoom(rcRoom: RcRoom): Promise<MatrixRoom> {
  const room: MatrixRoom = mapRoom(rcRoom)
  const creatorId = getCreator(rcRoom)
  await createDirectChatMemberships(rcRoom)
  const creatorSessionOptions = await getCreatorSessionOptions(creatorId)
  log.debug('Creating room:', room)

  room.room_id = await registerRoom(room, creatorSessionOptions)

  await handleMemberships(rcRoom._id, room, creatorId, creatorSessionOptions)

  return room
}

/**
 * Create memberships for a room
 * @param rcRoomId The Rocket.Chat room ID
 * @param room The Matrix room object
 * @param creatorId The Rocket.Chat room creator ID
 * @param creatorSessionOptions The credentials of the room creator
 */
async function handleMemberships(
  rcRoomId: string,
  room: MatrixRoom,
  creatorId: string,
  creatorSessionOptions: object | SessionOptions
) {
  const rcMemberIds = await getMemberships(rcRoomId)
  const memberMappings = await getFilteredMembers(rcMemberIds, creatorId)
  log.info(
    `Inviting members to room ${
      room.room_alias_name || room.name || room.room_id
    }:`,
    memberMappings.map((mapping) => mapping.matrixId)
  )
  log.debug(
    'Excluded members:',
    rcMemberIds.filter(
      (x) => !memberMappings.map((mapping) => mapping.rcId).includes(x)
    )
  )

  await Promise.all(
    memberMappings.map(async (memberMapping) => {
      await addMember(memberMapping, room.room_id || '', creatorSessionOptions)
    })
  )
}

/**
 * Wrapper function to invite users to a room and make them join
 * @param memberMapping The IdMapping of the user to join
 * @param matrixRoomId The Matrix room ID
 * @param creatorSessionOptions The credentials of the inviting user
 */
export async function addMember(
  memberMapping: IdMapping,
  matrixRoomId: string,
  creatorSessionOptions: object | SessionOptions
) {
  await inviteMember(
    memberMapping.matrixId || '',
    matrixRoomId,
    creatorSessionOptions
  )
  await acceptInvitation(memberMapping, matrixRoomId)
}

/**
 * Execute the wrapped function, handling errors of members missing in rooms by adding them and repeating the function.
 * @param fn The function to execute, preferably wrapped
 * @returns void
 * @throws Other errors than "User not in room"
 * @example executeAndHandleMissingMember(() => myFunc('parameter1', 'parameter2'))
 */
export async function executeAndHandleMissingMember(
  fn: () => Promise<void>
): Promise<void> {
  const regEx: RegExp =
    /^User (?<matrixUserId>@.+) not in room (?<matrixRoomId>!.+)$/
  try {
    await fn()
  } catch (error) {
    if (
      error instanceof AxiosError &&
      error.response &&
      error.response.data.errcode === 'M_FORBIDDEN' &&
      error.response.data.error &&
      regEx.test(error.response.data.error)
    ) {
      log.info(`${error.response.data.error}, adding.`)

      const { matrixUserId, matrixRoomId } =
        error.response.data.error.match(regEx).groups

      const userMapping = await getMappingByMatrixId(matrixUserId)
      if (!userMapping || !userMapping.matrixId || !userMapping.accessToken) {
        log.warn(`Could not determine joining user ${matrixUserId}, skipping.`)
        return
      }

      // Get room creator session or use empty axios options
      let userSessionOptions = {}
      const roomCreatorId = (
        await axios.get(`/_synapse/admin/v1/rooms/${matrixRoomId}`)
      ).data.creator
      if (!roomCreatorId) {
        log.warn(
          `Could not determine room creator for room ${matrixRoomId}, using admin credentials.`
        )
      } else {
        const creatorMapping = await getMappingByMatrixId(roomCreatorId)
        if (!creatorMapping?.accessToken) {
          log.warn(`Could not access token for ${roomCreatorId}, skipping.`)
          return
        }
        userSessionOptions = formatUserSessionOptions(
          creatorMapping.accessToken
        )
      }

      await addMember(userMapping, matrixRoomId, userSessionOptions)
      await fn()
    } else {
      throw error
    }
  }
}

/**
 * Handle a line of a Rocket.Chat room JSON export
 * @param rcRoom A Rocket.Chat room object
 */
export async function handle(rcRoom: RcRoom): Promise<void> {
  log.info(`Parsing room ${rcRoom.name || 'with ID: ' + rcRoom._id}`)

  const matrixRoomId = await getRoomId(rcRoom._id)
  if (matrixRoomId) {
    log.debug(`Mapping exists: ${rcRoom._id} -> ${matrixRoomId}`)
  } else {
    const matrixRoom = await createRoom(rcRoom)
    await createMapping(rcRoom._id, matrixRoom.room_id!)
  }
}
