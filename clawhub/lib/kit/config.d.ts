/**
 * config.ts — loads environment variables into a typed BotConfig.
 *
 * env vars:
 *   SOLANA_RPC_URL    — solana RPC endpoint (required, fallback: RPC_URL)
 *   VAULT_CREATOR     — vault creator pubkey (required)
 *   SOLANA_PRIVATE_KEY — disposable controller keypair, base58 (optional)
 *   SCAN_INTERVAL_MS  — ms between scan cycles (default 30000, min 5000)
 *   LOG_LEVEL         — debug | info | warn | error (default info)
 */
import type { BotConfig } from './types';
export declare const loadConfig: () => BotConfig;
//# sourceMappingURL=config.d.ts.map