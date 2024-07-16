import { afterEach, expect, jest, test } from '@jest/globals'
import axios from 'axios'
import {
  formatUserSessionOptions,
  getMatrixMembers,
  getServerName,
  getUserSessionOptions,
  whoami,
} from './synapse'

import * as storage from '../helpers/storage'

jest.mock('../helpers/storage')
const mockedStorage = storage as jest.Mocked<typeof storage>

jest.mock('axios')
const mockedAxios = axios as jest.Mocked<typeof axios>

afterEach(() => {
  jest.resetAllMocks()
})

test('whoami', async () => {
  mockedAxios.get.mockResolvedValueOnce({ data: { name: 'exit0' } })
  await expect(whoami()).resolves.toBeUndefined()

  mockedAxios.get.mockRejectedValueOnce('expected fail')
  await expect(whoami()).rejects.toBeUndefined()

  expect(mockedAxios.get).toHaveBeenCalledWith(
    '/_matrix/client/v3/account/whoami'
  )
  expect(mockedAxios.get).toHaveBeenCalledTimes(2)
})

test('get user session options', async () => {
  mockedStorage.getAccessToken
    .mockResolvedValueOnce('test access token')
    .mockResolvedValueOnce(undefined)

  await expect(getUserSessionOptions('valid RC ID')).resolves.toStrictEqual(
    formatUserSessionOptions('test access token')
  )
  await expect(getUserSessionOptions('invalid ID')).rejects.toThrowError(
    'Could not retrieve access token for ID invalid ID'
  )
})

test('get Matrix members', async () => {
  mockedAxios.get.mockResolvedValueOnce({
    data: {
      joined: {
        peter: {},
        paul: {},
        mary: {},
      },
    },
  })
  await expect(getMatrixMembers('matrixRoomId')).resolves.toStrictEqual([
    'peter',
    'paul',
    'mary',
  ])
  expect(mockedAxios.get).toHaveBeenLastCalledWith(
    '/_matrix/client/v3/rooms/matrixRoomId/joined_members',
    formatUserSessionOptions('')
  )
})

test('get server name', async () => {
  mockedAxios.get
    .mockResolvedValueOnce({ data: { user_id: '@testuser:matrix.test' } })
    .mockRejectedValueOnce(undefined)
  await expect(getServerName()).resolves.toBe('matrix.test')
  await expect(getServerName()).resolves.toBe('matrix.test')
  expect(mockedAxios.get).toHaveBeenCalledWith(
    '/_matrix/client/v3/account/whoami'
  )
  expect(mockedAxios.get).toHaveBeenCalledTimes(1)
})
