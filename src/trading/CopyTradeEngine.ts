import { WalletService } from '../wallet/WalletService.js';
import { AgentOrchestrator } from '../agents/AgentOrchestrator.js';
import { SubscriptionManager } from '../subscription/SubscriptionManager.js';
import { JsonStore } from '../storage/JsonStore.js';
import { StrategyAgent } from '../agents/StrategyAgent.js';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import type { PipelineResult, TradeHistoryEntry, TradeDetectedEvent } from '../agents/types.js';

/**
 * CopyTradeEngine — Main orchestrator for the copy trading system.
 *
 * Coordinates:
 * 1. Wallet connect + WDK wallet creation
 * 2. Following lead traders (any Sepolia address)
 * 3. Live monitoring (polls blockchain every 15 sec)
 * 4. Agent pipeline execution
 * 5. Persistent storage via JsonStore
 */
export class CopyTradeEngine {
    public walletService: WalletService;
    public orchestrator: AgentOrchestrator;
    public subscriptionManager: SubscriptionManager;
    public store: JsonStore;
    private tradeHistory: TradeHistoryEntry[] = [];
    private monitorInterval: ReturnType<typeof setInterval> | null = null;
    private isRunning = false;
    private trackedTraders: Map<string, { address: string; label: string; trackedAt: string }> = new Map();

    constructor() {
        this.store = new JsonStore();
        this.walletService = new WalletService();
        this.orchestrator = new AgentOrchestrator(this.walletService);
        this.subscriptionManager = new SubscriptionManager();

        // Restore wallets and subscriptions from store
        this.restoreFromStore();
    }

    /**
     * Restore state from persistent storage on startup.
     */
    private async restoreFromStore(): Promise<void> {
        const wallets = this.store.getAllWallets();
        if (wallets.length > 0) {
            logger.info(`📂 Restoring ${wallets.length} wallet(s) from store...`);
            for (const w of wallets) {
                try {
                    await this.walletService.importWallet(w.label, w.seedPhrase, w.isLeadTrader, w.id);
                    logger.info(`  ✅ Restored: ${w.label} (${w.address.slice(0, 8)}...)`);
                } catch (err) {
                    logger.warn(`  ⚠️ Failed to restore wallet ${w.label}: ${err}`);
                }
            }
        }

        const subs = this.store.getSubscriptions();
        for (const sub of subs) {
            try {
                this.subscriptionManager.subscribe(sub.subscriberWalletId, sub.traderAddress, sub.maxTradeSize);
            } catch {
                // Already exists or invalid
            }
        }

        const follows = this.store.getActiveFollows();
        if (follows.length > 0) {
            logger.info(`📂 Restored ${follows.length} active follow(s)`);
            // Auto-start monitoring if there are active follows
            if (!this.isRunning) {
                logger.info(`▶️ Auto-starting monitor engine (${follows.length} active follow(s))...`);
                this.start();
            }
        }
    }

    // ─── Wallet Connect ─────────────────────────────────────────

    /**
     * Connect a wallet (MetaMask) and create a mapped WDK wallet.
     * If user already connected before, returns the existing WDK wallet.
     */
    async connectWallet(connectedAddress: string): Promise<{
        isNew: boolean;
        user: { connectedAddress: string; wdkAddress: string; label: string };
        wdkWallet: { id: string; address: string; seedPhrase: string };
    }> {
        const addr = connectedAddress.toLowerCase();

        // Check if user already exists
        const existing = this.store.getUser(addr);
        if (existing) {
            const wallet = this.walletService.getWallet(existing.wdkWalletId);
            if (wallet) {
                logger.info(`🔄 Returning existing WDK wallet for ${addr.slice(0, 8)}...`);
                return {
                    isNew: false,
                    user: { connectedAddress: addr, wdkAddress: existing.wdkAddress, label: existing.label },
                    wdkWallet: { id: wallet.id, address: wallet.address, seedPhrase: wallet.seedPhrase },
                };
            }
            // Wallet not in memory — re-import from store
            const storedWallet = this.store.getWallet(existing.wdkWalletId);
            if (storedWallet) {
                const imported = await this.walletService.importWallet(
                    storedWallet.label, storedWallet.seedPhrase, false
                );
                return {
                    isNew: false,
                    user: { connectedAddress: addr, wdkAddress: imported.address, label: storedWallet.label },
                    wdkWallet: { id: imported.id, address: imported.address, seedPhrase: imported.seedPhrase },
                };
            }
        }

        // New user — create WDK wallet
        const label = `WDK Wallet (${addr.slice(0, 6)}...${addr.slice(-4)})`;
        const wdkWallet = await this.walletService.createWallet(label, false);

        // Persist to store
        this.store.setUser({
            connectedAddress: addr,
            wdkWalletId: wdkWallet.id,
            wdkAddress: wdkWallet.address,
            seedPhrase: wdkWallet.seedPhrase,
            label,
            createdAt: new Date().toISOString(),
        });

        this.store.setWallet({
            id: wdkWallet.id,
            label: wdkWallet.label,
            address: wdkWallet.address,
            seedPhrase: wdkWallet.seedPhrase,
            isLeadTrader: false,
            createdAt: wdkWallet.createdAt,
            connectedAddress: addr,
        });

        logger.info(`🔑 New WDK wallet created for connected address ${addr.slice(0, 8)}... → ${wdkWallet.address.slice(0, 8)}...`);

        return {
            isNew: true,
            user: { connectedAddress: addr, wdkAddress: wdkWallet.address, label },
            wdkWallet: { id: wdkWallet.id, address: wdkWallet.address, seedPhrase: wdkWallet.seedPhrase },
        };
    }

    // ─── Follow a Trader ────────────────────────────────────────

    /**
     * Follow any Sepolia address as a lead trader for live monitoring.
     */
    followTrader(traderAddress: string, followedBy: string, label?: string): {
        traderAddress: string; label: string; active: boolean;
    } {
        const trader = traderAddress.toLowerCase();
        const user = followedBy.toLowerCase();

        const record = {
            traderAddress: trader,
            label: label || `Trader (${trader.slice(0, 6)}...${trader.slice(-4)})`,
            followedBy: user,
            startedAt: new Date().toISOString(),
            active: true,
        };

        this.store.follow(record);

        // Also subscribe the user's WDK wallet to this trader
        const userData = this.store.getUser(user);
        if (userData) {
            try {
                this.subscriptionManager.subscribe(userData.wdkWalletId, trader);
                this.store.addSubscription({
                    id: `${userData.wdkWalletId}-${trader}`,
                    subscriberWalletId: userData.wdkWalletId,
                    traderAddress: trader,
                    createdAt: new Date().toISOString(),
                });
            } catch {
                // May already be subscribed
            }
        }

        logger.info(`👁️ ${user.slice(0, 8)}... now following trader ${trader.slice(0, 8)}...`);

        // Auto-start monitoring if not running
        if (!this.isRunning) {
            this.start();
        }

        return { traderAddress: trader, label: record.label, active: true };
    }

    /**
     * Unfollow a trader.
     */
    unfollowTrader(traderAddress: string, followedBy: string): boolean {
        return this.store.unfollow(traderAddress, followedBy);
    }

    /**
     * Get all followed traders and their status.
     */
    getFollowedTraders(followedBy?: string): Array<{ traderAddress: string; label: string; active: boolean; startedAt: string }> {
        const follows = this.store.getActiveFollows();
        if (followedBy) {
            return follows.filter(f => f.followedBy.toLowerCase() === followedBy.toLowerCase());
        }
        return follows;
    }

    // ─── Track external trader (legacy) ─────────────────────────

    trackExternalTrader(address: string, label: string) {
        const key = address.toLowerCase();
        const entry = { address: key, label, trackedAt: new Date().toISOString() };
        this.trackedTraders.set(key, entry);
        logger.info(`👁️ Tracking external trader: ${label} (${address})`);
        return entry;
    }

    getTrackedTraders() {
        return Array.from(this.trackedTraders.values());
    }

    // ─── Engine Control ─────────────────────────────────────────

    /**
     * Start the live monitoring loop.
     * Polls followed trader addresses every 15 seconds.
     */
    start(): void {
        if (this.isRunning) {
            logger.warn('CopyTradeEngine is already running');
            return;
        }

        this.isRunning = true;
        const intervalMs = 15_000; // 15 seconds
        logger.info(`🚀 CopyTradeEngine started — monitoring every ${intervalMs / 1000}s...`);

        // Run first cycle immediately
        this.monitorCycle();

        this.monitorInterval = setInterval(
            () => this.monitorCycle(),
            intervalMs
        );
    }

    /**
     * Stop the monitoring loop.
     */
    stop(): void {
        if (this.monitorInterval) {
            clearInterval(this.monitorInterval);
            this.monitorInterval = null;
        }
        this.isRunning = false;
        logger.info('🛑 CopyTradeEngine stopped');
    }

    /**
     * Single monitoring cycle — scan ALL followed traders for new trades.
     */
    private async monitorCycle(): Promise<void> {
        // Get all unique followed trader addresses
        const follows = this.store.getActiveFollows();
        const subscribedTraders = this.subscriptionManager.getMonitoredTraders();
        const allTraders = new Set([
            ...follows.map(f => f.traderAddress),
            ...subscribedTraders,
        ]);

        if (allTraders.size === 0) return;

        logger.info(`🔍 Monitor cycle: scanning ${allTraders.size} trader(s)...`);

        for (const traderAddress of allTraders) {
            try {
                const trades = await this.orchestrator.detectTrades(traderAddress);
                if (trades.length > 0) {
                    logger.info(`🎯 Found ${trades.length} trade(s) from ${traderAddress.slice(0, 8)}...`);
                    for (const trade of trades) {
                        const result = await this.processTrade(trade);

                        // Persist to store
                        this.store.addTradeHistory({
                            id: trade.id,
                            timestamp: new Date().toISOString(),
                            traderAddress: trade.traderAddress,
                            txHash: trade.txHash,
                            type: trade.type,
                            tokenIn: trade.tokenIn.symbol,
                            tokenOut: trade.tokenOut.symbol,
                            amountIn: trade.amountIn,
                            status: this.determineStatus(result),
                            executionResults: result.executions.map(e => ({
                                walletAddress: e.walletAddress,
                                success: e.success,
                                txHash: e.txHash,
                                reason: e.reasoning,
                            })),
                        });
                    }
                }
            } catch (error) {
                logger.error(`Monitor error for ${traderAddress.slice(0, 8)}...: ${error}`);
            }
        }
    }

    /**
     * Process a single detected trade through the agent pipeline.
     */
    async processTrade(trade: TradeDetectedEvent): Promise<PipelineResult> {
        const subscribers = this.subscriptionManager.getSubscribers(trade.traderAddress);

        if (subscribers.length === 0) {
            logger.info(`No subscribers for trader ${trade.traderAddress.slice(0, 8)} — skipping`);
            return {
                tradeEvent: trade,
                riskAssessment: {
                    approved: false, overallScore: 0, liquidityScore: 0, slippageScore: 0,
                    tradeSizeScore: 0, gasCostScore: 0, tokenRiskScore: 0,
                    reasoning: 'No subscribers', warnings: [],
                },
                executions: [], profitShares: [], reasoningLog: [], totalTimeMs: 0,
            };
        }

        const result = await this.orchestrator.processTradeEvent(trade, subscribers);

        const historyEntry: TradeHistoryEntry = {
            id: trade.id,
            timestamp: new Date().toISOString(),
            tradeEvent: trade,
            riskAssessment: result.riskAssessment,
            executions: result.executions,
            profitShares: result.profitShares,
            status: this.determineStatus(result),
        };

        this.tradeHistory.push(historyEntry);
        return result;
    }

    /**
     * Process a simulated trade (for demo/testing).
     */
    async processSimulatedTrade(traderAddress: string): Promise<PipelineResult> {
        const trade = StrategyAgent.createSimulatedTrade(traderAddress);
        return this.processTrade(trade);
    }

    private determineStatus(result: PipelineResult): TradeHistoryEntry['status'] {
        if (!result.riskAssessment.approved) return 'REJECTED';
        if (result.executions.length === 0) return 'REJECTED';
        const successCount = result.executions.filter(e => e.success).length;
        if (successCount === result.executions.length) return 'EXECUTED';
        if (successCount > 0) return 'PARTIAL';
        return 'FAILED';
    }

    // ─── Accessors ──────────────────────────────────────────────

    getTradeHistory(): TradeHistoryEntry[] {
        return [...this.tradeHistory];
    }

    getReasoningLogs() {
        return this.orchestrator.getAllReasoningLogs();
    }

    isEngineRunning(): boolean {
        return this.isRunning;
    }
}
