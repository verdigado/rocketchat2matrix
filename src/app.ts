import dotenv from 'dotenv'
dotenv.config()
import { AxiosError } from 'axios'
import lineByLine from 'n-readlines'
import { exit } from 'node:process'
import 'reflect-metadata'
import { Entity, entities } from './Entities'
import { handleDirectChats } from './handlers/directChats'
import { handleRoomMemberships } from './handlers/handleRoomMemberships'
import { handle as handleMessage } from './handlers/messages'
import { handlePinnedMessages } from './handlers/pinnedMessages'
import { handle as handleRoom } from './handlers/rooms'
import { handle as handleUser } from './handlers/users'
import log from './helpers/logger'
import { initStorage } from './helpers/storage'
import { whoami } from './helpers/synapse'

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
    log.info('Setting direct chats to be displayed as such for each user')
    await handleDirectChats()
    log.info('Setting pinned messages in rooms')
    await handlePinnedMessages()
    log.info('Checking room memberships')
    await handleRoomMemberships()

    log.info('Done.')
  } catch (error) {
    if (error instanceof AxiosError) {
      log.error(`Error during request: ${error.message}`)
      log.error(`Request: ${error.request?.method} ${error.request?.path}`)
      log.error(`Response: ${error.response?.status}`, error.response?.data)
    } else {
      log.error(`Encountered an error while booting up: ${error}`, error)
    }
    exit(1)
  }
}

main()
