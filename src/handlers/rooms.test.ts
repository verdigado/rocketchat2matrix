import { expect, jest, test } from '@jest/globals'
import axios from 'axios'
import { Entity, entities } from '../Entities'
import { IdMapping } from '../entity/IdMapping'
import * as storage from '../helpers/storage'
import { SessionOptions } from '../helpers/synapse'
import {
  MatrixRoomPresets,
  MatrixRoomVisibility,
  RcRoom,
  RcRoomTypes,
  acceptInvitation,
  createDirectChatMemberships,
  createMapping,
  getCreator,
  getFilteredMembers,
  inviteMember,
  mapRoom,
  registerRoom,
} from './rooms'

jest.mock('axios')
const mockedAxios = axios as jest.Mocked<typeof axios>

jest.mock('../helpers/storage')
const mockedStorage = storage as jest.Mocked<typeof storage>

const roomCreator = {
  _id: 'roomcreatorid',
  name: 'RoomCreator',
  username: 'RoomCreator',
  roles: [],
  __rooms: [],
}

const rcDirectChat = {
  _id: 'aliceidbobid',
  t: RcRoomTypes.direct,
  usernames: ['Alice', 'Bob'],
  uids: ['aliceid', 'bobid'],
}

const rcPublicRoom = {
  _id: 'randomRoomId',
  fname: 'public',
  description: 'Public chat room',
  name: 'public',
  t: RcRoomTypes.chat,
  u: roomCreator,
}

const rcPrivateRoom = {
  _id: 'privateRoomId',
  name: 'private',
  fname: 'private',
  description: 'Private chat room',
  t: RcRoomTypes.private,
  u: roomCreator,
}

const sessionOption: SessionOptions = {
  headers: { Authorization: 'Bearer secretAuthToken' },
  testingOption: 'there might be other options',
}

const room_id = '!randomId:my.matrix.host'

test('mapping direct chats', () => {
  expect(mapRoom(rcDirectChat)).toEqual({
    is_direct: true,
    preset: MatrixRoomPresets.trusted,
    creation_content: {
      'm.federate': false,
    },
  })
  expect(getCreator(rcDirectChat)).toBe('aliceid')
})

test('mapping public rooms', () => {
  expect(mapRoom(rcPublicRoom)).toEqual({
    preset: MatrixRoomPresets.public,
    room_alias_name: 'public',
    name: 'public',
    topic: 'Public chat room',
    creation_content: {
      'm.federate': false,
    },
    visibility: MatrixRoomVisibility.public,
  })
  expect(getCreator(rcPublicRoom)).toBe(roomCreator._id)
})

test('mapping private rooms', () => {
  expect(mapRoom(rcPrivateRoom)).toEqual({
    preset: MatrixRoomPresets.private,
    room_alias_name: 'private',
    name: 'private',
    topic: 'Private chat room',
    creation_content: {
      'm.federate': false,
    },
    visibility: MatrixRoomVisibility.private,
  })
  expect(getCreator(rcPrivateRoom)).toBe(roomCreator._id)
})

test('mapping live chats', () => {
  expect(() =>
    mapRoom({ _id: 'liveChatId', t: RcRoomTypes.live })
  ).toThrowError(
    'Room with ID: liveChatId is a live chat. Migration not implemented'
  )
})

test('getting creator', () => {
  expect(getCreator(rcDirectChat)).toBe('aliceid')
  expect(getCreator(rcPublicRoom)).toBe(roomCreator._id)
  expect(getCreator(rcPrivateRoom)).toBe(roomCreator._id)
  expect(getCreator({} as RcRoom)).toBe('')
})

test('creating memberships for direct chats', async () => {
  await expect(createDirectChatMemberships(rcDirectChat)).resolves.toBe(
    undefined
  )
  expect(mockedStorage.createMembership).toHaveBeenCalledWith(
    rcDirectChat._id,
    rcDirectChat.uids[0]
  )
  expect(mockedStorage.createMembership).toHaveBeenCalledWith(
    rcDirectChat._id,
    rcDirectChat.uids[1]
  )
  expect(mockedStorage.createMembership).toHaveBeenCalledTimes(2)

  mockedStorage.createMembership.mockClear()

  await expect(
    createDirectChatMemberships({
      ...rcDirectChat,
      _id: 'hoihoi',
      uids: ['hoi', 'hoi'],
    })
  ).resolves.toBe(undefined)

  expect(mockedStorage.createMembership).toHaveBeenCalledWith('hoihoi', 'hoi')
  expect(mockedStorage.createMembership).toHaveBeenCalledTimes(1)
})

test('registering room', async () => {
  mockedAxios.post.mockResolvedValue({
    data: { room_id },
  })
  expect(await registerRoom(rcPublicRoom, sessionOption)).toBe(room_id)
  expect(mockedAxios.post).toHaveBeenCalledWith(
    '/_matrix/client/v3/createRoom',
    rcPublicRoom,
    sessionOption
  )
  expect(mockedAxios.post).toHaveBeenCalledTimes(1)
  mockedAxios.post.mockClear()
})

test('inviting member', async () => {
  await expect(
    inviteMember('inviteme', room_id, sessionOption)
  ).resolves.not.toThrow()
  expect(mockedAxios.post).toHaveBeenCalledWith(
    `/_matrix/client/v3/rooms/${room_id}/invite`,
    { user_id: 'inviteme' },
    sessionOption
  )
  expect(mockedAxios.post).toHaveBeenCalledTimes(1)
  mockedAxios.post.mockClear()
})

test('accepting invitation by joining the room', async () => {
  await expect(
    acceptInvitation(
      {
        rcId: 'whatever',
        matrixId: 'Neo',
        accessToken: 'secretAuthToken',
        type: entities[Entity.Users].mappingType,
      },
      room_id
    )
  ).resolves.toBe(undefined)
  expect(mockedAxios.post).toHaveBeenCalledWith(
    `/_matrix/client/v3/join/${room_id}`,
    {},
    { headers: sessionOption.headers }
  )
  expect(mockedAxios.post).toHaveBeenCalledTimes(1)
  mockedAxios.post.mockClear()
})

test('filtering members', async () => {
  const members = [
    'creator',
    'existingUser',
    'otherExistingUser',
    'excludedUser',
  ]
  function mockMapping(rcId: string, type?: number): IdMapping {
    return {
      rcId,
      matrixId: `@${rcId}:matrix`,
      type: type || entities[Entity.Users].mappingType,
      accessToken: 'accessToken',
    }
  }

  mockedStorage.getMapping.mockImplementation(async (rcId, type) =>
    rcId.includes('excluded') || !rcId ? null : mockMapping(rcId, type)
  )

  await expect(getFilteredMembers(members, members[0])).resolves.toStrictEqual([
    mockMapping('existingUser'),
    mockMapping('otherExistingUser'),
  ])
  expect(mockedStorage.getMapping).toBeCalledWith(
    'existingUser',
    entities[Entity.Users].mappingType
  )
  expect(mockedStorage.getMapping).toBeCalledWith(
    'otherExistingUser',
    entities[Entity.Users].mappingType
  )
  expect(mockedStorage.getMapping).toBeCalledWith(
    'excludedUser',
    entities[Entity.Users].mappingType
  )
})

test('creating mapping', async () => {
  await expect(createMapping(rcPublicRoom._id, room_id)).resolves.toBe(
    undefined
  )
  expect(mockedStorage.save).toHaveBeenCalledWith({
    rcId: rcPublicRoom._id,
    matrixId: room_id,
    type: entities[Entity.Rooms].mappingType,
    accessToken: undefined,
  } as IdMapping)
})
