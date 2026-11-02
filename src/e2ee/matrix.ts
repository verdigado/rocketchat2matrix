import { AxiosError, Method } from 'axios'
import { axios } from '../helpers/tuwunel'

/**
 * Send a Client-Server API request with a specific access token.
 * @param accessToken The access token to authenticate with
 * @param method The HTTP method
 * @param path The path, starting with /_matrix/
 * @param data The JSON body, if any
 * @param params The query string parameters, if any
 * @returns The JSON response body
 */
export async function matrixRequest<T = Record<string, unknown>>(
  accessToken: string,
  method: Method,
  path: string,
  data?: unknown,
  params?: Record<string, string | number>
): Promise<T> {
  const response = await axios.request<T>({
    method,
    url: path,
    data,
    params,
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  return response.data
}

/**
 * @param error Any error
 * @returns The Matrix errcode of a failed request, if any
 */
export function matrixErrorCode(error: unknown): string | undefined {
  if (error instanceof AxiosError) {
    return error.response?.data?.errcode
  }
  return undefined
}

/**
 * @param error Any error
 * @returns The HTTP status of a failed request, if any
 */
export function httpStatus(error: unknown): number | undefined {
  if (error instanceof AxiosError) {
    return error.response?.status
  }
  return undefined
}

/**
 * Encode a path segment (room ID, user ID, event type, transaction ID, ...)
 * @param segment The raw segment
 * @returns The URL encoded segment
 */
export function enc(segment: string): string {
  return encodeURIComponent(segment)
}

/**
 * Serialise a JSON object as Matrix canonical JSON (sorted keys, no
 * whitespace), as needed for signatures.
 * @param value Any JSON value
 * @returns The canonical JSON string
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`
  }
  const object = value as Record<string, unknown>
  return `{${Object.keys(object)
    .filter((key) => object[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
    .join(',')}}`
}
