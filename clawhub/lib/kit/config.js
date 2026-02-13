"use strict";
/**
 * config.ts — loads environment variables into a typed BotConfig.
 *
 * the agent keypair is generated in-process. the user never provides a wallet.
 * VAULT_CREATOR identifies which vault the bot operates through.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadConfig = void 0;
const LOG_LEVELS = ['debug', 'info', 'warn', 'error'];
const loadConfig = () => {
    const rpcUrl = process.env.RPC_URL;
    if (!rpcUrl)
        throw new Error('RPC_URL env var is required');
    const vaultCreator = process.env.VAULT_CREATOR;
    if (!vaultCreator)
        throw new Error('VAULT_CREATOR env var is required (vault creator pubkey)');
    const scanIntervalMs = parseInt(process.env.SCAN_INTERVAL_MS ?? '30000', 10);
    if (isNaN(scanIntervalMs) || scanIntervalMs < 5000) {
        throw new Error('SCAN_INTERVAL_MS must be a number >= 5000');
    }
    const logLevel = (process.env.LOG_LEVEL ?? 'info');
    if (!LOG_LEVELS.includes(logLevel)) {
        throw new Error(`LOG_LEVEL must be one of: ${LOG_LEVELS.join(', ')}`);
    }
    return { rpcUrl, vaultCreator, scanIntervalMs, logLevel };
};
exports.loadConfig = loadConfig;
//# sourceMappingURL=config.js.map