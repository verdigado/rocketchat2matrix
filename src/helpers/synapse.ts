import { access_token } from '../config/synapse_access_token.json'
import axios from 'axios'
import log from './logger'
import { getAccessToken } from './storage'

axios.defaults.baseURL = 'http://localhost:8008'
axios.defaults.headers.common['Authorization'] = `Bearer ${access_token}`
axios.defaults.headers.post['Content-Type'] = 'application/json'

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

export async function getUserSessionOptions(id: string) {
  const accessToken = await getAccessToken(id)
  if (!accessToken) {
    throw new Error(`Could not retrieve access token for ID ${id}`)
  }
  return { headers: { Authorization: `Bearer ${accessToken}` } }
}
