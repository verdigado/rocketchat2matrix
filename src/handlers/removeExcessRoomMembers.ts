import { Entity, entities } from '../Entities'
import log from '../helpers/logger'
import {
  getAllMappingsByType,
  getMappingByMatrixId,
  getMemberships,
} from '../helpers/storage'
import {
  axios,
  formatUserSessionOptions,
  getMatrixMembers,
} from '../helpers/synapse'
import { getFilteredMembers } from './rooms'

/**
 * Remove all excess Matrix room members, which are not part of the Rocket.Chat room and not an admin
 */
export async function removeExcessRoomMembers() {
  const roomMappings = await getAllMappingsByType(
    entities[Entity.Rooms].mappingType
  )
  if (!roomMappings) {
    throw new Error(`No room mappings found`)
  }

  await Promise.all(
    roomMappings.map(async (roomMapping) => {
      log.info(
        `Checking memberships for room ${roomMapping.rcId} / ${roomMapping.matrixId}`
      )
      // get all memberships from db
      const rcMemberIds = await getMemberships(roomMapping.rcId)
      const memberMappings = await getFilteredMembers(rcMemberIds, '')
      const memberNames: string[] = memberMappings.map(
        (memberMapping) => memberMapping.matrixId || ''
      )

      // get each mx rooms' mx users
      const actualMembers: string[] = await getMatrixMembers(
        roomMapping.matrixId || ''
      )

      // do action for any user in mx, but not in rc
      const adminUsername = process.env.ADMIN_USERNAME || ''
      await Promise.all(
        actualMembers.map(async (actualMember) => {
          const memberMapping = await getMappingByMatrixId(actualMember)
          if (!memberMapping || !memberMapping.accessToken) {
            throw new Error(
              `Could not find access token for member ${actualMember}, this is a bug`
            )
          }
          const userSessionOptions = formatUserSessionOptions(
            memberMapping.accessToken
          )
          if (
            !memberNames.includes(actualMember) &&
            !actualMember.includes(adminUsername) // exclude admin from removal
          ) {
            // remove excess members from rooms
            log.warn(
              `Member ${actualMember} should not be in room ${roomMapping.matrixId}, removing`
            )

            await axios.post(
              `/_matrix/client/v3/rooms/${roomMapping.matrixId}/leave`,
              {},
              userSessionOptions
            )
          } else {
            // set read status for allowed members
            const lastMessageId = (
              await axios.get(
                `/_matrix/client/v3/rooms/${roomMapping.matrixId}/messages`,
                {
                  ...userSessionOptions,
                  params: {
                    ts: Date.now(),
                    dir: 'b',
                    limit: 1,
                    filter: { types: ['m.room.message'] },
                  },
                }
              )
            ).data.chunk[0].event_id
            log.info(
              `Member ${actualMember} is allowed in room ${roomMapping.matrixId}, setting read status for message ${lastMessageId}`
            )
            await axios.post(
              `/_matrix/client/v3/rooms/${roomMapping.matrixId}/receipt/m.read/${lastMessageId}`,
              {},
              userSessionOptions
            )
          }
        })
      )
    })
  )
}
