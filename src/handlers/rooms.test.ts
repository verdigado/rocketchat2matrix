import {
  MatrixRoomPresets,
  MatrixRoomVisibility,
  RcRoomTypes,
  mapRoom,
} from './rooms'

const roomCreator = {
  _id: 'roomcreatorid',
  name: 'RoomCreator',
  username: 'RoomCreator',
  roles: [],
  __rooms: [],
}

test('mapping direct chats', () => {
  expect(
    mapRoom({
      _id: 'aliceidbobid',
      t: RcRoomTypes.direct,
      usernames: ['Alice', 'Bob'],
      uids: ['aliceid', 'bobid'],
    })
  ).toEqual({
    is_direct: true,
    preset: MatrixRoomPresets.trusted,
    creation_content: {
      'm.federate': false,
    },
    _creatorId: 'aliceid',
  })
})

test('mapping public rooms', () => {
  expect(
    mapRoom({
      _id: 'randomRoomId',
      fname: 'public',
      description: 'Public chat room',
      name: 'public',
      t: RcRoomTypes.chat,
      u: roomCreator,
    })
  ).toEqual({
    preset: MatrixRoomPresets.public,
    room_alias_name: 'public',
    name: 'public',
    topic: 'Public chat room',
    creation_content: {
      'm.federate': false,
    },
    visibility: MatrixRoomVisibility.public,
    _creatorId: roomCreator._id,
  })
})

test('mapping private rooms', () => {
  expect(
    mapRoom({
      _id: 'privateRoomId',
      name: 'private',
      fname: 'private',
      description: 'Private chat room',
      t: RcRoomTypes.private,
      u: roomCreator,
    })
  ).toEqual({
    preset: MatrixRoomPresets.private,
    room_alias_name: 'private',
    name: 'private',
    topic: 'Private chat room',
    creation_content: {
      'm.federate': false,
    },
    _creatorId: roomCreator._id,
  })
})

test('mapping live chats', () => {
  expect(() =>
    mapRoom({ _id: 'liveChatId', t: RcRoomTypes.live })
  ).toThrowError('Room type l is unknown')
})
