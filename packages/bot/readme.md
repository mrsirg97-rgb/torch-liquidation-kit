# torch-liquidation-bot

Vault-based liquidation keeper for [Torch Market](https://torch.market) on Solana. Generates an agent keypair in-process — no user wallet required. All operations route through a Torch Vault. Built on [torchsdk](https://www.npmjs.com/package/torchsdk) v10.7.1.

## Install

```bash
npm install torch-liquidation-bot
```

## Quick Start

```bash
# 1. start the bot — it prints its agent wallet on startup
VAULT_CREATOR=<your-vault-creator-pubkey> SOLANA_RPC_URL=<rpc> npx torch-liquidation-bot

# 2. link the printed agent wallet to your vault (one-time, from your authority wallet)
#    the bot prints the exact instructions if the wallet is not yet linked

# 3. restart the bot — it will begin scanning and liquidating
```

## What It Does

Every migrated token on Torch has a built-in lending market. Borrowers lock tokens as collateral and borrow SOL. When a position's LTV exceeds the 65% liquidation threshold, anyone can liquidate it and collect a 10% collateral bonus.

This bot:

1. Generates a disposable `Keypair` in-process (no private key leaves the process; optional `SOLANA_PRIVATE_KEY` overrides)
2. Verifies the vault exists and the agent wallet is linked
3. Scans migrated tokens with `getAllLoanPositions()` — one RPC call per token, positions pre-sorted liquidatable-first
4. Executes `buildLiquidateTransaction()` for each liquidatable position, routing bonus tokens into the vault
5. Confirms via `confirmTransaction()` and records metrics
6. Repeats on a configurable interval

All value flows through the vault. The agent wallet is a stateless controller that holds only gas SOL.

**Off-chain health visibility (torchsdk v10.7.1+):** the SDK projects accrued interest forward to the current slot, so positions that have drifted past the liquidation threshold via interest accrual alone — without any on-chain instruction touching them — show up as `health=liquidatable` immediately. No need for someone else to poke the loan first.

## Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SOLANA_RPC_URL` | yes | — | Solana RPC endpoint (fallback: `RPC_URL`) |
| `VAULT_CREATOR` | yes | — | Vault creator pubkey (identifies which vault to use) |
| `SOLANA_PRIVATE_KEY` | no | — | Disposable controller keypair (base58 or JSON byte array). If omitted, generates fresh keypair on startup |
| `SCAN_INTERVAL_MS` | no | `30000` | Milliseconds between scan cycles (min 5000) |
| `SCAN_LIMIT` | no | `50` | Max tokens scanned per cycle (`0` = unlimited) |
| `MIN_AGENT_BALANCE_SOL` | no | `0.01` | Pause liquidations when agent's gas balance drops below this |
| `LOG_LEVEL` | no | `info` | `debug`, `info`, `warn`, `error` |
| `LOG_FORMAT` | no | `text` | `text` (human-readable) or `json` (structured, one record per line) |

## Vault Setup

```
User (hardware wallet) → creates vault, deposits SOL
                       → links bot's agent wallet
Bot  (disposable)      → scans for liquidatable positions
                       → executes liquidations using vault funds
                       → all proceeds return to vault
User                   → withdraws from vault (authority only)
```

The agent wallet needs minimal SOL for gas (~0.01 SOL default, configurable via `MIN_AGENT_BALANCE_SOL`). All liquidation value flows through the vault. If the agent balance drops below the threshold, the bot pauses that cycle and logs a warning rather than failing transactions mid-flight.

## Operational Features

- **Graceful shutdown.** `SIGINT` / `SIGTERM` abort the current scan cleanly — the bot finishes the in-flight RPC call, skips remaining tokens in the cycle, and exits with `graceful shutdown complete` + code 0. Safe for `systemctl stop`, container orchestrators, etc.
- **Retry with exponential backoff.** Every RPC call is wrapped in a 3-attempt retry with 1s / 2s / 4s delays and tracked via `stats.rpcRetries`. Transient Solana RPC failures don't kill a scan cycle.
- **30s timeout on every SDK call.** A hung RPC can't wedge the bot; the timeout throws and the retry logic kicks in.
- **Balance-pause check.** Pre-flight check before each scan cycle — if the agent's balance dips below `MIN_AGENT_BALANCE_SOL`, the cycle is skipped with an error log.
- **Structured JSON logging.** `LOG_FORMAT=json` emits one JSON record per line — pipe straight into Vector, Datadog, Loki, etc.
- **Runtime stats.** Every cycle logs cumulative counters: `cycles`, `liquidations`, `failures`, `rpc_retries`, `uptime_sec`, `lastError`.

## Programmatic Usage

If you want the scanning loop embedded in your own service instead of running the bot binary:

```typescript
import { Connection, Keypair } from '@solana/web3.js'
import {
  getTokens,
  getAllLoanPositions,
  getVault,
  getVaultForWallet,
  buildLiquidateTransaction,
  confirmTransaction,
} from 'torchsdk'

const connection = new Connection('<rpc>', 'confirmed')
const agent = Keypair.generate()

// verify vault and link (one-time)
const vaultCreator = '<vault-creator-pubkey>'
const vault = await getVault(connection, vaultCreator)
if (!vault) throw new Error('vault not found')

const link = await getVaultForWallet(connection, agent.publicKey.toBase58())
if (!link) throw new Error('agent wallet not linked to vault')

// scan and liquidate
const { tokens } = await getTokens(connection, {
  status: 'migrated',
  sort: 'volume',
  limit: 50,
})

for (const token of tokens) {
  const { positions } = await getAllLoanPositions(connection, token.mint)

  for (const pos of positions) {
    // positions are pre-sorted liquidatable → at_risk → healthy.
    // health is already projected to the current slot — no need to call accrue_interest first.
    if (pos.health !== 'liquidatable') break

    const { transaction } = await buildLiquidateTransaction(connection, {
      mint: token.mint,
      liquidator: agent.publicKey.toBase58(),
      borrower: pos.borrower,
      vault: vaultCreator,
    })
    transaction.sign([agent])
    const sig = await connection.sendRawTransaction(transaction.serialize())
    await confirmTransaction(connection, sig, agent.publicKey.toBase58())
  }
}
```

## Architecture

```
packages/bot/src/
├── constants.ts  — retry/timeout constants, log level/format tables
├── types.ts      — BotConfig, BotStats, ScanContext, Logger, LogLevel, LogFormat
├── config.ts     — loadConfig() + env-var validation
├── utils.ts      — withTimeout, withRetry, createLogger, sol/bpsToPercent formatters
└── index.ts      — scanAndLiquidate + main() with graceful shutdown
```

## Testing

Requires [Surfpool](https://github.com/txtx/surfpool) running a mainnet fork:

```bash
surfpool start --network mainnet --no-tui
pnpm build
pnpm test
```

The e2e covers the full flow: create token → bond → migrate → open loan → time-travel past threshold → scan → liquidate via vault → verify cleanup → balance-pause check → config validation → subprocess SIGTERM shutdown.

## Security

- Agent keypair generated in-process with `Keypair.generate()` (or loaded from optional `SOLANA_PRIVATE_KEY`)
- Vault model: agent is a stateless controller; all value stays in the vault
- Authority can unlink the agent wallet instantly via `buildUnlinkWalletTransaction()`
- All SDK calls wrapped with a 30-second timeout + 3-attempt retry
- Pre-flight balance check pauses liquidations before funds run out for gas
- Minimal dependencies: `@solana/web3.js`, `torchsdk`, `bs58`, `@solana/spl-token`
- No post-install hooks, no remote code fetching
- `disable-model-invocation: true` — agents cannot invoke this skill autonomously

## Links

- [torchsdk](https://github.com/mrsirg97-rgb/torchsdk) — the SDK powering this bot
- [Torch Market](https://torch.market) — the protocol
- [ClawHub](https://clawhub.ai/mrsirg97-rgb/torch-liquidation-bot) — skill registry
- program id: `8hbUkonssSEEtkqzwM7ZcZrD9evacM92TcWSooVF4BeT`

## License

MIT
