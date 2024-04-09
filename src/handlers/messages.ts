import { AxiosError } from 'axios'
import * as emoji from 'node-emoji'
import * as showdown from 'showdown'
import { Entity, entities } from '../Entities'
import { IdMapping } from '../entity/IdMapping'
import log from '../helpers/logger'
import {
  getMessageId,
  getRoomId,
  getUserId,
  getAccessToken,
  getUserMappingByName,
  save,
} from '../helpers/storage'
import {
  axios,
  formatUserSessionOptions,
  getServerName,
} from '../helpers/synapse'
import emojiMap from '../emojis.json'
import { executeAndHandleMissingMember } from './rooms'
import * as fs from 'fs'

const applicationServiceToken = process.env.AS_TOKEN || ''
if (!applicationServiceToken) {
  const message = 'No AS_TOKEN found in .env.'
  log.error(message)
  throw new Error(message)
}

type attachment = {
  type?: string
  description?: string
  message_link?: string
  image_url?: string
  image_type?: string
  title: string
  title_link?: string
}

/**
 * Type of Rocket.Chat messages
 */
export type RcMessage = {
  _id: string
  t?: string // Event type
  rid: string // The unique id for the room
  msg: string // The content of the message.
  attachments?: attachment[]
  file?: {
    _id: string
    name: string
    type: string
    url: string
  }
  type: string
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
  pinnedBy?: {
    _id?: string
    username?: string
  }
  drid?: string // The direct room id (if belongs to a direct room).
  // attachments?: any[] // An array of attachment objects, available only when the message has at least one attachment.
  reactions?: {
    [key: string]: {
      usernames: string[]
    }
  }
  md?: string
}

/**
 * Type of Matrix message event bodies
 */
export type MatrixMessage = {
  body: string
  msgtype: string
  type: string
  format?: string
  formatted_body?: string
  'm.mentions'?: {
    room?: boolean
    user_ids?: Array<string>
  }
  'm.relates_to'?: {
    rel_type: 'm.thread'
    event_id: string
    is_falling_back: true
    'm.in_reply_to': {
      event_id: string
    }
  }
  url?: string
}

/**
 * Emojis translated from Rocket.Chat to Unicode emojis, which Matrix uses
 */
export type EmojiMappings = {
  [key: string]: string
}

export async function mapTextMessage(
  rcMessage: RcMessage
): Promise<MatrixMessage> {
  let msg = rcMessage.msg

  const synapseServerName = await getServerName()

  const converterOptions: showdown.ConverterOptions = {
    literalMidWordUnderscores: true,
    simpleLineBreaks: true,
  }
  const mentions: MatrixMessage['m.mentions'] = {}

  if (msg.includes('@all')) {
    converterOptions['ghMentions'] = false

    msg = msg.replace('@all', '@room')

    mentions.room = true
  } else if (msg.includes('@here')) {
    converterOptions['ghMentions'] = false
  } else {
    converterOptions['ghMentions'] = true
    converterOptions['ghMentionsLink'] =
      'https://matrix.to/#/@{u}:' + synapseServerName

    for (const mention of msg.matchAll(
      /(^|\s)(\\)?(@([a-z\d]+(?:[a-z\d._-]+?[a-z\d]+)*))/gi
    )) {
      const username = '@' + mention[4] + ':' + synapseServerName

      mentions.user_ids = mentions?.user_ids || []
      mentions.user_ids.push(username)
    }
  }

  const converter = new showdown.Converter(converterOptions)

  const emojified = msg.replace(/:[\w\-+]+:/g, getEmoji)
  const htmled = converter.makeHtml(emojified)
  const matrixMessage: MatrixMessage = {
    type: 'm.room.message',
    msgtype: rcMessage.type,
    body: emojified,
  }
  if (mentions && (mentions.room || mentions.user_ids)) {
    matrixMessage['m.mentions'] = mentions
  }

  if (htmled.replace(/^<p>/, '').replace(/<\/p>$/, '') === emojified) {
    // markdown adds <p></p> tags, if it only adds this, don't add html part
    return matrixMessage
  } else {
    return {
      ...matrixMessage,
      format: 'org.matrix.custom.html',
      formatted_body: htmled,
    }
  }
}

/**
 * Translate a Rocket.Chat message to a Matrix message event body
 * @param rcMessage The Rocket.Chat message to convert
 * @returns The Matrix event body
 */
export async function mapMessage(rcMessage: RcMessage): Promise<MatrixMessage> {
  // handle other types of messages like pictures and files
  return mapTextMessage(rcMessage)
}

/**
 * Save an ID mapping in the local database
 * @param rcId Rocket.Chat message ID
 * @param matrixId Matrix message ID
 */
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

/**
 * Send a request to Synapse, creating the message event
 * @param matrixMessage The Matrix event body to use
 * @param room_id The Matrix room, the message will be posted to
 * @param user_id The user the message will be posted by
 * @param ts The timestamp to which the message will be dated
 * @param transactionId An unique identifier to distinguish identical messages
 * @returns The Matrix Message/event ID
 */
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

/**
 * Send a File to Synapse
 * @param user_id The user the media will be posted by
 * @param ts The timestamp to which the file will be dated
 * @param filePath the path on the local filesystem
 * @param fileName the filename
 * @param content_type: Content type of the file
 * @returns The Matrix Message/event ID
 */
export async function uploadFile(
  user_id: string,
  ts: number,
  filePath: string,
  fileName: string,
  content_type: string
): Promise<string> {
  const fileStream = fs.createReadStream(filePath)
  const accessToken = await getAccessToken(user_id)
  log.http(`Uploading ${fileName}...`)

  return (
    await axios.post(
      `/_matrix/media/v3/upload?user_id=${user_id}&ts=${ts}&filename=${fileName}`,
      fileStream,
      {
        headers: {
          'Content-Type': content_type,
          'Content-Length': fs.statSync(filePath).size,
          Authorization: `Bearer ${accessToken}`,
        },
      }
    )
  ).data.content_uri
}

/**
 * Add reactions to the event
 * @param reactions A Rocket.Chat reactions object
 * @param matrixMessageId The Matrix event reacted to
 * @param matrixRoomId The Matrix room
 */
export async function handleReactions(
  reactions: RcMessage['reactions'],
  matrixMessageId: string,
  matrixRoomId: string
): Promise<void> {
  for (const [reaction, value] of Object.entries(reactions || {})) {
    // Lookup key/emoji
    const reactionEmoji: string = getEmoji(reaction)

    if (reactionEmoji === reaction) {
      log.warn(
        `Could not find an emoji for ${reaction} for message ${matrixMessageId}, skipping`
      )
      continue
    }

    await Promise.all(
      [...new Set(value.usernames)] // Deduplicate users
        .map(async (rcUsername: string) => {
          // generate transaction id
          const transactionId = Buffer.from(
            [matrixMessageId, reactionEmoji, rcUsername].join('\0')
          ).toString('base64url')
          // lookup user access token
          const userMapping = await getUserMappingByName(rcUsername)
          if (!userMapping || !userMapping.accessToken) {
            log.warn(
              `Could not find user mapping for name: ${rcUsername}, skipping reaction ${reactionEmoji} for message ${matrixMessageId}`
            )
            return
          }

          const userSessionOptions = formatUserSessionOptions(
            userMapping.accessToken
          )
          log.http(
            `Adding reaction to message ${matrixMessageId} with symbol ${reactionEmoji} for user ${rcUsername}`
          )
          // put reaction
          try {
            await executeAndHandleMissingMember(() =>
              axios.put(
                `/_matrix/client/v3/rooms/${matrixRoomId}/send/m.reaction/${transactionId}`,
                {
                  'm.relates_to': {
                    rel_type: 'm.annotation',
                    event_id: matrixMessageId,
                    key: reactionEmoji,
                  },
                },
                userSessionOptions
              )
            )
          } catch (error) {
            if (
              error instanceof AxiosError &&
              error.response &&
              error.response.data.errcode === 'M_DUPLICATE_ANNOTATION'
            ) {
              log.debug(
                `Duplicate reaction to message ${matrixMessageId} with symbol ${reactionEmoji} for user ${rcUsername}, skipping.`
              )
            } else {
              throw error
            }
          }
        })
    )
  }
}

/**
 * Lookup an emoji first by its name representation and return a unicode emoji.
 *
 * First the emojis.json is looked up, then the emoji library. If no emoji is found, the search string is returned.
 * @param searchString Name of the emoji, possibly surrounded by colons
 * @returns The found emoji or `searchString`
 */
export function getEmoji(searchString: string): string {
  return (
    (emojiMap as EmojiMappings)[searchString] ||
    emoji.get(searchString.replaceAll(':', '')) ||
    searchString
  )
}

/**
 * Handle a line of a Rocket.Chat message JSON export
 * @param rcMessage A Rocket.Chat message object
 */
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
    log.warn(
      `Message ${rcMessage._id} is of unhandled type ${rcMessage.t}, skipping.`
    )
    return
  }

  const ts = new Date(rcMessage.ts.$date).valueOf()
  if (rcMessage.file) {
    if (rcMessage.attachments?.length == 1) {
      const path = './inputs/files/' + rcMessage.file._id
      if (!fs.existsSync(path)) {
        log.warn(`File doesn't exist locally, skipping Upload.`)
        return
      }
      const mxcurl = await uploadFile(
        rcMessage.u._id,
        ts,
        path,
        rcMessage.file.name,
        rcMessage.file.type
      )
      rcMessage.msg = rcMessage.file.name
      rcMessage.file.url = mxcurl
      if (rcMessage.attachments[0].image_type) {
        rcMessage.type = 'm.image'
      } else {
        rcMessage.type = 'm.file'
      }
    } else {
      log.warn(
        `Many attachments in ${rcMessage.u._id} not handled, skipping Upload.`
      )
      return
    }
  } else if (rcMessage.attachments && rcMessage.attachments.length > 0) {
    log.warn(`Attachment in ${rcMessage.u._id} not handled, skipping.`)
    return
  } else {
    rcMessage.type = 'm.text'
  }

  await handleMessage(rcMessage, room_id, ts)
}

async function handleMessage(
  rcMessage: RcMessage,
  room_id: string,
  ts: number
) {
  const user_id = await getUserId(rcMessage.u._id)
  if (!user_id) {
    log.warn(
      `Could not find author ${rcMessage.u.username} for message ${rcMessage._id}, skipping.`
    )
    return
  }
  const matrixMessage = await mapMessage(rcMessage)
  if (rcMessage.file) {
    matrixMessage.url = rcMessage.file.url
  }

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
  await executeAndHandleMissingMember(() =>
    createEventsAndMapping(matrixMessage, room_id, user_id, ts, rcMessage)
  )
}

/**
 * Wrapper function to combine the creation of a message, the reactions, adding of authors and the database mapping
 * @param matrixMessage The Matrix message event body
 * @param room_id The Matrix room ID
 * @param user_id The Matrix ID of the author
 * @param ts The Timestamp the message was originally created
 * @param rcMessage The originam Rocket.Chat message object
 */
async function createEventsAndMapping(
  matrixMessage: MatrixMessage,
  room_id: string,
  user_id: string,
  ts: number,
  rcMessage: RcMessage
): Promise<void> {
  const event_id = await createMessage(
    matrixMessage,
    room_id,
    user_id,
    ts,
    rcMessage._id
  )
  if (rcMessage.reactions) {
    log.info(
      `Parsing reactions for message ${rcMessage._id}`,
      rcMessage.reactions
    )
    await handleReactions(rcMessage.reactions, event_id, room_id)
  }
  await createMapping(rcMessage._id, event_id)
}
