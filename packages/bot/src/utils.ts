import { LAMPORTS_PER_SOL } from 'torchsdk'

import type { LogFormat, LogLevel, Logger } from './types'
import {
  DEFAULT_RETRY_ATTEMPTS,
  LOG_LEVELS,
  RETRY_BASE_DELAY_MS,
  RPC_TIMEOUT_MS,
} from './constants'

export const sol = (lamports: number) => (lamports / LAMPORTS_PER_SOL).toFixed(4)
export const bpsToPercent = (bps: number) => (bps / 100).toFixed(2) + '%'

export const withTimeout = async <T>(promise: Promise<T>, label: string): Promise<T> => {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`${label} timed out after ${RPC_TIMEOUT_MS}ms`)),
        RPC_TIMEOUT_MS,
      ),
    ),
  ])
}

// retry an async operation with exponential backoff.
// retries transient failures up to `attempts` times with 1s, 2s, 4s delays.
// re-throws the last error if all attempts fail. Set `onRetry` to track retry counts in metrics.
export const withRetry = async <T>(
  fn: () => Promise<T>,
  label: string,
  attempts = DEFAULT_RETRY_ATTEMPTS,
  onRetry?: () => void,
): Promise<T> => {
  let lastErr: Error = new Error(`${label} failed with no attempts`)
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err as Error
      if (i < attempts - 1) {
        onRetry?.()
        await new Promise((r) => setTimeout(r, RETRY_BASE_DELAY_MS * Math.pow(2, i)))
      }
    }
  }
  throw lastErr
}

export const createLogger = (minLevel: LogLevel, format: LogFormat = 'text'): Logger => {
  const minIdx = LOG_LEVELS.indexOf(minLevel)
  return (level, msg, extra) => {
    if (LOG_LEVELS.indexOf(level) < minIdx) return
    const ts = new Date().toISOString()
    if (format === 'json') {
      console.log(JSON.stringify({ ts, level, msg, ...(extra ?? {}) }))
      return
    }

    const tsShort = ts.substr(11, 12)
    const tag = level.toUpperCase().padEnd(5)
    const extraStr = extra ? ' ' + JSON.stringify(extra) : ''
    console.log(`[${tsShort}] ${tag} ${msg}${extraStr}`)
  }
}
