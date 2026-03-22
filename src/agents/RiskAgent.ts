import { BaseAgent } from './BaseAgent.js';
import { config } from '../config/index.js';
import type { AgentDecision, TradeDetectedEvent, RiskAssessment } from './types.js';

/**
 * RiskAgent — Evaluates detected trades across 5 risk dimensions.
 *
 * Scoring (0-100, higher = safer):
 * - Liquidity: Is there enough liquidity for this trade?
 * - Slippage: Will the trade suffer excessive slippage?
 * - Trade Size: Is the trade size reasonable?
 * - Gas Cost: Are gas costs proportional to trade value?
 * - Token Risk: Is the token known/trusted?
 *
 * A trade is approved only if the overall weighted score >= 60.
 */
export class RiskAgent extends BaseAgent {
    constructor() {
        super('RiskAgent', 'Analyzes trades for safety across liquidity, slippage, size, gas, and token risk');
    }

    async analyze(context: Record<string, unknown>): Promise<AgentDecision> {
        const trade = context.trade as TradeDetectedEvent;
        if (!trade) {
            return {
                decision: 'REJECT',
                confidence: 100,
                reasoning: 'No trade event provided for risk analysis',
                details: {},
            };
        }

        this.addReasoning(`Analyzing trade: ${trade.tokenIn.symbol} → ${trade.tokenOut.symbol}`, {
            amountIn: trade.amountIn,
            type: trade.type,
            txHash: trade.txHash.slice(0, 10) + '...',
        });

        const assessment = this.assessRisk(trade);

        this.addReasoning(`Risk Assessment Complete`, {
            overallScore: assessment.overallScore,
            liquidityScore: assessment.liquidityScore,
            slippageScore: assessment.slippageScore,
            tradeSizeScore: assessment.tradeSizeScore,
            gasCostScore: assessment.gasCostScore,
            tokenRiskScore: assessment.tokenRiskScore,
            approved: assessment.approved,
        });

        if (assessment.warnings.length > 0) {
            this.addReasoning(`⚠️ Warnings: ${assessment.warnings.join('; ')}`);
        }

        return {
            decision: assessment.approved ? 'APPROVE' : 'REJECT',
            confidence: assessment.overallScore,
            reasoning: assessment.reasoning,
            details: { assessment },
        };
    }

    /**
     * Perform full risk assessment.
     */
    assessRisk(trade: TradeDetectedEvent): RiskAssessment {
        const warnings: string[] = [];

        // ── 1. Liquidity Score ──────────────────────────────
        const liquidityScore = this.scoreLiquidity(trade, warnings);

        // ── 2. Slippage Score ──────────────────────────────
        const slippageScore = this.scoreSlippage(trade, warnings);

        // ── 3. Trade Size Score ────────────────────────────
        const tradeSizeScore = this.scoreTradeSize(trade, warnings);

        // ── 4. Gas Cost Score ──────────────────────────────
        const gasCostScore = this.scoreGasCost(trade, warnings);

        // ── 5. Token Risk Score ────────────────────────────
        const tokenRiskScore = this.scoreTokenRisk(trade, warnings);

        // ── Weighted Overall Score ─────────────────────────
        const overallScore = Math.round(
            liquidityScore * 0.25 +
            slippageScore * 0.20 +
            tradeSizeScore * 0.20 +
            gasCostScore * 0.15 +
            tokenRiskScore * 0.20
        );

        const approved = overallScore >= 60 && !warnings.some(w => w.startsWith('CRITICAL'));

        const reasoning = this.buildReasoningSummary(
            trade, overallScore, approved, {
            liquidityScore, slippageScore, tradeSizeScore, gasCostScore, tokenRiskScore,
        },
            warnings
        );

        return {
            approved,
            overallScore,
            liquidityScore,
            slippageScore,
            tradeSizeScore,
            gasCostScore,
            tokenRiskScore,
            reasoning,
            warnings,
        };
    }

    // ─── Scoring Functions ──────────────────────────────────────

    private scoreLiquidity(trade: TradeDetectedEvent, warnings: string[]): number {
        const knownIn = config.knownTokens.get(trade.tokenIn.address.toLowerCase());
        const knownOut = config.knownTokens.get(trade.tokenOut.address.toLowerCase());

        // Trusted tokens with known liquidity
        if (knownIn?.trusted && knownOut?.trusted) {
            return 95;
        }

        if (knownIn?.trusted || knownOut?.trusted) {
            warnings.push('One token in the pair is not in our trusted list');
            return 75;
        }

        warnings.push('Neither token is in the trusted list (Acceptable on Testnet)');
        return 60;
    }

    private scoreSlippage(trade: TradeDetectedEvent, warnings: string[]): number {
        const amountIn = parseFloat(trade.amountIn);
        const amountOut = parseFloat(trade.amountOut);

        if (amountIn === 0 || amountOut === 0) {
            return 75; // can't calculate, assign moderate score
        }

        // Simplified slippage estimate based on trade size
        // Larger trades = higher potential slippage
        if (amountIn > 10) {
            warnings.push('Large trade size may result in significant slippage');
            return 50;
        }
        if (amountIn > 5) {
            return 70;
        }
        if (amountIn > 1) {
            return 85;
        }
        return 95;
    }

    private scoreTradeSize(trade: TradeDetectedEvent, warnings: string[]): number {
        const amountIn = parseFloat(trade.amountIn);

        if (amountIn > 100) {
            warnings.push('CRITICAL: Extremely large trade size (>100 ETH equivalent)');
            return 10;
        }
        if (amountIn > 50) {
            warnings.push('Very large trade size — exercise caution');
            return 30;
        }
        if (amountIn > 10) {
            return 60;
        }
        if (amountIn > 1) {
            return 85;
        }
        return 95;
    }

    private scoreGasCost(trade: TradeDetectedEvent, warnings: string[]): number {
        const gasUsed = parseInt(trade.gasUsed);
        const gasPriceGwei = parseFloat(trade.gasPriceGwei);
        const gasCostEth = (gasUsed * gasPriceGwei) / 1e9;
        const amountIn = parseFloat(trade.amountIn);

        if (amountIn === 0) return 80;

        const gasPct = (gasCostEth / amountIn) * 100;

        if (gasPct > 50) {
            warnings.push('Gas cost exceeds 50% of trade value (Expected on Testnet small trades)');
            return 50;
        }
        if (gasPct > 20) {
            warnings.push('Gas cost is >20% of trade value');
            return 40;
        }
        if (gasPct > 10) {
            return 65;
        }
        if (gasPct > 5) {
            return 80;
        }
        return 95;
    }

    private scoreTokenRisk(trade: TradeDetectedEvent, warnings: string[]): number {
        let score = 50; // base score for unknown tokens

        const inToken = config.knownTokens.get(trade.tokenIn.address.toLowerCase());
        const outToken = config.knownTokens.get(trade.tokenOut.address.toLowerCase());

        if (inToken?.trusted) score += 25;
        else warnings.push(`Token IN (${trade.tokenIn.symbol}) is not in trusted list`);

        if (outToken?.trusted) score += 25;
        else warnings.push(`Token OUT (${trade.tokenOut.symbol}) is not in trusted list`);

        return Math.min(100, score);
    }

    // ─── Helper ─────────────────────────────────────────────────

    private buildReasoningSummary(
        trade: TradeDetectedEvent,
        overallScore: number,
        approved: boolean,
        scores: Record<string, number>,
        warnings: string[]
    ): string {
        const decision = approved ? '✅ APPROVED' : '❌ REJECTED';

        return [
            `═══════════════════════════════════════════`,
            `  RISK ASSESSMENT — ${decision}`,
            `═══════════════════════════════════════════`,
            `  Trade: ${trade.tokenIn.symbol} → ${trade.tokenOut.symbol}`,
            `  Amount: ${trade.amountIn} ${trade.tokenIn.symbol}`,
            `  Type: ${trade.type}`,
            `───────────────────────────────────────────`,
            `  Overall Score: ${overallScore}/100`,
            `  Liquidity:     ${scores.liquidityScore}/100`,
            `  Slippage:      ${scores.slippageScore}/100`,
            `  Trade Size:    ${scores.tradeSizeScore}/100`,
            `  Gas Cost:      ${scores.gasCostScore}/100`,
            `  Token Risk:    ${scores.tokenRiskScore}/100`,
            warnings.length > 0 ? `───────────────────────────────────────────` : '',
            ...warnings.map(w => `  ⚠️  ${w}`),
            `═══════════════════════════════════════════`,
        ].filter(Boolean).join('\n');
    }
}
