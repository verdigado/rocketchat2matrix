import axios from 'axios'
import { access_token } from '../config/synapse_access_token.json'
import log from './logger'
import { getAccessToken } from './storage'

axios.defaults.baseURL = process.env.SYNAPSE_URL || 'http://localhost:8008'
axios.defaults.headers.common['Authorization'] = `Bearer ${access_token}`
axios.defaults.headers.post['Content-Type'] = 'application/json'

const applicationServiceToken = process.env.AS_TOKEN || ''

export interface SessionOptions {
  headers: {
    Authorization: string
  }
  [others: string]: unknown
}

export { default as axios } from 'axios'

/**
 * Check the Synapse admin credentials and log them
 * @returns A Promise which resolves if the login succeeds or rejects if it fails
 */
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

/**
 * Format an access token to use in axios
 * @param accessToken The HTTP Auth Bearer Token to format
 * @returns A axios-compatible session option object to contain the credentials as Synapse expects them
 */
export function formatUserSessionOptions(accessToken: string): SessionOptions {
  return { headers: { Authorization: `Bearer ${accessToken}` } }
}

/**
 * Lookup and format a user's access token to use in axios
 * @param rcId The user's Rocket.Chat ID
 * @returns A axios-compatible session option object to contain the credentials as Synapse expects them
 */
export async function getUserSessionOptions(
  rcId: string
): Promise<SessionOptions> {
  const accessToken = await getAccessToken(rcId)
  if (!accessToken) {
    throw new Error(`Could not retrieve access token for ID ${rcId}`)
  }
  return formatUserSessionOptions(accessToken)
}

/**
 * Return a list of matrix users in a room
 * @param matrixRoomId The Matrix ID of the room
 * @returns Array of Matrix user IDs
 */
export async function getMatrixMembers(
  matrixRoomId: string
): Promise<string[]> {
  return Object.keys(
    (
      await axios.get(
        `/_matrix/client/v3/rooms/${matrixRoomId}/joined_members`,
        formatUserSessionOptions(applicationServiceToken)
      )
    ).data.joined
  )
}
