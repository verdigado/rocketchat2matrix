import * as emoji from 'node-emoji'
import { Entity, entities } from '../Entities'
import { IdMapping } from '../entity/IdMapping'
import log from '../helpers/logger'
import {
  getMappingByMatrixId,
  getMessageId,
  getRoomId,
  getUserId,
  getUserMappingByName,
  save,
} from '../helpers/storage'
import {
  axios,
  formatUserSessionOptions,
  getDomainName,
} from '../helpers/synapse'
import reactionKeys from '../reactions.json'
import { executeAndHandleMissingMember } from './rooms'
import { AxiosError } from 'axios'

const applicationServiceToken = process.env.AS_TOKEN || ''
if (!applicationServiceToken) {
  const message = 'No AS_TOKEN found in .env.'
  log.error(message)
  throw new Error(message)
}

export type Md = {
  type: string
  language?: string
  value: {
    type: string
    value: string
  }[]
}[]

export type Attachements = {
  text: string
  md?: Md
  message_link?: string
  author_name?: string
  author_icon?: string
  type?: string
}[]

/**
 * Type of Rocket.Chat messages
 */
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
  md?: Md
  attachments?: Attachements
}

/**
 * Type of Matrix message event bodies
 */
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
  'm.mentions'?: {
    user_ids: string[]
  }
  format?: string
  formatted_body?: string
}

/**
 * Reaction emojis translated from Rocket.Chat to Unicode emojis, which Matrix uses
 */
export type ReactionKeys = {
  [key: string]: string
}

/**
 * Translate a Rocket.Chat message to a Matrix message event body
 * @param rcMessage The Rocket.Chat message to convert
 * @returns The Matrix event body
 */
export function mapMessage(rcMessage: RcMessage): MatrixMessage {
  return {
    body: rcMessage.msg,
    msgtype: 'm.text',
    type: 'm.room.message',
  }
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
    const reactionKey: string =
      (reactionKeys as ReactionKeys)[reaction] ||
      emoji.get(reaction.replaceAll(':', '')) ||
      ''

    if (!reactionKey) {
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
            [matrixMessageId, reactionKey, rcUsername].join('\0')
          ).toString('base64url')
          // lookup user access token
          const userMapping = await getUserMappingByName(rcUsername)
          if (!userMapping || !userMapping.accessToken) {
            log.warn(
              `Could not find user mapping for name: ${rcUsername}, skipping reaction ${reactionKey} for message ${matrixMessageId}`
            )
            return
          }

          const userSessionOptions = formatUserSessionOptions(
            userMapping.accessToken
          )
          log.http(
            `Adding reaction to message ${matrixMessageId} with symbol ${reactionKey} for user ${rcUsername}`
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
                    key: reactionKey,
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
                `Duplicate reaction to message ${matrixMessageId} with symbol ${reactionKey} for user ${rcUsername}, skipping.`
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
 * format message body to handle Links
 * @param formatted_body, matrixMessage
 */
export async function formatLink(formatted_body: string): Promise<string[]> {
  const regexMessageId: RegExp = /\[ \]\(https:\/[^?]+\?msg=([^)]+)\)/
  let msgMatrixId: string = ''
  let messageMatrixId: string = ''

  const match: RegExpExecArray | null = regexMessageId.exec(formatted_body)
  if (match && match[1]) {
    const msgId: string = match[1]
    log.warn(msgId)
    const msgMatrixId = await getMessageId(msgId)
    if (msgMatrixId) {
      messageMatrixId = msgMatrixId
      log.debug(`message matrix id ${messageMatrixId}`)
    }
  } else {
    log.warn('No message ID found')
  }
  return [formatted_body, messageMatrixId]
}

/**
 * get text and author from linked message and compute new formatted body
 * @param formatted_body, attachments
 */
export async function getFromAttachement(
  formatted_body: string,
  attachements: Attachements,
  matrixMessage: MatrixMessage
): Promise<string[]> {
  const regexMessageId: RegExp = /\[ \]\(https:\/[^?]+\?msg=([^)]+)\)/
  const regexUserName: RegExp = /\/avatar\/([^?]+)/
  let authorMatrixId: string = ''
  let message: string = ''
  for (const item of attachements) {
    if (item.message_link && item.author_icon && item.text) {
      const match: RegExpExecArray | null = regexUserName.exec(item.author_icon)
      if (match && match[1]) {
        const username: string = match[1]
        log.warn(username)
        const userMapping = await getUserMappingByName(username)
        if (!userMapping || !userMapping.matrixId) {
          log.warn(`Could not find user mapping for name: ${username}`)
        } else {
          log.warn(userMapping.matrixId)
          authorMatrixId = userMapping.matrixId
        }
      } else {
        log.warn('No message ID found')
      }
      const textInside: string = item.text.replace(regexMessageId, '')
      message = textInside
      break
    }
  }
  return [authorMatrixId, formatted_body, message]
}

/**
 * format message body to handle code
 * @param formatted_body, matrixMessage
 */
export function formatCode(
  formatted_body: string,
  matrixMessage: MatrixMessage
): string {
  let concat: string = ''
  const substrings = formatted_body.split('```')
  for (let i = 0; i < substrings.length; i++) {
    if (i !== 0 && i !== substrings.length - 1) {
      if (substrings[i].startsWith('\n')) {
        substrings[i] = substrings[i].substring(1)
      }
      if (substrings[i].endsWith('\n')) {
        substrings[i] = substrings[i].substring(0, substrings[i].length - 1)
      }
      substrings[i] = '<pre><code>' + substrings[i] + '</code></pre>'
    }
    if (substrings.length === 2) {
      substrings[1] = '<pre><code>' + substrings[1] + '</code></pre>'
    }
    concat = concat + substrings[i]
  }
  if (concat !== formatted_body) {
    matrixMessage.formatted_body = concat
    matrixMessage.format = `org.matrix.custom.html`
  }
  return concat
}

/**
 * replace string by other string
 * @param input string, string to replace, replacement string
 */
export function replaceString(
  str: string,
  toreplace: string,
  replacement: string
): string {
  // Find the index of the first occurrence of triple backticks
  const index = str.indexOf(toreplace)
  if (index === -1) {
    return str // Return the original string if no triple backticks found
  }

  // Replace the first occurrence of triple backticks with the replacement string
  const replacedString =
    str.slice(0, index) + replacement + str.slice(index + toreplace.length)

  return replacedString
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
  if (rcMessage.msg) {
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
    let domain: string = getDomainName()
    let formatted_body: string = matrixMessage.body
    formatted_body = formatCodeBis(formatted_body, matrixMessage)
    if (rcMessage.attachments) {
      for (const attach of rcMessage.attachments) {
        if (!attach.type) {
          const regexMessageId: RegExp = /\[ \]\(https:\/[^?]+\?msg=([^)]+)\)/
          let messageMatrixId: string = ''
          let authorMatrixId: string = ''
          let message: string = ''
          ;[formatted_body, messageMatrixId] = await formatLink(formatted_body)
          ;[authorMatrixId, formatted_body, message] = await getFromAttachement(
            formatted_body,
            rcMessage.attachments,
            matrixMessage
          )
          const new_body: string = `> <${authorMatrixId}> ${message}`
          const form_body: string = `<mx-reply><blockquote><a href=\"https://matrix.to/#/${room_id}/${messageMatrixId}?via=${domain}\">In reply to</a> <a href=\"https://matrix.to/#/${authorMatrixId}\">${authorMatrixId}</a><br>${message}</blockquote></mx-reply>`
          const replacedStr: string = matrixMessage.body.replace(
            regexMessageId,
            new_body
          )
          const replacedStrForm: string = formatted_body.replace(
            regexMessageId,
            form_body
          )
          matrixMessage.body = replacedStr
          formatted_body = replacedStrForm
          matrixMessage.formatted_body = formatted_body
          matrixMessage.format = `org.matrix.custom.html`
        }
      }
    }
    await executeAndHandleMissingMember(() =>
      createEventsAndMapping(matrixMessage, room_id, user_id, ts, rcMessage)
    )
  } else {
    log.warn('no msg')
    return
  }
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
