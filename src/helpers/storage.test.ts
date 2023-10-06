process.env.DATABASE = ':memory:'
import { beforeAll, expect, test } from '@jest/globals'
import { Entity, entities } from '../Entities'
import { IdMapping } from '../entity/IdMapping'
import { Membership } from '../entity/Membership'
import {
  createMembership,
  getAccessToken,
  getMapping,
  getMemberships,
  getMessageId,
  getRoomId,
  getUserId,
  initStorage,
  save,
} from './storage'

const mapping = new IdMapping()
mapping.rcId = 'rcId'
mapping.matrixId = 'matrixId'
mapping.type = entities[Entity.Users].mappingType
mapping.accessToken = 'accessToken'

const membership = new Membership()
membership.rcRoomId = 'rcRoomId'
membership.rcUserId = 'rcUserId'

beforeAll(async () => {
  await initStorage()
})

test('create mapping', async () => {
  await expect(save(mapping)).resolves.toBe(undefined)
})

test('get mapping', async () => {
  await expect(getMapping(mapping.rcId, mapping.type)).resolves.toStrictEqual(
    mapping
  )
  await expect(getMapping('inexistent', 0)).resolves.toBe(null)
})

test('get access token', async () => {
  await expect(getAccessToken(mapping.rcId)).resolves.toBe(mapping.accessToken)
  await expect(getAccessToken('inexistent')).resolves.toBe(undefined)
})

test('create membership', async () => {
  await expect(
    createMembership(membership.rcRoomId, membership.rcUserId)
  ).resolves.toBe(undefined)
})

test('get membership', async () => {
  await expect(getMemberships(membership.rcRoomId)).resolves.toStrictEqual([
    membership.rcUserId,
  ])

  await createMembership(membership.rcRoomId, 'secondMember')
  await expect(getMemberships(membership.rcRoomId)).resolves.toStrictEqual([
    membership.rcUserId,
    'secondMember',
  ])

  await expect(getMemberships('inexistent')).resolves.toStrictEqual([])
})

test('get member by id', async () => {
  await expect(getUserId(mapping.rcId)).resolves.toBe(mapping.matrixId)
  await expect(getUserId('inexistent')).resolves.toBeFalsy()
})

test('get room by id', async () => {
  const room = new IdMapping()
  room.rcId = 'rcRoom'
  room.matrixId = 'matrixRoom'
  room.type = entities[Entity.Rooms].mappingType
  await save(room)

  await expect(getRoomId(room.rcId)).resolves.toBe(room.matrixId)
  await expect(getRoomId('inexistent')).resolves.toBeFalsy()
})

test('get message by id', async () => {
  const message = new IdMapping()
  message.rcId = 'rcMessage'
  message.matrixId = 'matrixMessage'
  message.type = entities[Entity.Messages].mappingType
  await save(message)

  await expect(getMessageId(message.rcId)).resolves.toBe(message.matrixId)
  await expect(getMessageId('inexistent')).resolves.toBeFalsy()
})
