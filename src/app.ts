import dotenv from 'dotenv'
dotenv.config()
import { AxiosError } from 'axios'
import lineByLine from 'n-readlines'
import { exit } from 'node:process'
import { PromisePool } from '@supercharge/promise-pool'
import 'reflect-metadata'
import { Entity, entities } from './Entities'
import { handleDirectChats } from './handlers/directChats'
import { handleRoomMemberships } from './handlers/handleRoomMemberships'
import { handle as handleMessage, RcMessage } from './handlers/messages'
import { handlePinnedMessages } from './handlers/pinnedMessages'
import { handle as handleRoom, RcRoom } from './handlers/rooms'
import { handle as handleUser, RcUser } from './handlers/users'
import log from './helpers/logger'
import { initStorage } from './helpers/storage'
import { whoami } from './helpers/synapse'

log.info('rocketchat2matrix starts.')

/**
 * Reads a file line by line and handles the lines parsed to JSON according to the expected type
 * @param entity The Entity with it's file name and type definitions
 */
async function loadRcExport(entity: Entity) {
  const concurrency = parseInt(process.env.CONCURRENCY_LIMIT || '50')
  const userQueue: RcUser[] = []
  const roomQueue: RcRoom[] = []
  const messagesPerRoom: Map<string, RcMessage[]> = new Map()

  const rl = new lineByLine(`./inputs/${entities[entity].filename}`)

  let line: false | Buffer
  switch (entity) {
    case Entity.Users:
      while ((line = rl.next())) {
        const item = JSON.parse(line.toString())
        userQueue.push(item)
      }
      await PromisePool.withConcurrency(concurrency)
        .for(userQueue)
        .process((item) => handleUser(item))
      break

    case Entity.Rooms:
      while ((line = rl.next())) {
        const item = JSON.parse(line.toString())
        roomQueue.push(item)
      }
      await PromisePool.withConcurrency(concurrency)
        .for(roomQueue)
        .process((item) => handleRoom(item))
      break

    case Entity.Messages:
      while ((line = rl.next())) {
        const item = JSON.parse(line.toString())
        if (messagesPerRoom.has(item.rid)) {
          messagesPerRoom.get(item.rid)?.push(item)
        } else {
          messagesPerRoom.set(item.rid, [item])
        }
      }
      await PromisePool.withConcurrency(concurrency)
        .for(messagesPerRoom.values())
        .process(async (room) => {
          for (const item of room) {
            await handleMessage(item)
          }
        })
      break

    default:
      throw new Error(`Unhandled Entity: ${entity}`)
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
    log.info('Checking room memberships and setting read status')
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
