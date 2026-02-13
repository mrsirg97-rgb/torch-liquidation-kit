# torch-liquidation-bot v3.0.1 (Vault Mode)

Vault-based liquidation bot for [Torch Market](https://torch.market) on Solana. Generates an agent keypair in-process — no user wallet required. All operations route through a Torch Vault.

> **v3.0.0+ Breaking Change:** The bot now operates through the torchsdk v3.2.3+ vault model. It generates a disposable agent keypair at startup, scans for underwater loan positions, and executes liquidations. The user never provides a wallet — only a vault creator pubkey and an RPC endpoint.

## Install

```bash
npm install torch-liquidation-bot
```

## Quick Start

```bash
# 1. start the bot — it prints its agent wallet on startup
VAULT_CREATOR=<your-vault-creator-pubkey> SOLANA_RPC_URL=<rpc> npx torch-liquidation-bot

# 2. link the printed agent wallet to your vault (one-time, from your authority wallet)
#    the bot will print the exact instructions if the wallet is not yet linked

# 3. restart the bot — it will begin scanning and liquidating
```

## What It Does

Every migrated token on Torch has a built-in lending market. Borrowers lock tokens as collateral and borrow SOL. When a position's LTV exceeds the liquidation threshold, anyone can liquidate it and earn the liquidation bonus.

This bot:

1. Generates a disposable `Keypair` in-process (no private key leaves the process)
2. Verifies the vault exists and the agent wallet is linked
3. Scans migrated tokens for active loans
4. Checks each borrower's position health via `getLoanPosition()`
5. Executes `buildLiquidateTransaction()` for any position with `health === 'liquidatable'`
6. Confirms the transaction via `confirmTransaction()`
7. Repeats on a configurable interval

All value flows through the vault. The agent wallet is a stateless controller.

## Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SOLANA_RPC_URL` | yes | -- | Solana RPC endpoint (fallback: `RPC_URL`) |
| `VAULT_CREATOR` | yes | -- | Vault creator pubkey (identifies which vault to use) |
| `SOLANA_PRIVATE_KEY` | no | -- | Disposable controller keypair (base58 or JSON byte array). If omitted, generates fresh keypair on startup |
| `SCAN_INTERVAL_MS` | no | `30000` | Milliseconds between scan cycles (min 5000) |
| `LOG_LEVEL` | no | `info` | `debug`, `info`, `warn`, `error` |

## Vault Setup

The bot uses the torchsdk v3.2.3 vault model:

```
User (hardware wallet) → Creates vault, deposits SOL
                       → Links bot's agent wallet
Bot  (disposable)      → Scans for liquidatable positions
                       → Executes liquidations using vault funds
                       → All proceeds return to vault
User                   → Withdraws from vault (authority only)
```

The agent wallet needs minimal SOL for gas (~0.01 SOL). All liquidation value flows through the vault.

## Programmatic Usage

```typescript
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
} from 'torchsdk'

const connection = new Connection('<rpc>', 'confirmed')
const agent = Keypair.generate()

// verify vault and link
const vaultCreator = '<vault-creator-pubkey>'
const vault = await getVault(connection, vaultCreator)
const link = await getVaultForWallet(connection, agent.publicKey.toBase58())

// scan and liquidate
const { tokens } = await getTokens(connection, { status: 'migrated', sort: 'volume', limit: 50 })

for (const token of tokens) {
  const lending = await getLendingInfo(connection, token.mint)
  if (!lending.active_loans) continue

  const { holders } = await getHolders(connection, token.mint)
  for (const holder of holders) {
    const pos = await getLoanPosition(connection, token.mint, holder.address)
    if (pos.health !== 'liquidatable') continue

    const { transaction } = await buildLiquidateTransaction(connection, {
      mint: token.mint,
      liquidator: agent.publicKey.toBase58(),
      borrower: holder.address,
      vault: vaultCreator,
    })
    transaction.sign(agent)
    const sig = await connection.sendRawTransaction(transaction.serialize())
    await confirmTransaction(connection, sig, agent.publicKey.toBase58())
  }
}
```

## Architecture

```
src/
├── types.ts    — BotConfig interface
├── config.ts   — loadConfig() (SOLANA_RPC_URL, VAULT_CREATOR, SOLANA_PRIVATE_KEY, SCAN_INTERVAL_MS, LOG_LEVEL)
├── utils.ts    — sol(), bpsToPercent(), createLogger()
└── index.ts    — vault-based liquidation loop
```

## Lending Parameters

| Parameter | Value |
|-----------|-------|
| Max LTV | 50% |
| Liquidation threshold | 65% LTV |
| Interest rate | 2% per epoch (~7 days) |
| Liquidation bonus | 10% of collateral |
| Min borrow | 0.1 SOL |

## Testing

Requires [Surfpool](https://github.com/nicholasgasior/surfpool) running a mainnet fork:

```bash
surfpool start --network mainnet --no-tui
pnpm test
```

## Security

- Agent keypair generated in-process with `Keypair.generate()` (or loaded from optional `SOLANA_PRIVATE_KEY`)
- Vault model: agent is a stateless controller, all value stays in the vault
- Authority can unlink the agent wallet instantly via `buildUnlinkWalletTransaction()`
- Minimal dependencies: `@solana/web3.js` + `torchsdk` -- both pinned to exact versions
- No post-install hooks, no remote code fetching
- SDK contacts three external services (SAID Protocol, CoinGecko, Irys) -- all read-only, no credentials sent

## Links

- [torchsdk](https://github.com/mrsirg97-rgb/torchsdk) -- the SDK powering this bot
- [Torch Market](https://torch.market) -- the protocol
- [ClawHub](https://clawhub.ai/mrsirg97-rgb/torch-liquidation-bot) -- skill registry

## License

MIT
