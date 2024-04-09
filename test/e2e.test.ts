import { beforeAll, describe, expect, test } from '@jest/globals'
import { axios } from '../src/helpers/synapse'
import { entities } from '../src/Entities'
import lineByLine from 'n-readlines'
import { MatrixRoom, RcRoom } from '../src/handlers/rooms'

describe('rooms', () => {
  const rcRooms = []
  const matrixRooms = []

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
    expect(matrixRooms.length).toBe(rcRooms.length)
    test
  })
})
