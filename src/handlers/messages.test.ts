process.env.AS_TOKEN = 'ApplicationSecretToken'
process.env.EXCLUDED_USERS = 'excludedUser1,excludedUser2'
import { afterEach, expect, jest, test } from '@jest/globals'
import axios from 'axios'
import { IdMapping } from '../entity/IdMapping'
import log from '../helpers/logger'
import * as storage from '../helpers/storage'
import { formatUserSessionOptions } from '../helpers/synapse'
import {
  MatrixMessage,
  RcMessage,
  createMessage,
  handle,
  handleReactions,
  mapMessage,
} from './messages'

jest.mock('axios')
const mockedAxios = axios as jest.Mocked<typeof axios>

jest.mock('../helpers/storage')
const mockedStorage = storage as jest.Mocked<typeof storage>

const rcMessage: RcMessage = {
  _id: 'testMessage',
  rid: 'testRoom',
  msg: 'Test',
  u: {
    _id: 'testUser',
  },
  ts: {
    $date: '1970-01-02T06:51:51.0Z', // UNIX-TS: 111111000
  },
}

const matrixMessage: MatrixMessage = {
  body: 'Test',
  msgtype: 'm.text',
  type: 'm.room.message',
}

afterEach(() => {
  jest.resetAllMocks()
})

test('mapping messages', () => {
  expect(mapMessage(rcMessage)).toStrictEqual(matrixMessage)
})

test('creating messages', async () => {
  mockedAxios.put.mockResolvedValue({ data: { event_id: 'message@matrix' } })

  await expect(
    createMessage(matrixMessage, 'roomID', 'userID', 42, 'transactionId')
  ).resolves.toBe('message@matrix')

  expect(mockedAxios.put).toHaveBeenCalledWith(
    '/_matrix/client/v3/rooms/roomID/send/m.room.message/transactionId?user_id=userID&ts=42',
    matrixMessage,
    { headers: { Authorization: 'Bearer ApplicationSecretToken' } }
  )
})

test('skipping existing messages', async () => {
  mockedAxios.put.mockResolvedValue({ data: { event_id: 'test@matrix' } })
  mockedStorage.getRoomId.mockResolvedValue('testMatrixRoom')
  mockedStorage.getUserId.mockResolvedValue('testMatrixUser')
  mockedStorage.getMessageId.mockResolvedValue('existingMxMessage') // for checking skipping existing messages
  const debug = jest.spyOn(log, 'debug')

  await expect(
    handle({ ...rcMessage, _id: 'existingRcMessage' })
  ).resolves.toBeUndefined()
  expect(debug).toHaveBeenLastCalledWith(
    'Mapping exists: existingRcMessage -> existingMxMessage'
  )
})

test('handling threaded messages', async () => {
  mockedAxios.put.mockResolvedValue({ data: { event_id: 'test@matrix' } })
  mockedStorage.getRoomId.mockResolvedValue('testMatrixRoom')
  mockedStorage.getUserId.mockResolvedValue('testMatrixUser')
  mockedStorage.getMessageId
    .mockResolvedValueOnce(undefined) // For checking if the Message already exists
    .mockResolvedValueOnce('testMatrixMessage') // For checking the parent message
  await expect(
    handle({ ...rcMessage, tmid: 'threadId' })
  ).resolves.toBeUndefined()

  expect(mockedAxios.put).toHaveBeenLastCalledWith(
    '/_matrix/client/v3/rooms/testMatrixRoom/send/m.room.message/testMessage?user_id=testMatrixUser&ts=111111000',
    {
      ...matrixMessage,
      'm.relates_to': {
        rel_type: 'm.thread',
        event_id: 'testMatrixMessage',
        is_falling_back: true,
        'm.in_reply_to': {
          event_id: 'testMatrixMessage',
        },
      },
    },
    { headers: { Authorization: 'Bearer ApplicationSecretToken' } }
  )
  expect(mockedStorage.getRoomId).toHaveBeenLastCalledWith('testRoom')
  expect(mockedStorage.getUserId).toHaveBeenLastCalledWith('testUser')
  expect(mockedStorage.getMessageId).toHaveBeenLastCalledWith('threadId')
})

test('skipping messages without room', async () => {
  const warn = jest.spyOn(log, 'warn')
  mockedStorage.getRoomId.mockResolvedValue(undefined)

  await expect(
    handle({ ...rcMessage, _id: 'roomless', rid: '404' })
  ).resolves.toBeUndefined()
  expect(warn).toHaveBeenLastCalledWith(
    'Could not find room 404 for message roomless, skipping.'
  )
})

test('skipping messages with a type', async () => {
  mockedStorage.getRoomId.mockResolvedValue('testOtherMatrixRoom')
  const warn = jest.spyOn(log, 'warn')

  await expect(handle({ ...rcMessage, t: 'anything' })).resolves.toBeUndefined()
  expect(warn).toHaveBeenLastCalledWith(
    'Message testMessage is of unhandled type anything, skipping.'
  )
})

test('skipping messages without user id', async () => {
  mockedStorage.getRoomId.mockResolvedValue('testMatrixRoom')
  mockedStorage.getUserId.mockResolvedValue(undefined)
  const warn = jest.spyOn(log, 'warn')

  await expect(
    handle({ ...rcMessage, u: { _id: 'none', username: 'nobody' } })
  ).resolves.toBeUndefined()
  expect(warn).toHaveBeenLastCalledWith(
    'Could not find author nobody for message testMessage, skipping.'
  )
})

test('skipping messages with a missing thread', async () => {
  mockedStorage.getRoomId.mockResolvedValue('testMatrixRoom')
  mockedStorage.getUserId.mockResolvedValue('testMatrixUser')
  const warn = jest.spyOn(log, 'warn')

  await expect(
    handle({ ...rcMessage, tmid: 'missingThread' })
  ).resolves.toBeUndefined()
  expect(warn).toHaveBeenLastCalledWith(
    'Related message missingThread missing, skipping.'
  )
})

test('handling reactions', async () => {
  mockedStorage.getUserMappingByName.mockImplementation(
    async (username: string) => {
      if (username === 'testuser') {
        const idMapping = new IdMapping()
        idMapping.rcId = 'rcId'
        idMapping.matrixId = 'testuser'
        idMapping.type = 0
        idMapping.accessToken = 'testuser'
        return idMapping
      } else {
        return null
      }
    }
  )
  const warn = jest.spyOn(log, 'warn')

  await expect(
    handleReactions(
      {
        ':+1:': { usernames: ['testuser', 'testuser', 'undefined'] }, // exists in reactions.json
        ':biohazard:': { usernames: ['testuser'] }, // doesn't exist in reactions.json, but found by node-emoji
        ':undefined:': { usernames: [] }, // doesn't exist, should cause a warning
        ':thumbsup:': { usernames: ['testuser'] }, // should create the same request as with :+1:
      },
      'messageId',
      'roomId'
    )
  ).resolves.toBeUndefined()

  expect(warn).toHaveBeenCalledWith(
    'Could not find user mapping for name: undefined, skipping reaction 👍 for message messageId'
  )
  expect(warn).toHaveBeenCalledWith(
    'Could not find an emoji for :undefined: for message messageId, skipping'
  )
  const thumbsupCall = [
    '/_matrix/client/v3/rooms/roomId/send/m.reaction/bWVzc2FnZUlkAPCfkY0AdGVzdHVzZXI',
    {
      'm.relates_to': {
        rel_type: 'm.annotation',
        event_id: 'messageId',
        key: '👍',
      },
    },
    formatUserSessionOptions('testuser'),
  ]
  expect(mockedAxios.put).toHaveBeenNthCalledWith(1, ...thumbsupCall)
  expect(mockedAxios.put).toHaveBeenNthCalledWith(
    2,
    '/_matrix/client/v3/rooms/roomId/send/m.reaction/bWVzc2FnZUlkAOKYowB0ZXN0dXNlcg',
    {
      'm.relates_to': {
        rel_type: 'm.annotation',
        event_id: 'messageId',
        key: '☣',
      },
    },
    formatUserSessionOptions('testuser')
  )
  expect(mockedAxios.put).toHaveBeenNthCalledWith(3, ...thumbsupCall)
  expect(mockedAxios.put).toHaveBeenCalledTimes(3)
})
