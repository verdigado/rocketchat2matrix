import dotenv from 'dotenv'
dotenv.config()
import lineByLine from 'n-readlines'
import 'reflect-metadata'
import { handle as handleRoom } from './handlers/rooms'
import { handle as handleUser } from './handlers/users'
import { handle as handleMessage } from './handlers/messages'
import log from './helpers/logger'
import { initStorage } from './helpers/storage'
import { whoami } from './helpers/synapse'
import { Entity, entities } from './Entities'

log.info('rocketchat2matrix starts.')

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
    log.info('Done.')
  } catch (error) {
    log.error(`Encountered an error while booting up: ${error}`, error)
  }
}

main()
