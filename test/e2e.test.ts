import { beforeAll, describe, expect, test } from '@jest/globals'
import { axios } from '../src/helpers/synapse'
import { entities } from '../src/Entities'
import lineByLine from 'n-readlines'
import { MatrixRoom, RcRoom } from '../src/handlers/rooms'
import { MatrixUser, RcUser } from '../src/handlers/users'

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

  test('equal length', async () => {
    const IGNORED_ROOMS = 0
    expect(matrixRooms.length).toBe(rcRooms.length - IGNORED_ROOMS)
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

  test('equal length', async () => {
    const IGNORED_USERS = 1
    expect(matrixUsers.length).toBe(rcUsers.length - IGNORED_USERS)
  })
})
