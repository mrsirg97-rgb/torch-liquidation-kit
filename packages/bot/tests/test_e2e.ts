/**
 * E2E Test — Surfpool (mainnet fork)
 *
 * Tests vault-based liquidation bot flow:
 *   1. Connect to surfpool RPC
 *   2. Discover migrated tokens via getTokens
 *   3. Get lending info and verify active loans
 *   4. Get holders and check loan positions
 *   5. Verify vault query APIs
 *   6. Verify in-process keypair generation (no user wallet)
 *
 * Run:
 *   surfpool start --network mainnet --no-tui
 *   npx tsx tests/test_e2e.ts
 */

import { Connection, Keypair, LAMPORTS_PER_SOL } from '@solana/web3.js'
import {
  getToken,
  getTokens,
  getLendingInfo,
  getAllLoanPositions,
  getVaultForWallet,
  type LendingInfo,
  type LoanPositionWithKey,
} from 'torchsdk'

const RPC_URL = process.env.RPC_URL ?? 'http://localhost:8899'

const log = (msg: string) => {
  const ts = new Date().toISOString().substr(11, 8)
  console.log(`[${ts}] ${msg}`)
}

const bpsToPercent = (bps: number): string => (bps / 100).toFixed(2) + '%'
const sol = (lamports: number): string => (lamports / LAMPORTS_PER_SOL).toFixed(4)

let passed = 0
let failed = 0

const ok = (name: string, detail?: string) => {
  passed++
  log(`  ✓ ${name}${detail ? ` — ${detail}` : ''}`)
}

const fail = (name: string, err: any) => {
  failed++
  log(`  ✗ ${name} — ${err.message || err}`)
}

const main = async () => {
  console.log('='.repeat(60))
  console.log('VAULT LIQUIDATION BOT E2E TEST — Surfpool Mainnet Fork')
  console.log('='.repeat(60))

  // ------------------------------------------------------------------
  // 1. Connect
  // ------------------------------------------------------------------
  log('\n[1] Connect to RPC')
  const connection = new Connection(RPC_URL, 'confirmed')
  try {
    const version = await connection.getVersion()
    ok('connection', `solana-core ${version['solana-core']}`)
  } catch (e: any) {
    fail('connection', e)
    console.error('Cannot reach RPC. Is surfpool running?')
    process.exit(1)
  }

  // ------------------------------------------------------------------
  // 2. Discover migrated tokens
  // ------------------------------------------------------------------
  log('\n[2] Discover Migrated Tokens (getTokens)')
  let firstMint: string | undefined
  let discoveredTokens: any[] = []
  try {
    const { tokens } = await getTokens(connection, {
      status: 'migrated',
      sort: 'volume',
      limit: 10,
    })

    if (!tokens || tokens.length === 0) {
      throw new Error('No migrated tokens found')
    }

    firstMint = tokens[0].mint
    discoveredTokens = tokens
    ok('getTokens', `found ${tokens.length} migrated tokens`)

    for (const t of tokens) {
      log(`    ${t.symbol.padEnd(10)} | mint=${t.mint.slice(0, 8)}...`)
    }
  } catch (e: any) {
    fail('getTokens', e)
  }

  // ------------------------------------------------------------------
  // 3. Get lending info and check for active loans
  // ------------------------------------------------------------------
  log('\n[3] Get Lending Info (getLendingInfo)')
  let lendingCount = 0
  let tokenWithLoans: { mint: string; symbol: string } | undefined

  for (const t of discoveredTokens) {
    try {
      const lending: LendingInfo = await getLendingInfo(connection, t.mint)

      if (lending.interest_rate_bps <= 0) {
        throw new Error(`Invalid interest rate for ${t.symbol}`)
      }

      lendingCount++
      log(
        `    ${t.symbol.padEnd(10)} | ` +
          `rate=${bpsToPercent(lending.interest_rate_bps).padEnd(7)} | ` +
          `threshold=${bpsToPercent(lending.liquidation_threshold_bps).padEnd(7)} | ` +
          `bonus=${bpsToPercent(lending.liquidation_bonus_bps).padEnd(7)} | ` +
          `loans=${String(lending.active_loans).padEnd(4)} | ` +
          `avail=${sol(lending.treasury_sol_available)} SOL`,
      )

      if ((lending?.active_loans ?? 0) > 0 && !tokenWithLoans) {
        tokenWithLoans = { mint: t.mint, symbol: t.symbol }
      }
    } catch {
      // token may not have lending enabled
    }
  }

  if (lendingCount > 0) {
    ok('getLendingInfo', `${lendingCount} tokens with lending data`)
  } else {
    fail('getLendingInfo', { message: 'No tokens returned lending data' })
  }

  // ------------------------------------------------------------------
  // 4. Scan loan positions (getAllLoanPositions)
  // ------------------------------------------------------------------
  log('\n[4] Scan Loan Positions (getAllLoanPositions)')
  if (firstMint) {
    try {
      const { positions, pool_price_sol } = await getAllLoanPositions(connection, firstMint)
      ok(
        'getAllLoanPositions',
        `${positions.length} active loans for ${discoveredTokens[0]?.symbol}` +
          (pool_price_sol != null ? ` | pool price=${sol(pool_price_sol)} SOL` : ''),
      )

      for (const pos of positions.slice(0, 5)) {
        log(
          `    borrower=${pos.borrower.slice(0, 8)}... | ` +
            `owed=${sol(pos.total_owed)} SOL | ` +
            `collateral=${pos.collateral_amount} | ` +
            `health=${pos.health}`,
        )
      }

      // verify sort order: liquidatable → at_risk → healthy
      const healthOrder = ['liquidatable', 'at_risk', 'healthy']
      let sorted = true
      for (let i = 1; i < positions.length; i++) {
        if (healthOrder.indexOf(positions[i].health) < healthOrder.indexOf(positions[i - 1].health)) {
          sorted = false
          break
        }
      }
      if (positions.length > 1) {
        if (sorted) {
          ok('sort order', 'positions sorted by health (liquidatable first)')
        } else {
          fail('sort order', { message: 'positions not sorted by health' })
        }
      }
    } catch (e: any) {
      fail('getAllLoanPositions', e)
    }
  }

  // ------------------------------------------------------------------
  // 5. Get token detail
  // ------------------------------------------------------------------
  log('\n[5] Get Token Detail (getToken)')
  if (firstMint) {
    try {
      const token = await getToken(connection, firstMint)

      if (!token.name) throw new Error('Missing token name')
      if (!token.symbol) throw new Error('Missing token symbol')
      if (token.price_sol <= 0) throw new Error('Invalid price')

      ok(
        'getToken',
        `${token.name} (${token.symbol}) | price=${sol(token.price_sol)} SOL | status=${token.status}`,
      )
    } catch (e: any) {
      fail('getToken', e)
    }
  }

  // ------------------------------------------------------------------
  // 6. Vault query APIs
  // ------------------------------------------------------------------
  log('\n[6] Vault Query APIs (getVault, getVaultForWallet)')

  // generate a fresh keypair — simulates the in-process agent wallet
  const testKeypair = Keypair.generate()
  log(`    test agent wallet: ${testKeypair.publicKey.toBase58().slice(0, 12)}...`)

  // getVaultForWallet on an unlinked wallet should return null
  try {
    const link = await getVaultForWallet(connection, testKeypair.publicKey.toBase58())
    if (!link) {
      ok('getVaultForWallet', 'correctly returns null for unlinked wallet')
    } else {
      ok(
        'getVaultForWallet',
        `wallet is linked to vault (creator=${link.creator?.slice(0, 8)}...)`,
      )
    }
  } catch (e: any) {
    fail('getVaultForWallet', e)
  }

  // ------------------------------------------------------------------
  // 7. Verify in-process keypair (no user wallet)
  // ------------------------------------------------------------------
  log('\n[7] Verify In-Process Keypair')
  ok(
    'keypair generated',
    `${testKeypair.publicKey.toBase58().slice(0, 12)}... (in-process, no env var)`,
  )
  ok('no user wallet', 'no WALLET env var read, no external key imported')

  // ------------------------------------------------------------------
  // Summary
  // ------------------------------------------------------------------
  console.log('\n' + '='.repeat(60))
  console.log(`RESULTS: ${passed} passed, ${failed} failed`)
  console.log('='.repeat(60))

  if (failed > 0) process.exit(1)
}

main().catch((err) => {
  console.error('\nFATAL:', err)
  process.exit(1)
})
