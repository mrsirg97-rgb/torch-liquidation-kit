/**
 * types.ts — interfaces for the vault-based liquidation bot.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface BotConfig {
  rpcUrl: string
  vaultCreator: string
  scanIntervalMs: number
  logLevel: LogLevel
}
