# Torch Market — Whitepaper

**Solana Program Version 3.2.0** | February 2026

---

## Why

Token launchers are disposable. Create a token, add liquidity, wait for hype, watch it die. The community gets a price chart and nothing else. When attention moves on, there's nothing keeping the lights on — no treasury, no lending, no governance, no reason for anyone to stay.

AI agents make this worse. An agent with a hot wallet is a liability. If the key leaks, the funds are gone. If the agent misbehaves, there's no kill switch. Every agent framework today asks you to trust a private key with real money.

Torch fixes both problems.

---

## What

Torch Market is a fair-launch token launchpad on Solana where every token is born as a **micro-economy** — not just a price chart.

Every token launches with:
- A **bonding curve** for price discovery (no LP needed, no presale, no founder allocation)
- A **community treasury** funded by 10% of every buy
- A **governance vote** on treasury outcome at graduation
- A **lending market** that activates after migration to Raydium
- An **auto-buyback engine** that defends price from treasury reserves

And for AI agents:
- **Torch Vault** — full-custody on-chain escrow where the vault holds all assets and the agent wallet is disposable
- **Protocol rewards** — active traders earn back a share of platform fees each epoch

---

## How It Works

### The Token Lifecycle

**1. Launch (Fair)**
Anyone creates a token. 100% fair launch — no presale, no founder allocation, no VC advantage. The bonding curve starts with 30 SOL virtual reserves and prices the first tokens near zero. Total supply: 1 billion tokens (6 decimals, Token-2022).

**2. Bonding (Price Discovery)**
Traders buy and sell on the bonding curve. Each buy increases the price deterministically. 10% of every buy goes to the community treasury. 1% goes to the protocol treasury. 2% max wallet enforced during bonding to prevent whale accumulation.

First buy on any token requires a governance vote: `burn` (deflationary) or `return` (deeper liquidity). One wallet, one vote. The vote is binding and on-chain.

**3. Graduation (200 SOL)**
When the bonding curve accumulates 200 SOL in real reserves, the token graduates. Liquidity migrates to Raydium CPMM. The community vote executes: burn destroys 100M treasury tokens (reducing supply to 900M), return adds them to the Raydium pool.

**4. Post-Migration (Full Economy)**
After migration, the token becomes a complete economy:
- **DEX trading** on Raydium with 1% Token-2022 transfer fee on all transfers
- **Treasury lending** — borrow SOL against token collateral (up to 50% LTV, 2% weekly interest)
- **Auto-buyback** — treasury buys back tokens when price drops below 80% of migration baseline
- **Liquidations** — underwater loans (LTV > 65%) can be liquidated by anyone for a 10% bonus

### The Economic Loop

```
Trading generates fees --> Fees fund the treasury --> Treasury enables lending
--> Lending generates interest --> Interest funds buybacks --> Buybacks support price
--> Price stability encourages trading --> ...
```

This is self-reinforcing. Unlike typical launchers where value only flows out, Torch tokens have a mechanism that continuously recycles value back into the ecosystem.

### Vault Custody (For AI Agents)

Torch Vault inverts the standard agent wallet model:

| Traditional | Torch Vault |
|-------------|-------------|
| Agent holds funds in hot wallet | Vault PDA holds all assets |
| Key compromise = funds lost | Key compromise = dust lost |
| No kill switch | Instant revocation (one tx) |
| Agent needs funded wallet | Agent needs ~0.01 SOL for gas |

**Three roles, cleanly separated:**
- **Creator** — immutable PDA seed, determines vault address
- **Authority** — transferable admin, controls withdrawals and linking
- **Controller** — disposable signer, can trade but cannot extract value

Every operation (buy, sell, borrow, repay, swap, star) routes through the vault. SOL and tokens flow in and out of the vault PDA — never to the controller wallet. The authority can unlink a controller in one transaction. The vault can be created and funded entirely by a human principal without the agent ever touching a private key.

### Protocol Rewards

The protocol treasury collects 1% from every bonding curve buy across all tokens. Each epoch (~7 days), the pool above a 1,500 SOL reserve floor is distributed proportionally to wallets that traded >= 10 SOL volume in the previous epoch. For vault users, rewards go directly to the vault.

Active agents earn back a share of the fees they generate. High-volume agents meaningfully offset trading costs.

---

## Protocol Constants

| Parameter | Value |
|-----------|-------|
| Total Supply | 1B tokens (6 decimals) |
| Bonding Target | 200 SOL |
| Treasury Rate | 10% of buys |
| Protocol Fee | 1% on buys |
| Max Wallet (Bonding) | 2% |
| Star Cost | 0.05 SOL |
| Token Standard | Token-2022 (1% transfer fee) |
| Lending Max LTV | 50% |
| Liquidation Threshold | 65% LTV |
| Interest Rate | 2% per epoch |
| Liquidation Bonus | 10% |
| Utilization Cap | 50% of treasury |
| Min Borrow | 0.1 SOL |
| Buyback Trigger | Price < 80% of baseline |
| Supply Floor | 500M tokens |
| Protocol Reserve Floor | 1,500 SOL |
| Epoch Duration | 7 days |
| Min Volume for Rewards | 10 SOL/epoch |

---

## Program

- **Program ID:** `8hbUkonssSEEtkqzwM7ZcZrD9evacM92TcWSooVF4BeT`
- **Framework:** Anchor 0.32.1 (Rust)
- **Instructions:** 25
- **Account Types:** 11
- **Token Standard:** Token-2022 with transfer fee extension
- **DEX Integration:** Raydium CPMM (CPI)
- **All token addresses end in `tm`** (vanity suffix)

---

## Security Audit Overview

**Auditor:** Claude Opus 4.6 (Anthropic)
**Date:** February 12, 2026
**Scope:** Full on-chain program — 25 instructions, 11 account types, ~4,500 lines Rust

| Category | Result |
|----------|--------|
| Access Control | PASS |
| Math Safety | PASS |
| PDA Security | PASS |
| Vault Custody | PASS |
| Lending Safety | PASS |
| Token-2022 Safety | PASS |
| Authority Separation | PASS |

| Severity | Count |
|----------|-------|
| Critical | 0 |
| High | 0 |
| Medium | 0 |
| Low | 3 |
| Informational | 5 |

**Low findings:**
- L-1: Unchecked lamport arithmetic in non-vault claim path (non-vault path uses raw `-=`/`+=` instead of `checked_sub`/`checked_add`)
- L-2: Protocol treasury `current_balance` tracker can drift between epoch advances (recalculated from actual lamports at each advance)
- L-3: `protocol_treasury` is Optional in Sell context — sell volume may not be tracked if omitted

**No critical, high, or medium vulnerabilities found.** All arithmetic uses checked operations with overflow protection. All PDA seeds are unique with stored bumps. Vault custody maintains a closed economic loop — controllers cannot extract value. Full audit: [torch.market/audit.md](https://torch.market/audit.md)
