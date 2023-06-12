import log from '../helpers/logger'
import { createMembership } from '../helpers/storage'
import { axios, getUserSessionOptions } from '../helpers/synapse'
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
  _creatorId?: string
}

export function mapRoom(rcRoom: RcRoom): MatrixRoom {
  const room: MatrixRoom = {
    creation_content: {
      'm.federate': false,
    },
    _creatorId: '',
  }
  rcRoom.name && (room.name = rcRoom.name)
  rcRoom.name && (room.room_alias_name = rcRoom.name)
  rcRoom.description && (room.topic = rcRoom.description)

  switch (rcRoom.t) {
    case RcRoomTypes.direct:
      room.is_direct = true
      room.preset = MatrixRoomPresets.trusted
      room._creatorId = rcRoom.uids?.[0] || ''

      if (rcRoom.uids) {
        Promise.all(
          rcRoom.uids.map(async (uid) => {
            await createMembership(rcRoom._id, uid)
            log.debug(`${uid} membership in direct chat ${rcRoom._id} created`)
          })
        )
      } else {
        throw new Error('Found a direct chat without uids. This is unexpected.')
      }
      break

    case RcRoomTypes.chat:
      room.preset = MatrixRoomPresets.public
      room.visibility = MatrixRoomVisibility.public
      room._creatorId = rcRoom.u?._id || ''
      break

    case RcRoomTypes.private:
      room.preset = MatrixRoomPresets.private
      room._creatorId = rcRoom.u?._id || ''
      break

    case RcRoomTypes.live:
    default:
      const message = `Room type ${rcRoom.t} is unknown or unimplemented`
      log.error(message)
      throw new Error(message)
  }
  if (!room._creatorId) {
    log.warn(
      `Creator ID could not be determined for room ${rcRoom.name} of type ${rcRoom.t}.`
    )
  }
  return room
}

export async function createRoom(rcRoom: RcRoom): Promise<MatrixRoom> {
  const room: MatrixRoom = mapRoom(rcRoom)
  let sessionOptions = {}
  if (room._creatorId) {
    try {
      sessionOptions = await getUserSessionOptions(room._creatorId)
      log.debug('Room user session generated:', sessionOptions)
    } catch (error) {
      log.warn(error)
      // TODO: Skip room, if it has 0-1 member or is a direct chat?
    }
  }
  log.debug('Creating room:', room)
  delete room._creatorId

  room.room_id = (
    await axios.post('/_matrix/client/v3/createRoom', room, sessionOptions)
  ).data.room_id

  // TODO: Invite members and let them join

  return room
}
