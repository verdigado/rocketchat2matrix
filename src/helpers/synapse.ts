import axios from 'axios'
import { access_token } from '../config/synapse_access_token.json'
import log from './logger'
import { getAccessToken } from './storage'

axios.defaults.baseURL = 'http://localhost:8008'
axios.defaults.headers.common['Authorization'] = `Bearer ${access_token}`
axios.defaults.headers.post['Content-Type'] = 'application/json'

export interface SessionOptions {
  headers: {
    Authorization: string
  }
  [others: string]: unknown
}

export { default as axios } from 'axios'
export const whoami = () =>
  new Promise<void>((resolve, reject) => {
    axios
      .get('/_matrix/client/v3/account/whoami')
      .then((response) => {
        log.info('Logged into synapse as', response.data)
        resolve()
      })
      .catch((reason) => {
        log.error(`Login to synapse failed: ${reason}`)
        reject()
      })
  })

export function formatUserSessionOptions(accessToken: string): SessionOptions {
  return { headers: { Authorization: `Bearer ${accessToken}` } }
}

export async function getUserSessionOptions(
  rcId: string
): Promise<SessionOptions> {
  const accessToken = await getAccessToken(rcId)
  if (!accessToken) {
    throw new Error(`Could not retrieve access token for ID ${rcId}`)
  }
  return formatUserSessionOptions(accessToken)
}
