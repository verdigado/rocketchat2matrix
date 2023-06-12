import dotenv from 'dotenv'
dotenv.config()
import lineByLine from 'n-readlines'
import 'reflect-metadata'
import { IdMapping } from './entity/IdMapping'
import { Membership } from './entity/Membership'
import { RcUser, createUser } from './handlers/users'
import log from './helpers/logger'
import { getMapping, initStorage, save } from './helpers/storage'
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
        log.debug(`Parsing user: ${rcUser.name}: ${rcUser._id}`)

        // Check for exclusion
        if (
          rcUser.roles.some((e) => ['app', 'bot'].includes(e)) ||
          (process.env.EXCLUDED_USERS || '').split(',').includes(rcUser._id)
        ) {
          log.debug('User excluded. Skipping.')
          break
        }

        let mapping = await getMapping(rcUser._id, entities[entity].mappingType)
        if (mapping && mapping.matrixId) {
          log.debug('Mapping exists:', mapping)
        } else {
          const matrixUser = await createUser(rcUser)
          mapping = new IdMapping()
          mapping.rcId = rcUser._id
          mapping.matrixId = matrixUser.user_id
          mapping.type = entities[entity].mappingType
          mapping.accessToken = matrixUser.access_token

          await save(mapping)
          log.debug('Mapping added:', mapping)

          // Add user to room mapping (specific to users)
          rcUser.__rooms.forEach(async (rcRoomId: string) => {
            const membership = new Membership()
            membership.rcRoomId = rcRoomId
            membership.rcUserId = rcUser._id

            await save(membership)
            log.debug(`${rcUser.username} membership for ${rcRoomId} created`)
          })
        }

        break

      case Entities.Rooms:
        const rcRoom: RcRoom = item
        log.debug(`Room: ${rcRoom.name}`, rcRoom)

        let roomMapping = await getMapping(
          rcRoom._id,
          entities[entity].mappingType
        )
        if (roomMapping && roomMapping.matrixId) {
          log.debug('Mapping exists:', roomMapping)
        } else {
          const matrixRoom = await createRoom(rcRoom)
          roomMapping = new IdMapping()
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
    // await loadRcExport(Entities.Users)
    await loadRcExport(Entities.Rooms)
    log.info('Done.')
  } catch (error) {
    log.error(`Encountered an error while booting up: ${error}`)
  }
}

main()
