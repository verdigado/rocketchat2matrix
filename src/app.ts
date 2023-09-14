import dotenv from 'dotenv'
dotenv.config()
import { AxiosError } from 'axios'
import lineByLine from 'n-readlines'
import 'reflect-metadata'
import { Entity, entities } from './Entities'
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
import { axios, formatUserSessionOptions, whoami } from './helpers/synapse'

const applicationServiceToken = process.env.AS_TOKEN || ''

log.info('rocketchat2matrix starts.')

// eslint-disable-next-line @typescript-eslint/no-unused-vars
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

async function removeExcessRoomMembers() {
  const roomMappings = await getAllMappingsByType(
    entities[Entity.Rooms].mappingType
  )
  if (!roomMappings) {
    throw new Error(`No room mappings found`)
  }

  roomMappings.forEach(async (roomMapping) => {
    log.info(
      `Checking memberships for room ${roomMapping.rcId} / ${roomMapping.matrixId}:`
    )
    // get all memberships from db
    const rcMemberIds = await getMemberships(roomMapping.rcId)
    const memberMappings = await getFilteredMembers(rcMemberIds, '')
    const memberNames: string[] = memberMappings.map(
      (memberMapping) => memberMapping.matrixId || ''
    )
    // get each mx rooms' mx users
    const actualMembers: string[] = Object.keys(
      (
        await axios.get(
          `/_matrix/client/v3/rooms/${roomMapping.matrixId}/joined_members`,
          formatUserSessionOptions(applicationServiceToken)
        )
      ).data.joined
    )

    // do action for any user in mx, but not in rc
    await Promise.all(
      actualMembers.map(async (actualMember) => {
        if (!memberNames.includes(actualMember)) {
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
