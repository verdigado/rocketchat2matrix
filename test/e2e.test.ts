import { beforeAll, describe, expect, test } from '@jest/globals'
import lineByLine from 'n-readlines'
import { entities } from '../src/Entities'
import { IdMapping } from '../src/entity/IdMapping'
import { MatrixMessage, RcMessage } from '../src/handlers/messages'
import { MatrixRoom, RcRoom } from '../src/handlers/rooms'
import { MatrixUser, RcUser } from '../src/handlers/users'
import {
  getMapping,
  getRoomId,
  getUserId,
  initStorage,
} from '../src/helpers/storage'
import { axios, formatUserSessionOptions } from '../src/helpers/synapse'

beforeAll(async () => {
  await initStorage()
})

describe('rooms', () => {
  const rcRooms: RcRoom[] = []
  const matrixRooms: MatrixRoom[] = []

  beforeAll(async () => {
    const rl = new lineByLine(`./inputs/${entities.rooms.filename}`)
    let line: false | Buffer
    while ((line = rl.next())) {
      const room: RcRoom = JSON.parse(line.toString())
      rcRooms.push(room)
    }
    ;(await axios.get('/_synapse/admin/v1/rooms')).data.rooms.forEach(
      (room: MatrixRoom) => matrixRooms.push(room)
    )
  })

  test('equal number', () => {
    const IGNORED_ROOMS = 0
    expect(matrixRooms.length).toBe(rcRooms.length - IGNORED_ROOMS)
  })

  test('self chat exists', async () => {
    const roomId = await getRoomId('selfChat')
    const room = matrixRooms.find((room) => room.room_id === roomId) as {
      joined_members: number
      creator: string
      public: boolean
      join_rules: string
    }

    expect(room.joined_members).toBe(1)
    expect(room.creator).toContain('normal_user')
    expect(room.public).toBe(false)
    expect(room.join_rules).toBe('invite')
  })

  test('modes and permissions', () => {
    const publicRoom = matrixRooms.find((room) => room.name === 'PubRoom') as {
      public: boolean
      join_rules: string
    }
    expect(publicRoom.public).toBe(true)
    expect(publicRoom.join_rules).toBe('public')

    const privateRoom = matrixRooms.find((room) => room.name === 'priv') as {
      public: boolean
      join_rules: string
    }
    expect(privateRoom.public).toBe(false)
    expect(privateRoom.join_rules).toBe('invite')
  })

  test('direct chats are marked as such', async () => {
    const roomId = await getRoomId('directChat')
    const room = matrixRooms.find((room) => room.room_id === roomId) as {
      joined_members: number
      creator: string
      public: boolean
      join_rules: string
    }

    expect(room.joined_members).toBe(2)
    expect(room.creator).toContain('normal_user')
    expect(room.public).toBe(false)
    expect(room.join_rules).toBe('invite')

    const normalUserMapping = await getMapping('normalUserId', 0)
    const directChats = (
      await axios.get(
        `/_matrix/client/v3/user/${normalUserMapping?.matrixId}/account_data/m.direct`,
        formatUserSessionOptions(normalUserMapping?.accessToken || '')
      )
    ).data
    expect(directChats[(await getUserId('otherUserId')) || '']).toContain(
      roomId
    )
  })

  test('memberships are correct', async () => {
    const sortById = (
      a: { id: string | undefined; members: (string | undefined)[] },
      b: { id: string | undefined; members: (string | undefined)[] }
    ): number => a.id?.localeCompare(b.id || '') || 0

    const matrixRoomMembers = await Promise.all(
      matrixRooms.map(async (room) => ({
        id: room.room_id,
        members: (
          await axios.get(`/_synapse/admin/v1/rooms/${room.room_id}/members`)
        ).data.members.sort(),
      }))
    )

    const rcRoomMembers = await Promise.all(
      [
        {
          id: 'GENERAL',
          members: ['normalUserId', 'otherUserId'],
        },
        {
          id: 'publicRoom',
          members: ['normalUserId', 'otherUserId'],
        },
        {
          id: 'privateRoom',
          members: ['normalUserId', 'otherUserId'],
        },
        {
          id: 'directChat',
          members: ['normalUserId', 'otherUserId'],
        },
        {
          id: 'directChatWithDeletedUser',
          members: ['normalUserId'],
        },
        {
          id: 'selfChat',
          members: ['normalUserId'],
        },
      ].map(async (room) => ({
        id: await getRoomId(room.id),
        members: await Promise.all(room.members.map(getUserId)),
      }))
    )

    // add admin user to GENERAL room
    const admin = (await axios.get('/_matrix/client/v3/account/whoami')).data
      .user_id
    rcRoomMembers[0].members.push(admin)

    expect(matrixRoomMembers.sort(sortById)).toEqual(
      rcRoomMembers.sort(sortById).map((room) => ({
        id: room.id,
        members: room.members.sort(),
      }))
    )
  })
})

describe('users', () => {
  const rcUsers: RcUser[] = []
  const matrixUsers: MatrixUser[] = []

  beforeAll(async () => {
    const rl = new lineByLine(`./inputs/${entities.users.filename}`)
    let line: false | Buffer
    while ((line = rl.next())) {
      const user: RcUser = JSON.parse(line.toString())
      rcUsers.push(user)
    }
    ;(await axios.get('/_synapse/admin/v2/users')).data.users.forEach(
      (user: MatrixUser) => matrixUsers.push(user)
    )
  })

  test('equal number', async () => {
    const IGNORED_USERS = 1
    expect(matrixUsers.length).toBe(rcUsers.length - IGNORED_USERS)
  })

  test.todo('user without username is handled')
})

describe('messages', () => {
  type Message = {
    rc: RcMessage
    matrix?: {
      content: MatrixMessage
      event_id?: string
      room_id?: string
      origin_server_ts?: number
    }
    mapping?: IdMapping
  }

  const messages: Message[] = []

  beforeAll(async () => {
    const rl = new lineByLine(`./inputs/${entities.messages.filename}`)
    let line: false | Buffer
    while ((line = rl.next())) {
      const message: Message = { rc: JSON.parse(line.toString()) }
      message.mapping = (await getMapping(message.rc._id, 2)) || undefined
      if (message.mapping) {
        const roomId = await getRoomId(message.rc.rid)
        const messageId = message.mapping.matrixId

        message.matrix =
          (
            await axios.get(
              `/_matrix/client/v3/rooms/${roomId}/event/${messageId}`
            )
          ).data || undefined
      }
      messages.push(message)
    }
  })

  test('equal number', async () => {
    const IGNORED_MESSAGES = 5
    expect(messages.filter((message) => !!message.mapping).length).toBe(
      messages.length - IGNORED_MESSAGES
    )
  })

  test('correct time', async () => {
    const existingMessages = messages.filter((message) => !!message.matrix)
    expect(
      existingMessages.map((message) => new Date(message.rc.ts.$date).getTime())
    ).toStrictEqual(
      existingMessages.map((message) => message.matrix!.origin_server_ts)
    )
  })

  test('reactions', async () => {
    async function getReactions(rcMessageId: string) {
      const message = messages.find((message) => message.rc._id == rcMessageId)
      const relations = (
        await axios.get(
          `/_matrix/client/v1/rooms/${message!.matrix!.room_id}/relations/${message!.mapping!.matrixId}`
        )
      ).data.chunk
      const reactions = relations
        .filter((relation: { type: string }) => relation.type == 'm.reaction')
        .map((reaction: any) => ({
          user: reaction.sender.split('@')[1].split(':')[0],
          key: reaction.content['m.relates_to'].key,
        }))
      return reactions
    }

    await expect(getReactions('msgId001')).resolves.toStrictEqual([
      { user: 'other_user', key: '❤️' },
      { user: 'other_user', key: '🎉' },
      { user: 'normal_user', key: '🎉' },
    ])
    await expect(getReactions('msgThreadResponse')).resolves.toStrictEqual([
      { user: 'normal_user', key: '👋' },
    ])
  })

  test('pinned messages', async () => {
    const pinnedMessages: Message[] = messages.filter(
      (message) => message.rc.pinned
    )
    const roomId = await getRoomId('GENERAL')

    expect(
      (
        await axios.get(
          `/_matrix/client/v3/rooms/${roomId}/state/m.room.pinned_events/`
        )
      ).data.pinned
    ).toStrictEqual(pinnedMessages.map((message) => message.mapping?.matrixId))
  })

  test('answer is in thread', () => {
    const threadMessage = messages.find(
      (message) => message.rc._id == 'msgThreadResponse'
    )?.matrix

    const rootMessageId = messages.find(
      (message) => message.rc._id == 'msgId001'
    )?.matrix?.event_id

    expect(threadMessage?.content['m.relates_to']?.event_id).toBe(rootMessageId)
  })

  test('markdown, mention and emoji conversion', () => {
    const message = messages.find(
      (message) => message.rc._id == 'mdMsg'
    )?.matrix

    expect(message?.content?.formatted_body).toContain(
      '@room <strong>Markdown</strong> works 🎉'
    )
  })
})
