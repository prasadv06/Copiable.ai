import { CopyTradeEngine } from '../trading/CopyTradeEngine.js';
import { StrategyAgent } from '../agents/StrategyAgent.js';
import { logger } from '../utils/logger.js';

/**
 * Demo Simulation Script
 * 
 * Demonstrates the full copy trading pipeline:
 * 1. Creates a lead trader wallet
 * 2. Creates multiple user wallets
 * 3. Users subscribe to the trader
 * 4. Simulates a trade detection
 * 5. AI agents analyze and decide
 * 6. Mirrors trades + distributes profit
 */
async function runDemo() {
    console.log('\n');
    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║   🏛️ AUTONOMOUS COPY TRADING SYNDICATE — DEMO              ║');
    console.log('║   Tether Hackathon Galáctica: WDK Edition 1                ║');
    console.log('╚══════════════════════════════════════════════════════════════╝');
    console.log('\n');

    const engine = new CopyTradeEngine();

    // ── Step 1: Create Wallets ────────────────────────────
    console.log('━'.repeat(60));
    console.log('  STEP 1: Creating Wallets via WDK');
    console.log('━'.repeat(60));

    const leadTrader = await engine.walletService.createWallet('Lead Trader (Alpha)', true);
    console.log(`  ✅ Lead Trader: ${leadTrader.address}`);
    console.log(`     Label: ${leadTrader.label}`);
    console.log(`     Seed: ${leadTrader.seedPhrase.split(' ').slice(0, 3).join(' ')}... [hidden]\n`);

    const user1 = await engine.walletService.createWallet('User Alice', false);
    console.log(`  ✅ User Alice:  ${user1.address}`);

    const user2 = await engine.walletService.createWallet('User Bob', false);
    console.log(`  ✅ User Bob:    ${user2.address}`);

    const user3 = await engine.walletService.createWallet('User Carol', false);
    console.log(`  ✅ User Carol:  ${user3.address}\n`);

    // ── Step 2: Check Balances ────────────────────────────
    console.log('━'.repeat(60));
    console.log('  STEP 2: Checking Wallet Balances (Sepolia)');
    console.log('━'.repeat(60));

    for (const wallet of [leadTrader, user1, user2, user3]) {
        const bal = await engine.walletService.getBalance(wallet.address);
        console.log(`  ${wallet.label}: ${bal.ethBalance} ETH | ${bal.usdtBalance} USDt`);
    }
    console.log('');

    // ── Step 3: Subscribe Users ───────────────────────────
    console.log('━'.repeat(60));
    console.log('  STEP 3: Subscribing Users to Lead Trader');
    console.log('━'.repeat(60));

    engine.subscriptionManager.subscribe(user1.id, leadTrader.address, '1.0');
    console.log(`  🔔 Alice subscribed (max trade: 1.0 ETH)`);

    engine.subscriptionManager.subscribe(user2.id, leadTrader.address, '0.5');
    console.log(`  🔔 Bob subscribed (max trade: 0.5 ETH)`);

    engine.subscriptionManager.subscribe(user3.id, leadTrader.address);
    console.log(`  🔔 Carol subscribed (no max trade limit)\n`);

    // ── Step 4: Simulate Trade Detection ──────────────────
    console.log('━'.repeat(60));
    console.log('  STEP 4: Simulating Trade from Lead Trader');
    console.log('━'.repeat(60));
    console.log('  Lead trader executes swap: WETH → USDt');
    console.log('  Amount: 0.5 WETH → ~950 USDt\n');

    // ── Step 5: Run Agent Pipeline ────────────────────────
    console.log('━'.repeat(60));
    console.log('  STEP 5: AI Agent Pipeline Processing');
    console.log('━'.repeat(60));
    console.log('');

    const result = await engine.processSimulatedTrade(leadTrader.address);

    // ── Step 6: Display Results ───────────────────────────
    console.log('\n');
    console.log('━'.repeat(60));
    console.log('  STEP 6: Pipeline Results Summary');
    console.log('━'.repeat(60));

    console.log(`\n  Trade: ${result.tradeEvent.tokenIn.symbol} → ${result.tradeEvent.tokenOut.symbol}`);
    console.log(`  Amount: ${result.tradeEvent.amountIn} ${result.tradeEvent.tokenIn.symbol}`);

    console.log(`\n  Risk Assessment:`);
    console.log(`    Overall Score: ${result.riskAssessment.overallScore}/100`);
    console.log(`    Approved: ${result.riskAssessment.approved ? '✅ YES' : '❌ NO'}`);
    console.log(`    Liquidity:  ${result.riskAssessment.liquidityScore}/100`);
    console.log(`    Slippage:   ${result.riskAssessment.slippageScore}/100`);
    console.log(`    Trade Size: ${result.riskAssessment.tradeSizeScore}/100`);
    console.log(`    Gas Cost:   ${result.riskAssessment.gasCostScore}/100`);
    console.log(`    Token Risk: ${result.riskAssessment.tokenRiskScore}/100`);

    console.log(`\n  Executions: ${result.executions.length}`);
    for (const exec of result.executions) {
        const status = exec.success ? '✅' : '❌';
        console.log(`    ${status} ${exec.walletAddress.slice(0, 10)}... — ${exec.amountMirrored} mirrored`);
        if (exec.txHash) console.log(`       tx: ${exec.txHash.slice(0, 16)}...`);
    }

    console.log(`\n  Profit Shares: ${result.profitShares.length}`);
    for (const share of result.profitShares) {
        const status = share.success ? '💰' : '❌';
        console.log(`    ${status} ${share.amount} ETH → Lead Trader`);
    }

    console.log(`\n  Pipeline Time: ${result.totalTimeMs}ms`);

    // ── Reasoning Log ─────────────────────────────────────
    console.log('\n');
    console.log('━'.repeat(60));
    console.log('  AGENT REASONING LOG');
    console.log('━'.repeat(60));

    for (const entry of result.reasoningLog) {
        const time = new Date(entry.timestamp).toLocaleTimeString();
        console.log(`  [${time}] ${entry.agent}: ${entry.message}`);
    }

    // ── Simulate a RISKY trade (should be rejected) ───────
    console.log('\n\n');
    console.log('━'.repeat(60));
    console.log('  BONUS: Simulating RISKY Trade (expected: REJECTED)');
    console.log('━'.repeat(60));

    const riskyTrade = StrategyAgent.createSimulatedTrade(leadTrader.address, {
        tokenIn: { address: '0xdeadbeef00000000000000000000000000000000', symbol: 'SCAM', decimals: 18 },
        tokenOut: { address: '0xdeadbeef00000000000000000000000000000001', symbol: 'RUG', decimals: 18 },
        amountIn: '150.0',
        amountOut: '1',
        gasUsed: '500000',
        gasPriceGwei: '100',
    });

    const riskyResult = await engine.processTrade(riskyTrade);
    console.log(`\n  Risk Score: ${riskyResult.riskAssessment.overallScore}/100`);
    console.log(`  Decision: ${riskyResult.riskAssessment.approved ? '✅ APPROVED' : '❌ REJECTED'}`);
    console.log(`  Warnings:`);
    for (const warning of riskyResult.riskAssessment.warnings) {
        console.log(`    ⚠️  ${warning}`);
    }

    console.log('\n');
    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║   ✅ DEMO COMPLETE                                          ║');
    console.log('║   All agents demonstrated autonomous decision-making        ║');
    console.log('║   with transparent reasoning logs.                          ║');
    console.log('╚══════════════════════════════════════════════════════════════╝');
    console.log('\n');
}

runDemo().catch(error => {
    logger.error(`Demo failed: ${error}`);
    process.exit(1);
});
