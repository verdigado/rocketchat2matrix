import dotenv from 'dotenv'
dotenv.config()
import { AxiosError } from 'axios'
import lineByLine from 'n-readlines'
import { exit } from 'node:process'
import 'reflect-metadata'
import { Entity, entities } from './Entities'
import { existsSync } from 'node:fs'
import { getStoreDir, isE2EE, validateE2EEConfig } from './e2ee/config'
import { loadSdk } from './e2ee/sdk'
import { closeAllCryptoSessions } from './e2ee/session'
import { handleDirectChats } from './handlers/directChats'
import { handleE2EE } from './handlers/e2ee'
import { handleRoomMemberships } from './handlers/handleRoomMemberships'
import { handle as handleMessage } from './handlers/messages'
import { handlePinnedMessages } from './handlers/pinnedMessages'
import { handle as handleRoom } from './handlers/rooms'
import { handle as handleUser } from './handlers/users'
import log from './helpers/logger'
import { initStorage } from './helpers/storage'
import { checkAppserviceNamespace, whoami } from './helpers/tuwunel'

log.info('rocketchat2tuwunel starts.')

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
    if (isE2EE()) {
      // Fail before anything is migrated if the settings or the crypto
      // engine are unusable
      validateE2EEConfig()
      loadSdk()
      log.info(
        'E2EE mode: rooms, messages and reactions will be end-to-end encrypted'
      )
    } else if (existsSync(getStoreDir())) {
      // Never finish an encrypted migration in clear
      throw new Error(
        `${getStoreDir()} exists: a previous run used E2EE=true. Set E2EE=true again, or start over with reset.sh.`
      )
    }
    await whoami()
    await initStorage()

    log.info('Parsing users')
    await loadRcExport(Entity.Users)
    await checkAppserviceNamespace()
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
    if (isE2EE()) {
      log.info('Preparing the recovery of the encrypted history')
      await handleE2EE()
    }

    await closeAllCryptoSessions()
    log.info('Done.')
  } catch (error) {
    if (error instanceof AxiosError) {
      log.error(`Error during request: ${error.message}`)
      log.error(`Request: ${error.request?.method} ${error.request?.path}`)
      log.error(`Response: ${error.response?.status}`, error.response?.data)
    } else {
      log.error(`Encountered an error while booting up: ${error}`, error)
    }
    await closeAllCryptoSessions()
    exit(1)
  }
}

main()
