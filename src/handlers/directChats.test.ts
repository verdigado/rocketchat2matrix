import { expect, test } from '@jest/globals'
import { DirectChats, parseDirectChats } from './directChats'

test('direct chat parsing', () => {
  const directChats: DirectChats = {
    abc: ['a', 'b', 'c'],
    ab: ['a', 'b'],
  }

  expect(parseDirectChats(directChats)).toStrictEqual({
    a: { b: ['abc', 'ab'], c: ['abc'] },
    b: { a: ['abc', 'ab'], c: ['abc'] },
    c: { a: ['abc'], b: ['abc'] },
  })
})
