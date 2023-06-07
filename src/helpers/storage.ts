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
