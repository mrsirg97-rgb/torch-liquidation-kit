import { LogFormat, LogLevel } from './types'

export const DEFAULT_RETRY_ATTEMPTS = 3
export const LOG_LEVELS: LogLevel[] = ['debug', 'info', 'warn', 'error']
export const LOG_FORMATS: LogFormat[] = ['text', 'json']
export const RETRY_BASE_DELAY_MS = 1_000
export const RPC_TIMEOUT_MS = 30_000
