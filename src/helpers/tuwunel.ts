import axios from 'axios'
import { access_token } from '../config/tuwunel_access_token.json'
import log from './logger'
import { Entity, entities } from '../Entities'
import { getAccessToken, getAllMappingsByType } from './storage'

axios.defaults.baseURL = process.env.HOMESERVER_URL || 'http://127.0.0.1:6167'
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
 * Check the Tuwunel admin credentials and log them
 * @returns A Promise which resolves if the login succeeds or rejects if it fails
 */
export const whoami = () =>
  new Promise<void>((resolve, reject) => {
    axios
      .get('/_matrix/client/v3/account/whoami')
      .then((response) => {
        log.info('Logged into Tuwunel as', response.data)
        resolve()
      })
      .catch((reason) => {
        log.error(`Login to Tuwunel failed: ${reason}`)
        reject()
      })
  })

/**
 * Format an access token to use in axios
 * @param accessToken The HTTP Auth Bearer Token to format
 * @returns A axios-compatible session option object to contain the credentials as Tuwunel expects them
 */
export function formatUserSessionOptions(accessToken: string): SessionOptions {
  return { headers: { Authorization: `Bearer ${accessToken}` } }
}

/**
 * Lookup and format a user's access token to use in axios
 * @param rcId The user's Rocket.Chat ID
 * @returns A axios-compatible session option object to contain the credentials as Tuwunel expects them
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
  const response = await axios.get(
    `/_synapse/admin/v1/rooms/${matrixRoomId}/members`
  )

  return response.data.members
}

let serverName: string

export async function getServerName(): Promise<string> {
  if (!serverName) {
    serverName = (
      await axios.get('/_matrix/client/v3/account/whoami')
    ).data.user_id.split(':')[1]
  }
  return serverName
}

/**
 * Check that the Application Service may act as every migrated user (its
 * namespace covers them). Messages are sent through it with their original
 * date, so a too narrow namespace would stop the migration half-way.
 */
export async function checkAppserviceNamespace(): Promise<void> {
  const refused: string[] = []
  for (const mapping of await getAllMappingsByType(
    entities[Entity.Users].mappingType
  )) {
    if (!mapping.matrixId) continue
    try {
      await axios.get('/_matrix/client/v3/account/whoami', {
        ...formatUserSessionOptions(applicationServiceToken),
        params: { user_id: mapping.matrixId },
      })
    } catch {
      refused.push(mapping.matrixId)
    }
  }
  if (refused.length > 0) {
    throw new Error(
      `The Application Service cannot act as ${refused.join(', ')}: its users namespace must cover every migrated user (e.g. regex: '@.*')`
    )
  }
}
