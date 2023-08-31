import { Entity, entities } from '../Entities'
import { IdMapping } from '../entity/IdMapping'
import log from '../helpers/logger'
import { getMessageId, getRoomId, getUserId, save } from '../helpers/storage'
import { axios, formatUserSessionOptions } from '../helpers/synapse'

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
  if (rcMessage.t) {
    log.warn(`Message ${rcMessage._id} is of type ${rcMessage.t}, skipping.`)
    return
  }

  const room_id = (await getRoomId(rcMessage.rid)) || ''
  if (!room_id) {
    log.warn(
      `Could not find room ${rcMessage.rid} for message ${rcMessage._id}, skipping.`
    )
    return
  }

  const user_id = (await getUserId(rcMessage.u._id)) || ''
  if (!user_id) {
    log.warn(
      `Could not find author ${rcMessage.u.username} for message ${rcMessage._id}, skipping.`
    )
    return
  }

  const matrixMessage = mapMessage(rcMessage)

  const ts = new Date(rcMessage.ts.$date).valueOf()
  if (rcMessage.tmid) {
    const event_id = (await getMessageId(rcMessage.tmid)) || ''
    matrixMessage['m.relates_to'] = {
      rel_type: 'm.thread',
      event_id,
      is_falling_back: true,
      'm.in_reply_to': {
        event_id,
      },
    }
  }

  const event_id = await createMessage(
    matrixMessage,
    room_id,
    user_id,
    ts,
    rcMessage._id
  )

  createMapping(rcMessage._id, event_id)
}
