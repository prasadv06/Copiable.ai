# Architecture — Autonomous Copy Trading Syndicate

## System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Web Dashboard (Port 3001)                     │
│    Wallet Mgmt │ Subscriptions │ Agent Logs │ Trade History          │
└──────────────────────────┬──────────────────────────────────────────┘
                           │ REST API
┌──────────────────────────┴──────────────────────────────────────────┐
│                       Express API Server                             │
│                                                                      │
│  ┌──────────────┐   ┌──────────────────┐   ┌───────────────────┐   │
│  │ MCP Server   │   │ CopyTradeEngine  │   │ WalletService     │   │
│  │ (8 tools)    │   │ (main loop)      │   │ (WDK integration) │   │
│  └──────┬───────┘   └────────┬─────────┘   └────────┬──────────┘   │
│         │                    │                       │              │
│         │           ┌────────┴─────────┐             │              │
│         │           │ AgentOrchestrator │             │              │
│         │           └────────┬─────────┘             │              │
│         │                    │                       │              │
│  ┌──────┴──────────────────┬─┴──────────┬────────────┤              │
│  │                         │            │            │              │
│  │  ┌─────────────┐  ┌────┴────┐  ┌────┴─────┐  ┌──┴───────┐     │
│  │  │  Strategy    │→ │  Risk   │→ │Execution │→ │ Profit   │     │
│  │  │  Agent       │  │  Agent  │  │  Agent   │  │  Agent   │     │
│  │  └─────────────┘  └─────────┘  └──────────┘  └──────────┘     │
│  │                                                                  │
│  │  ┌──────────────────────┐                                       │
│  │  │ SubscriptionManager  │                                       │
│  │  └──────────────────────┘                                       │
│  │                                                                  │
└──┴──────────────────────────────────────────────────────────────────┘
                           │
              ┌────────────┴────────────┐
              │  Ethereum Sepolia (RPC) │
              │  USDt + WETH contracts  │
              └─────────────────────────┘
```

## Agent Pipeline

```
Trade Detected ──→ Strategy Agent ──→ Risk Agent ──→ Execution Agent ──→ Profit Agent
                      │                   │               │                   │
                  Confirms trade     Scores 5 dims.   Mirrors to          Sends 2%
                  type & size       (weighted avg.)   subscribers         fee to trader
                      │                   │               │                   │
                  [SKIP|APPROVE]    [APPROVE|REJECT]  [EXECUTE]         [EXECUTE]
                                         │
                              If REJECT → Pipeline stops
```

### Risk Scoring (5 dimensions, weighted)

| Dimension | Weight | What it checks |
|-----------|--------|----------------|
| Liquidity | 25% | Is the token in our trusted list? |
| Slippage | 20% | Trade size vs expected impact |
| Trade Size | 20% | Absolute size thresholds |
| Gas Cost | 15% | Gas as % of trade value |
| Token Risk | 20% | Known vs unknown tokens |

**Threshold:** Score ≥ 60/100 to approve (unless CRITICAL warning present).

## Data Flow

1. **Monitor** polls Sepolia RPC for lead trader transactions
2. **Decoder** parses tx receipts for ERC-20 Transfer and Swap events
3. **Strategy Agent** structures the trade as `TradeDetectedEvent`
4. **Risk Agent** scores the trade and returns `RiskAssessment`
5. **Execution Agent** mirrors to each subscriber (proportional to balance)
6. **Profit Agent** calculates & distributes 2% performance fee
7. Results stored in `TradeHistoryEntry[]`

## WDK Integration

| Feature | Implementation |
|---------|---------------|
| Wallet Creation | `ethers.Mnemonic` (BIP-39) → WDK-compatible seed |
| Balance Queries | `ethers.JsonRpcProvider` → ERC-20 `balanceOf` |
| Transactions | `HDNodeWallet.sendTransaction()` via Sepolia RPC |
| Token Support | USDt (Sepolia mock), WETH |
| Account Abstraction | ERC-4337 config ready (Pimlico bundler/paymaster) |

## Design Decisions

1. **Rule-based agents** instead of LLM-driven — deterministic, debuggable, no API key required for demo
2. **Polling monitor** instead of WebSocket — simpler for hackathon, works with any RPC
3. **Simulated execution** for demo — real tx would require funded wallets
4. **In-memory state** — no database dependency, easy to demo
5. **Proportional mirroring** — subscriber trades scale to 50% of their balance (safety cap)
