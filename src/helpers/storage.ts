import { DataSource } from 'typeorm'
import { IdMapping } from '../entity/IdMapping'
import { Membership } from '../entity/Membership'

const AppDataSource = new DataSource({
  type: 'sqlite',
  database: 'db.sqlite',
  entities: [IdMapping, Membership],
  synchronize: true,
  logging: false,
})

export async function initStorage() {
  await AppDataSource.initialize()
}

export function getMapping(id: string, type: number) {
  return AppDataSource.manager.findOneBy(IdMapping, {
    rcId: id,
    type: type,
  })
}

export async function save(entity: IdMapping | Membership) {
  await AppDataSource.manager.save(entity)
}

export async function getAccessToken(id: string) {
  return (await getMapping(id, 0))?.accessToken
}

export async function createMembership(rcRoomId: string, rcUserId: string) {
  const membership = new Membership()
  membership.rcRoomId = rcRoomId
  membership.rcUserId = rcUserId

  await save(membership)
}

export async function getMemberships(rcRoomId: string) {
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
