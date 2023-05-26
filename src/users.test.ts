process.env.REGISTRATION_SHARED_SECRET = 'ThisIsSoSecretWow'
import { RcUser, MatrixUser, mapUser } from './users'

const rcUser: RcUser = {
  _id: 'testRc',
  name: 'Tester',
  username: 'test',
  roles: ['user'],
  __rooms: [],
}
const matrixUser: MatrixUser = {
  user_id: '',
  username: rcUser.username,
  displayname: rcUser.name,
  password: '',
  admin: false,
}

test('mapping users', () => {
  expect(mapUser(rcUser)).toStrictEqual(matrixUser)
})
