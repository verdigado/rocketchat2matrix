import { DataSource, ILike } from 'typeorm'
import { Entity, entities } from '../Entities'
import { IdMapping } from '../entity/IdMapping'
import { Membership } from '../entity/Membership'

const AppDataSource = new DataSource({
  type: 'sqlite',
  database: process.env.DATABASE || 'db.sqlite',
  entities: [IdMapping, Membership],
  synchronize: true,
  logging: false,
})

/**
 * Initialise the local database and adapter. This must be called once, before any queries are made
 */
export async function initStorage(): Promise<void> {
  await AppDataSource.initialize()
}

/**
 * Get an IdMapping by Rocket.Chat ID and type
 * @param rcId The RC ID to look up
 * @param type The mapping type: 0 for Users, 1 for Rooms, 2 for Messages
 * @returns One found IdMapping or null
 */
export function getMapping(
  rcId: string,
  type: number
): Promise<IdMapping | null> {
  return AppDataSource.manager.findOneBy(IdMapping, {
    rcId: rcId,
    type: type,
  })
}

/**
 * Return all IdMappings of a specific type
 * @param type The mapping type: 0 for Users, 1 for Rooms, 2 for Messages
 * @returns An array of IdMappings of the defined type
 */
export function getAllMappingsByType(type: number): Promise<IdMapping[]> {
  return AppDataSource.manager.findBy(IdMapping, { type })
}

/**
 * Reverse-lookup a mapping by Matrix ID
 * @param matrixId The Matrix ID to look up
 * @returns One found IdMapping or null
 */
export function getMappingByMatrixId(
  matrixId: string
): Promise<IdMapping | null> {
  return AppDataSource.manager.findOneBy(IdMapping, {
    matrixId: matrixId,
  })
}

/**
 * Search for a user IdMapping by its name
 * @param username The Matrix or Rocket.Chat username to look up
 * @returns One found IdMapping or null
 */
export function getUserMappingByName(
  username: string
): Promise<IdMapping | null> {
  return AppDataSource.manager.findOneBy(IdMapping, {
    matrixId: ILike(`@${username.toLowerCase()}:%`),
    type: entities[Entity.Users].mappingType,
  })
}

/**
 * Write the entity to the database
 * @param entity The entity to save
 */
export async function save(entity: IdMapping | Membership): Promise<void> {
  await AppDataSource.manager.save(entity)
}

/**
 * Lookup a user's access token by it's Rocket.Chat ID
 * @param rcId The Rocket.Chat user ID
 * @returns The user's access token or null
 */
export async function getAccessToken(
  rcId: string
): Promise<string | undefined> {
  return (await getMapping(rcId, entities[Entity.Users].mappingType))
    ?.accessToken
}

/**
 * Save a membership relation (a user being a member of a room) to the database
 * @param rcRoomId The room ID to be member of
 * @param rcUserId The user ID which is the member
 */
export async function createMembership(
  rcRoomId: string,
  rcUserId: string
): Promise<void> {
  const membership = new Membership()
  membership.rcRoomId = rcRoomId
  membership.rcUserId = rcUserId

  await save(membership)
}

/**
 * Returns all members of a given room
 * @param rcRoomId The room ID to get all members of
 * @returns An array of Rocket.Chat user IDs that are members of the room
 */
export async function getMemberships(rcRoomId: string): Promise<string[]> {
  return (
    await AppDataSource.manager.find(Membership, {
      select: {
        rcUserId: true,
      },
      where: {
        rcRoomId: rcRoomId,
      },
    })
  ).map((entity) => entity.rcUserId)
}

/**
 * Lookup a users Matrix ID by it's Rocket.Chat ID
 * @param rcId The user's Rocket.Chat ID
 * @returns The user's Matrix ID or undefined
 */
export async function getUserId(rcId: string): Promise<string | undefined> {
  return (await getMapping(rcId, entities[Entity.Users].mappingType))?.matrixId
}

/**
 * Lookup a room Matrix ID by it's Rocket.Chat ID
 * @param rcId The room's Rocket.Chat ID
 * @returns The room's Matrix ID or undefined
 */
export async function getRoomId(rcId: string): Promise<string | undefined> {
  return (await getMapping(rcId, entities[Entity.Rooms].mappingType))?.matrixId
}

/**
 * Lookup a message Matrix ID by it's Rocket.Chat ID
 * @param rcId The message's Rocket.Chat ID
 * @returns The message's Matrix ID or undefined
 */
export async function getMessageId(rcId: string): Promise<string | undefined> {
  return (await getMapping(rcId, entities[Entity.Messages].mappingType))
    ?.matrixId
}
