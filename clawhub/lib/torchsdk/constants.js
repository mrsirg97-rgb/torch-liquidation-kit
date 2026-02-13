"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TOKEN_MULTIPLIER = exports.LAMPORTS_PER_SOL = exports.BLACKLISTED_MINTS = exports.TOKEN_DECIMALS = exports.TOTAL_SUPPLY = exports.VAULT_WALLET_LINK_SEED = exports.TORCH_VAULT_SEED = exports.COLLATERAL_VAULT_SEED = exports.LOAN_SEED = exports.STAR_RECORD_SEED = exports.USER_STATS_SEED = exports.PROTOCOL_TREASURY_SEED = exports.VOTE_SEED = exports.USER_POSITION_SEED = exports.TREASURY_SEED = exports.BONDING_CURVE_SEED = exports.GLOBAL_CONFIG_SEED = exports.TOKEN_2022_PROGRAM_ID = exports.MEMO_PROGRAM_ID = exports.RAYDIUM_AMM_CONFIG = exports.WSOL_MINT = exports.RAYDIUM_CPMM_PROGRAM = exports.PROGRAM_ID = void 0;
const web3_js_1 = require("@solana/web3.js");
// Program ID - Mainnet/Devnet (deployed program)
exports.PROGRAM_ID = new web3_js_1.PublicKey('8hbUkonssSEEtkqzwM7ZcZrD9evacM92TcWSooVF4BeT');
// Raydium CPMM Program
// Note: Same address on mainnet and devnet - Raydium deploys to same program ID
exports.RAYDIUM_CPMM_PROGRAM = new web3_js_1.PublicKey('CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C');
// WSOL Mint (same on all networks)
exports.WSOL_MINT = new web3_js_1.PublicKey('So11111111111111111111111111111111111111112');
// Raydium AMM Config (0.25% fee tier - standard)
// Note: This config PDA exists on both mainnet and devnet
exports.RAYDIUM_AMM_CONFIG = new web3_js_1.PublicKey('D4FPEruKEHrG5TenZ2mpDGEfu1iUvTiqBxvpU8HLBvC2');
// SPL Memo Program
exports.MEMO_PROGRAM_ID = new web3_js_1.PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
// Token-2022 Program (for Token Extensions)
exports.TOKEN_2022_PROGRAM_ID = new web3_js_1.PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
// PDA Seeds (must match the Rust program)
exports.GLOBAL_CONFIG_SEED = 'global_config';
exports.BONDING_CURVE_SEED = 'bonding_curve';
// [V13] BURN_VAULT_SEED removed - treasury's ATA now holds vote vault tokens
exports.TREASURY_SEED = 'treasury';
exports.USER_POSITION_SEED = 'user_position';
exports.VOTE_SEED = 'vote';
exports.PROTOCOL_TREASURY_SEED = 'protocol_treasury_v11'; // V11: Protocol fee treasury
exports.USER_STATS_SEED = 'user_stats';
exports.STAR_RECORD_SEED = 'star_record';
exports.LOAN_SEED = 'loan';
exports.COLLATERAL_VAULT_SEED = 'collateral_vault';
exports.TORCH_VAULT_SEED = 'torch_vault'; // V2.0: Vault PDA
exports.VAULT_WALLET_LINK_SEED = 'vault_wallet'; // V2.0: Wallet link PDA
// Token constants (must match the Rust program)
exports.TOTAL_SUPPLY = BigInt('1000000000000000'); // 1B with 6 decimals
exports.TOKEN_DECIMALS = 6;
// Blacklisted tokens (legacy test tokens, etc.)
exports.BLACKLISTED_MINTS = [
    '6JkGdXSKzUHTNwR5w7jce4WxjczUGpqheBJsP1if5htm', // Legacy SPL test token (pre-prod-beta)
    'Nu5xbqZvZd4JerG2aNyxQfUiHBnM59w7CHzyVx5Vztm', // Legacy SPL devnet test token
    '8wzap6FUtL4ko6LnnELt8ZoM6ksy6jPJ9veFkwGB56tm', // Legacy SPL devnet test token
    'HgFGagsCFmBKRFM3U4zCpy3r8XU7RFS58UChup9xCytm', // Legacy SPL devnet test token
    'CLJk4YLy8pBu7mRFm1hfaeFJJ6WQQR7RHmkptPSLCXtm', // Pre-V13 devnet test token
    '61ryb1WAq2vqEcdeStvTMRvYdcgzvZYFjBtKzSzXv7tm', // Pre-V13 devnet test token
    '9F8SXt7VP8b6Vb6RzE8dTdBEwKuKeCizhxEY6QQX1qtm', // Pre-V13 mainnet test token
    'GQKidAtE2RmEpMq7ciPShniHZ9fh8NSAaXp59M89X3tm', // Pre-V13 mainnet test token
    '7b7WHQdXQN4bR8eC47jaH9De6JYC4cze1BWJJcxU1Mtm', // Pre-V13 mainnet test token
    'FjERW8DSNB81GYWhrXwdfS3s74xTF8T5gjcKYSa1v7tm', // Duplicate test token (keep Second Torch only)
];
// Formatting helpers
exports.LAMPORTS_PER_SOL = 1000000000;
exports.TOKEN_MULTIPLIER = Math.pow(10, exports.TOKEN_DECIMALS);
//# sourceMappingURL=constants.js.map