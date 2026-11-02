import {
  appendFileSync,
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  openSync,
  readFileSync,
  renameSync,
  writeSync,
} from 'node:fs'
import log from '../helpers/logger'
import { getRecoveryKeysFile } from './config'
import { canonicalJson, enc, httpStatus, matrixErrorCode } from './matrix'
import { loadSdk } from './sdk'
import { CryptoSession } from './session'

export const BACKUP_ALGORITHM = 'm.megolm_backup.v1.curve25519-aes-sha2'

/**
 * What a migrated user needs to read their history: a server-side key backup
 * and the recovery key protecting it.
 */
export type UserRecovery = {
  userId: string
  backupVersion: string
  backupPublicKey: string
  recoveryKey: string
}

type BackupInfo = {
  version: string
  algorithm: string
  auth_data: {
    public_key?: string
    signatures?: Record<string, Record<string, string>>
  }
}

const FILE_HEADER = [
  '# Rocket.Chat -> Matrix migration: personal recovery keys',
  '# Give each key to its owner only, through a safe channel, then delete this file.',
  '# The key is asked once by Element/Tesseract to "verify this session" and unlock the migrated history.',
  '# matrix_user_id\tlocalpart\trecovery_key',
  '',
].join('\n')

/**
 * @param userId A Matrix user ID
 * @param recoveryKey Its recovery key
 * @returns The line of the recovery keys file
 */
function recoveryKeyLine(userId: string, recoveryKey: string): string {
  return `${userId}\t${userId.slice(1).split(':')[0]}\t${recoveryKey}\n`
}

/**
 * Read the recovery keys already written by a previous (interrupted) run
 * @returns A map of Matrix user IDs to recovery keys
 */
export function readRecoveryKeys(): Map<string, string> {
  const keys = new Map<string, string>()
  const file = getRecoveryKeysFile()
  if (!existsSync(file)) {
    return keys
  }
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const [userId, , recoveryKey] = line.split('\t')
    if (userId?.startsWith('@') && recoveryKey) {
      keys.set(userId, recoveryKey.trim())
    }
  }
  return keys
}

/**
 * Write a recovery key to the recovery keys file (mode 0600). It is written
 * before anything is uploaded, so a key can never be lost.
 * @param userId The Matrix user ID
 * @param recoveryKey The recovery key
 */
function saveRecoveryKey(userId: string, recoveryKey: string): void {
  const file = getRecoveryKeysFile()
  if (!existsSync(file)) {
    appendFileSync(file, FILE_HEADER, { mode: 0o600 })
  }
  chmodSync(file, 0o600)
  appendFileSync(file, recoveryKeyLine(userId, recoveryKey))
}

/**
 * Rewrite the recovery keys file with exactly one (the current) key per user.
 * Keys of users not provisioned in this run are kept. The new file replaces
 * the old one only once it is completely written.
 * @param recoveries The users provisioned in this run
 */
export function writeRecoveryKeysFile(recoveries: UserRecovery[]): void {
  const keys = readRecoveryKeys()
  for (const recovery of recoveries) {
    keys.set(recovery.userId, recovery.recoveryKey)
  }
  const file = getRecoveryKeysFile()
  const temporary = `${file}.tmp`
  const fd = openSync(temporary, 'w', 0o600)
  try {
    writeSync(fd, FILE_HEADER)
    for (const userId of [...keys.keys()].sort()) {
      writeSync(fd, recoveryKeyLine(userId, keys.get(userId)!))
    }
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
  renameSync(temporary, file)
  chmodSync(file, 0o600)
}

/**
 * Read an account data event of the session's user
 * @param session The user's crypto session
 * @param type The account data type
 * @returns The content, or undefined if it does not exist
 */
async function getAccountData(
  session: CryptoSession,
  type: string
): Promise<Record<string, unknown> | undefined> {
  try {
    return await session.request(
      'GET',
      `/_matrix/client/v3/user/${enc(session.userId)}/account_data/${enc(type)}`
    )
  } catch (error) {
    if (httpStatus(error) === 404 || matrixErrorCode(error) === 'M_NOT_FOUND') {
      return undefined
    }
    throw error
  }
}

/**
 * Write an account data event of the session's user
 * @param session The user's crypto session
 * @param type The account data type
 * @param content The content
 */
async function putAccountData(
  session: CryptoSession,
  type: string,
  content: unknown
): Promise<void> {
  await session.request(
    'PUT',
    `/_matrix/client/v3/user/${enc(session.userId)}/account_data/${enc(type)}`,
    content
  )
}

/**
 * @param session The user's crypto session
 * @returns The latest key backup of the user, if any
 */
export async function getLatestBackup(
  session: CryptoSession
): Promise<BackupInfo | undefined> {
  try {
    return await session.request<BackupInfo>(
      'GET',
      '/_matrix/client/v3/room_keys/version'
    )
  } catch (error) {
    if (httpStatus(error) === 404 || matrixErrorCode(error) === 'M_NOT_FOUND') {
      return undefined
    }
    throw error
  }
}

/**
 * @param session The user's crypto session
 * @returns The cross-signing master key published on the server, if any
 */
export async function getPublishedMasterKey(
  session: CryptoSession
): Promise<{ keys?: Record<string, string> } | undefined> {
  const response = await session.request<{
    master_keys?: Record<string, { keys?: Record<string, string> }>
  }>('POST', '/_matrix/client/v3/keys/query', {
    device_keys: { [session.userId]: [] },
  })
  return response.master_keys?.[session.userId]
}

/**
 * @param session The user's crypto session
 * @returns The key ID (ed25519:<public key>) of the local master key, if any
 */
async function getLocalMasterKeyId(
  session: CryptoSession
): Promise<string | undefined> {
  const signatures = JSON.parse(
    (await session.machine.sign('{}')).asJSON()
  ) as Record<string, Record<string, string>>
  return Object.keys(signatures[session.userId] || {}).find(
    (keyId) => keyId !== `ed25519:${session.deviceId}`
  )
}

/**
 * Create the cross-signing identity of the user (master, self-signing and
 * user-signing keys) and sign the migration device with it. As the user has
 * no cross-signing keys yet, Tuwunel accepts the upload without password
 * (MSC3967).
 * @param session The user's crypto session
 */
async function setupCrossSigning(session: CryptoSession): Promise<void> {
  const status = await session.machine.crossSigningStatus()
  const local =
    status.hasMaster && status.hasSelfSigning && status.hasUserSigning
  const published = await getPublishedMasterKey(session)

  if (published) {
    const localKeyId = local ? await getLocalMasterKeyId(session) : undefined
    if (localKeyId && published.keys?.[localKeyId]) {
      log.debug(`E2EE: cross-signing already set up for ${session.userId}`)
      return
    }
    throw new AlreadyProvisionedError(
      `${session.userId} already has a cross-signing identity on the server`
    )
  }

  // A previous run may have created the identity locally and stopped
  // before publishing it: publish that same identity again.
  const requests = await session.machine.bootstrapCrossSigning(!local)
  if (requests.uploadKeysReq) {
    await session.sendOutgoingRequest(requests.uploadKeysReq)
  }
  try {
    await session.request(
      'POST',
      '/_matrix/client/v3/keys/device_signing/upload',
      JSON.parse(requests.uploadSigningKeysReq)
    )
  } catch (error) {
    if (httpStatus(error) === 401) {
      throw new Error(
        `E2EE: Tuwunel asked for interactive authentication to create the cross-signing keys of ${session.userId}`
      )
    }
    throw error
  }
  await session.sendOutgoingRequest(requests.uploadSignaturesReq)
  log.info(`E2EE: cross-signing identity created for ${session.userId}`)
}

/**
 * Create the server-side key backup of the user, or reuse the one created by
 * a previous run.
 * @param session The user's crypto session
 * @returns The backup version, its public key and its private key (base64)
 */
async function setupKeyBackup(
  session: CryptoSession
): Promise<{ version: string; publicKey: string; privateKey: string }> {
  const sdk = loadSdk()
  const latest = await getLatestBackup(session)
  const saved = await session.machine.getBackupKeys()

  if (saved.decryptionKeyBase64 && saved.backupVersion) {
    const key = sdk.BackupDecryptionKey.fromBase64(saved.decryptionKeyBase64)
    const publicKey = key.megolmV1PublicKey.publicKeyBase64
    if (
      latest?.version === saved.backupVersion &&
      latest.auth_data?.public_key === publicKey
    ) {
      log.debug(
        `E2EE: reusing key backup ${latest.version} of ${session.userId}`
      )
      return {
        version: latest.version,
        publicKey,
        privateKey: saved.decryptionKeyBase64,
      }
    }
  }
  if (latest) {
    const createdByMigration =
      latest.auth_data?.signatures?.[session.userId]?.[
        `ed25519:${session.deviceId}`
      ] !== undefined
    if (!createdByMigration) {
      throw new AlreadyProvisionedError(
        `${session.userId} already has a key backup (version ${latest.version}) that was not created by this migration`
      )
    }
    // A previous run created this backup but stopped before saving its key:
    // replace it (it cannot have been used, its key is unknown).
    log.warn(
      `E2EE: replacing the unfinished key backup ${latest.version} of ${session.userId}`
    )
    await session.request(
      'DELETE',
      `/_matrix/client/v3/room_keys/version/${enc(latest.version)}`
    )
  }

  const key = sdk.BackupDecryptionKey.createRandomKey()
  const publicKey = key.megolmV1PublicKey.publicKeyBase64
  const authData: Record<string, unknown> = { public_key: publicKey }
  const signatures = await session.machine.sign(canonicalJson(authData))
  authData.signatures = JSON.parse(signatures.asJSON())

  const { version } = await session.request<{ version: string }>(
    'POST',
    '/_matrix/client/v3/room_keys/version',
    { algorithm: BACKUP_ALGORITHM, auth_data: authData }
  )
  await session.machine.saveBackupDecryptionKey(key, version)
  log.info(`E2EE: key backup ${version} created for ${session.userId}`)
  return { version, publicKey, privateKey: key.toBase64() }
}

/**
 * Store the cross-signing keys and the backup key in the user's Secret
 * Storage (SSSS), encrypted with a new random key. The base58 form of this
 * key is the user's recovery key, the one Element and Tesseract ask for.
 * @param session The user's crypto session
 * @param backupPrivateKey The backup private key (base64)
 * @param knownRecoveryKey The recovery key written by a previous run, if any
 * @returns The recovery key
 */
async function setupSecretStorage(
  session: CryptoSession,
  backupPrivateKey: string,
  knownRecoveryKey: string | undefined
): Promise<string> {
  const sdk = loadSdk()
  const defaultKey = await getAccountData(
    session,
    'm.secret_storage.default_key'
  )

  let key: InstanceType<typeof sdk.SecretStorageKey> | undefined
  if (defaultKey?.key) {
    const keyId = String(defaultKey.key)
    const keyType = `m.secret_storage.key.${keyId}`
    const keyInfo = await getAccountData(session, keyType)
    if (!knownRecoveryKey || !keyInfo) {
      throw new AlreadyProvisionedError(
        `${session.userId} already has a secret storage key that was not created by this migration`
      )
    }
    key = sdk.SecretStorageKey.fromAccountData(
      knownRecoveryKey,
      keyType,
      JSON.stringify(keyInfo)
    )
  } else {
    key = sdk.SecretStorageKey.createRandomKey()
    saveRecoveryKey(session.userId, key.toBase58())
    await putAccountData(
      session,
      key.eventType(),
      JSON.parse(key.accountDataContent())
    )
  }

  const items = await session.machine.exportSecretsForSecretStorage(key)
  await putAccountData(
    session,
    'm.cross_signing.master',
    JSON.parse(items.masterKey)
  )
  await putAccountData(
    session,
    'm.cross_signing.self_signing',
    JSON.parse(items.selfSigningKey)
  )
  await putAccountData(
    session,
    'm.cross_signing.user_signing',
    JSON.parse(items.userSigningKey)
  )
  await putAccountData(
    session,
    'm.megolm_backup.v1',
    JSON.parse(key.encrypt(backupPrivateKey, 'm.megolm_backup.v1'))
  )
  await putAccountData(session, 'm.secret_storage.default_key', {
    key: key.keyId(),
  })

  return key.toBase58()
}

/**
 * Raised when a user already has their own encryption setup on the server
 * (e.g. they logged in before the migration). It is never overwritten.
 */
export class AlreadyProvisionedError extends Error {}

/**
 * Give a migrated user everything needed to read the migrated history on a
 * new device: cross-signing identity, key backup and secret storage
 * protected by a personal recovery key.
 * @param session The user's crypto session
 * @returns The user's backup and recovery key
 */
export async function provisionUser(
  session: CryptoSession
): Promise<UserRecovery> {
  return session.exclusive(async () => {
    const knownRecoveryKey = readRecoveryKeys().get(session.userId)
    await setupCrossSigning(session)
    const backup = await setupKeyBackup(session)
    const recoveryKey = await setupSecretStorage(
      session,
      backup.privateKey,
      knownRecoveryKey
    )
    return {
      userId: session.userId,
      backupVersion: backup.version,
      backupPublicKey: backup.publicKey,
      recoveryKey,
    }
  })
}
