import { AxiosError } from 'axios'
import { Entity, entities } from '../Entities'
import { IdMapping } from '../entity/IdMapping'
import log from '../helpers/logger'
import {
  getMapping,
  getMappingByMatrixId,
  getMessageId,
  getRoomId,
  getUserId,
  save,
} from '../helpers/storage'
import { axios, formatUserSessionOptions } from '../helpers/synapse'
import { acceptInvitation, inviteMember } from './rooms'

const applicationServiceToken = process.env.AS_TOKEN || ''
if (!applicationServiceToken) {
  const message = 'No AS_TOKEN found in .env.'
  log.error(message)
  throw new Error(message)
}

export type RcMessage = {
  _id: string
  t?: string // Event type
  rid: string // The unique id for the room
  msg: string // The content of the message.
  tmid?: string
  ts: {
    $date: string
  }
  mentions?: string[]
  u: {
    _id: string
    username?: string
    name?: string
  }
  // md?: any // The message's content in a markdown format.
  pinned?: boolean
  drid?: string // The direct room id (if belongs to a direct room).
  // attachments?: any[] // An array of attachment objects, available only when the message has at least one attachment.
  reactions?: object // Object containing reaction information associated with the message.
}

export type MatrixMessage = {
  body: string
  msgtype: 'm.text'
  type: 'm.room.message'
  'm.relates_to'?: {
    rel_type: 'm.thread'
    event_id: string
    is_falling_back: true
    'm.in_reply_to': {
      event_id: string
    }
  }
}

export function mapMessage(rcMessage: RcMessage): MatrixMessage {
  return {
    body: rcMessage.msg,
    msgtype: 'm.text',
    type: 'm.room.message',
  }
}

export async function createMapping(
  rcId: string,
  matrixId: string
): Promise<void> {
  const messageMapping = new IdMapping()
  messageMapping.rcId = rcId
  messageMapping.matrixId = matrixId
  messageMapping.type = entities[Entity.Messages].mappingType

  await save(messageMapping)
  log.debug('Mapping added:', messageMapping)
}

export async function createMessage(
  matrixMessage: MatrixMessage,
  room_id: string,
  user_id: string,
  ts: number,
  transactionId: string
): Promise<string> {
  return (
    await axios.put(
      `/_matrix/client/v3/rooms/${room_id}/send/m.room.message/${transactionId}?user_id=${user_id}&ts=${ts}`,
      matrixMessage,
      formatUserSessionOptions(applicationServiceToken)
    )
  ).data.event_id
}

export async function handle(rcMessage: RcMessage): Promise<void> {
  log.info(`Parsing message with ID: ${rcMessage._id}`)

  const matrixId = await getMessageId(rcMessage._id)
  if (matrixId) {
    log.debug(`Mapping exists: ${rcMessage._id} -> ${matrixId}`)
    return
  }

  const room_id = await getRoomId(rcMessage.rid)
  if (!room_id) {
    log.warn(
      `Could not find room ${rcMessage.rid} for message ${rcMessage._id}, skipping.`
    )
    return
  }

  if (rcMessage.t) {
    switch (rcMessage.t) {
      case 'ru': // User removed by
      case 'ul': // User left
      case 'ult': // User left team
      case 'removed-user-from-team': // Removed user from team
        log.info(
          `Message ${rcMessage._id} is of type ${rcMessage.t}, removing member ${rcMessage.msg} from room ${room_id}`
        )

        const members = (
          await axios.get(
            `/_matrix/client/v3/rooms/${room_id}/joined_members`,
            formatUserSessionOptions(applicationServiceToken)
          )
        ).data.joined
        if (!members) {
          const errorMessage = `Could not determine members of room ${room_id}, aborting`
          log.error(errorMessage)
          throw new Error(errorMessage)
        }

        const matrixUser =
          Object.keys(members).find((key) =>
            key.includes(rcMessage.msg.toLowerCase())
          ) || ''

        const userMapping = await getMappingByMatrixId(matrixUser)
        if (!userMapping?.accessToken) {
          log.warn(
            `Could not get access token for ${rcMessage.msg}, maybe user is not a member, skipping.`
          )
          return
        }

        log.http(`User ${matrixUser} leaves room ${room_id}`)
        await axios.post(
          `/_matrix/client/v3/rooms/${room_id}/leave`,
          { reason: `Event type ${rcMessage.t}` },
          formatUserSessionOptions(userMapping.accessToken)
        )
        return

      case 'uj': // User joined channel
      case 'ujt': // User joined team
      case 'ut': // User joined conversation

      case 'au': // User added by
      case 'added-user-to-team': // Added user to team
      case 'r': // Room name changed
      case 'rm': // Message removed
        log.warn(
          `Message ${rcMessage._id} is of type ${rcMessage.t}, for which Rocket.Chat does not provide the initial state information, skipping.`
        )
        return

      case 'user-muted': // User muted by
      default:
        log.warn(
          `Message ${rcMessage._id} is of unhandled type ${rcMessage.t}, skipping.`
        )
        return
    }
  }

  const user_id = await getUserId(rcMessage.u._id)
  if (!user_id) {
    log.warn(
      `Could not find author ${rcMessage.u.username} for message ${rcMessage._id}, skipping.`
    )
    return
  }

  const matrixMessage = mapMessage(rcMessage)

  const ts = new Date(rcMessage.ts.$date).valueOf()
  if (rcMessage.tmid) {
    const event_id = await getMessageId(rcMessage.tmid)
    if (!event_id) {
      log.warn(`Related message ${rcMessage.tmid} missing, skipping.`)
      return
    } else {
      matrixMessage['m.relates_to'] = {
        rel_type: 'm.thread',
        event_id,
        is_falling_back: true,
        'm.in_reply_to': {
          event_id,
        },
      }
    }
  }

  try {
    const event_id = await createMessage(
      matrixMessage,
      room_id,
      user_id,
      ts,
      rcMessage._id
    )
    await createMapping(rcMessage._id, event_id)
  } catch (error) {
    if (
      error instanceof AxiosError &&
      error.response &&
      error.response.data.errcode === 'M_FORBIDDEN' &&
      error.response.data.error === `User ${user_id} not in room ${room_id}`
    ) {
      log.info(error.response.data.error + ', adding.')

      const userMapping = await getMapping(
        rcMessage.u._id,
        entities[Entity.Users].mappingType
      )
      if (!userMapping || !userMapping.matrixId || !userMapping.accessToken) {
        log.warn(`Could not determine joining user, skipping.`, rcMessage)
        return
      }

      // Get room creator session or use empty axios options
      let userSessionOptions = {}
      const roomCreatorId = (
        await axios.get(`/_synapse/admin/v1/rooms/${room_id}`)
      ).data.creator
      if (!roomCreatorId) {
        log.warn(
          `Could not determine room creator for room ${room_id}, using admin credentials.`
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

      await inviteMember(userMapping.matrixId, room_id, userSessionOptions)
      await acceptInvitation(userMapping, room_id)

      const event_id = await createMessage(
        matrixMessage,
        room_id,
        user_id,
        ts,
        rcMessage._id
      )
      await createMapping(rcMessage._id, event_id)
    } else {
      throw error
    }
  }
}
