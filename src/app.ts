import dotenv from 'dotenv'
dotenv.config()
import fs from 'node:fs'
import log from './logger'
import readline from 'node:readline'
import { RcUser, createUser } from './users'
import { whoami } from './synapse'
import 'reflect-metadata'
import { DataSource } from 'typeorm'
import { IdMapping } from './entity/IdMapping'
import { Membership } from './entity/Membership'

log.info('rocketchat2matrix starts.')

const AppDataSource = new DataSource({
  type: 'sqlite',
  database: 'db.sqlite',
  entities: [IdMapping, Membership],
  synchronize: true,
  logging: false,
})

const enum Entities {
  Users = 'users.json',
  Rooms = 'rocketchat_room.json',
  Messages = 'rocketchat_message.json',
}

function loadRcExport(entity: Entities): Promise<void> {
  const rl = readline.createInterface({
    input: fs.createReadStream(`./inputs/${entity}`, {
      encoding: 'utf-8',
    }),
    crlfDelay: Infinity,
  })

  rl.on('line', async (line) => {
    const item = JSON.parse(line)
    switch (entity) {
      case Entities.Users:
        const rcUser: RcUser = item
        log.info(`User: ${rcUser.name}: ${rcUser._id}`)

        // Check for exclusion
        if (
          rcUser.roles.some((e) => ['app', 'bot'].includes(e)) ||
          [
            'rocket.cat',
            '5kdLWNTys3u2MhB2H', // verdiadmin
          ].includes(rcUser._id)
        ) {
          log.debug('User excluded. Skipping.')
          break
        }

        let mapping = await AppDataSource.manager.findOneBy(IdMapping, {
          rcId: rcUser._id,
          type: 0,
        })
        if (mapping && mapping.matrixId) {
          log.debug('Mapping exists:', mapping)
        } else {
          const matrixUser = await createUser(rcUser)
          mapping = new IdMapping()
          mapping.rcId = rcUser._id
          mapping.matrixId = matrixUser.user_id
          mapping.type = 0

          AppDataSource.manager.save(mapping)
          log.debug('Mapping added:', mapping)

          // Add user to room mapping (specific to users)
          rcUser.__rooms.forEach(async (rcRoomId: string) => {
            const membership = new Membership()
            membership.rcRoomId = rcRoomId
            membership.rcUserId = rcUser._id

            await AppDataSource.manager.save(membership)
            log.debug(`${rcUser.username} membership for ${rcRoomId} created`)
          })
        }

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
  return new Promise((resolve) => {
    rl.on('close', () => {
      resolve()
    })
  })
}

async function main() {
  try {
    await whoami()
    await AppDataSource.initialize()
    await loadRcExport(Entities.Users)
    log.info('Done.')
  } catch (error) {
    log.error(`Encountered an error while booting up`)
  }
}

main()
