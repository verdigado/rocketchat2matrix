import { expect, jest, test } from '@jest/globals'
import { getUserSessionOptions } from '../helpers/synapse'
import { getCreatorSessionOptions } from './rooms'

jest.mock('../helpers/synapse')
const mockedGetUserSessionOptions = getUserSessionOptions as jest.Mocked<
  typeof getUserSessionOptions
>

const sessionOption = {
  headers: { Authorization: 'Bearer secretAuthToken' },
}

test('getting token for different room creators', async () => {
  mockedGetUserSessionOptions.mockImplementation(async (id: string) => {
    if (id.includes('excluded')) {
      throw new Error(`Could not retrieve access token for ID ${id}`)
    }
    return sessionOption
  })

  expect(await getCreatorSessionOptions('')).toStrictEqual({})
  expect(await getCreatorSessionOptions('excludedUser')).toStrictEqual({})
  expect(await getCreatorSessionOptions('creator')).toStrictEqual(sessionOption)
  expect(mockedGetUserSessionOptions).toHaveBeenCalledWith('excludedUser')
  expect(mockedGetUserSessionOptions).toHaveBeenCalledWith('creator')
})
