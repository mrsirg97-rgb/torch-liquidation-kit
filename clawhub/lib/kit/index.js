#!/usr/bin/env node
"use strict";
/**
 * torch-liquidation-bot — vault-based liquidation bot.
 *
 * generates an agent keypair in-process (or uses SOLANA_PRIVATE_KEY if provided).
 * all operations route through a torch vault identified by VAULT_CREATOR.
 *
 * usage:
 *   VAULT_CREATOR=<pubkey> SOLANA_RPC_URL=<rpc> npx tsx src/index.ts
 *
 * env:
 *   SOLANA_RPC_URL    — solana RPC endpoint (required, fallback: RPC_URL)
 *   VAULT_CREATOR     — vault creator pubkey (required)
 *   SOLANA_PRIVATE_KEY — disposable controller keypair, base58 (optional)
 *   SCAN_INTERVAL_MS  — ms between scan cycles (default 30000, min 5000)
 *   LOG_LEVEL         — debug | info | warn | error (default info)
 */
Object.defineProperty(exports, "__esModule", { value: true });
const web3_js_1 = require("@solana/web3.js");
const torchsdk_1 = require("torchsdk");
const config_1 = require("./config");
const utils_1 = require("./utils");
// ---------------------------------------------------------------------------
// scan & liquidate
// ---------------------------------------------------------------------------
const scanAndLiquidate = async (connection, log, vaultCreator, agentKeypair) => {
    const { tokens } = await (0, torchsdk_1.getTokens)(connection, {
        status: 'migrated',
        sort: 'volume',
        limit: 50,
    });
    log('debug', `discovered ${tokens.length} migrated tokens`);
    for (const token of tokens) {
        let lending;
        try {
            lending = await (0, torchsdk_1.getLendingInfo)(connection, token.mint);
        }
        catch {
            continue; // lending not enabled for this token
        }
        if (!lending.active_loans || lending.active_loans === 0)
            continue;
        log('debug', `${token.symbol} — ${lending.active_loans} active loans, ` +
            `threshold: ${(0, utils_1.bpsToPercent)(lending.liquidation_threshold_bps)}, ` +
            `bonus: ${(0, utils_1.bpsToPercent)(lending.liquidation_bonus_bps)}`);
        // get holders as potential borrowers
        let holders;
        try {
            const result = await (0, torchsdk_1.getHolders)(connection, token.mint);
            holders = result.holders;
        }
        catch {
            log('debug', `${token.symbol} — could not fetch holders, skipping`);
            continue;
        }
        for (const holder of holders) {
            let position;
            try {
                position = await (0, torchsdk_1.getLoanPosition)(connection, token.mint, holder.address);
            }
            catch {
                continue; // no loan position for this holder
            }
            // SDK provides health status directly — skip non-liquidatable positions
            if (position.health !== 'liquidatable')
                continue;
            log('info', `LIQUIDATABLE | ${token.symbol} | borrower=${holder.address.slice(0, 8)}... | ` +
                `LTV=${position.current_ltv_bps != null ? (0, utils_1.bpsToPercent)(position.current_ltv_bps) : '?'} > ` +
                `threshold=${(0, utils_1.bpsToPercent)(lending.liquidation_threshold_bps)} | ` +
                `owed=${(0, utils_1.sol)(position.total_owed)} SOL`);
            // build and execute liquidation through the vault
            try {
                const { transaction, message } = await (0, torchsdk_1.buildLiquidateTransaction)(connection, {
                    mint: token.mint,
                    liquidator: agentKeypair.publicKey.toBase58(),
                    borrower: holder.address,
                    vault: vaultCreator,
                });
                transaction.sign(agentKeypair);
                const signature = await connection.sendRawTransaction(transaction.serialize());
                await (0, torchsdk_1.confirmTransaction)(connection, signature, agentKeypair.publicKey.toBase58());
                log('info', `LIQUIDATED | ${token.symbol} | borrower=${holder.address.slice(0, 8)}... | ` +
                    `sig=${signature.slice(0, 16)}... | ${message}`);
            }
            catch (err) {
                log('warn', `LIQUIDATION FAILED | ${token.symbol} | ${holder.address.slice(0, 8)}... | ${err.message}`);
            }
        }
    }
};
// ---------------------------------------------------------------------------
// main — vault-routed liquidation loop
// ---------------------------------------------------------------------------
const main = async () => {
    const config = (0, config_1.loadConfig)();
    const log = (0, utils_1.createLogger)(config.logLevel);
    const connection = new web3_js_1.Connection(config.rpcUrl, 'confirmed');
    // load or generate agent keypair
    let agentKeypair;
    if (config.privateKey) {
        try {
            const parsed = JSON.parse(config.privateKey);
            if (Array.isArray(parsed)) {
                agentKeypair = web3_js_1.Keypair.fromSecretKey(Uint8Array.from(parsed));
            }
            else {
                throw new Error('SOLANA_PRIVATE_KEY JSON must be a byte array');
            }
        }
        catch (e) {
            if (e.message?.includes('byte array'))
                throw e;
            // not JSON — try base58
            agentKeypair = web3_js_1.Keypair.fromSecretKey((0, utils_1.decodeBase58)(config.privateKey));
        }
        log('info', 'loaded keypair from SOLANA_PRIVATE_KEY');
    }
    else {
        agentKeypair = web3_js_1.Keypair.generate();
        log('info', 'generated fresh agent keypair');
    }
    console.log('=== torch liquidation bot ===');
    console.log(`agent wallet: ${agentKeypair.publicKey.toBase58()}`);
    console.log(`vault creator: ${config.vaultCreator}`);
    console.log(`scan interval: ${config.scanIntervalMs}ms`);
    console.log();
    // verify vault exists
    const vault = await (0, torchsdk_1.getVault)(connection, config.vaultCreator);
    if (!vault) {
        throw new Error(`vault not found for creator ${config.vaultCreator}`);
    }
    log('info', `vault found — authority=${vault.authority}`);
    // verify agent wallet is linked to vault
    const link = await (0, torchsdk_1.getVaultForWallet)(connection, agentKeypair.publicKey.toBase58());
    if (!link) {
        console.log();
        console.log('--- ACTION REQUIRED ---');
        console.log('agent wallet is NOT linked to the vault.');
        console.log('link it by running (from your authority wallet):');
        console.log();
        console.log(`  buildLinkWalletTransaction(connection, {`);
        console.log(`    authority: "<your-authority-pubkey>",`);
        console.log(`    vault_creator: "${config.vaultCreator}",`);
        console.log(`    wallet_to_link: "${agentKeypair.publicKey.toBase58()}"`);
        console.log(`  })`);
        console.log();
        console.log('then restart the bot.');
        console.log('-----------------------');
        process.exit(1);
    }
    log('info', 'agent wallet linked to vault — starting scan loop');
    log('info', `treasury: ${(0, utils_1.sol)(vault.sol_balance ?? 0)} SOL`);
    // scan loop
    while (true) {
        try {
            log('debug', '--- scan cycle start ---');
            await scanAndLiquidate(connection, log, config.vaultCreator, agentKeypair);
            log('debug', '--- scan cycle end ---');
        }
        catch (err) {
            log('error', `scan cycle error: ${err.message}`);
        }
        await new Promise((resolve) => setTimeout(resolve, config.scanIntervalMs));
    }
};
main().catch((err) => {
    console.error('FATAL:', err.message ?? err);
    process.exit(1);
});
//# sourceMappingURL=index.js.map