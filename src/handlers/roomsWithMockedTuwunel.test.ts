import { expect, jest, test } from '@jest/globals'
import {
  AxiosError,
  AxiosResponseHeaders,
  InternalAxiosRequestConfig,
} from 'axios'
import { IdMapping } from '../entity/IdMapping'
import log from '../helpers/logger'
import * as storage from '../helpers/storage'
import * as tuwunel from '../helpers/tuwunel'
import {
  executeAndHandleMissingMember,
  getCreatorSessionOptions,
  inviteMember,
} from './rooms'

jest.mock('../helpers/storage')
const mockedStorage = storage as jest.Mocked<typeof storage>

jest.mock('../helpers/tuwunel')
const mockedTuwunel = tuwunel as jest.Mocked<typeof tuwunel>

const sessionOption = {
  headers: { Authorization: 'Bearer secretAuthToken' },
}

test('getting token for different room creators', async () => {
  mockedTuwunel.getUserSessionOptions.mockImplementation(async (id: string) => {
    if (id.includes('excluded')) {
      throw new Error(`Could not retrieve access token for ID ${id}`)
    }
    return sessionOption
  })

  expect(await getCreatorSessionOptions('')).toStrictEqual({})
  expect(await getCreatorSessionOptions('excludedUser')).toStrictEqual({})
  expect(await getCreatorSessionOptions('creator')).toStrictEqual(sessionOption)
  expect(mockedTuwunel.getUserSessionOptions).toHaveBeenCalledWith(
    'excludedUser'
  )
  expect(mockedTuwunel.getUserSessionOptions).toHaveBeenCalledWith('creator')
})

const room_id = 'testRoomId'
test('inviteMember: skip on user already in room', async () => {
  mockedTuwunel.axios.post.mockRejectedValueOnce(
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
  mockedTuwunel.axios.post.mockRejectedValueOnce(
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
  mockedTuwunel.axios.post.mockRejectedValueOnce('this is truly unexpected')
  await expect(
    inviteMember('captainLeft', room_id, sessionOption)
  ).rejects.toBe('this is truly unexpected')

  expect(mockedTuwunel.axios.post).toHaveBeenCalledTimes(3)
  mockedTuwunel.axios.post.mockReset()
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
  mockedTuwunel.axios.get.mockResolvedValue({ data: { creator: null } })

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
  mockedTuwunel.axios.get.mockResolvedValue({
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

const tuwunelForbidden = (error: string) =>
  new AxiosError('nah', '403', undefined, undefined, {
    data: { errcode: 'M_FORBIDDEN', error },
    status: 403,
    statusText: 'nah',
    headers: {} as AxiosResponseHeaders,
    config: {} as InternalAxiosRequestConfig,
  })

test('inviteMember: skip user already joined (Tuwunel wording)', async () => {
  mockedTuwunel.axios.post.mockReset()
  mockedTuwunel.axios.post.mockRejectedValueOnce(
    tuwunelForbidden(
      'Auth check failed: cannot invite user that is joined or banned'
    )
  )
  await expect(
    inviteMember('@joined:matrix', room_id, sessionOption)
  ).resolves.toBeUndefined()
})

test('executeAndHandleMissingMember: Tuwunel auth error uses the hint', async () => {
  mockedStorage.getMappingByMatrixId.mockReset()
  mockedStorage.getMappingByMatrixId.mockResolvedValueOnce(null)
  let calls = 0
  await expect(
    executeAndHandleMissingMember(
      async () => {
        calls++
        throw tuwunelForbidden(
          "Auth check failed: sender's membership `leave` is not `join`"
        )
      },
      { matrixUserId: '@leaver:matrix', matrixRoomId: '!room:matrix' }
    )
  ).resolves.toBeUndefined()
  expect(calls).toBe(1)
  expect(mockedStorage.getMappingByMatrixId).toHaveBeenCalledWith(
    '@leaver:matrix'
  )
})

test('executeAndHandleMissingMember: Tuwunel auth error without hint is rethrown', async () => {
  await expect(
    executeAndHandleMissingMember(async () => {
      throw tuwunelForbidden(
        "Auth check failed: sender's membership `leave` is not `join`"
      )
    })
  ).rejects.toBeInstanceOf(AxiosError)
})
