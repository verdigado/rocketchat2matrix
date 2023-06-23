import dotenv from 'dotenv'
dotenv.config()
import lineByLine from 'n-readlines'
import 'reflect-metadata'
import { handle as handleRoom } from './handlers/rooms'
import { handle as handleUser } from './handlers/users'
import log from './helpers/logger'
import { initStorage } from './helpers/storage'
import { whoami } from './helpers/synapse'

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
        await handleUser(item)
        break

      case Entities.Rooms:
        await handleRoom(item)
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
