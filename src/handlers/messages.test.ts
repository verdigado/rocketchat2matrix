process.env.AS_TOKEN = 'ApplicationSecretToken'
process.env.EXCLUDED_USERS = 'excludedUser1,excludedUser2'
import { afterEach, expect, jest, test } from '@jest/globals'
import axios from 'axios'
import { IdMapping } from '../entity/IdMapping'
import log from '../helpers/logger'
import * as storage from '../helpers/storage'
import {
  MatrixMessage,
  RcMessage,
  createMessage,
  handle,
  handleReactions,
  mapMessage,
  mapTextMessage,
} from './messages'
import * as synapse from '../helpers/synapse'

jest.mock('../helpers/synapse')
const mockedSynapse = synapse as jest.Mocked<typeof synapse>
const mockedAxios = mockedSynapse.axios as jest.Mocked<typeof axios>

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

test('mapping messages', async () => {
  await expect(mapMessage(rcMessage)).resolves.toStrictEqual(matrixMessage)
})

test('creating messages', async () => {
  mockedAxios.put.mockResolvedValue({ data: { event_id: 'message@matrix' } })

  await expect(
    createMessage(matrixMessage, 'roomID', 'userID', 42, 'transactionId')
  ).resolves.toBe('message@matrix')

  expect(mockedAxios.put).toHaveBeenCalledWith(
    '/_matrix/client/v3/rooms/roomID/send/m.room.message/transactionId?user_id=userID&ts=42',
    matrixMessage,
    undefined
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
    undefined
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
    undefined,
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
    undefined
  )
  expect(mockedAxios.put).toHaveBeenNthCalledWith(3, ...thumbsupCall)
  expect(mockedAxios.put).toHaveBeenCalledTimes(3)
})

test.todo('parse markdown')

test('parse emojis', async () => {
  // testing normal emojis
  await expect(
    mapTextMessage({ ...rcMessage, msg: 'Test :thinking::grimacing: :fire:' })
  ).resolves.toStrictEqual({
    ...matrixMessage,
    body: 'Test 🤔😬 🔥',
  })

  // // testing translated reaction emojis
  // await expect(
  //   mapTextMessage({
  //     ...rcMessage,
  //     msg: 'normal :straight_ruler: and :custard: custom stuff :verdigado:',
  //   })
  // ).resolves.toStrictEqual({
  //   ...matrixMessage,
  //   body: 'normal 📏 and 🍮 custom stuff 🌻',
  // })
})

test('parse mentions', async () => {
  mockedSynapse.getServerName.mockResolvedValue('matrix.test')

  // no mentions
  await expect(mapTextMessage(rcMessage)).resolves.toStrictEqual(matrixMessage)

  // mentioning the room
  await expect(
    mapTextMessage({ ...rcMessage, msg: 'Hello @all' })
  ).resolves.toStrictEqual({
    ...matrixMessage,
    body: 'Hello @room',
    'm.mentions': { room: true },
  })

  // // mentioning online rc users, ignored in mx
  // await expect(
  //   mapTextMessage({ ...rcMessage, msg: 'Online @here' })
  // ).resolves.toStrictEqual({
  //   ...matrixMessage,
  //   body: 'Online @here',
  // })

  // mentioning one user
  await expect(
    mapTextMessage({ ...rcMessage, msg: 'Hey @joe' })
  ).resolves.toStrictEqual({
    ...matrixMessage,
    body: 'Hey @joe',
    format: 'org.matrix.custom.html',
    formatted_body:
      '<p>Hey <a href="https://matrix.to/#/@joe:matrix.test">@joe</a></p>', // with element, there is no @ within the a tag, nor p surrounding it
    'm.mentions': { user_ids: ['@joe:matrix.test'] },
  })

  // mentioning multiple users
  await expect(
    mapTextMessage({ ...rcMessage, msg: '@tom & @jerry' })
  ).resolves.toStrictEqual({
    ...matrixMessage,
    body: '@tom & @jerry',
    format: 'org.matrix.custom.html',
    formatted_body:
      '<p><a href="https://matrix.to/#/@tom:matrix.test">@tom</a> &amp; <a href="https://matrix.to/#/@jerry:matrix.test">@jerry</a></p>', // with element, there is no @ within the a tag, nor p surrounding it
    'm.mentions': { user_ids: ['@tom:matrix.test', '@jerry:matrix.test'] },
  })
})
