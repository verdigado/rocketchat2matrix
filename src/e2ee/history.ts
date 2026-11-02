import { Entity, entities } from '../Entities'
import {
  getAllMappingsByType,
  getMapping,
  getMemberships,
} from '../helpers/storage'
import { axios, getMatrixMembers } from '../helpers/tuwunel'
import { enc } from './matrix'

/**
 * An event of a migrated room, as seen by the server
 */
export type ScannedEvent = {
  event_id: string
  type: string
  sender: string
  session_id?: string
}

/**
 * A migrated room: who may read its history, and what the server stores
 */
export type ScannedRoom = {
  roomId: string
  rcRoomId: string
  members: Set<string> // Matrix IDs of the Rocket.Chat members of the room
  joined: string[] // Matrix IDs of the users currently joined
  encrypted: boolean
  events: ScannedEvent[]
}

/**
 * Return, for each migrated room, the Matrix users that were members of the
 * room in Rocket.Chat. Only they receive the keys of the room's history.
 * @returns The members by Matrix room ID
 */
export async function getRoomMembers(): Promise<
  Map<string, { rcRoomId: string; members: Set<string> }>
> {
  const result = new Map<string, { rcRoomId: string; members: Set<string> }>()
  const roomMappings = await getAllMappingsByType(
    entities[Entity.Rooms].mappingType
  )
  for (const roomMapping of roomMappings) {
    if (!roomMapping.matrixId) continue
    const members = new Set<string>()
    for (const rcUserId of await getMemberships(roomMapping.rcId)) {
      const userMapping = await getMapping(
        rcUserId,
        entities[Entity.Users].mappingType
      )
      if (userMapping?.matrixId && userMapping.accessToken) {
        members.add(userMapping.matrixId)
      }
    }
    result.set(roomMapping.matrixId, { rcRoomId: roomMapping.rcId, members })
  }
  return result
}

/**
 * Read the whole timeline of a room through the admin API, which does not
 * depend on the history visibility of the room
 * @param roomId The Matrix room ID
 * @returns The message-like events of the room (state events excluded)
 */
async function readTimeline(roomId: string): Promise<ScannedEvent[]> {
  const events: ScannedEvent[] = []
  let from: string | undefined
  for (;;) {
    const page: {
      chunk: Array<{
        event_id: string
        type: string
        sender: string
        state_key?: string
        content?: Record<string, unknown>
      }>
      end?: string
    } = (
      await axios.get(`/_synapse/admin/v1/rooms/${enc(roomId)}/messages`, {
        params: { dir: 'b', limit: 500, ...(from ? { from } : {}) },
      })
    ).data
    for (const event of page.chunk) {
      if (event.state_key !== undefined) continue
      events.push({
        event_id: event.event_id,
        type: event.type,
        sender: event.sender,
        session_id:
          typeof event.content?.session_id === 'string'
            ? event.content.session_id
            : undefined,
      })
    }
    if (!page.end || page.chunk.length === 0 || page.end === from) {
      return events
    }
    from = page.end
  }
}

/**
 * @param roomId The Matrix room ID
 * @returns Whether the room's state contains a Megolm m.room.encryption event
 */
async function isEncrypted(roomId: string): Promise<boolean> {
  const state: Array<{ type: string; content?: { algorithm?: string } }> = (
    await axios.get(`/_synapse/admin/v1/rooms/${enc(roomId)}/state`, {
      params: { type: 'm.room.encryption' },
    })
  ).data.state
  return state.some(
    (event) =>
      event.type === 'm.room.encryption' &&
      event.content?.algorithm === 'm.megolm.v1.aes-sha2'
  )
}

/**
 * Read every migrated room with the admin API
 * @returns The scanned rooms
 */
export async function scanRooms(): Promise<ScannedRoom[]> {
  const rooms: ScannedRoom[] = []
  for (const [roomId, { rcRoomId, members }] of await getRoomMembers()) {
    rooms.push({
      roomId,
      rcRoomId,
      members,
      joined: await getMatrixMembers(roomId),
      encrypted: await isEncrypted(roomId),
      events: await readTimeline(roomId),
    })
  }
  return rooms
}
