/**
 * utils.ts — shared helpers.
 */

import { LAMPORTS_PER_SOL } from 'torchsdk'
import type { LogLevel } from './types'

export const sol = (lamports: number) => (lamports / LAMPORTS_PER_SOL).toFixed(4)

export const bpsToPercent = (bps: number) => (bps / 100).toFixed(2) + '%'

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
