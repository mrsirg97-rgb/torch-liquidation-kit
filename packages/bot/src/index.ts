#!/usr/bin/env node
/**
 * torch-liquidation-bot — vault-based liquidation keeper.
 *
 * generates an agent keypair in-process (or loads SOLANA_PRIVATE_KEY).
 * all value flows through a Torch Vault identified by VAULT_CREATOR.
 * the agent key is a stateless signer holding only gas SOL.
 * usage:
 *   VAULT_CREATOR=<pubkey> SOLANA_RPC_URL=<rpc> npx torch-liquidation-bot
 * See config.ts for the full env var list.
 */
import { Connection, Keypair } from '@solana/web3.js'
import bs58 from 'bs58'
import {
  getTokens,
  getAllLoanPositions,
  getVault,
  getVaultForWallet,
  buildLiquidateTransaction,
  confirmTransaction,
  type LoanPositionWithKey,
} from 'torchsdk'

import { loadConfig } from './config'
import { sol, bpsToPercent, createLogger, withTimeout, withRetry } from './utils'
import type { BotStats, Logger, ScanContext } from './types'

const scanAndLiquidate = async ({
  connection,
  log,
  vaultCreator,
  agentKeypair,
  agentPk,
  scanLimit,
  minBalance,
  stats,
  isShutdownRequested,
}: ScanContext): Promise<void> => {
  // pre-flight balance check — skip cycle if agent can't pay gas
  const balance = await withRetry(
    () => withTimeout(connection.getBalance(agentKeypair.publicKey), 'getBalance'),
    'getBalance',
    3,
    () => stats.rpcRetries++,
  )
  if (balance < minBalance) {
    log('error', `agent balance too low — pausing cycle`, {
      balance_sol: sol(balance),
      min_sol: sol(minBalance),
    })
    return
  }

  const { tokens } = await withRetry(
    () =>
      withTimeout(
        getTokens(connection, {
          status: 'migrated',
          sort: 'volume',
          limit: scanLimit > 0 ? scanLimit : 10_000,
        }),
        'getTokens',
      ),
    'getTokens',
    3,
    () => stats.rpcRetries++,
  )

  log('debug', `discovered ${tokens.length} migrated tokens`)
  for (const token of tokens) {
    // bail between tokens so SIGTERM doesn't stall on a long scan of many tokens
    if (isShutdownRequested()) return

    let positions: LoanPositionWithKey[]
    try {
      const result = await withRetry(
        () => withTimeout(getAllLoanPositions(connection, token.mint), 'getAllLoanPositions'),
        'getAllLoanPositions',
        3,
        () => stats.rpcRetries++,
      )
      positions = result.positions
    } catch {
      continue // lending not enabled for this token, or persistent RPC failure
    }

    if (positions.length === 0) {
      continue
    }

    log('debug', `${token.symbol} — ${positions.length} active loans`)
    // positions are pre-sorted: liquidatable -> at_risk -> healthy
    for (const position of positions) {
      if (position.health !== 'liquidatable') {
        break
      }

      log('info', `LIQUIDATABLE`, {
        token: token.symbol,
        borrower: position.borrower.slice(0, 8) + '...',
        ltv: position.current_ltv_bps != null ? bpsToPercent(position.current_ltv_bps) : 'unknown',
        owed_sol: sol(position.total_owed),
      })

      try {
        const { transaction, message } = await withTimeout(
          buildLiquidateTransaction(connection, {
            mint: token.mint,
            liquidator: agentPk,
            borrower: position.borrower,
            vault: vaultCreator,
          }),
          'buildLiquidateTransaction',
        )

        transaction.sign([agentKeypair])
        const signature = await connection.sendRawTransaction(transaction.serialize())
        await withTimeout(confirmTransaction(connection, signature, agentPk), 'confirmTransaction')
        stats.liquidations++
        log('info', `LIQUIDATED`, {
          token: token.symbol,
          borrower: position.borrower.slice(0, 8) + '...',
          sig: signature.slice(0, 16) + '...',
          message,
        })
      } catch (err) {
        stats.failures++
        const msg = err instanceof Error ? err.message : String(err)
        stats.lastError = msg
        log('warn', `LIQUIDATION FAILED`, {
          token: token.symbol,
          borrower: position.borrower.slice(0, 8) + '...',
          error: msg,
        })
      }
    }
  }
}

const loadAgentKeypair = (privateKey: string | null, log: Logger): Keypair => {
  if (!privateKey) {
    const kp = Keypair.generate()
    log('info', 'generated fresh agent keypair')
    return kp
  }

  try {
    const parsed = JSON.parse(privateKey)
    if (Array.isArray(parsed)) {
      const kp = Keypair.fromSecretKey(Uint8Array.from(parsed))
      log('info', 'loaded keypair from SOLANA_PRIVATE_KEY (JSON byte array)')
      return kp
    }
    throw new Error('SOLANA_PRIVATE_KEY JSON must be a byte array')
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (msg.includes('byte array')) throw e
  }

  const kp = Keypair.fromSecretKey(bs58.decode(privateKey))
  log('info', 'loaded keypair from SOLANA_PRIVATE_KEY (base58)')
  return kp
}

// main — vault-routed liquidation loop with graceful shutdown
const main = async () => {
  const config = loadConfig()
  const log = createLogger(config.logLevel, config.logFormat)
  const connection = new Connection(config.rpcUrl, 'confirmed')
  const agentKeypair = loadAgentKeypair(config.privateKey, log)
  const agentPk = agentKeypair.publicKey.toBase58()
  const stats: BotStats = {
    cycles: 0,
    liquidations: 0,
    failures: 0,
    rpcRetries: 0,
    startedAt: Date.now(),
    lastError: null,
  }

  console.log('=== torch liquidation bot ===')
  console.log(`agent wallet: ${agentPk}`)
  console.log(`vault creator: ${config.vaultCreator}`)
  console.log(`scan interval: ${config.scanIntervalMs}ms`)
  console.log(`scan limit: ${config.scanLimit === 0 ? 'unlimited' : config.scanLimit}`)
  console.log(`min agent balance: ${sol(config.minAgentBalanceLamports)} SOL\n`)
  // verify vault exists
  const vault = await withRetry(
    () => withTimeout(getVault(connection, config.vaultCreator), 'getVault'),
    'getVault',
    3,
    () => stats.rpcRetries++,
  )
  if (!vault) {
    throw new Error(`vault not found for creator ${config.vaultCreator}`)
  }

  log('info', `vault found — authority=${vault.authority}`)
  // verify agent wallet is linked to vault
  const link = await withRetry(
    () => withTimeout(getVaultForWallet(connection, agentPk), 'getVaultForWallet'),
    'getVaultForWallet',
    3,
    () => stats.rpcRetries++,
  )
  if (!link) {
    console.log()
    console.log('--- ACTION REQUIRED ---')
    console.log('agent wallet is NOT linked to the vault.')
    console.log('link it by running (from your authority wallet):')
    console.log()
    console.log(`  buildLinkWalletTransaction(connection, {`)
    console.log(`    authority: "<your-authority-pubkey>",`)
    console.log(`    vault_creator: "${config.vaultCreator}",`)
    console.log(`    wallet_to_link: "${agentPk}"`)
    console.log(`  })`)
    console.log()
    console.log('then restart the bot.')
    console.log('-----------------------')
    process.exit(1)
  }

  log('info', `agent wallet linked to vault — starting scan loop`)
  log('info', `treasury: ${sol(vault.sol_balance ?? 0)} SOL`)
  // graceful shutdown on SIGINT / SIGTERM
  let shutdown = false
  const requestShutdown = (signal: string) => {
    if (shutdown) return
    shutdown = true
    log('info', `received ${signal} — shutting down after current cycle`)
  }

  process.on('SIGINT', () => requestShutdown('SIGINT'))
  process.on('SIGTERM', () => requestShutdown('SIGTERM'))
  const ctx: ScanContext = {
    connection,
    log,
    vaultCreator: config.vaultCreator,
    agentKeypair,
    agentPk,
    scanLimit: config.scanLimit,
    minBalance: config.minAgentBalanceLamports,
    stats,
    isShutdownRequested: () => shutdown,
  }

  // scan loop
  while (!shutdown) {
    try {
      log('debug', '--- scan cycle start ---')
      await scanAndLiquidate(ctx)
      stats.cycles++
      log('info', `stats`, {
        cycles: stats.cycles,
        liquidations: stats.liquidations,
        failures: stats.failures,
        rpc_retries: stats.rpcRetries,
        uptime_sec: Math.floor((Date.now() - stats.startedAt) / 1000),
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      stats.lastError = msg
      log('error', `scan cycle error: ${msg}`)
    }

    if (shutdown) {
      break
    }

    // interruptible sleep so shutdown fires quickly
    const sleepUntil = Date.now() + config.scanIntervalMs
    while (!shutdown && Date.now() < sleepUntil) {
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
  }

  log('info', 'graceful shutdown complete', {
    final_cycles: stats.cycles,
    final_liquidations: stats.liquidations,
    final_failures: stats.failures,
  })
  process.exit(0)
}

main().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err)
  console.error('FATAL:', msg)
  process.exit(1)
})
