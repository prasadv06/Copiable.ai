import { StrategyAgent } from './StrategyAgent.js';
import { RiskAgent } from './RiskAgent.js';
import { ExecutionAgent } from './ExecutionAgent.js';
import { ProfitAgent } from './ProfitAgent.js';
import { WalletService } from '../wallet/WalletService.js';
import { logger } from '../utils/logger.js';
import type {
    TradeDetectedEvent,
    RiskAssessment,
    ExecutionResult,
    ProfitShareResult,
    PipelineResult,
    ReasoningEntry,
    Subscription,
} from './types.js';

/**
 * AgentOrchestrator — Manages the AI agent pipeline.
 *
 * Pipeline flow:
 * 1. StrategyAgent detects a trade
 * 2. RiskAgent evaluates the trade
 * 3. If approved → ExecutionAgent mirrors to subscribers
 * 4. ProfitAgent distributes performance fees
 *
 * All reasoning is collected and returned.
 */
export class AgentOrchestrator {
    private strategyAgent: StrategyAgent;
    private riskAgent: RiskAgent;
    private executionAgent: ExecutionAgent;
    private profitAgent: ProfitAgent;
    private pipelineResults: PipelineResult[] = [];

    constructor(walletService: WalletService) {
        this.strategyAgent = new StrategyAgent();
        this.riskAgent = new RiskAgent();
        this.executionAgent = new ExecutionAgent(walletService);
        this.profitAgent = new ProfitAgent(walletService);
    }

    /**
     * Run the full agent pipeline for a detected trade event.
     */
    async processTradeEvent(
        trade: TradeDetectedEvent,
        subscribers: Subscription[]
    ): Promise<PipelineResult> {
        const startTime = Date.now();
        const allReasoning: ReasoningEntry[] = [];

        // Clear previous reasoning
        this.strategyAgent.clearReasoningLog();
        this.riskAgent.clearReasoningLog();
        this.executionAgent.clearReasoningLog();
        this.profitAgent.clearReasoningLog();

        logger.info(`\n${'═'.repeat(60)}`);
        logger.info(`  🤖 AGENT PIPELINE STARTED`);
        logger.info(`  Trade: ${trade.tokenIn.symbol} → ${trade.tokenOut.symbol}`);
        logger.info(`  Amount: ${trade.amountIn} ${trade.tokenIn.symbol}`);
        logger.info(`${'═'.repeat(60)}\n`);

        // ── Step 1: Strategy Analysis ────────────────────────
        logger.info('📡 [Step 1/4] Strategy Agent — Trade Detection Confirmation');
        this.strategyAgent.clearReasoningLog();

        this.strategyAgent.addReasoning(
            `Trade detected from lead wallet: ${trade.tokenIn.symbol} → ${trade.tokenOut.symbol}, ${trade.amountIn} ${trade.tokenIn.symbol}`,
            { txHash: trade.txHash.slice(0, 10) + '...' }
        );
        allReasoning.push(...this.strategyAgent.getReasoningLog());

        // ── Step 2: Risk Assessment ──────────────────────────
        logger.info('🛡️  [Step 2/4] Risk Agent — Safety Analysis');
        const riskDecision = await this.riskAgent.analyze({ trade });
        const riskAssessment = riskDecision.details.assessment as RiskAssessment;

        if (riskDecision.decision === 'REJECT') {
            logger.info('❌ Trade REJECTED by Risk Agent');
            this.riskAgent.addReasoning('❌ Trade REJECTED by Risk Agent');
            allReasoning.push(...this.riskAgent.getReasoningLog());
            
            const result: PipelineResult = {
                tradeEvent: trade,
                riskAssessment,
                executions: [],
                profitShares: [],
                reasoningLog: allReasoning,
                totalTimeMs: Date.now() - startTime,
            };
            this.pipelineResults.push(result);
            return result;
        }

        logger.info(`✅ Trade APPROVED by Risk Agent — Risk Score: ${riskAssessment.overallScore}/100`);
        this.riskAgent.addReasoning(`✅ Trade APPROVED by Risk Agent — Risk Score: ${riskAssessment.overallScore}/100`);
        allReasoning.push(...this.riskAgent.getReasoningLog());

        // ── Step 3: Execution ────────────────────────────────
        logger.info('⚡ [Step 3/4] Execution Agent — Mirroring Trades');
        const execDecision = await this.executionAgent.analyze({
            trade,
            subscribers,
        });
        allReasoning.push(...this.executionAgent.getReasoningLog());

        const executions = (execDecision.details.results || []) as ExecutionResult[];

        // ── Step 4: Profit Sharing ───────────────────────────
        logger.info('💰 [Step 4/4] Profit Agent — Fee Distribution');
        const profitDecision = await this.profitAgent.analyze({
            executions,
            traderAddress: trade.traderAddress,
        });
        allReasoning.push(...this.profitAgent.getReasoningLog());

        const profitShares = (profitDecision.details.profitShares || []) as ProfitShareResult[];

        // ── Summary ──────────────────────────────────────────
        const totalTimeMs = Date.now() - startTime;
        const successCount = executions.filter(e => e.success).length;

        logger.info(`\n${'═'.repeat(60)}`);
        logger.info(`  🏁 PIPELINE COMPLETE in ${totalTimeMs}ms`);
        logger.info(`  Risk Score: ${riskAssessment.overallScore}/100`);
        logger.info(`  Executions: ${successCount}/${executions.length} successful`);
        logger.info(`  Profit Shares: ${profitShares.filter(p => p.success).length}`);
        logger.info(`${'═'.repeat(60)}\n`);

        const result: PipelineResult = {
            tradeEvent: trade,
            riskAssessment,
            executions,
            profitShares,
            reasoningLog: allReasoning,
            totalTimeMs,
        };

        this.pipelineResults.push(result);
        return result;
    }

    /**
     * Run trade detection for a trader address (polling mode).
     */
    async detectTrades(traderAddress: string): Promise<TradeDetectedEvent[]> {
        this.strategyAgent.clearReasoningLog();
        const decision = await this.strategyAgent.analyze({ traderAddress });

        if (decision.decision === 'APPROVE' && decision.details.trades) {
            return decision.details.trades as TradeDetectedEvent[];
        }
        return [];
    }

    // ─── Accessors ──────────────────────────────────────────────

    getPipelineResults(): PipelineResult[] {
        return [...this.pipelineResults];
    }

    getAllReasoningLogs(): ReasoningEntry[] {
        const historyLogs = this.pipelineResults.flatMap(p => p.reasoningLog);
        const currentLogs = [
            ...this.strategyAgent.getReasoningLog(),
            ...this.riskAgent.getReasoningLog(),
            ...this.executionAgent.getReasoningLog(),
            ...this.profitAgent.getReasoningLog(),
        ];

        const allLogs = [...historyLogs, ...currentLogs];
        
        // Deduplicate
        const uniqueLogs: ReasoningEntry[] = [];
        const seen = new Set<string>();
        
        for (const log of allLogs) {
            const key = `${log.timestamp}-${log.message}`;
            if (!seen.has(key)) {
                seen.add(key);
                uniqueLogs.push(log);
            }
        }
        
        uniqueLogs.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
        return uniqueLogs;
    }

    getAgents() {
        return {
            strategy: this.strategyAgent,
            risk: this.riskAgent,
            execution: this.executionAgent,
            profit: this.profitAgent,
        };
    }
}
