import { axios } from './synapse'
import { createHmac } from 'node:crypto'

export type RcUser = {
  username: string
  name: string
  roles: string[]
  _id: string
  __rooms: string[]
}

export type MatrixUser = {
  user_id?: string
  nonce?: string
  username: string
  displayname: string
  password?: string
  admin: boolean
  mac?: string
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

const registration_shared_secret =
  'vkq7zfBDt4A1NmMN6jJ*g+,G~.R:QuC_xI:~7~jQ_6kJ6O~JrG'

function generateHmac(user: MatrixUser): string {
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

async function registerUser(user: MatrixUser): Promise<string> {
  return (await axios.post('/_synapse/admin/v1/register', user)).data.user_id
}

export async function createUser(rcUser: RcUser): Promise<MatrixUser> {
  const user = mapUser(rcUser)
  user.nonce = await getUserRegistrationNonce()
  user.mac = generateHmac(user)
  user.user_id = await registerUser(user)

  return user
}
