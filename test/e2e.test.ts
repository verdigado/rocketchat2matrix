import { beforeAll, describe, expect, test } from '@jest/globals'
import lineByLine from 'n-readlines'
import { entities } from '../src/Entities'
import { IdMapping } from '../src/entity/IdMapping'
import { MatrixMessage, RcMessage } from '../src/handlers/messages'
import { MatrixRoom, RcRoom } from '../src/handlers/rooms'
import { MatrixUser, RcUser } from '../src/handlers/users'
import { getMapping, getRoomId, initStorage } from '../src/helpers/storage'
import { axios } from '../src/helpers/synapse'

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

  test.todo('modes and permissions')
  test.todo('self chat exists')
  test.todo('direct chats are marked as such')
  test.todo('memberships are correct')
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

  test.todo('deleted user is skipped')
  test.todo('user without username is handled')
})

type Message = {
  rc: RcMessage
  matrix?: MatrixMessage
  mapping?: IdMapping
}

describe('messages', () => {
  const messages: Message[] = []

  beforeAll(async () => {
    await initStorage()
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
      const message = messages.filter(
        (message) => message.rc._id == rcMessageId
      )[0]
      const relations = (
        await axios.get(
          `/_matrix/client/v1/rooms/${message.matrix?.room_id}/relations/${message.mapping!.matrixId}`
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

  test.todo('markdown conversion')
  test.todo('answer is in thread')
})
