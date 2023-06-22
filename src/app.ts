import dotenv from 'dotenv'
dotenv.config()
import lineByLine from 'n-readlines'
import 'reflect-metadata'
import { IdMapping } from './entity/IdMapping'
import { RcUser, createUser } from './handlers/users'
import log from './helpers/logger'
import {
  createMembership,
  getMapping,
  getRoomId,
  getUserId,
  initStorage,
  save,
} from './helpers/storage'
import { whoami } from './helpers/synapse'
import { RcRoom, createRoom } from './handlers/rooms'

log.info('rocketchat2matrix starts.')

const enum Entities {
  Users = 'users',
  Rooms = 'rooms',
  Messages = 'messages',
}

type EntityConfig = {
  filename: string
  mappingType: number
}

const entities: { [key in Entities]: EntityConfig } = {
  users: {
    filename: 'users.json',
    mappingType: 0,
  },
  rooms: {
    filename: 'rocketchat_room.json',
    mappingType: 1,
  },
  messages: {
    filename: 'rocketchat_message.json',
    mappingType: 2,
  },
}

async function loadRcExport(entity: Entities) {
  const rl = new lineByLine(`./inputs/${entities[entity].filename}`)

  let line: false | Buffer
  while ((line = rl.next())) {
    const item = JSON.parse(line.toString())
    switch (entity) {
      case Entities.Users:
        const rcUser: RcUser = item
        log.info(`Parsing user: ${rcUser.name}: ${rcUser._id}`)

        // Check for exclusion
        if (
          rcUser.roles.some((e) => ['app', 'bot'].includes(e)) ||
          (process.env.EXCLUDED_USERS || '').split(',').includes(rcUser._id)
        ) {
          log.debug('User excluded. Skipping.')
          break
        }

        const matrixUserId = await getUserId(rcUser._id)
        if (matrixUserId) {
          log.debug(`Mapping exists: ${rcUser._id} -> ${matrixUserId}`)
        } else {
          const matrixUser = await createUser(rcUser)
          const mapping = new IdMapping()
          mapping.rcId = rcUser._id
          mapping.matrixId = matrixUser.user_id
          mapping.type = entities[entity].mappingType
          mapping.accessToken = matrixUser.access_token

          await save(mapping)
          log.debug('Mapping added:', mapping)

          // Add user to room mapping (specific to users)
          await Promise.all(
            rcUser.__rooms.map(async (rcRoomId: string) => {
              await createMembership(rcRoomId, rcUser._id)
              log.debug(`${rcUser.username} membership for ${rcRoomId} created`)
            })
          )
        }

        break

      case Entities.Rooms:
        const rcRoom: RcRoom = item
        log.info(`Parsing room ${rcRoom.name || 'with ID: ' + rcRoom._id}`)

        const matrixRoomId = await getRoomId(rcRoom._id)
        if (matrixRoomId) {
          log.debug(`Mapping exists: ${rcRoom._id} -> ${matrixRoomId}`)
        } else {
          const matrixRoom = await createRoom(rcRoom)
          const roomMapping = new IdMapping()
          roomMapping.rcId = rcRoom._id
          roomMapping.matrixId = matrixRoom.room_id
          roomMapping.type = entities[entity].mappingType

          await save(roomMapping)
          log.debug('Mapping added:', roomMapping)
        }
        break

      case Entities.Messages:
        log.debug(`Message: ${item.name}`)
        break

      default:
        throw new Error(`Unhandled Entity: ${entity}`)
    }
  }
}

async function main() {
  try {
    await whoami()
    await initStorage()
    log.info('Parsing users')
    await loadRcExport(Entities.Users)
    log.info('Parsing rooms')
    await loadRcExport(Entities.Rooms)
    log.info('Done.')
  } catch (error) {
    log.error(`Encountered an error while booting up: ${error}`, error)
  }
}

main()
