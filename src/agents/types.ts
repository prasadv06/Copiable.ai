// ─── Agent Types ──────────────────────────────────────────────

export interface ReasoningEntry {
    timestamp: string;
    agent: string;
    message: string;
    data?: Record<string, unknown>;
}

export type AgentDecisionType = 'APPROVE' | 'REJECT' | 'EXECUTE' | 'SKIP' | 'INFO';

export interface AgentDecision {
    decision: AgentDecisionType;
    confidence: number; // 0-100
    reasoning: string;
    details: Record<string, unknown>;
}

// ─── Trade Types ──────────────────────────────────────────────

export interface TradeDetectedEvent {
    id: string;
    timestamp: string;
    traderAddress: string;
    txHash: string;
    type: 'SWAP' | 'TRANSFER' | 'CONTRACT_INTERACTION';
    tokenIn: TokenInfo;
    tokenOut: TokenInfo;
    amountIn: string;
    amountOut: string;
    gasUsed: string;
    gasPriceGwei: string;
}

export interface TokenInfo {
    address: string;
    symbol: string;
    decimals: number;
}

export interface RiskAssessment {
    approved: boolean;
    overallScore: number; // 0-100
    liquidityScore: number;
    slippageScore: number;
    tradeSizeScore: number;
    gasCostScore: number;
    tokenRiskScore: number;
    reasoning: string;
    warnings: string[];
}

export interface ExecutionResult {
    walletId: string;
    walletAddress: string;
    success: boolean;
    txHash?: string;
    error?: string;
    amountMirrored: string;
    reasoning: string;
}

export interface ProfitShareResult {
    from: string;
    to: string;
    amount: string;
    txHash?: string;
    success: boolean;
    reasoning: string;
}

// ─── Wallet Types ──────────────────────────────────────────────

export interface ManagedWallet {
    id: string;
    label: string;
    seedPhrase: string;
    address: string;
    createdAt: string;
    isLeadTrader: boolean;
}

export interface WalletBalance {
    address: string;
    ethBalance: string;
    usdtBalance: string;
    wethBalance?: string;
    linkBalance?: string;
    usdcBalance?: string;
    aaveBalance?: string;
    lastUpdated: string;
}

// ─── Subscription Types ──────────────────────────────────────

export interface Subscription {
    id: string;
    subscriberWalletId: string;
    traderAddress: string;
    createdAt: string;
    active: boolean;
    maxTradeSize?: string; // max amount to mirror per trade
}

// ─── Pipeline Types ──────────────────────────────────────────

export interface PipelineResult {
    tradeEvent: TradeDetectedEvent;
    riskAssessment: RiskAssessment;
    executions: ExecutionResult[];
    profitShares: ProfitShareResult[];
    reasoningLog: ReasoningEntry[];
    totalTimeMs: number;
}

// ─── Trade History ──────────────────────────────────────────

export interface TradeHistoryEntry {
    id: string;
    timestamp: string;
    tradeEvent: TradeDetectedEvent;
    riskAssessment: RiskAssessment;
    executions: ExecutionResult[];
    profitShares: ProfitShareResult[];
    status: 'APPROVED' | 'REJECTED' | 'EXECUTED' | 'PARTIAL' | 'FAILED';
}
