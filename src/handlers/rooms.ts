import { IdMapping } from '../entity/IdMapping'
import log from '../helpers/logger'
import {
  createMembership,
  getMapping,
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

export const enum RcRoomTypes {
  direct = 'd',
  chat = 'c',
  private = 'p',
  live = 'l',
}

export type RcRoom = {
  _id: string
  t: RcRoomTypes
  uids?: string[]
  usernames?: string[]
  name?: string
  u?: RcUser
  topic?: string
  fname?: string
  description?: string
}

export const enum MatrixRoomPresets {
  private = 'private_chat',
  public = 'public_chat',
  trusted = 'trusted_private_chat',
}

export const enum MatrixRoomVisibility {
  private = 'private',
  public = 'public',
}

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
      room.is_direct = true
      room.preset = MatrixRoomPresets.trusted
      break

    case RcRoomTypes.chat:
      room.preset = MatrixRoomPresets.public
      room.visibility = MatrixRoomVisibility.public
      break

    case RcRoomTypes.private:
      room.preset = MatrixRoomPresets.private
      break

    case RcRoomTypes.live:
    default:
      const message = `Room type ${rcRoom.t} is unknown or unimplemented`
      log.error(message)
      throw new Error(message)
  }
  return room
}

export function getCreator(rcRoom: RcRoom): string {
  if (rcRoom.u && rcRoom.u._id) {
    return rcRoom.u._id
  } else if (rcRoom.uids && rcRoom.uids.length > 1) {
    return rcRoom.uids[0]
  } else {
    log.warn(
      `Creator ID could not be determined for room ${rcRoom.name} of type ${rcRoom.t}. This is normal for the default room.`
    )
    return ''
  }
}

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

export async function registerRoom(
  room: MatrixRoom,
  creatorSessionOptions: SessionOptions | object
): Promise<string> {
  return (
    await axios.post(
      '/_matrix/client/v3/createRoom',
      room,
      creatorSessionOptions
    )
  ).data.room_id
}

export async function inviteMember(
  inviteeId: string,
  roomId: string,
  creatorSessionOptions: SessionOptions | object
): Promise<void> {
  log.http(`Invite member ${inviteeId}`)
  await axios.post(
    `/_matrix/client/v3/rooms/${roomId}/invite`,
    { user_id: inviteeId },
    creatorSessionOptions
  )
}

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

export async function createMapping(
  rcId: string,
  matrixRoom: MatrixRoom
): Promise<void> {
  const roomMapping = new IdMapping()
  roomMapping.rcId = rcId
  roomMapping.matrixId = matrixRoom.room_id
  roomMapping.type = 1

  await save(roomMapping)
  log.debug('Mapping added:', roomMapping)
}

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
      await inviteMember(
        memberMapping.matrixId || '',
        room.room_id || '',
        creatorSessionOptions
      )
      await acceptInvitation(memberMapping, room.room_id || '')
    })
  )
}

export async function handle(rcRoom: RcRoom): Promise<void> {
  log.info(`Parsing room ${rcRoom.name || 'with ID: ' + rcRoom._id}`)

  const matrixRoomId = await getRoomId(rcRoom._id)
  if (matrixRoomId) {
    log.debug(`Mapping exists: ${rcRoom._id} -> ${matrixRoomId}`)
  } else {
    const matrixRoom = await createRoom(rcRoom)
    await createMapping(rcRoom._id, matrixRoom)
  }
}
