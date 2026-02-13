/**
 * utils.ts — shared helpers.
 */

import { LAMPORTS_PER_SOL } from 'torchsdk'
import type { LogLevel } from './types'

export const sol = (lamports: number) => (lamports / LAMPORTS_PER_SOL).toFixed(4)

export const bpsToPercent = (bps: number) => (bps / 100).toFixed(2) + '%'

// base58 decoder — avoids ESM-only bs58 dependency
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'

export const decodeBase58 = (s: string): Uint8Array => {
  const result: number[] = []
  for (let i = 0; i < s.length; i++) {
    let carry = B58.indexOf(s[i])
    if (carry < 0) throw new Error(`invalid base58 character: ${s[i]}`)
    for (let j = 0; j < result.length; j++) {
      carry += result[j] * 58
      result[j] = carry & 0xff
      carry >>= 8
    }
    while (carry > 0) {
      result.push(carry & 0xff)
      carry >>= 8
    }
  }
  for (let i = 0; i < s.length && s[i] === '1'; i++) {
    result.push(0)
  }
  return new Uint8Array(result.reverse())
}

const LEVEL_ORDER: LogLevel[] = ['debug', 'info', 'warn', 'error']

export function createLogger(minLevel: LogLevel) {
  const minIdx = LEVEL_ORDER.indexOf(minLevel)

  return function log(level: LogLevel, msg: string) {
    if (LEVEL_ORDER.indexOf(level) < minIdx) return
    const ts = new Date().toISOString().substr(11, 12)
    const tag = level.toUpperCase().padEnd(5)
    console.log(`[${ts}] ${tag} ${msg}`)
  }
}
