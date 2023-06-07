import { createHmac } from 'node:crypto'
import log from '../helpers/logger'
import { axios } from '../helpers/synapse'

export type RcUser = {
  _id: string
  username: string
  name: string
  roles: string[]
  __rooms: string[]
}

export type MatrixUser = {
  user_id: string
  username: string
  displayname: string
  password: string
  admin: boolean
  nonce?: string
  mac?: string
  access_token?: string
}

export type AccessToken = {
  access_token: string
  device_id: string
  home_server: string
  user_id: string
}

export function mapUser(rcUser: RcUser): MatrixUser {
  return {
    user_id: '',
    username: rcUser.username,
    displayname: rcUser.name,
    password: '',
    admin: rcUser.roles.includes('admin'),
  }
}

const registration_shared_secret = process.env.REGISTRATION_SHARED_SECRET || ''
if (!registration_shared_secret) {
  const message = 'No REGISTRATION_SHARED_SECRET found in .env.'
  log.error(message)
  throw new Error(message)
}

export function generateHmac(user: MatrixUser): string {
  const hmac = createHmac('sha1', registration_shared_secret)
  hmac.write(
    `${user.nonce}\0${user.username}\0${user.password}\0${
      user.admin ? 'admin' : 'notadmin'
    }`
  )
  hmac.end()
  return hmac.read().toString('hex')
}

async function getUserRegistrationNonce(): Promise<string> {
  return (await axios.get('/_synapse/admin/v1/register')).data.nonce
}

async function registerUser(user: MatrixUser): Promise<AccessToken> {
  return (await axios.post('/_synapse/admin/v1/register', user)).data
}

export async function createUser(rcUser: RcUser): Promise<MatrixUser> {
  const user = mapUser(rcUser)
  user.nonce = await getUserRegistrationNonce()
  user.mac = generateHmac(user)
  const accessToken = await registerUser(user)
  user.user_id = accessToken.user_id
  user.access_token = accessToken.access_token
  log.info(`User ${rcUser.username} created:`, user)

  delete user.nonce
  delete user.mac

  return user
}
