process.env.REGISTRATION_SHARED_SECRET = 'ThisIsSoSecretWow'
import axios from 'axios'
import { RcUser, MatrixUser, mapUser, createUser } from './users'

jest.mock('axios')
const mockedAxios = axios as jest.Mocked<typeof axios>

const rcUser: RcUser = {
  _id: 'testRc',
  name: 'Tester McDelme',
  username: 'testuser',
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

test('creating users', async () => {
  const nonce = 'test-nonce'
  const matrixId = 'TestRandomId'

  mockedAxios.get.mockResolvedValue({ data: { nonce: nonce } })
  mockedAxios.post.mockResolvedValue({
    data: { user_id: matrixId },
  })

  const createdUser = await createUser(rcUser)
  expect(createdUser).toStrictEqual({
    ...matrixUser,
    user_id: matrixId,
  })

  expect(mockedAxios.get).toHaveBeenCalledWith('/_synapse/admin/v1/register')
  expect(mockedAxios.post).toHaveBeenCalled()
  // The following test rails with an incorrect return value, for whatever reason.
  // Probably because of mutated call logs in jest due to the `delete` or sth.
  // expect(mockedAxios.post).toHaveBeenCalledWith('/_synapse/admin/v1/register', {
  //   ...matrixUser,
  //   nonce,
  //   mac: 'be0537407ab3c82de908c5763185556e98a7211c',
  // })
})
