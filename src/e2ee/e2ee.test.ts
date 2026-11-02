import { afterEach, expect, test } from '@jest/globals'
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mapRoom, RcRoomTypes } from '../handlers/rooms'
import { isE2EE, shouldFinalize, validateE2EEConfig } from './config'
import { canonicalJson } from './matrix'
import { readRecoveryKeys, writeRecoveryKeysFile } from './recovery'

const env = { ...process.env }
afterEach(() => {
  process.env = { ...env }
})

test('E2EE mode is off unless explicitly enabled', () => {
  delete process.env.E2EE
  expect(isE2EE()).toBe(false)
  for (const value of ['true', 'TRUE', '1', 'yes', ' on ']) {
    process.env.E2EE = value
    expect(isE2EE()).toBe(true)
  }
  for (const value of ['false', '0', 'no', '']) {
    process.env.E2EE = value
    expect(isE2EE()).toBe(false)
  }
  for (const value of ['oui', 'enabled', 'tru']) {
    process.env.E2EE = value
    expect(() => isE2EE()).toThrow('is not a valid value')
  }
})

test('the store directory can never hold the project or the recovery keys', () => {
  process.env.E2EE_STORE_DIR = '.'
  expect(() => validateE2EEConfig()).toThrow('must be a dedicated directory')
  process.env.E2EE_STORE_DIR = '..'
  expect(() => validateE2EEConfig()).toThrow('must be a dedicated directory')
  process.env.E2EE_STORE_DIR = '/tmp/rc2t-secrets-test'
  process.env.E2EE_RECOVERY_KEYS_FILE = '/tmp/rc2t-secrets-test/keys.txt'
  expect(() => validateE2EEConfig()).toThrow(
    'must not be inside E2EE_STORE_DIR'
  )
  process.env.E2EE_RECOVERY_KEYS_FILE = '/tmp/rc2t-keys-test.txt'
  expect(() => validateE2EEConfig()).not.toThrow()
})

test('migration devices are finalized unless disabled', () => {
  delete process.env.E2EE_FINALIZE
  expect(shouldFinalize()).toBe(true)
  process.env.E2EE_FINALIZE = 'false'
  expect(shouldFinalize()).toBe(false)
})

test('canonical JSON sorts keys and drops whitespace', () => {
  expect(canonicalJson({ b: 1, a: { d: [1, 'é'], c: null } })).toBe(
    '{"a":{"c":null,"d":[1,"é"]},"b":1}'
  )
  expect(canonicalJson({ public_key: 'abc' })).toBe('{"public_key":"abc"}')
})

test('rooms are created encrypted in E2EE mode only', () => {
  const rcRoom = { _id: 'r', t: RcRoomTypes.private, name: 'priv' }
  process.env.E2EE = 'false'
  expect(mapRoom(rcRoom).initial_state).toBeUndefined()
  process.env.E2EE = 'true'
  expect(mapRoom(rcRoom).initial_state).toStrictEqual([
    {
      type: 'm.room.encryption',
      state_key: '',
      content: { algorithm: 'm.megolm.v1.aes-sha2' },
    },
  ])
})

test('recovery keys file keeps one key per user, mode 0600', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rc2t-'))
  process.env.E2EE_RECOVERY_KEYS_FILE = join(dir, 'keys.txt')
  try {
    const recovery = {
      backupVersion: '1',
      backupPublicKey: 'pk',
    }
    writeRecoveryKeysFile([
      { ...recovery, userId: '@b:server', recoveryKey: 'EsTB key' },
      { ...recovery, userId: '@a:server', recoveryKey: 'EsTA key' },
    ])
    expect(readRecoveryKeys()).toStrictEqual(
      new Map([
        ['@a:server', 'EsTA key'],
        ['@b:server', 'EsTB key'],
      ])
    )
    expect(statSync(process.env.E2EE_RECOVERY_KEYS_FILE).mode & 0o777).toBe(
      0o600
    )
    expect(readFileSync(process.env.E2EE_RECOVERY_KEYS_FILE, 'utf8')).toContain(
      '@a:server\ta\tEsTA key'
    )
    // a later run keeps the keys of the users it did not provision
    writeRecoveryKeysFile([
      { ...recovery, userId: '@a:server', recoveryKey: 'EsTA new' },
    ])
    expect(readRecoveryKeys()).toStrictEqual(
      new Map([
        ['@a:server', 'EsTA new'],
        ['@b:server', 'EsTB key'],
      ])
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
