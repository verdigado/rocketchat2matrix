process.env.AS_TOKEN = 'ApplicationSecretToken'
process.env.EXCLUDED_USERS = 'excludedUser1,excludedUser2'
import { expect, jest, test } from '@jest/globals'
import axios from 'axios'
import * as storage from '../helpers/storage'
import {
  MatrixMessage,
  RcMessage,
  createMessage,
  handle,
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
  mockedAxios.put.mockClear()
})

test('handling messages', async () => {
  mockedAxios.put.mockResolvedValue({ data: { event_id: 'test@matrix' } })
  mockedStorage.getRoomId.mockResolvedValue('testMatrixRoom')
  mockedStorage.getUserId.mockResolvedValue('testMatrixUser')
  mockedStorage.getMessageId.mockResolvedValueOnce(undefined) // For checking if the Message already exists
  mockedStorage.getMessageId.mockResolvedValue('testMatrixMessage') // For checking the parent message

  await expect(handle({ ...rcMessage, tmid: 'threadId' })).resolves.toBe(
    undefined
  )

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
  mockedAxios.put.mockClear()
})
