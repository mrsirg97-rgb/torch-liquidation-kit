import { Connection, Keypair } from '@solana/web3.js'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'
export type LogFormat = 'text' | 'json'
export type Logger = (level: LogLevel, msg: string, extra?: Record<string, unknown>) => void

export interface BotConfig {
  rpcUrl: string
  vaultCreator: string
  privateKey: string | null
  scanIntervalMs: number
  logLevel: LogLevel
  logFormat: LogFormat
  // max tokens to scan per cycle (0 = unlimited).
  scanLimit: number
  // minimum agent SOL balance before pausing liquidations (lamports).
  minAgentBalanceLamports: number
}

export interface BotStats {
  cycles: number
  liquidations: number
  failures: number
  rpcRetries: number
  startedAt: number
  lastError: string | null
}

export interface ScanContext {
  connection: Connection
  log: Logger
  vaultCreator: string
  agentKeypair: Keypair
  agentPk: string
  scanLimit: number
  minBalance: number
  stats: BotStats
  // returns true when SIGINT/SIGTERM has been received; the scan loop should
  // bail between tokens so graceful shutdown doesn't stall on a long cycle.
  isShutdownRequested: () => boolean
}
