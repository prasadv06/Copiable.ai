import { BaseAgent } from './BaseAgent.js';
import { WalletService } from '../wallet/WalletService.js';
import { config } from '../config/index.js';
import type {
    AgentDecision,
    ExecutionResult,
    ProfitShareResult,
} from './types.js';

/**
 * ProfitAgent — Handles profit-sharing / tipping to the lead trader.
 *
 * After successful mirrored trades, calculates a performance fee
 * (default 2%) and sends it to the lead trader's wallet.
 */
export class ProfitAgent extends BaseAgent {
    private walletService: WalletService;

    constructor(walletService: WalletService) {
        super('ProfitAgent', 'Handles profit sharing and performance fee distribution to lead traders');
        this.walletService = walletService;
    }

    async analyze(context: Record<string, unknown>): Promise<AgentDecision> {
        const executions = context.executions as ExecutionResult[];
        const traderAddress = context.traderAddress as string;

        if (!executions || executions.length === 0) {
            this.addReasoning('No executions to process for profit sharing');
            return {
                decision: 'SKIP',
                confidence: 100,
                reasoning: 'No successful executions to share profits from',
                details: {},
            };
        }

        const successful = executions.filter(e => e.success);
        if (successful.length === 0) {
            this.addReasoning('All executions failed — no profit to share');
            return {
                decision: 'SKIP',
                confidence: 100,
                reasoning: 'No successful trades to generate profit share',
                details: {},
            };
        }

        this.addReasoning(
            `Calculating ${config.performanceFeePct}% performance fee for ${successful.length} successful trade(s)`,
            { traderAddress: traderAddress?.slice(0, 8) + '...' }
        );

        const profitShares: ProfitShareResult[] = [];

        for (const exec of successful) {
            const share = await this.calculateAndDistribute(exec, traderAddress);
            profitShares.push(share);
        }

        const totalShared = profitShares
            .filter(p => p.success)
            .reduce((sum, p) => sum + parseFloat(p.amount), 0);

        this.addReasoning(
            `💰 Profit sharing complete: ${totalShared.toFixed(6)} ETH distributed to lead trader`,
            { shares: profitShares.length, totalAmount: totalShared.toFixed(6) }
        );

        return {
            decision: 'EXECUTE',
            confidence: 90,
            reasoning: `Distributed ${totalShared.toFixed(6)} ETH performance fee (${config.performanceFeePct}%) to lead trader`,
            details: { profitShares },
        };
    }

    /**
     * Calculate and distribute REAL profit share on Sepolia.
     */
    private async calculateAndDistribute(
        execution: ExecutionResult,
        traderAddress: string
    ): Promise<ProfitShareResult> {
        const amountMirrored = parseFloat(execution.amountMirrored);
        const feeAmount = amountMirrored * (config.performanceFeePct / 100);

        this.addReasoning(
            `Fee calculation: ${amountMirrored.toFixed(6)} × ${config.performanceFeePct}% = ${feeAmount.toFixed(6)} ETH`,
            { from: execution.walletAddress.slice(0, 8), to: traderAddress.slice(0, 8) }
        );

        if (feeAmount < 0.000001) {
            return {
                from: execution.walletAddress,
                to: traderAddress,
                amount: '0',
                success: false,
                reasoning: `Fee too small to transfer: ${feeAmount.toFixed(10)} ETH`,
            };
        }

        try {
            // Find the wallet by address to get the walletId
            const wallet = this.walletService.getWalletByAddress(execution.walletAddress);

            if (wallet) {
                // Check if wallet has enough ETH for gas + fee
                const balance = await this.walletService.getBalance(wallet.address);
                const ethBalance = parseFloat(balance.ethBalance);

                if (ethBalance > feeAmount + 0.0005) {
                    // Send REAL performance fee on Sepolia
                    const txHash = await this.walletService.sendETH(
                        wallet.id,
                        traderAddress,
                        feeAmount.toFixed(8)
                    );

                    this.addReasoning(`✅ REAL performance fee sent: ${feeAmount.toFixed(6)} ETH → ${traderAddress.slice(0, 8)}...`, {
                        txHash,
                        explorer: `https://sepolia.etherscan.io/tx/${txHash}`,
                    });

                    return {
                        from: execution.walletAddress,
                        to: traderAddress,
                        amount: feeAmount.toFixed(6),
                        txHash,
                        success: true,
                        reasoning: `🔗 REAL TX: Sent ${feeAmount.toFixed(6)} ETH (${config.performanceFeePct}% of ${amountMirrored.toFixed(6)}) to lead trader`,
                    };
                }
            }

            // Wallet doesn't have enough for real tx — record the intent
            this.addReasoning(`⚠️ Insufficient gas for real fee transfer — recording intent`, {
                feeOwed: feeAmount.toFixed(6),
                to: traderAddress.slice(0, 8),
            });

            return {
                from: execution.walletAddress,
                to: traderAddress,
                amount: feeAmount.toFixed(6),
                success: true, // intent recorded
                reasoning: `Fee of ${feeAmount.toFixed(6)} ETH recorded (pending: wallet needs gas to send)`,
            };
        } catch (error) {
            const errMsg = error instanceof Error ? error.message : String(error);
            return {
                from: execution.walletAddress,
                to: traderAddress,
                amount: feeAmount.toFixed(6),
                success: false,
                reasoning: `Profit share failed: ${errMsg}`,
            };
        }
    }
}
