process.env.REGISTRATION_SHARED_SECRET = 'ThisIsSoSecretWow'
process.env.EXCLUDED_USERS = 'excludedUser1,excludedUser2'
process.env.ADMIN_USERNAME = 'testAdmin'
import { expect, jest, test } from '@jest/globals'
import axios from 'axios'
import { Entity, entities } from '../Entities'
import adminAccessToken from '../config/synapse_access_token.json'
import { IdMapping } from '../entity/IdMapping'
import log from '../helpers/logger'
import * as storage from '../helpers/storage'
import {
  MatrixUser,
  RcUser,
  createMapping,
  createUser,
  generateHmac,
  handle,
  mapUser,
  userIsExcluded,
} from './users'

jest.mock('axios')
const mockedAxios = axios as jest.Mocked<typeof axios>

jest.mock('../helpers/storage')
const mockedStorage = storage as jest.Mocked<typeof storage>

const rcUser: RcUser = {
  _id: 'testRc',
  name: 'Tester McDelme',
  username: 'testuser',
  roles: ['user'],
  __rooms: ['room0', 'room1'],
}

const matrixUser: MatrixUser = {
  user_id: '',
  username: rcUser.username,
  displayname: rcUser.name,
  password: '',
  admin: false,
}

const nonce = 'test-nonce'
const mac = 'be0537407ab3c82de908c5763185556e98a7211c'

test('mapping users', () => {
  expect(mapUser(rcUser)).toStrictEqual(matrixUser)
})

test('generating correct hmac', () => {
  expect(generateHmac({ ...matrixUser, nonce })).toStrictEqual(mac)
})

test('creating users', async () => {
  const matrixId = 'TestRandomId'
  const accessToken = 'secretaccesstoken'

  mockedAxios.get.mockResolvedValue({ data: { nonce: nonce } })
  mockedAxios.post.mockResolvedValue({
    data: { user_id: matrixId, access_token: accessToken },
  })

  const createdUser = await createUser(rcUser)
  expect(createdUser).toStrictEqual({
    ...matrixUser,
    user_id: matrixId,
    access_token: accessToken,
  })

  expect(mockedAxios.get).toHaveBeenCalledWith('/_synapse/admin/v1/register')
  expect(mockedAxios.post).toHaveBeenCalledWith('/_synapse/admin/v1/register', {
    ...matrixUser,
    nonce,
    mac,
  })

  expect(mockedStorage.createMembership).toHaveBeenCalledWith(
    rcUser.__rooms[0],
    rcUser._id
  )
  expect(mockedStorage.createMembership).toHaveBeenCalledWith(
    rcUser.__rooms[1],
    rcUser._id
  )
  expect(mockedStorage.createMembership).toHaveBeenCalledTimes(2)
})

test('users are excluded', () => {
  expect(userIsExcluded(rcUser)).toBeFalsy()
  expect(userIsExcluded({ ...rcUser, _id: 'excludedUser1' })).toBeTruthy()
  expect(userIsExcluded({ ...rcUser, username: 'excludedUser2' })).toBeTruthy()
  expect(userIsExcluded({ ...rcUser, roles: ['bot'] })).toBeTruthy()
  expect(
    userIsExcluded({ ...rcUser, roles: [...rcUser.__rooms, 'app'] })
  ).toBeTruthy()
  expect(
    userIsExcluded({
      ...rcUser,
      _id: 'excludedUser2',
      username: 'excludedUser1',
      roles: [...rcUser.__rooms, 'app', 'bot'],
    })
  ).toBeTruthy()
})

test('creating mapping', async () => {
  await expect(createMapping(rcUser._id, matrixUser)).resolves.toBeUndefined()
  expect(mockedStorage.save).toHaveBeenCalledWith({
    rcId: rcUser._id,
    matrixId: matrixUser.user_id,
    type: entities[Entity.Users].mappingType,
    accessToken: matrixUser.access_token,
  } as IdMapping)
  mockedStorage.save.mockClear()
})

test('handling a normal user', async () => {
  await expect(handle({ ...rcUser })).resolves.toBeUndefined()

  expect(mockedStorage.save).toHaveBeenLastCalledWith({
    rcId: 'testRc',
    matrixId: 'TestRandomId',
    type: 0,
    accessToken: 'secretaccesstoken',
  } as IdMapping)
})

const info = jest.spyOn(log, 'info')
test('handling an admin user', async () => {
  await expect(
    handle({
      ...rcUser,
      _id: 'admin',
      username: 'testAdmin',
      name: 'Administrator',
    })
  ).resolves.toBeUndefined()

  expect(mockedStorage.save).toHaveBeenLastCalledWith({
    rcId: 'admin',
    matrixId: adminAccessToken.user_id,
    type: 0,
    accessToken: adminAccessToken.access_token,
  } as IdMapping)
  expect(info).toHaveBeenLastCalledWith(
    'User testAdmin is defined as admin in ENV, mapping as such'
  )
  mockedStorage.save.mockClear()
})

const debug = jest.spyOn(log, 'debug')
test('skipping existing user', async () => {
  mockedStorage.getUserId.mockResolvedValueOnce('@copycat')
  await expect(
    handle({
      ...rcUser,
      _id: 'copycat',
      name: 'CopyCat',
    })
  ).resolves.toBeUndefined()

  expect(mockedStorage.save).not.toHaveBeenCalled()
  expect(debug).toHaveBeenLastCalledWith('Mapping exists: copycat -> @copycat')
})
