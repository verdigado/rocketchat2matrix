import { Entity, entities } from '../Entities'
import log from '../helpers/logger'
import { getAllMappingsByType, getMappingByMatrixId } from '../helpers/storage'
import {
  axios,
  formatUserSessionOptions,
  getMatrixMembers,
} from '../helpers/synapse'

/**
 * Mark all rooms as read for each member
 */
export async function handleMarkAllAsRead(): Promise<void> {
  const roomMappings = await getAllMappingsByType(
    entities[Entity.Rooms].mappingType
  )
  if (!roomMappings) {
    throw new Error(`No room mappings found`)
  }

  await Promise.all(
    roomMappings.map(async (roomMapping) => {
      let lastMessageId = ''

      log.info(
        `Checking memberships for room ${roomMapping.rcId} / ${roomMapping.matrixId}`
      )
      // get each rooms' users
      const roomMemberIds: string[] = await getMatrixMembers(
        roomMapping.matrixId || ''
      )

      // get member credentials
      await Promise.all(
        roomMemberIds.map(getMappingByMatrixId).map(async (memberIdMapping) => {
          const sessionOptions = formatUserSessionOptions(
            (await memberIdMapping)?.accessToken || ''
          )
          // if no lastMessage, get that
          if (!lastMessageId) {
            lastMessageId = (
              await axios.get(
                `/_matrix/client/v3/rooms/${roomMapping.matrixId}/messages`,
                {
                  ...sessionOptions,
                  params: {
                    ts: Date.now(),
                    dir: 'b',
                    limit: 1,
                    filter: { types: ['m.room.message'] },
                  },
                }
              )
            ).data.chunk[0].event_id
            log.http(
              `Looked up last message for room ${roomMapping.matrixId}: ${lastMessageId}`
            )
          }
          // set read status
          log.http(
            `Mark all messages as read in room ${roomMapping.matrixId} for user ${(await memberIdMapping)?.matrixId}`,
            (
              await axios.post(
                `/_matrix/client/v3/rooms/${roomMapping.matrixId}/receipt/m.read/${lastMessageId}`,
                {},
                sessionOptions
              )
            ).data
          )
        })
      )
    })
  )
}
