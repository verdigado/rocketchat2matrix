import fs from 'node:fs'
import readline from 'node:readline'
import log from './logger'
import { whoami } from './synapse'
log.info('rocketchat2matrix starts.')

interface RcUser {
  username: string
  name: string
  roles: string[]
  _id: string
  __rooms: string[]
}

function loadRcExport(filename: string) {
  const rl = readline.createInterface({
    input: fs.createReadStream(`./inputs/${filename}`, {
      encoding: 'utf-8',
    }),
    crlfDelay: Infinity,
  })

  rl.on('line', (line) => {
    const entity: RcUser = JSON.parse(line)
    log.debug(`User: ${entity.name}`)
  })
}

async function main() {
  try {
    await whoami()
    await loadRcExport('users.json')
  } catch (error) {
    log.error(`Encountered an error booting up`)
  }
}

main()
