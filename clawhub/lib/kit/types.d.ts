/**
 * types.ts — interfaces for the vault-based liquidation bot.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export interface BotConfig {
    rpcUrl: string;
    vaultCreator: string;
    privateKey: string | null;
    scanIntervalMs: number;
    logLevel: LogLevel;
}
//# sourceMappingURL=types.d.ts.map