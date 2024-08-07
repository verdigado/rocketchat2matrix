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
 * Set the room read status to "read all" for others
 */
export async function handleRoomMemberships() {
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
          let userSessionOptions = {}
          // set session options for non-admins
          if (!actualMember.includes(adminUsername)) {
            const memberMapping = await getMappingByMatrixId(actualMember)
            if (!memberMapping || !memberMapping.accessToken) {
              throw new Error(
                `Could not find access token for member ${actualMember}, this is a bug`
              )
            }
            userSessionOptions = formatUserSessionOptions(
              memberMapping.accessToken
            )
          }

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
            const lastMessages = (
              await axios.get(
                `/_matrix/client/v3/rooms/${roomMapping.matrixId}/messages`,
                {
                  ...userSessionOptions,
                  params: {
                    ts: Date.now(),
                    dir: 'b', // direction: backwards, getting latest event first
                    limit: 1, // getting only the latest event
                    filter: { types: ['m.room.message'] }, // getting only message events
                  },
                }
              )
            ).data
            if (
              lastMessages.chunk.length == 0 ||
              !lastMessages.chunk[0].event_id
            ) {
              log.info(
                `No messages in room ${roomMapping.matrixId}, skipping setting read status for ${actualMember}`
              )
            } else {
              log.info(
                `Member ${actualMember} is allowed in room ${roomMapping.matrixId}, setting read status for message ${lastMessages.chunk[0].event_id}`
              )
              await axios.post(
                `/_matrix/client/v3/rooms/${roomMapping.matrixId}/receipt/m.read/${lastMessages.chunk[0].event_id}`,
                {},
                userSessionOptions
              )
            }
          }
        })
      )
    })
  )
}
