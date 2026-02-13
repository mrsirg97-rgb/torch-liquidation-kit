#!/usr/bin/env node
/**
 * torch-liquidation-bot — vault-based liquidation bot.
 *
 * generates an agent keypair in-process. all operations route through
 * a torch vault identified by VAULT_CREATOR. the user never provides a wallet.
 *
 * usage:
 *   VAULT_CREATOR=<pubkey> RPC_URL=<rpc> npx tsx src/index.ts
 *
 * env:
 *   RPC_URL           — solana RPC endpoint (required)
 *   VAULT_CREATOR     — vault creator pubkey (required)
 *   SCAN_INTERVAL_MS  — ms between scan cycles (default 30000, min 5000)
 *   LOG_LEVEL         — debug | info | warn | error (default info)
 */

import { Connection, Keypair } from '@solana/web3.js'
import {
  getTokens,
  getLendingInfo,
  getHolders,
  getLoanPosition,
  getVault,
  getVaultForWallet,
  buildLiquidateTransaction,
  confirmTransaction,
  type LendingInfo,
  type LoanPositionInfo,
} from 'torchsdk'
import { loadConfig } from './config'
import { sol, bpsToPercent, createLogger } from './utils'

// ---------------------------------------------------------------------------
// bootstrap — generate agent keypair in-process
// ---------------------------------------------------------------------------

const agentKeypair = Keypair.generate()

// ---------------------------------------------------------------------------
// scan & liquidate
// ---------------------------------------------------------------------------

const scanAndLiquidate = async (
  connection: Connection,
  log: ReturnType<typeof createLogger>,
  vaultCreator: string,
) => {
  const { tokens } = await getTokens(connection, {
    status: 'migrated',
    sort: 'volume',
    limit: 50,
  })

  log('debug', `discovered ${tokens.length} migrated tokens`)

  for (const token of tokens) {
    let lending: LendingInfo
    try {
      lending = await getLendingInfo(connection, token.mint)
    } catch {
      continue // lending not enabled for this token
    }

    if (!lending.active_loans || lending.active_loans === 0) continue

    log(
      'debug',
      `${token.symbol} — ${lending.active_loans} active loans, ` +
        `threshold: ${bpsToPercent(lending.liquidation_threshold_bps)}, ` +
        `bonus: ${bpsToPercent(lending.liquidation_bonus_bps)}`,
    )

    // get holders as potential borrowers
    let holders: { address: string }[]
    try {
      const result = await getHolders(connection, token.mint)
      holders = result.holders
    } catch {
      log('debug', `${token.symbol} — could not fetch holders, skipping`)
      continue
    }

    for (const holder of holders) {
      let position: LoanPositionInfo
      try {
        position = await getLoanPosition(connection, token.mint, holder.address)
      } catch {
        continue // no loan position for this holder
      }

      // SDK provides health status directly — skip non-liquidatable positions
      if (position.health !== 'liquidatable') continue

      log(
        'info',
        `LIQUIDATABLE | ${token.symbol} | borrower=${holder.address.slice(0, 8)}... | ` +
          `LTV=${position.current_ltv_bps != null ? bpsToPercent(position.current_ltv_bps) : '?'} > ` +
          `threshold=${bpsToPercent(lending.liquidation_threshold_bps)} | ` +
          `owed=${sol(position.total_owed)} SOL`,
      )

      // build and execute liquidation through the vault
      try {
        const { transaction, message } = await buildLiquidateTransaction(connection, {
          mint: token.mint,
          liquidator: agentKeypair.publicKey.toBase58(),
          borrower: holder.address,
          vault: vaultCreator,
        })

        transaction.sign(agentKeypair)
        const signature = await connection.sendRawTransaction(transaction.serialize())
        await confirmTransaction(connection, signature, agentKeypair.publicKey.toBase58())

        log(
          'info',
          `LIQUIDATED | ${token.symbol} | borrower=${holder.address.slice(0, 8)}... | ` +
            `sig=${signature.slice(0, 16)}... | ${message}`,
        )
      } catch (err: any) {
        log(
          'warn',
          `LIQUIDATION FAILED | ${token.symbol} | ${holder.address.slice(0, 8)}... | ${err.message}`,
        )
      }
    }
  }
}

// ---------------------------------------------------------------------------
// main — vault-routed liquidation loop
// ---------------------------------------------------------------------------

const main = async () => {
  const config = loadConfig()
  const log = createLogger(config.logLevel)
  const connection = new Connection(config.rpcUrl, 'confirmed')

  console.log('=== torch liquidation bot ===')
  console.log(`agent wallet: ${agentKeypair.publicKey.toBase58()}`)
  console.log(`vault creator: ${config.vaultCreator}`)
  console.log(`scan interval: ${config.scanIntervalMs}ms`)
  console.log()

  // verify vault exists
  const vault = await getVault(connection, config.vaultCreator)
  if (!vault) {
    throw new Error(`vault not found for creator ${config.vaultCreator}`)
  }
  log('info', `vault found — authority=${vault.authority}`)

  // verify agent wallet is linked to vault
  const link = await getVaultForWallet(connection, agentKeypair.publicKey.toBase58())
  if (!link) {
    console.log()
    console.log('--- ACTION REQUIRED ---')
    console.log('agent wallet is NOT linked to the vault.')
    console.log('link it by running (from your authority wallet):')
    console.log()
    console.log(`  buildLinkWalletTransaction(connection, {`)
    console.log(`    authority: "<your-authority-pubkey>",`)
    console.log(`    vault_creator: "${config.vaultCreator}",`)
    console.log(`    wallet_to_link: "${agentKeypair.publicKey.toBase58()}"`)
    console.log(`  })`)
    console.log()
    console.log('then restart the bot.')
    console.log('-----------------------')
    process.exit(1)
  }

  log('info', 'agent wallet linked to vault — starting scan loop')
  log('info', `treasury: ${sol(vault.sol_balance ?? 0)} SOL`)

  // scan loop
  while (true) {
    try {
      log('debug', '--- scan cycle start ---')
      await scanAndLiquidate(connection, log, config.vaultCreator)
      log('debug', '--- scan cycle end ---')
    } catch (err: any) {
      log('error', `scan cycle error: ${err.message}`)
    }

    await new Promise((resolve) => setTimeout(resolve, config.scanIntervalMs))
  }
}

main().catch((err) => {
  console.error('FATAL:', err.message ?? err)
  process.exit(1)
})
