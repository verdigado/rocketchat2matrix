process.env.AS_TOKEN = 'ApplicationSecretToken'
process.env.EXCLUDED_USERS = 'excludedUser1,excludedUser2'
import { expect, jest, test } from '@jest/globals'
import {
  AxiosError,
  AxiosResponseHeaders,
  InternalAxiosRequestConfig,
} from 'axios'
import { IdMapping } from '../entity/IdMapping'
import log from '../helpers/logger'
import * as storage from '../helpers/storage'
import { handleReactions } from './messages'
import * as rooms from './rooms'

jest.mock('../helpers/storage')
const mockedStorage = storage as jest.Mocked<typeof storage>

jest.mock('./rooms')
const mockedRooms = rooms as jest.Mocked<typeof rooms>

test('handling reactions: duplicate reaction error', async () => {
  const debug = jest.spyOn(log, 'debug')
  mockedStorage.getUserMappingByName.mockImplementation(
    async (username: string) => {
      switch (username) {
        case 'testuser':
        case 'duplicator':
        case 'breaker': {
          const idMapping = new IdMapping()
          idMapping.rcId = 'rcId-' + username
          idMapping.matrixId = username
          idMapping.type = 0
          idMapping.accessToken = username
          return idMapping
        }
      }
      return null
    }
  )
  mockedRooms.executeAndHandleMissingMember
    .mockRejectedValueOnce(
      new AxiosError('nah', '400', undefined, undefined, {
        data: {
          errcode: 'M_DUPLICATE_ANNOTATION',
          error: `Use me`,
        },
        status: 400,
        statusText: 'nah',
        headers: {} as AxiosResponseHeaders,
        config: {} as InternalAxiosRequestConfig,
      })
    )
    .mockRejectedValue(new Error('Not a duplicate, but something else'))

  await expect(
    handleReactions(
      {
        ':flame:': { usernames: ['duplicator', 'breaker'] },
      },
      'messageId',
      'roomId'
    )
  ).rejects.toThrowError('Not a duplicate, but something else')
  expect(debug).toHaveBeenCalledWith(
    'Duplicate reaction to message messageId with symbol 🔥 for user duplicator, skipping.'
  )
})
