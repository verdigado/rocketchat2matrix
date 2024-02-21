import dotenv from 'dotenv'
dotenv.config()
import { AxiosError } from 'axios'
import lineByLine from 'n-readlines'
import 'reflect-metadata'
import { Entity, entities } from './Entities'
import { handleDirectChats } from './handlers/directChats'
import { handlePinnedMessages } from './handlers/pinnedMessages'
import { handle as handleMessage } from './handlers/messages'
import { getFilteredMembers, handle as handleRoom } from './handlers/rooms'
import { handle as handleUser } from './handlers/users'
import log from './helpers/logger'
import {
  getAllMappingsByType,
  getMappingByMatrixId,
  getMemberships,
  initStorage,
} from './helpers/storage'
import {
  axios,
  formatUserSessionOptions,
  getMatrixMembers,
  whoami,
} from './helpers/synapse'

log.info('rocketchat2matrix starts.')

/**
 * Reads a file line by line and handles the lines parsed to JSON according to the expected type
 * @param entity The Entity with it's file name and type definitions
 */
async function loadRcExport(entity: Entity) {
  const rl = new lineByLine(`./inputs/${entities[entity].filename}`)

  let line: false | Buffer
  while ((line = rl.next())) {
    const item = JSON.parse(line.toString())
    switch (entity) {
      case Entity.Users:
        await handleUser(item)
        break

      case Entity.Rooms:
        await handleRoom(item)
        break

      case Entity.Messages:
        await handleMessage(item)
        break

      default:
        throw new Error(`Unhandled Entity: ${entity}`)
    }
  }
}

/**
 * Remove all excess Matrix room members, which are not part of the Rocket.Chat room and not an admin
 */
async function removeExcessRoomMembers() {
  const roomMappings = await getAllMappingsByType(
    entities[Entity.Rooms].mappingType
  )
  if (!roomMappings) {
    throw new Error(`No room mappings found`)
  }

  await Promise.all(
    roomMappings.map(async (roomMapping) => {
      log.info(
        `Checking memberships for room ${roomMapping.rcId} / ${roomMapping.matrixId}`
      )
      // get all memberships from db
      const rcMemberIds = await getMemberships(roomMapping.rcId)
      const memberMappings = await getFilteredMembers(rcMemberIds, '')
      const memberNames: string[] = memberMappings.map(
        (memberMapping) => memberMapping.matrixId || ''
      )

      // get each mx rooms' mx users
      const actualMembers: string[] = await getMatrixMembers(
        roomMapping.matrixId || ''
      )

      // do action for any user in mx, but not in rc
      const adminUsername = process.env.ADMIN_USERNAME || ''
      await Promise.all(
        actualMembers.map(async (actualMember) => {
          if (
            !memberNames.includes(actualMember) &&
            !actualMember.includes(adminUsername) // exclude admin from removal
          ) {
            log.warn(
              `Member ${actualMember} should not be in room ${roomMapping.matrixId}, removing`
            )
            const memberMapping = await getMappingByMatrixId(actualMember)
            if (!memberMapping || !memberMapping.accessToken) {
              throw new Error(
                `Could not find access token for member ${actualMember}, this is a bug`
              )
            }

            await axios.post(
              `/_matrix/client/v3/rooms/${roomMapping.matrixId}/leave`,
              {},
              formatUserSessionOptions(memberMapping.accessToken)
            )
          }
        })
      )
    })
  )
}

async function main() {
  try {
    await whoami()
    await initStorage()

    log.info('Parsing users')
    await loadRcExport(Entity.Users)
    log.info('Parsing rooms')
    await loadRcExport(Entity.Rooms)
    log.info('Parsing messages')
    await loadRcExport(Entity.Messages)
    log.info('Checking room memberships')
    await removeExcessRoomMembers()
    log.info('Setting direct chats to be displayed as such for each user')
    await handleDirectChats()
    log.info('Setting pinned messages in rooms')
    await handlePinnedMessages()

    log.info('Done.')
  } catch (error) {
    if (error instanceof AxiosError) {
      log.error(`Error during request: ${error.message}`)
      log.error(`Request: ${error.request?.method} ${error.request?.path}`)
      log.error(`Response: ${error.response?.status}`, error.response?.data)
    } else {
      log.error(`Encountered an error while booting up: ${error}`, error)
    }
  }
}

main()
