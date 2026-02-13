"use strict";
/**
 * Transaction builders
 *
 * Build unsigned transactions for buy, sell, create, star, vault, and lending.
 * Agents sign these locally and submit to the network.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildVaultSwapTransaction = exports.buildWithdrawTokensTransaction = exports.buildClaimProtocolRewardsTransaction = exports.buildLiquidateTransaction = exports.buildRepayTransaction = exports.buildBorrowTransaction = exports.buildTransferAuthorityTransaction = exports.buildUnlinkWalletTransaction = exports.buildLinkWalletTransaction = exports.buildWithdrawVaultTransaction = exports.buildDepositVaultTransaction = exports.buildCreateVaultTransaction = exports.buildStarTransaction = exports.buildCreateTokenTransaction = exports.buildSellTransaction = exports.buildDirectBuyTransaction = exports.buildBuyTransaction = void 0;
const web3_js_1 = require("@solana/web3.js");
const spl_token_1 = require("@solana/spl-token");
const anchor_1 = require("@coral-xyz/anchor");
const program_1 = require("./program");
const constants_1 = require("./constants");
const tokens_1 = require("./tokens");
const torch_market_json_1 = __importDefault(require("./torch_market.json"));
// ============================================================================
// Helpers
// ============================================================================
const makeDummyProvider = (connection, payer) => {
    const dummyWallet = {
        publicKey: payer,
        signTransaction: async (t) => t,
        signAllTransactions: async (t) => t,
    };
    return new anchor_1.AnchorProvider(connection, dummyWallet, {});
};
const finalizeTransaction = async (connection, tx, feePayer) => {
    const { blockhash } = await connection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.feePayer = feePayer;
};
// ============================================================================
// Buy
// ============================================================================
// Internal buy builder shared by both vault and direct variants
const buildBuyTransactionInternal = async (connection, mintStr, buyerStr, amount_sol, slippage_bps, vote, message, vaultCreatorStr) => {
    const mint = new web3_js_1.PublicKey(mintStr);
    const buyer = new web3_js_1.PublicKey(buyerStr);
    const tokenData = await (0, tokens_1.fetchTokenRaw)(connection, mint);
    if (!tokenData)
        throw new Error(`Token not found: ${mintStr}`);
    const { bondingCurve } = tokenData;
    if (bondingCurve.bonding_complete)
        throw new Error('Bonding curve complete, trade on DEX');
    // Calculate expected output
    const virtualSol = BigInt(bondingCurve.virtual_sol_reserves.toString());
    const virtualTokens = BigInt(bondingCurve.virtual_token_reserves.toString());
    const realSol = BigInt(bondingCurve.real_sol_reserves.toString());
    const solAmount = BigInt(amount_sol);
    const result = (0, program_1.calculateTokensOut)(solAmount, virtualSol, virtualTokens, realSol);
    // Apply slippage
    const slippage = Math.max(10, Math.min(1000, slippage_bps));
    const minTokens = (result.tokensToUser * BigInt(10000 - slippage)) / BigInt(10000);
    // Derive PDAs
    const [bondingCurvePda] = (0, program_1.getBondingCurvePda)(mint);
    const [treasuryPda] = (0, program_1.getTokenTreasuryPda)(mint);
    const [userPositionPda] = (0, program_1.getUserPositionPda)(bondingCurvePda, buyer);
    const [userStatsPda] = (0, program_1.getUserStatsPda)(buyer);
    const [globalConfigPda] = (0, program_1.getGlobalConfigPda)();
    const [protocolTreasuryPda] = (0, program_1.getProtocolTreasuryPda)();
    const bondingCurveTokenAccount = (0, spl_token_1.getAssociatedTokenAddressSync)(mint, bondingCurvePda, true, spl_token_1.TOKEN_2022_PROGRAM_ID);
    const treasuryTokenAccount = (0, program_1.getTreasuryTokenAccount)(mint, treasuryPda);
    const buyerTokenAccount = (0, spl_token_1.getAssociatedTokenAddressSync)(mint, buyer, false, spl_token_1.TOKEN_2022_PROGRAM_ID);
    const tx = new web3_js_1.Transaction();
    // Create buyer ATA if needed
    tx.add((0, spl_token_1.createAssociatedTokenAccountIdempotentInstruction)(buyer, buyerTokenAccount, buyer, mint, spl_token_1.TOKEN_2022_PROGRAM_ID, spl_token_1.ASSOCIATED_TOKEN_PROGRAM_ID));
    const provider = makeDummyProvider(connection, buyer);
    const program = new anchor_1.Program(torch_market_json_1.default, provider);
    // Fetch global config for dev wallet
    const globalConfigAccount = (await program.account.globalConfig.fetch(globalConfigPda));
    // Vault accounts (optional — pass null when not using vault)
    let torchVaultAccount = null;
    let vaultWalletLinkAccount = null;
    let vaultTokenAccount = null;
    if (vaultCreatorStr) {
        const vaultCreator = new web3_js_1.PublicKey(vaultCreatorStr);
        [torchVaultAccount] = (0, program_1.getTorchVaultPda)(vaultCreator);
        [vaultWalletLinkAccount] = (0, program_1.getVaultWalletLinkPda)(buyer);
        // [V18] Tokens go to vault ATA instead of buyer's wallet
        vaultTokenAccount = (0, spl_token_1.getAssociatedTokenAddressSync)(mint, torchVaultAccount, true, spl_token_1.TOKEN_2022_PROGRAM_ID);
        // Create vault ATA if needed (vault PDA owns it)
        tx.add((0, spl_token_1.createAssociatedTokenAccountIdempotentInstruction)(buyer, vaultTokenAccount, torchVaultAccount, mint, spl_token_1.TOKEN_2022_PROGRAM_ID, spl_token_1.ASSOCIATED_TOKEN_PROGRAM_ID));
    }
    const buyIx = await program.methods
        .buy({
        solAmount: new anchor_1.BN(amount_sol.toString()),
        minTokensOut: new anchor_1.BN(minTokens.toString()),
        vote: vote === 'return' ? true : vote === 'burn' ? false : null,
    })
        .accounts({
        buyer,
        globalConfig: globalConfigPda,
        devWallet: globalConfigAccount.devWallet || globalConfigAccount.dev_wallet,
        protocolTreasury: protocolTreasuryPda,
        mint,
        bondingCurve: bondingCurvePda,
        tokenVault: bondingCurveTokenAccount,
        tokenTreasury: treasuryPda,
        treasuryTokenAccount,
        buyerTokenAccount,
        userPosition: userPositionPda,
        userStats: userStatsPda,
        torchVault: torchVaultAccount,
        vaultWalletLink: vaultWalletLinkAccount,
        vaultTokenAccount,
        tokenProgram: spl_token_1.TOKEN_2022_PROGRAM_ID,
        associatedTokenProgram: spl_token_1.ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: web3_js_1.SystemProgram.programId,
    })
        .instruction();
    tx.add(buyIx);
    // Bundle optional message as SPL Memo instruction
    if (message && message.trim().length > 0) {
        if (message.length > MAX_MESSAGE_LENGTH) {
            throw new Error(`Message must be ${MAX_MESSAGE_LENGTH} characters or less`);
        }
        const memoIx = new web3_js_1.TransactionInstruction({
            programId: constants_1.MEMO_PROGRAM_ID,
            keys: [{ pubkey: buyer, isSigner: true, isWritable: false }],
            data: Buffer.from(message.trim(), 'utf-8'),
        });
        tx.add(memoIx);
    }
    await finalizeTransaction(connection, tx, buyer);
    const vaultLabel = vaultCreatorStr ? ' (via vault)' : '';
    return {
        transaction: tx,
        message: `Buy ${Number(result.tokensToUser) / 1e6} tokens for ${Number(solAmount) / 1e9} SOL${vaultLabel}`,
    };
};
/**
 * Build an unsigned vault-funded buy transaction.
 *
 * The vault pays for the buy. This is the recommended path for AI agents.
 *
 * @param connection - Solana RPC connection
 * @param params - Buy parameters with required vault creator pubkey
 * @returns Unsigned transaction and descriptive message
 */
const buildBuyTransaction = async (connection, params) => {
    const { mint, buyer, amount_sol, slippage_bps = 100, vote, message, vault } = params;
    return buildBuyTransactionInternal(connection, mint, buyer, amount_sol, slippage_bps, vote, message, vault);
};
exports.buildBuyTransaction = buildBuyTransaction;
/**
 * Build an unsigned direct buy transaction (no vault).
 *
 * The buyer pays from their own wallet. Use this for human-operated wallets only.
 * For AI agents, use buildBuyTransaction with a vault instead.
 *
 * @param connection - Solana RPC connection
 * @param params - Buy parameters (no vault)
 * @returns Unsigned transaction and descriptive message
 */
const buildDirectBuyTransaction = async (connection, params) => {
    const { mint, buyer, amount_sol, slippage_bps = 100, vote, message } = params;
    return buildBuyTransactionInternal(connection, mint, buyer, amount_sol, slippage_bps, vote, message, undefined);
};
exports.buildDirectBuyTransaction = buildDirectBuyTransaction;
// ============================================================================
// Sell
// ============================================================================
/**
 * Build an unsigned sell transaction.
 *
 * @param connection - Solana RPC connection
 * @param params - Sell parameters (mint, seller, amount_tokens in raw units, optional slippage_bps)
 * @returns Unsigned transaction and descriptive message
 */
const buildSellTransaction = async (connection, params) => {
    const { mint: mintStr, seller: sellerStr, amount_tokens, slippage_bps = 100, message, vault: vaultCreatorStr } = params;
    const mint = new web3_js_1.PublicKey(mintStr);
    const seller = new web3_js_1.PublicKey(sellerStr);
    const tokenData = await (0, tokens_1.fetchTokenRaw)(connection, mint);
    if (!tokenData)
        throw new Error(`Token not found: ${mintStr}`);
    const { bondingCurve } = tokenData;
    if (bondingCurve.bonding_complete)
        throw new Error('Bonding curve complete, trade on DEX');
    // Calculate expected output
    const virtualSol = BigInt(bondingCurve.virtual_sol_reserves.toString());
    const virtualTokens = BigInt(bondingCurve.virtual_token_reserves.toString());
    const tokenAmount = BigInt(amount_tokens);
    const result = (0, program_1.calculateSolOut)(tokenAmount, virtualSol, virtualTokens);
    // Apply slippage
    const slippage = Math.max(10, Math.min(1000, slippage_bps));
    const minSol = (result.solToUser * BigInt(10000 - slippage)) / BigInt(10000);
    // Derive PDAs
    const [bondingCurvePda] = (0, program_1.getBondingCurvePda)(mint);
    const [treasuryPda] = (0, program_1.getTokenTreasuryPda)(mint);
    const [userPositionPda] = (0, program_1.getUserPositionPda)(bondingCurvePda, seller);
    const [userStatsPda] = (0, program_1.getUserStatsPda)(seller);
    const bondingCurveTokenAccount = (0, spl_token_1.getAssociatedTokenAddressSync)(mint, bondingCurvePda, true, spl_token_1.TOKEN_2022_PROGRAM_ID);
    const sellerTokenAccount = (0, spl_token_1.getAssociatedTokenAddressSync)(mint, seller, false, spl_token_1.TOKEN_2022_PROGRAM_ID);
    // [V18] Vault accounts (optional — pass null when not using vault)
    let torchVaultAccount = null;
    let vaultWalletLinkAccount = null;
    let vaultTokenAccount = null;
    if (vaultCreatorStr) {
        const vaultCreator = new web3_js_1.PublicKey(vaultCreatorStr);
        [torchVaultAccount] = (0, program_1.getTorchVaultPda)(vaultCreator);
        [vaultWalletLinkAccount] = (0, program_1.getVaultWalletLinkPda)(seller);
        vaultTokenAccount = (0, spl_token_1.getAssociatedTokenAddressSync)(mint, torchVaultAccount, true, spl_token_1.TOKEN_2022_PROGRAM_ID);
    }
    const tx = new web3_js_1.Transaction();
    // Create vault ATA if needed (idempotent — safe for first vault sell on a mint)
    if (vaultTokenAccount && torchVaultAccount) {
        tx.add((0, spl_token_1.createAssociatedTokenAccountIdempotentInstruction)(seller, vaultTokenAccount, torchVaultAccount, mint, spl_token_1.TOKEN_2022_PROGRAM_ID, spl_token_1.ASSOCIATED_TOKEN_PROGRAM_ID));
    }
    const provider = makeDummyProvider(connection, seller);
    const program = new anchor_1.Program(torch_market_json_1.default, provider);
    const sellIx = await program.methods
        .sell({
        tokenAmount: new anchor_1.BN(amount_tokens.toString()),
        minSolOut: new anchor_1.BN(minSol.toString()),
    })
        .accounts({
        seller,
        mint,
        bondingCurve: bondingCurvePda,
        tokenVault: bondingCurveTokenAccount,
        sellerTokenAccount,
        userPosition: userPositionPda,
        tokenTreasury: treasuryPda,
        userStats: userStatsPda,
        torchVault: torchVaultAccount,
        vaultWalletLink: vaultWalletLinkAccount,
        vaultTokenAccount,
        tokenProgram: spl_token_1.TOKEN_2022_PROGRAM_ID,
        systemProgram: web3_js_1.SystemProgram.programId,
    })
        .instruction();
    tx.add(sellIx);
    // Bundle optional message as SPL Memo instruction
    if (message && message.trim().length > 0) {
        if (message.length > MAX_MESSAGE_LENGTH) {
            throw new Error(`Message must be ${MAX_MESSAGE_LENGTH} characters or less`);
        }
        const memoIx = new web3_js_1.TransactionInstruction({
            programId: constants_1.MEMO_PROGRAM_ID,
            keys: [{ pubkey: seller, isSigner: true, isWritable: false }],
            data: Buffer.from(message.trim(), 'utf-8'),
        });
        tx.add(memoIx);
    }
    await finalizeTransaction(connection, tx, seller);
    const vaultLabel = vaultCreatorStr ? ' (via vault)' : '';
    return {
        transaction: tx,
        message: `Sell ${Number(tokenAmount) / 1e6} tokens for ${Number(result.solToUser) / 1e9} SOL${vaultLabel}`,
    };
};
exports.buildSellTransaction = buildSellTransaction;
// ============================================================================
// Create Token
// ============================================================================
/**
 * Build an unsigned create token transaction.
 *
 * Returns the transaction (partially signed by the mint keypair) and the mint keypair
 * so the agent can extract the mint address.
 *
 * @param connection - Solana RPC connection
 * @param params - Create parameters (creator, name, symbol, metadata_uri)
 * @returns Partially-signed transaction, mint PublicKey, and mint Keypair
 */
const buildCreateTokenTransaction = async (connection, params) => {
    const { creator: creatorStr, name, symbol, metadata_uri } = params;
    const creator = new web3_js_1.PublicKey(creatorStr);
    if (name.length > 32)
        throw new Error('Name must be 32 characters or less');
    if (symbol.length > 10)
        throw new Error('Symbol must be 10 characters or less');
    // Grind for vanity "tm" suffix
    let mint;
    const maxAttempts = 500000;
    let attempts = 0;
    while (true) {
        mint = web3_js_1.Keypair.generate();
        attempts++;
        if (mint.publicKey.toBase58().endsWith('tm'))
            break;
        if (attempts >= maxAttempts)
            break;
    }
    // Derive PDAs
    const [globalConfig] = (0, program_1.getGlobalConfigPda)();
    const [bondingCurve] = (0, program_1.getBondingCurvePda)(mint.publicKey);
    const [treasury] = (0, program_1.getTokenTreasuryPda)(mint.publicKey);
    const bondingCurveTokenAccount = (0, spl_token_1.getAssociatedTokenAddressSync)(mint.publicKey, bondingCurve, true, spl_token_1.TOKEN_2022_PROGRAM_ID);
    const treasuryTokenAccount = (0, program_1.getTreasuryTokenAccount)(mint.publicKey, treasury);
    const tx = new web3_js_1.Transaction();
    const provider = makeDummyProvider(connection, creator);
    const program = new anchor_1.Program(torch_market_json_1.default, provider);
    const createIx = await program.methods
        .createToken({ name, symbol, uri: metadata_uri })
        .accounts({
        creator,
        globalConfig,
        mint: mint.publicKey,
        bondingCurve,
        tokenVault: bondingCurveTokenAccount,
        treasury,
        treasuryTokenAccount,
        token2022Program: spl_token_1.TOKEN_2022_PROGRAM_ID,
        associatedTokenProgram: spl_token_1.ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: web3_js_1.SystemProgram.programId,
        rent: web3_js_1.SYSVAR_RENT_PUBKEY,
    })
        .instruction();
    tx.add(createIx);
    await finalizeTransaction(connection, tx, creator);
    // Partially sign with mint keypair
    tx.partialSign(mint);
    return {
        transaction: tx,
        mint: mint.publicKey,
        mintKeypair: mint,
        message: `Create token "${name}" ($${symbol})`,
    };
};
exports.buildCreateTokenTransaction = buildCreateTokenTransaction;
// ============================================================================
// Star
// ============================================================================
/**
 * Build an unsigned star transaction (costs 0.05 SOL).
 *
 * @param connection - Solana RPC connection
 * @param params - Star parameters (mint, user)
 * @returns Unsigned transaction and descriptive message
 */
const buildStarTransaction = async (connection, params) => {
    const { mint: mintStr, user: userStr, vault: vaultCreatorStr } = params;
    const mint = new web3_js_1.PublicKey(mintStr);
    const user = new web3_js_1.PublicKey(userStr);
    const tokenData = await (0, tokens_1.fetchTokenRaw)(connection, mint);
    if (!tokenData)
        throw new Error(`Token not found: ${mintStr}`);
    const { bondingCurve } = tokenData;
    if (user.equals(bondingCurve.creator)) {
        throw new Error('Cannot star your own token');
    }
    // Check if already starred
    const [starRecordPda] = (0, program_1.getStarRecordPda)(user, mint);
    const starRecord = await connection.getAccountInfo(starRecordPda);
    if (starRecord)
        throw new Error('Already starred this token');
    // Derive PDAs
    const [bondingCurvePda] = (0, program_1.getBondingCurvePda)(mint);
    const [treasuryPda] = (0, program_1.getTokenTreasuryPda)(mint);
    // [V18] Vault accounts (optional — vault pays star cost)
    let torchVaultAccount = null;
    let vaultWalletLinkAccount = null;
    if (vaultCreatorStr) {
        const vaultCreator = new web3_js_1.PublicKey(vaultCreatorStr);
        [torchVaultAccount] = (0, program_1.getTorchVaultPda)(vaultCreator);
        [vaultWalletLinkAccount] = (0, program_1.getVaultWalletLinkPda)(user);
    }
    const tx = new web3_js_1.Transaction();
    const provider = makeDummyProvider(connection, user);
    const program = new anchor_1.Program(torch_market_json_1.default, provider);
    const starIx = await program.methods
        .starToken()
        .accounts({
        user,
        mint,
        bondingCurve: bondingCurvePda,
        tokenTreasury: treasuryPda,
        creator: bondingCurve.creator,
        starRecord: starRecordPda,
        torchVault: torchVaultAccount,
        vaultWalletLink: vaultWalletLinkAccount,
        systemProgram: web3_js_1.SystemProgram.programId,
    })
        .instruction();
    tx.add(starIx);
    await finalizeTransaction(connection, tx, user);
    const vaultLabel = vaultCreatorStr ? ' (via vault)' : '';
    return {
        transaction: tx,
        message: `Star token (costs 0.05 SOL)${vaultLabel}`,
    };
};
exports.buildStarTransaction = buildStarTransaction;
// ============================================================================
// Message
// ============================================================================
const MAX_MESSAGE_LENGTH = 500;
// ============================================================================
// Vault (V2.0)
// ============================================================================
/**
 * Build an unsigned create vault transaction.
 *
 * Creates a TorchVault PDA and auto-links the creator's wallet.
 *
 * @param connection - Solana RPC connection
 * @param params - Creator public key
 * @returns Unsigned transaction
 */
const buildCreateVaultTransaction = async (connection, params) => {
    const creator = new web3_js_1.PublicKey(params.creator);
    const [vaultPda] = (0, program_1.getTorchVaultPda)(creator);
    const [walletLinkPda] = (0, program_1.getVaultWalletLinkPda)(creator);
    const provider = makeDummyProvider(connection, creator);
    const program = new anchor_1.Program(torch_market_json_1.default, provider);
    const ix = await program.methods
        .createVault()
        .accounts({
        creator,
        vault: vaultPda,
        walletLink: walletLinkPda,
        systemProgram: web3_js_1.SystemProgram.programId,
    })
        .instruction();
    const tx = new web3_js_1.Transaction().add(ix);
    await finalizeTransaction(connection, tx, creator);
    return {
        transaction: tx,
        message: `Create vault for ${params.creator.slice(0, 8)}...`,
    };
};
exports.buildCreateVaultTransaction = buildCreateVaultTransaction;
/**
 * Build an unsigned deposit vault transaction.
 *
 * Anyone can deposit SOL into any vault.
 *
 * @param connection - Solana RPC connection
 * @param params - Depositor, vault creator, amount in lamports
 * @returns Unsigned transaction
 */
const buildDepositVaultTransaction = async (connection, params) => {
    const depositor = new web3_js_1.PublicKey(params.depositor);
    const vaultCreator = new web3_js_1.PublicKey(params.vault_creator);
    const [vaultPda] = (0, program_1.getTorchVaultPda)(vaultCreator);
    const provider = makeDummyProvider(connection, depositor);
    const program = new anchor_1.Program(torch_market_json_1.default, provider);
    const ix = await program.methods
        .depositVault(new anchor_1.BN(params.amount_sol.toString()))
        .accounts({
        depositor,
        vault: vaultPda,
        systemProgram: web3_js_1.SystemProgram.programId,
    })
        .instruction();
    const tx = new web3_js_1.Transaction().add(ix);
    await finalizeTransaction(connection, tx, depositor);
    return {
        transaction: tx,
        message: `Deposit ${params.amount_sol / 1e9} SOL into vault`,
    };
};
exports.buildDepositVaultTransaction = buildDepositVaultTransaction;
/**
 * Build an unsigned withdraw vault transaction.
 *
 * Only the vault authority can withdraw.
 *
 * @param connection - Solana RPC connection
 * @param params - Authority, vault creator, amount in lamports
 * @returns Unsigned transaction
 */
const buildWithdrawVaultTransaction = async (connection, params) => {
    const authority = new web3_js_1.PublicKey(params.authority);
    const vaultCreator = new web3_js_1.PublicKey(params.vault_creator);
    const [vaultPda] = (0, program_1.getTorchVaultPda)(vaultCreator);
    const provider = makeDummyProvider(connection, authority);
    const program = new anchor_1.Program(torch_market_json_1.default, provider);
    const ix = await program.methods
        .withdrawVault(new anchor_1.BN(params.amount_sol.toString()))
        .accounts({
        authority,
        vault: vaultPda,
        systemProgram: web3_js_1.SystemProgram.programId,
    })
        .instruction();
    const tx = new web3_js_1.Transaction().add(ix);
    await finalizeTransaction(connection, tx, authority);
    return {
        transaction: tx,
        message: `Withdraw ${params.amount_sol / 1e9} SOL from vault`,
    };
};
exports.buildWithdrawVaultTransaction = buildWithdrawVaultTransaction;
/**
 * Build an unsigned link wallet transaction.
 *
 * Only the vault authority can link wallets.
 *
 * @param connection - Solana RPC connection
 * @param params - Authority, vault creator, wallet to link
 * @returns Unsigned transaction
 */
const buildLinkWalletTransaction = async (connection, params) => {
    const authority = new web3_js_1.PublicKey(params.authority);
    const vaultCreator = new web3_js_1.PublicKey(params.vault_creator);
    const walletToLink = new web3_js_1.PublicKey(params.wallet_to_link);
    const [vaultPda] = (0, program_1.getTorchVaultPda)(vaultCreator);
    const [walletLinkPda] = (0, program_1.getVaultWalletLinkPda)(walletToLink);
    const provider = makeDummyProvider(connection, authority);
    const program = new anchor_1.Program(torch_market_json_1.default, provider);
    const ix = await program.methods
        .linkWallet()
        .accounts({
        authority,
        vault: vaultPda,
        walletToLink,
        walletLink: walletLinkPda,
        systemProgram: web3_js_1.SystemProgram.programId,
    })
        .instruction();
    const tx = new web3_js_1.Transaction().add(ix);
    await finalizeTransaction(connection, tx, authority);
    return {
        transaction: tx,
        message: `Link wallet ${params.wallet_to_link.slice(0, 8)}... to vault`,
    };
};
exports.buildLinkWalletTransaction = buildLinkWalletTransaction;
/**
 * Build an unsigned unlink wallet transaction.
 *
 * Only the vault authority can unlink wallets. Rent returns to authority.
 *
 * @param connection - Solana RPC connection
 * @param params - Authority, vault creator, wallet to unlink
 * @returns Unsigned transaction
 */
const buildUnlinkWalletTransaction = async (connection, params) => {
    const authority = new web3_js_1.PublicKey(params.authority);
    const vaultCreator = new web3_js_1.PublicKey(params.vault_creator);
    const walletToUnlink = new web3_js_1.PublicKey(params.wallet_to_unlink);
    const [vaultPda] = (0, program_1.getTorchVaultPda)(vaultCreator);
    const [walletLinkPda] = (0, program_1.getVaultWalletLinkPda)(walletToUnlink);
    const provider = makeDummyProvider(connection, authority);
    const program = new anchor_1.Program(torch_market_json_1.default, provider);
    const ix = await program.methods
        .unlinkWallet()
        .accounts({
        authority,
        vault: vaultPda,
        walletToUnlink,
        walletLink: walletLinkPda,
        systemProgram: web3_js_1.SystemProgram.programId,
    })
        .instruction();
    const tx = new web3_js_1.Transaction().add(ix);
    await finalizeTransaction(connection, tx, authority);
    return {
        transaction: tx,
        message: `Unlink wallet ${params.wallet_to_unlink.slice(0, 8)}... from vault`,
    };
};
exports.buildUnlinkWalletTransaction = buildUnlinkWalletTransaction;
/**
 * Build an unsigned transfer authority transaction.
 *
 * Transfers vault admin control to a new wallet.
 *
 * @param connection - Solana RPC connection
 * @param params - Current authority, vault creator, new authority
 * @returns Unsigned transaction
 */
const buildTransferAuthorityTransaction = async (connection, params) => {
    const authority = new web3_js_1.PublicKey(params.authority);
    const vaultCreator = new web3_js_1.PublicKey(params.vault_creator);
    const newAuthority = new web3_js_1.PublicKey(params.new_authority);
    const [vaultPda] = (0, program_1.getTorchVaultPda)(vaultCreator);
    const provider = makeDummyProvider(connection, authority);
    const program = new anchor_1.Program(torch_market_json_1.default, provider);
    const ix = await program.methods
        .transferAuthority()
        .accounts({
        authority,
        vault: vaultPda,
        newAuthority,
    })
        .instruction();
    const tx = new web3_js_1.Transaction().add(ix);
    await finalizeTransaction(connection, tx, authority);
    return {
        transaction: tx,
        message: `Transfer vault authority to ${params.new_authority.slice(0, 8)}...`,
    };
};
exports.buildTransferAuthorityTransaction = buildTransferAuthorityTransaction;
// ============================================================================
// Borrow (V2.4)
// ============================================================================
/**
 * Build an unsigned borrow transaction.
 *
 * Lock tokens as collateral in the collateral vault and receive SOL from treasury.
 * Token must be migrated (has Raydium pool for price calculation).
 *
 * @param connection - Solana RPC connection
 * @param params - Borrow parameters (mint, borrower, collateral_amount, sol_to_borrow)
 * @returns Unsigned transaction and descriptive message
 */
const buildBorrowTransaction = async (connection, params) => {
    const { mint: mintStr, borrower: borrowerStr, collateral_amount, sol_to_borrow, vault: vaultCreatorStr } = params;
    const mint = new web3_js_1.PublicKey(mintStr);
    const borrower = new web3_js_1.PublicKey(borrowerStr);
    // Derive PDAs
    const [bondingCurvePda] = (0, program_1.getBondingCurvePda)(mint);
    const [treasuryPda] = (0, program_1.getTokenTreasuryPda)(mint);
    const [collateralVaultPda] = (0, program_1.getCollateralVaultPda)(mint);
    const [loanPositionPda] = (0, program_1.getLoanPositionPda)(mint, borrower);
    const borrowerTokenAccount = (0, spl_token_1.getAssociatedTokenAddressSync)(mint, borrower, false, spl_token_1.TOKEN_2022_PROGRAM_ID);
    // Get Raydium pool accounts for price calculation
    const raydium = (0, program_1.getRaydiumMigrationAccounts)(mint);
    // [V18] Vault accounts (optional — collateral from vault ATA, SOL to vault)
    let torchVaultAccount = null;
    let vaultWalletLinkAccount = null;
    let vaultTokenAccount = null;
    if (vaultCreatorStr) {
        const vaultCreator = new web3_js_1.PublicKey(vaultCreatorStr);
        [torchVaultAccount] = (0, program_1.getTorchVaultPda)(vaultCreator);
        [vaultWalletLinkAccount] = (0, program_1.getVaultWalletLinkPda)(borrower);
        vaultTokenAccount = (0, spl_token_1.getAssociatedTokenAddressSync)(mint, torchVaultAccount, true, spl_token_1.TOKEN_2022_PROGRAM_ID);
    }
    const tx = new web3_js_1.Transaction();
    // Create vault ATA if needed
    if (vaultTokenAccount && torchVaultAccount) {
        tx.add((0, spl_token_1.createAssociatedTokenAccountIdempotentInstruction)(borrower, vaultTokenAccount, torchVaultAccount, mint, spl_token_1.TOKEN_2022_PROGRAM_ID, spl_token_1.ASSOCIATED_TOKEN_PROGRAM_ID));
    }
    const provider = makeDummyProvider(connection, borrower);
    const program = new anchor_1.Program(torch_market_json_1.default, provider);
    const borrowIx = await program.methods
        .borrow({
        collateralAmount: new anchor_1.BN(collateral_amount.toString()),
        solToBorrow: new anchor_1.BN(sol_to_borrow.toString()),
    })
        .accounts({
        borrower,
        mint,
        bondingCurve: bondingCurvePda,
        treasury: treasuryPda,
        collateralVault: collateralVaultPda,
        borrowerTokenAccount,
        loanPosition: loanPositionPda,
        poolState: raydium.poolState,
        tokenVault0: raydium.token0Vault,
        tokenVault1: raydium.token1Vault,
        torchVault: torchVaultAccount,
        vaultWalletLink: vaultWalletLinkAccount,
        vaultTokenAccount,
        tokenProgram: spl_token_1.TOKEN_2022_PROGRAM_ID,
        systemProgram: web3_js_1.SystemProgram.programId,
    })
        .instruction();
    tx.add(borrowIx);
    await finalizeTransaction(connection, tx, borrower);
    const vaultLabel = vaultCreatorStr ? ' (via vault)' : '';
    return {
        transaction: tx,
        message: `Borrow ${Number(sol_to_borrow) / 1e9} SOL with ${Number(collateral_amount) / 1e6} tokens as collateral${vaultLabel}`,
    };
};
exports.buildBorrowTransaction = buildBorrowTransaction;
// ============================================================================
// Repay (V2.4)
// ============================================================================
/**
 * Build an unsigned repay transaction.
 *
 * Repay SOL debt. Interest is paid first, then principal.
 * Full repay returns all collateral and closes the position.
 *
 * @param connection - Solana RPC connection
 * @param params - Repay parameters (mint, borrower, sol_amount)
 * @returns Unsigned transaction and descriptive message
 */
const buildRepayTransaction = async (connection, params) => {
    const { mint: mintStr, borrower: borrowerStr, sol_amount, vault: vaultCreatorStr } = params;
    const mint = new web3_js_1.PublicKey(mintStr);
    const borrower = new web3_js_1.PublicKey(borrowerStr);
    // Derive PDAs
    const [treasuryPda] = (0, program_1.getTokenTreasuryPda)(mint);
    const [collateralVaultPda] = (0, program_1.getCollateralVaultPda)(mint);
    const [loanPositionPda] = (0, program_1.getLoanPositionPda)(mint, borrower);
    const borrowerTokenAccount = (0, spl_token_1.getAssociatedTokenAddressSync)(mint, borrower, false, spl_token_1.TOKEN_2022_PROGRAM_ID);
    // [V18] Vault accounts (optional — SOL from vault, collateral returns to vault ATA)
    let torchVaultAccount = null;
    let vaultWalletLinkAccount = null;
    let vaultTokenAccount = null;
    if (vaultCreatorStr) {
        const vaultCreator = new web3_js_1.PublicKey(vaultCreatorStr);
        [torchVaultAccount] = (0, program_1.getTorchVaultPda)(vaultCreator);
        [vaultWalletLinkAccount] = (0, program_1.getVaultWalletLinkPda)(borrower);
        vaultTokenAccount = (0, spl_token_1.getAssociatedTokenAddressSync)(mint, torchVaultAccount, true, spl_token_1.TOKEN_2022_PROGRAM_ID);
    }
    const tx = new web3_js_1.Transaction();
    // Create vault ATA if needed (collateral returns here)
    if (vaultTokenAccount && torchVaultAccount) {
        tx.add((0, spl_token_1.createAssociatedTokenAccountIdempotentInstruction)(borrower, vaultTokenAccount, torchVaultAccount, mint, spl_token_1.TOKEN_2022_PROGRAM_ID, spl_token_1.ASSOCIATED_TOKEN_PROGRAM_ID));
    }
    const provider = makeDummyProvider(connection, borrower);
    const program = new anchor_1.Program(torch_market_json_1.default, provider);
    const repayIx = await program.methods
        .repay(new anchor_1.BN(sol_amount.toString()))
        .accounts({
        borrower,
        mint,
        treasury: treasuryPda,
        collateralVault: collateralVaultPda,
        borrowerTokenAccount,
        loanPosition: loanPositionPda,
        torchVault: torchVaultAccount,
        vaultWalletLink: vaultWalletLinkAccount,
        vaultTokenAccount,
        tokenProgram: spl_token_1.TOKEN_2022_PROGRAM_ID,
        systemProgram: web3_js_1.SystemProgram.programId,
    })
        .instruction();
    tx.add(repayIx);
    await finalizeTransaction(connection, tx, borrower);
    const vaultLabel = vaultCreatorStr ? ' (via vault)' : '';
    return {
        transaction: tx,
        message: `Repay ${Number(sol_amount) / 1e9} SOL${vaultLabel}`,
    };
};
exports.buildRepayTransaction = buildRepayTransaction;
// ============================================================================
// Liquidate (V2.4)
// ============================================================================
/**
 * Build an unsigned liquidate transaction.
 *
 * Permissionless — anyone can call when a borrower's LTV exceeds the
 * liquidation threshold. Liquidator pays SOL and receives collateral + bonus.
 *
 * @param connection - Solana RPC connection
 * @param params - Liquidate parameters (mint, liquidator, borrower)
 * @returns Unsigned transaction and descriptive message
 */
const buildLiquidateTransaction = async (connection, params) => {
    const { mint: mintStr, liquidator: liquidatorStr, borrower: borrowerStr, vault: vaultCreatorStr } = params;
    const mint = new web3_js_1.PublicKey(mintStr);
    const liquidator = new web3_js_1.PublicKey(liquidatorStr);
    const borrower = new web3_js_1.PublicKey(borrowerStr);
    // Derive PDAs
    const [bondingCurvePda] = (0, program_1.getBondingCurvePda)(mint);
    const [treasuryPda] = (0, program_1.getTokenTreasuryPda)(mint);
    const [collateralVaultPda] = (0, program_1.getCollateralVaultPda)(mint);
    const [loanPositionPda] = (0, program_1.getLoanPositionPda)(mint, borrower);
    const liquidatorTokenAccount = (0, spl_token_1.getAssociatedTokenAddressSync)(mint, liquidator, false, spl_token_1.TOKEN_2022_PROGRAM_ID);
    // Get Raydium pool accounts for price calculation
    const raydium = (0, program_1.getRaydiumMigrationAccounts)(mint);
    // [V20] Vault accounts (optional — SOL from vault, collateral to vault ATA)
    let torchVaultAccount = null;
    let vaultWalletLinkAccount = null;
    let vaultTokenAccount = null;
    if (vaultCreatorStr) {
        const vaultCreator = new web3_js_1.PublicKey(vaultCreatorStr);
        [torchVaultAccount] = (0, program_1.getTorchVaultPda)(vaultCreator);
        [vaultWalletLinkAccount] = (0, program_1.getVaultWalletLinkPda)(liquidator);
        vaultTokenAccount = (0, spl_token_1.getAssociatedTokenAddressSync)(mint, torchVaultAccount, true, spl_token_1.TOKEN_2022_PROGRAM_ID);
    }
    const tx = new web3_js_1.Transaction();
    // Create liquidator ATA if needed
    tx.add((0, spl_token_1.createAssociatedTokenAccountIdempotentInstruction)(liquidator, liquidatorTokenAccount, liquidator, mint, spl_token_1.TOKEN_2022_PROGRAM_ID, spl_token_1.ASSOCIATED_TOKEN_PROGRAM_ID));
    // Create vault ATA if needed (collateral goes here)
    if (vaultTokenAccount && torchVaultAccount) {
        tx.add((0, spl_token_1.createAssociatedTokenAccountIdempotentInstruction)(liquidator, vaultTokenAccount, torchVaultAccount, mint, spl_token_1.TOKEN_2022_PROGRAM_ID, spl_token_1.ASSOCIATED_TOKEN_PROGRAM_ID));
    }
    const provider = makeDummyProvider(connection, liquidator);
    const program = new anchor_1.Program(torch_market_json_1.default, provider);
    const liquidateIx = await program.methods
        .liquidate()
        .accounts({
        liquidator,
        borrower,
        mint,
        bondingCurve: bondingCurvePda,
        treasury: treasuryPda,
        collateralVault: collateralVaultPda,
        liquidatorTokenAccount,
        loanPosition: loanPositionPda,
        poolState: raydium.poolState,
        tokenVault0: raydium.token0Vault,
        tokenVault1: raydium.token1Vault,
        torchVault: torchVaultAccount,
        vaultWalletLink: vaultWalletLinkAccount,
        vaultTokenAccount,
        tokenProgram: spl_token_1.TOKEN_2022_PROGRAM_ID,
        associatedTokenProgram: spl_token_1.ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: web3_js_1.SystemProgram.programId,
    })
        .instruction();
    tx.add(liquidateIx);
    await finalizeTransaction(connection, tx, liquidator);
    const vaultLabel = vaultCreatorStr ? ' (via vault)' : '';
    return {
        transaction: tx,
        message: `Liquidate loan position for ${borrowerStr.slice(0, 8)}...${vaultLabel}`,
    };
};
exports.buildLiquidateTransaction = buildLiquidateTransaction;
// ============================================================================
// Claim Protocol Rewards
// ============================================================================
/**
 * Build an unsigned claim protocol rewards transaction.
 *
 * Claims the user's proportional share of protocol treasury rewards
 * based on trading volume in the previous epoch. Requires >= 10 SOL volume.
 *
 * @param connection - Solana RPC connection
 * @param params - Claim parameters (user, optional vault)
 * @returns Unsigned transaction and descriptive message
 */
const buildClaimProtocolRewardsTransaction = async (connection, params) => {
    const { user: userStr, vault: vaultCreatorStr } = params;
    const user = new web3_js_1.PublicKey(userStr);
    // Derive PDAs
    const [userStatsPda] = (0, program_1.getUserStatsPda)(user);
    const [protocolTreasuryPda] = (0, program_1.getProtocolTreasuryPda)();
    // [V20] Vault accounts (optional — rewards go to vault instead of user)
    let torchVaultAccount = null;
    let vaultWalletLinkAccount = null;
    if (vaultCreatorStr) {
        const vaultCreator = new web3_js_1.PublicKey(vaultCreatorStr);
        [torchVaultAccount] = (0, program_1.getTorchVaultPda)(vaultCreator);
        [vaultWalletLinkAccount] = (0, program_1.getVaultWalletLinkPda)(user);
    }
    const tx = new web3_js_1.Transaction();
    const provider = makeDummyProvider(connection, user);
    const program = new anchor_1.Program(torch_market_json_1.default, provider);
    const claimIx = await program.methods
        .claimProtocolRewards()
        .accounts({
        user,
        userStats: userStatsPda,
        protocolTreasury: protocolTreasuryPda,
        torchVault: torchVaultAccount,
        vaultWalletLink: vaultWalletLinkAccount,
        systemProgram: web3_js_1.SystemProgram.programId,
    })
        .instruction();
    tx.add(claimIx);
    await finalizeTransaction(connection, tx, user);
    const vaultLabel = vaultCreatorStr ? ' (via vault)' : '';
    return {
        transaction: tx,
        message: `Claim protocol rewards${vaultLabel}`,
    };
};
exports.buildClaimProtocolRewardsTransaction = buildClaimProtocolRewardsTransaction;
// ============================================================================
// Withdraw Tokens (V18)
// ============================================================================
/**
 * Build an unsigned withdraw tokens transaction.
 *
 * Withdraw tokens from a vault ATA to any destination token account.
 * Authority only. Composability escape hatch for external DeFi.
 *
 * @param connection - Solana RPC connection
 * @param params - Authority, vault creator, mint, destination, amount in raw units
 * @returns Unsigned transaction
 */
const buildWithdrawTokensTransaction = async (connection, params) => {
    const authority = new web3_js_1.PublicKey(params.authority);
    const vaultCreator = new web3_js_1.PublicKey(params.vault_creator);
    const mint = new web3_js_1.PublicKey(params.mint);
    const destination = new web3_js_1.PublicKey(params.destination);
    const [vaultPda] = (0, program_1.getTorchVaultPda)(vaultCreator);
    const vaultTokenAccount = (0, spl_token_1.getAssociatedTokenAddressSync)(mint, vaultPda, true, spl_token_1.TOKEN_2022_PROGRAM_ID);
    const destinationTokenAccount = (0, spl_token_1.getAssociatedTokenAddressSync)(mint, destination, false, spl_token_1.TOKEN_2022_PROGRAM_ID);
    const tx = new web3_js_1.Transaction();
    // Create destination ATA if needed
    tx.add((0, spl_token_1.createAssociatedTokenAccountIdempotentInstruction)(authority, destinationTokenAccount, destination, mint, spl_token_1.TOKEN_2022_PROGRAM_ID, spl_token_1.ASSOCIATED_TOKEN_PROGRAM_ID));
    const provider = makeDummyProvider(connection, authority);
    const program = new anchor_1.Program(torch_market_json_1.default, provider);
    const ix = await program.methods
        .withdrawTokens(new anchor_1.BN(params.amount.toString()))
        .accounts({
        authority,
        vault: vaultPda,
        mint,
        vaultTokenAccount,
        destinationTokenAccount,
        tokenProgram: spl_token_1.TOKEN_2022_PROGRAM_ID,
    })
        .instruction();
    tx.add(ix);
    await finalizeTransaction(connection, tx, authority);
    return {
        transaction: tx,
        message: `Withdraw ${params.amount} tokens from vault to ${params.destination.slice(0, 8)}...`,
    };
};
exports.buildWithdrawTokensTransaction = buildWithdrawTokensTransaction;
// ============================================================================
// Vault Swap (V19)
// ============================================================================
/**
 * Build an unsigned vault-routed DEX swap transaction.
 *
 * Executes a Raydium CPMM swap through the vault PDA for migrated Torch tokens.
 * Full custody preserved — all value flows through the vault.
 *
 * @param connection - Solana RPC connection
 * @param params - Swap parameters (mint, signer, vault_creator, amount_in, minimum_amount_out, is_buy)
 * @returns Unsigned transaction and descriptive message
 */
const buildVaultSwapTransaction = async (connection, params) => {
    const { mint: mintStr, signer: signerStr, vault_creator: vaultCreatorStr, amount_in, minimum_amount_out, is_buy } = params;
    const mint = new web3_js_1.PublicKey(mintStr);
    const signer = new web3_js_1.PublicKey(signerStr);
    const vaultCreator = new web3_js_1.PublicKey(vaultCreatorStr);
    // Derive vault PDAs
    const [torchVaultPda] = (0, program_1.getTorchVaultPda)(vaultCreator);
    const [vaultWalletLinkPda] = (0, program_1.getVaultWalletLinkPda)(signer);
    const [bondingCurvePda] = (0, program_1.getBondingCurvePda)(mint);
    // Vault's token ATA (Token-2022)
    const vaultTokenAccount = (0, spl_token_1.getAssociatedTokenAddressSync)(mint, torchVaultPda, true, spl_token_1.TOKEN_2022_PROGRAM_ID);
    // Vault's WSOL ATA (SPL Token — persistent, reused across swaps)
    const vaultWsolAccount = (0, spl_token_1.getAssociatedTokenAddressSync)(constants_1.WSOL_MINT, torchVaultPda, true, spl_token_1.TOKEN_PROGRAM_ID);
    // Raydium pool accounts
    const raydium = (0, program_1.getRaydiumMigrationAccounts)(mint);
    const tx = new web3_js_1.Transaction();
    // Create vault token ATA if needed (for first buy of a migrated token)
    tx.add((0, spl_token_1.createAssociatedTokenAccountIdempotentInstruction)(signer, vaultTokenAccount, torchVaultPda, mint, spl_token_1.TOKEN_2022_PROGRAM_ID, spl_token_1.ASSOCIATED_TOKEN_PROGRAM_ID));
    // Create vault WSOL ATA if needed (persistent — reused across swaps)
    tx.add((0, spl_token_1.createAssociatedTokenAccountIdempotentInstruction)(signer, vaultWsolAccount, torchVaultPda, constants_1.WSOL_MINT, spl_token_1.TOKEN_PROGRAM_ID, spl_token_1.ASSOCIATED_TOKEN_PROGRAM_ID));
    const provider = makeDummyProvider(connection, signer);
    const program = new anchor_1.Program(torch_market_json_1.default, provider);
    // On buy: fund WSOL with lamports from vault in a separate instruction
    // (isolates direct lamport manipulation from CPIs to avoid runtime balance errors)
    if (is_buy) {
        const fundIx = await program.methods
            .fundVaultWsol(new anchor_1.BN(amount_in.toString()))
            .accounts({
            signer,
            torchVault: torchVaultPda,
            vaultWalletLink: vaultWalletLinkPda,
            vaultWsolAccount,
        })
            .instruction();
        tx.add(fundIx);
    }
    const swapIx = await program.methods
        .vaultSwap(new anchor_1.BN(amount_in.toString()), new anchor_1.BN(minimum_amount_out.toString()), is_buy)
        .accounts({
        signer,
        torchVault: torchVaultPda,
        vaultWalletLink: vaultWalletLinkPda,
        mint,
        bondingCurve: bondingCurvePda,
        vaultTokenAccount,
        vaultWsolAccount,
        raydiumProgram: constants_1.RAYDIUM_CPMM_PROGRAM,
        raydiumAuthority: raydium.raydiumAuthority,
        ammConfig: constants_1.RAYDIUM_AMM_CONFIG,
        poolState: raydium.poolState,
        poolTokenVault0: raydium.token0Vault,
        poolTokenVault1: raydium.token1Vault,
        observationState: raydium.observationState,
        wsolMint: constants_1.WSOL_MINT,
        tokenProgram: spl_token_1.TOKEN_PROGRAM_ID,
        token2022Program: spl_token_1.TOKEN_2022_PROGRAM_ID,
        associatedTokenProgram: spl_token_1.ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: web3_js_1.SystemProgram.programId,
    })
        .instruction();
    tx.add(swapIx);
    await finalizeTransaction(connection, tx, signer);
    const direction = is_buy ? 'Buy' : 'Sell';
    const amountLabel = is_buy
        ? `${amount_in / 1e9} SOL`
        : `${amount_in / 1e6} tokens`;
    return {
        transaction: tx,
        message: `${direction} ${amountLabel} via vault DEX swap`,
    };
};
exports.buildVaultSwapTransaction = buildVaultSwapTransaction;
//# sourceMappingURL=transactions.js.map