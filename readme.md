# torch-liquidation-bot v3.0.0

Autonomous vault-based liquidation keeper for [Torch Market](https://torch.market) lending on Solana. Generates an agent keypair in-process -- no user wallet required. All operations route through a Torch Vault.

## Install

```bash
npm install torch-liquidation-bot@3.0.0
```

## Quick Start

```bash
# 1. start the bot — it prints its agent wallet on startup
VAULT_CREATOR=<your-vault-creator-pubkey> RPC_URL=<rpc> npx torch-liquidation-bot

# 2. link the printed agent wallet to your vault (one-time, from your authority wallet)
#    the bot will print the exact instructions if the wallet is not yet linked

# 3. restart the bot — it will begin scanning and liquidating
```

## What It Does

Every migrated token on Torch has a built-in lending market. Borrowers lock tokens as collateral and borrow SOL from the community treasury (up to 50% LTV, 2% weekly interest). When a loan's LTV crosses 65%, it becomes liquidatable. Anyone can liquidate it and collect a **10% bonus** on the collateral value.

This bot:

1. Generates a disposable `Keypair` in-process (no private key leaves the process)
2. Verifies the vault exists and the agent wallet is linked
3. Scans migrated tokens for active loans
4. Checks each borrower's position health via `getLoanPosition()`
5. Executes `buildLiquidateTransaction()` with `vault` param for any position with `health === 'liquidatable'`
6. Confirms the transaction via `confirmTransaction()`
7. Repeats on a configurable interval

All value flows through the vault. The agent wallet is a disposable controller that holds nothing.

## Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `RPC_URL` | yes | -- | Solana RPC endpoint (HTTPS) |
| `VAULT_CREATOR` | yes | -- | Vault creator pubkey (identifies which vault to use) |
| `SCAN_INTERVAL_MS` | no | `30000` | Milliseconds between scan cycles (min 5000) |
| `LOG_LEVEL` | no | `info` | `debug`, `info`, `warn`, `error` |

## Vault Setup

The bot uses the Torch Vault model via torchsdk v3.2.3:

```
Human Principal (hardware wallet)
  → Creates vault, deposits SOL, links bot's agent wallet

Bot (disposable agent keypair, ~0.01 SOL for gas)
  → Scans for liquidatable positions
  → Executes liquidations via vault (SOL from vault, collateral to vault ATA)

Human Principal (retains full control)
  → Withdraws SOL and collateral tokens at any time (authority only)
  → Unlinks agent wallet instantly if needed
```

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
const vaultCreator = '<vault-creator-pubkey>'

// verify vault and link
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
packages/bot/src/
├── index.ts    — entry point: keypair generation, vault verification, scan loop
├── config.ts   — loadConfig(): validates RPC_URL, VAULT_CREATOR, SCAN_INTERVAL_MS, LOG_LEVEL
├── types.ts    — BotConfig, LogLevel interfaces
└── utils.ts    — sol(), bpsToPercent(), createLogger()
```

## Lending Parameters

| Parameter | Value |
|-----------|-------|
| Max LTV | 50% |
| Liquidation Threshold | 65% LTV |
| Interest Rate | 2% per epoch (~7 days) |
| Liquidation Bonus | 10% of collateral |
| Min Borrow | 0.1 SOL |

## Testing

Requires [Surfpool](https://github.com/nicholasgasior/surfpool) running a mainnet fork:

```bash
surfpool start --network mainnet --no-tui
pnpm test
```

**Result:** 7 passed, 1 informational (Surfpool RPC limitation on `getTokenLargestAccounts` -- works on mainnet).

## Security

- Agent keypair generated in-process with `Keypair.generate()` -- never serialized, never leaves the process
- No user wallet or private key imported from environment
- Vault model: agent is a disposable controller, all value stays in the vault
- Authority can unlink the agent wallet instantly via `buildUnlinkWalletTransaction()`
- Minimal dependencies: `@solana/web3.js` + `torchsdk` -- both pinned to exact versions
- No post-install hooks, no remote code fetching
- `disable-model-invocation: true` -- agents cannot invoke this skill autonomously

### External Runtime Dependencies

The SDK makes outbound HTTPS requests to three external services beyond the Solana RPC:

| Service | Purpose | When Called |
|---------|---------|------------|
| **SAID Protocol** (`api.saidprotocol.com`) | Agent identity verification and trust tier lookup | `confirmTransaction()` |
| **CoinGecko** (`api.coingecko.com`) | SOL/USD price for display | Token queries with USD pricing |
| **Irys Gateway** (`gateway.irys.xyz`) | Token metadata fallback (name, symbol, image) | `getToken()` when on-chain metadata URI points to Irys |

No credentials are sent to these services. All requests are read-only GET/POST. If any service is unreachable, the SDK degrades gracefully. No private key material is ever transmitted to any external endpoint.

See the full [Security Audit](clawhub/audit.md) and [SKILL.md](clawhub/SKILL.md) for threat model and supply chain verification.

## Links

- [torchsdk](https://github.com/mrsirg97-rgb/torchsdk) -- the SDK powering this bot (v3.2.3)
- [Torch Market](https://torch.market) -- the protocol
- [ClawHub](https://clawhub.ai/mrsirg97-rgb/torch-liquidation-bot) -- skill registry

## License

MIT
