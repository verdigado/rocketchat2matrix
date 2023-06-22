process.env.DATABASE = ':memory:'
import { beforeAll, expect, test } from '@jest/globals'
import {
  createMembership,
  getAccessToken,
  getMapping,
  getMemberships,
  initStorage,
  save,
} from './storage'
import { IdMapping } from '../entity/IdMapping'
import { Membership } from '../entity/Membership'

const mapping = new IdMapping()
mapping.rcId = 'rcId'
mapping.matrixId = 'matrixId'
mapping.type = 0
mapping.accessToken = 'accessToken'

const membership = new Membership()
membership.rcRoomId = 'rcRoomId'
membership.rcUserId = 'rcUserId'

beforeAll(async () => {
  await initStorage()
})

test('save mapping', async () => {
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
