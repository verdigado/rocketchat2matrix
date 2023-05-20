import { access_token } from './config/synapse_access_token.json'
// import rcUsers from '../inputs/users.json'
import fs from 'node:fs'
import readline from 'node:readline'
import axios from 'axios'
import winston from 'winston'

const log = (module.exports = winston.createLogger({
  level: 'debug',
  transports: [new winston.transports.Console()],
  format: winston.format.combine(
    winston.format.colorize({ all: true }),
    winston.format.simple()
  ),
}))
log.info('rocketchat2matrix starts.')

axios.defaults.baseURL = 'http://localhost:8008'
axios.defaults.headers.common['Authorization'] = ` Bearer ${access_token}`
axios.defaults.headers.post['Content-Type'] = 'application/json'

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
  const whoami = axios.get('/_matrix/client/v3/account/whoami')
  whoami
    .then((response) => log.info('Logged into synapse as', response.data))
    .catch((reason) => log.error(`Login to synapse failed: ${reason}`))

  loadRcExport('users.json')
}

main()
