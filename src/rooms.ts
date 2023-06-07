import log from './helpers/logger'
import { getAccessToken } from './helpers/storage'
import { axios, getUserSessionOptions } from './helpers/synapse'
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

export type MatrixRoom = {
  room_id?: string
  name?: string
  creation_content?: object
  room_alias_name?: string
  topic?: string
  is_direct?: boolean
  preset?: MatrixRoomPresets
  _creatorId?: string
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
    case 'd':
      room.is_direct = true
      room.preset = MatrixRoomPresets.trusted
      room._creatorId = rcRoom.uids?.[0]
      break

    case 'c':
      room.preset = MatrixRoomPresets.public
      room._creatorId = rcRoom.u?._id
      break

    case 'p':
      room.preset = MatrixRoomPresets.private
      room._creatorId = rcRoom.u?._id
      break

    default:
      const message = `Room type ${rcRoom.t} is unknown`
      log.error(message)
      throw new Error(message)
  }
  return room
}

export async function createRoom(rcRoom: RcRoom): Promise<MatrixRoom> {
  const room: MatrixRoom = mapRoom(rcRoom)
  room.room_id = (
    await axios.post(
      '/_matrix/client/v3/createRoom',
      room,
      await getUserSessionOptions(room._creatorId!)
    )
  ).data.room_id

  return room
}
