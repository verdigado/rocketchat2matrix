import type * as CryptoSdk from '@matrix-org/matrix-sdk-crypto-nodejs'

export type Sdk = typeof CryptoSdk
export type { CryptoSdk }

let sdk: Sdk | undefined

/**
 * Load the Matrix crypto engine (matrix-sdk-crypto-nodejs) on first use.
 *
 * It is only loaded in E2EE mode, so the plain migration keeps working on
 * Node.js versions the native module does not support.
 * @returns The loaded module
 */
export function loadSdk(): Sdk {
  if (!sdk) {
    const [major] = process.versions.node.split('.').map(Number)
    if (major < 24) {
      throw new Error(
        `E2EE mode needs Node.js >= 24 (current: ${process.versions.node})`
      )
    }
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    sdk = require('@matrix-org/matrix-sdk-crypto-nodejs') as Sdk
  }
  return sdk
}

/**
 * Numeric values of the RequestType const enum of the crypto engine
 */
export const RequestTypes = {
  KeysUpload: 0,
  KeysQuery: 1,
  KeysClaim: 2,
  ToDevice: 3,
  SignatureUpload: 4,
  RoomMessage: 5,
  KeysBackup: 6,
} as const
