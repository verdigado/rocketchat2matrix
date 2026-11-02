import { randomBytes } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs'
import { dirname, parse, relative, resolve } from 'node:path'

/**
 * Settings of the end-to-end encrypted (E2EE) migration mode.
 *
 * When `E2EE=true`, every migrated room is created encrypted, every
 * historical message and reaction is encrypted by its author before it is
 * sent to Tuwunel, and every migrated user gets a key backup protected by a
 * personal recovery key. No plaintext message is ever sent in this mode.
 */

const TRUE_VALUES = ['1', 'true', 'yes', 'on']
const FALSE_VALUES = ['', '0', 'false', 'no', 'off']

/**
 * Parse a boolean setting, refusing ambiguous values
 * @param name The environment variable
 * @param fallback The value when the variable is not set
 * @returns The boolean value
 */
function booleanSetting(name: string, fallback: boolean): boolean {
  const raw = process.env[name]
  if (raw === undefined) {
    return fallback
  }
  const value = raw.trim().toLowerCase()
  if (TRUE_VALUES.includes(value)) return true
  if (FALSE_VALUES.includes(value)) return false
  throw new Error(`${name}='${raw}' is not a valid value: use true or false`)
}

/**
 * @returns true if the E2EE migration mode is enabled in the environment
 */
export function isE2EE(): boolean {
  return booleanSetting('E2EE', false)
}

/**
 * @returns The directory holding the encrypted crypto stores of the migration devices
 */
export function getStoreDir(): string {
  return resolve(process.env.E2EE_STORE_DIR || './e2ee-store')
}

/**
 * @returns The file holding the generated passphrase of the crypto stores,
 * kept outside of the store directory
 */
export function getPassphraseFile(): string {
  return `${getStoreDir()}.passphrase`
}

/**
 * @returns The file the recovery keys of the migrated users are written to
 */
export function getRecoveryKeysFile(): string {
  return resolve(process.env.E2EE_RECOVERY_KEYS_FILE || './recovery-keys.txt')
}

/**
 * @returns Whether the migration devices must be logged out once the
 * migration has been verified. Defaults to true.
 */
export function shouldFinalize(): boolean {
  return booleanSetting('E2EE_FINALIZE', true)
}

/**
 * @returns Whether the migration may be finalized although some users could
 * not get a recovery key (they already had their own encryption setup)
 */
export function allowSkippedUsers(): boolean {
  return booleanSetting('E2EE_ALLOW_SKIPPED_USERS', false)
}

/**
 * @param parent A directory
 * @param child A path
 * @returns Whether `child` is `parent` or inside it
 */
function isInside(parent: string, child: string): boolean {
  const rel = relative(parent, child)
  return rel === '' || (!rel.startsWith('..') && !parse(rel).root)
}

/**
 * Refuse settings that would make the end of the migration delete something
 * it did not create (the store directory is emptied at the end).
 */
export function validateE2EEConfig(): void {
  booleanSetting('E2EE_FINALIZE', true)
  booleanSetting('E2EE_ALLOW_SKIPPED_USERS', false)
  const storeDir = getStoreDir()
  if (isInside(storeDir, process.cwd()) || storeDir === parse(storeDir).root) {
    throw new Error(
      `E2EE_STORE_DIR=${storeDir} must be a dedicated directory, not the project directory or one of its parents`
    )
  }
  if (isInside(storeDir, getRecoveryKeysFile())) {
    throw new Error(
      'E2EE_RECOVERY_KEYS_FILE must not be inside E2EE_STORE_DIR, which is deleted at the end of the migration'
    )
  }
  if (existsSync(storeDir)) {
    const foreign = readdirSync(storeDir).filter(
      (name) => !name.startsWith('@')
    )
    if (foreign.length > 0) {
      throw new Error(
        `E2EE_STORE_DIR=${storeDir} contains files that were not created by the migration: ${foreign.join(', ')}`
      )
    }
  }
}

/**
 * Create the store directory with restrictive permissions
 * @returns The store directory
 */
export function ensureStoreDir(): string {
  const dir = getStoreDir()
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 })
  }
  chmodSync(dir, 0o700)
  return dir
}

/**
 * Return the passphrase encrypting the crypto stores at rest.
 *
 * It is read from `E2EE_STORE_PASSPHRASE`, or generated once and kept next
 * to (not inside) the store directory, so an interrupted migration can be
 * resumed. It is deleted with the stores at the end of the migration.
 * @returns The passphrase
 */
export function getStorePassphrase(): string {
  const fromEnv = process.env.E2EE_STORE_PASSPHRASE
  if (fromEnv) {
    return fromEnv
  }

  const file = getPassphraseFile()
  if (!existsSync(file)) {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, randomBytes(32).toString('base64url'), { mode: 0o600 })
  }
  return readFileSync(file, 'utf8').trim()
}
