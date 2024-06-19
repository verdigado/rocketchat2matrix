import { expect, jest, test } from '@jest/globals'
import {
  AxiosError,
  AxiosResponseHeaders,
  InternalAxiosRequestConfig,
} from 'axios'
import { IdMapping } from '../entity/IdMapping'
import log from '../helpers/logger'
import * as storage from '../helpers/storage'
import * as synapse from '../helpers/synapse'
import {
  executeAndHandleMissingMember,
  getCreatorSessionOptions,
  inviteMember,
} from './rooms'

jest.mock('../helpers/storage')
const mockedStorage = storage as jest.Mocked<typeof storage>

jest.mock('../helpers/synapse')
const mockedSynapse = synapse as jest.Mocked<typeof synapse>

const sessionOption = {
  headers: { Authorization: 'Bearer secretAuthToken' },
}

test('getting token for different room creators', async () => {
  mockedSynapse.getUserSessionOptions.mockImplementation(async (id: string) => {
    if (id.includes('excluded')) {
      throw new Error(`Could not retrieve access token for ID ${id}`)
    }
    return sessionOption
  })

  expect(await getCreatorSessionOptions('')).toStrictEqual({})
  expect(await getCreatorSessionOptions('excludedUser')).toStrictEqual({})
  expect(await getCreatorSessionOptions('creator')).toStrictEqual(sessionOption)
  expect(mockedSynapse.getUserSessionOptions).toHaveBeenCalledWith(
    'excludedUser'
  )
  expect(mockedSynapse.getUserSessionOptions).toHaveBeenCalledWith('creator')
})

const room_id = 'testRoomId'
test('inviteMember: skip on user already in room', async () => {
  mockedSynapse.axios.post.mockRejectedValueOnce(
    new AxiosError('nah', '400', undefined, undefined, {
      data: {
        errcode: 'M_FORBIDDEN',
        error: 'alreadyInThere is already in the room.',
      },
      status: 400,
      statusText: 'nah',
      headers: {} as AxiosResponseHeaders,
      config: {} as InternalAxiosRequestConfig,
    })
  )
  const debug = jest.spyOn(log, 'debug')
  await expect(
    inviteMember('alreadyInThere', room_id, sessionOption)
  ).resolves.toBeUndefined()
  expect(debug).toHaveBeenCalledWith(
    `User alreadyInThere is already in room ${room_id}, probably because this user created the room as a fallback.`
  )
})

test('inviteMember: skip on creator not in room', async () => {
  mockedSynapse.axios.post.mockRejectedValueOnce(
    new AxiosError('nah', '400', undefined, undefined, {
      data: {
        errcode: 'M_FORBIDDEN',
        error: `not in room ${room_id}.`,
      },
      status: 400,
      statusText: 'nah',
      headers: {} as AxiosResponseHeaders,
      config: {} as InternalAxiosRequestConfig,
    })
  )
  const warn = jest.spyOn(log, 'warn')
  await expect(
    inviteMember('captainLeft', room_id, sessionOption)
  ).resolves.toBeUndefined()
  expect(warn).toHaveBeenCalledWith(
    `Creator is not in room ${room_id}, skipping invitation for captainLeft.`
  )
})

test('inviteMember: fail with unexpected errors', async () => {
  mockedSynapse.axios.post.mockRejectedValueOnce('this is truly unexpected')
  await expect(
    inviteMember('captainLeft', room_id, sessionOption)
  ).rejects.toBe('this is truly unexpected')

  expect(mockedSynapse.axios.post).toHaveBeenCalledTimes(3)
  mockedSynapse.axios.post.mockReset()
})

test('executeAndHandleMissingMember: fail with unexpected errors', async () => {
  await expect(
    executeAndHandleMissingMember(async () => {
      throw new Error('this is truly unexpected')
    })
  ).rejects.toThrowError('this is truly unexpected')
})

const axiosNotInRoomError = async () => {
  throw new AxiosError('nah', '400', undefined, undefined, {
    data: {
      errcode: 'M_FORBIDDEN',
      error: `User @MsMissing not in room !roomId`,
    },
    status: 400,
    statusText: 'nah',
    headers: {} as AxiosResponseHeaders,
    config: {} as InternalAxiosRequestConfig,
  })
}

test('executeAndHandleMissingMember: skip missing member', async () => {
  mockedStorage.getMappingByMatrixId.mockResolvedValueOnce(null)
  await expect(
    executeAndHandleMissingMember(axiosNotInRoomError)
  ).resolves.toBeUndefined()
  expect(mockedStorage.getMappingByMatrixId).toHaveBeenCalledWith('@MsMissing')
})

test('executeAndHandleMissingMember: using admin to invite missing member', async () => {
  mockedStorage.getMappingByMatrixId.mockResolvedValue({
    rcId: 'RcMissing',
    matrixId: '@MsMissing:matrix',
    accessToken: 'mellon',
  } as IdMapping)
  mockedSynapse.axios.get.mockResolvedValue({ data: { creator: null } })

  const warn = jest.spyOn(log, 'warn')
  const http = jest.spyOn(log, 'http')
  await expect(
    executeAndHandleMissingMember(axiosNotInRoomError)
  ).rejects.not.toBeUndefined()

  expect(warn).toHaveBeenCalledWith(
    'Could not determine room creator for room !roomId, using admin credentials.'
  )
  expect(http).toHaveBeenCalledWith(
    'Accepting invitation for member RcMissing aka. @MsMissing:matrix'
  )
})

test('executeAndHandleMissingMember: using admin to invite missing member', async () => {
  log.debug('using room creator')
  mockedSynapse.axios.get.mockResolvedValue({
    data: { creator: 'RoomCreatorId' },
  })

  mockedStorage.getMappingByMatrixId.mockResolvedValue({
    rcId: 'RoomCreator',
    matrixId: '@RoomCreator:matrix',
    accessToken: 'Freund',
  } as IdMapping)
  await expect(
    executeAndHandleMissingMember(axiosNotInRoomError)
  ).rejects.not.toBeUndefined()
  expect(mockedStorage.getMappingByMatrixId).toHaveBeenLastCalledWith(
    'RoomCreatorId'
  )
})
