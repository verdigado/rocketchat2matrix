import fs from 'node:fs'
import readline from 'node:readline'
import log from './logger'
import { whoami } from './synapse'
log.info('rocketchat2matrix starts.')

const enum Entities {
  Users = 'users.json',
  Rooms = 'rocketchat_room.json',
  Messages = 'rocketchat_message.json',
}

function loadRcExport(entity: Entities) {
  const rl = readline.createInterface({
    input: fs.createReadStream(`./inputs/${entity}`, {
      encoding: 'utf-8',
    }),
    crlfDelay: Infinity,
  })

  rl.on('line', (line) => {
    const item = JSON.parse(line)
    switch (entity) {
      case Entities.Users:
        log.debug(`User: ${item.name}`)
        break

      case Entities.Rooms:
        log.debug(`Room: ${item.name}`)
        break

      case Entities.Messages:
        log.debug(`Message: ${item.name}`)
        break

      default:
        throw new Error(`Unhandled Entity: ${entity}`)
    }
  })
}

async function main() {
  try {
    await whoami()
    await loadRcExport(Entities.Users)
  } catch (error) {
    log.error(`Encountered an error booting up`)
  }
}

main()
