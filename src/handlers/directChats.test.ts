import { expect, jest, test } from '@jest/globals'
import {
  AxiosError,
  AxiosResponseHeaders,
  InternalAxiosRequestConfig,
} from 'axios'
import lineByLine from 'n-readlines'
import log from '../helpers/logger'
import * as storage from '../helpers/storage'
import * as synapse from '../helpers/synapse'
import {
  DirectChats,
  UserDirectChatMappings,
  getDirectChats,
  handleDirectChats,
  parseDirectChats,
  setDirectChats,
} from './directChats'

jest.mock('n-readlines')
const mockedLineByLine = lineByLine as jest.Mocked<typeof lineByLine>

jest.mock('../helpers/storage')
const mockedStorage = storage as jest.Mocked<typeof storage>

jest.mock('../helpers/synapse')
const mockedSynapse = synapse as jest.Mocked<typeof synapse>

jest.mock('../helpers/logger')
const mockedLog = log as jest.Mocked<typeof log>

const directChats: DirectChats = {
  abc: ['a', 'b', 'c'],
  ab: ['a', 'b'],
}

const directChatMappings: UserDirectChatMappings = {
  a: { b: ['abc', 'ab'], c: ['abc'] },
  b: { a: ['abc', 'ab'], c: ['abc'] },
  c: { a: ['abc'], b: ['abc'] },
}

test('direct chat parsing', () => {
  expect(parseDirectChats(directChats)).toStrictEqual(directChatMappings)
  expect(parseDirectChats({ ownRoom: ['selfchatter'] })).toStrictEqual({
    selfchatter: { selfchatter: ['ownRoom'] },
  })
})

test('get direct chats', async () => {
  mockedLineByLine.prototype.next
    .mockReturnValueOnce(
      Buffer.from(JSON.stringify({ t: 'c', _id: 'ignored' }))
    )
    .mockReturnValueOnce(Buffer.from(JSON.stringify({ t: 'd', _id: 'abc' })))
    .mockReturnValueOnce(Buffer.from(JSON.stringify({ t: 'd', _id: 'ab' })))
    .mockReturnValueOnce(Buffer.from(JSON.stringify({ t: 'd', _id: false })))
    .mockReturnValue(false)

  mockedStorage.getRoomId.mockImplementation(async (id: string) => id)
  mockedSynapse.getMatrixMembers.mockImplementation(
    async (roomId: string) => directChats[roomId]
  )

  await expect(getDirectChats()).resolves.toStrictEqual(directChats)
  expect(mockedLog.warn).toHaveBeenCalledWith(
    'Room false has no mapping, skipping to mark it as a direct chat.'
  )
})

test('setting direct chats', async () => {
  mockedSynapse.axios.get
    .mockRejectedValueOnce(new AxiosError('Unauthorized'))
    .mockRejectedValueOnce(
      new AxiosError('Not found', '404', undefined, undefined, {
        data: { errcode: 'M_NOT_FOUND' },
        status: 404,
        statusText: 'Not found',
        headers: {} as AxiosResponseHeaders,
        config: {} as InternalAxiosRequestConfig,
      })
    )
    .mockResolvedValueOnce({ data: { partner: ['same'] } })
    .mockResolvedValueOnce({ data: { partner: ['different'] } })

  await expect(setDirectChats(directChatMappings)).rejects.toThrowError(
    'Unauthorized'
  )
  await expect(
    setDirectChats({
      testerNewSettings: { partner: ['chatname'] },
      testerExistingSameSettings: { partner: ['same'] },
      testerExistingDifferentSettings: { otherPartner: ['d1fferent'] },
    })
  ).resolves.toBe(undefined)
  expect(mockedSynapse.axios.get).toHaveBeenCalledWith(
    '/_matrix/client/v3/user/a/account_data/m.direct',
    undefined
  )
  expect(mockedSynapse.axios.put).toHaveBeenLastCalledWith(
    '/_matrix/client/v3/user/testerNewSettings/account_data/m.direct',
    { partner: ['chatname'] },
    undefined
  )

  expect(mockedLog.debug).toHaveBeenCalledWith(
    'User testerExistingSameSettings already has the expected direct chats configured, skipping.'
  )
  expect(mockedLog.debug).toHaveBeenCalledWith(
    'User testerExistingDifferentSettings already has a different direct chat setting.'
  )
})

test('handle direct chats', async () => {
  await expect(handleDirectChats()).resolves.toBe(undefined)
})
