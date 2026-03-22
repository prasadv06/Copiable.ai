# 🏛️ Autonomous Copy Trading Syndicate

> AI-driven decentralized copy trading powered by **Tether WDK**, **OpenClaw**, and **MCP**
> Built for the **Tether Hackathon Galáctica: WDK Edition 1**

## What It Does

A lead trader executes trades on-chain. AI agents autonomously detect, analyze, and mirror those trades across subscribed user wallets — all self-custodial via WDK.

```
Lead Trader trades WETH → USDt on Sepolia
        │
        ▼
┌─────────────────────┐
│   Strategy Agent    │  ← Detects the trade (scans real blocks)
├─────────────────────┤
│     Risk Agent      │  ← Scores liquidity, slippage, size, gas, token risk
├─────────────────────┤
│   Execution Agent   │  ← Mirrors trade to subscribed wallets via WDK
├─────────────────────┤
│    Profit Agent     │  ← Sends 2% performance fee to lead trader
└─────────────────────┘
```

---

## Quick Start

### Prerequisites

- **Node.js** ≥ 20
- **npm** (latest)
- **Pimlico API Key** (optional, for ERC-4337) — [Get one here](https://dashboard.pimlico.io)

### Setup

```bash
# 1. Clone and install
cd WDK_Copy_Trade
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env with your Pimlico API key (optional)

# 3. Run the demo simulation
npm run demo

# 4. Start the server + dashboard
npm run dev
# Open http://localhost:3001
```

### Get Test Tokens

- [Google Cloud Faucet](https://cloud.google.com/application/web3/faucet/ethereum/sepolia) — Sepolia ETH
- [Pimlico Faucet](https://dashboard.pimlico.io/test-erc20-faucet) — Sepolia USDt
- [Alchemy Faucet](https://sepoliafaucet.com) — Sepolia ETH

---

## Hackathon Tech Stack Integration

### ✅ WDK — Tether's Wallet Development Kit

All wallet operations use the **real WDK SDK** (`@tetherto/wdk` + `@tetherto/wdk-wallet-evm`):

```typescript
import WDK from '@tetherto/wdk'
import WalletManagerEvm from '@tetherto/wdk-wallet-evm'

// Generate seed via WDK
const seedPhrase = WDK.getRandomSeedPhrase()

// Initialize WDK with Sepolia EVM wallet
const wdk = new WDK(seedPhrase)
  .registerWallet('ethereum', WalletManagerEvm, { provider: rpcUrl })

// Derive account (BIP-44)
const account = await wdk.getAccount('ethereum', 0)
const address = await account.getAddress()

// Real balance queries
const ethBalance = await account.getBalance()

// Real transactions
const { hash } = await account.sendTransaction({ to, value })
```

- **WDK Docs**: https://docs.wallet.tether.io
- **WDK GitHub**: https://github.com/tetherto/wdk-core

### ✅ MCP — Model Context Protocol

Our MCP server exposes 8 tools compatible with the [wdk-mcp](https://github.com/dieselftw/wdk-mcp) standard:

| Tool | Description |
|------|-------------|
| `create_wallet` | Create a self-custodial WDK wallet |
| `get_balance` | Check ETH + USDt balance on Sepolia |
| `list_wallets` | List all managed wallets |
| `subscribe_to_trader` | Subscribe a wallet to copy a trader |
| `simulate_trade` | Trigger the AI agent pipeline |
| `get_reasoning_logs` | Retrieve agent reasoning logs |
| `get_trade_history` | Get trade execution history |
| `send_transaction` | Send real ETH on Sepolia |

- **wdk-mcp**: https://github.com/dieselftw/wdk-mcp

### ✅ OpenClaw Compatibility

The MCP tools are designed to work with [OpenClaw](https://openclaw.ai) or any agent framework that supports MCP tool calling. OpenClaw agents can call our tools via the MCP endpoint to autonomously manage wallets and execute trades.

- **OpenClaw GitHub**: https://github.com/openclaw/openclaw
- **OpenClaw Website**: https://openclaw.ai

### ✅ Tether Tokens

- **USDt** balance queries on Sepolia (`0xd077a400968890eacc75cdc901f0356c943e4fdb`)
- ERC-20 token transfers via WDK's `transfer()` method
- Real on-chain balance display in the dashboard

### ✅ Network: Ethereum Sepolia Testnet

- **Chain ID**: 11155111
- **RPC**: `https://ethereum-sepolia-rpc.publicnode.com`
- **Explorer**: https://sepolia.etherscan.io
- All transactions are real and verifiable on Etherscan

---

## Architecture

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the full technical architecture.

```
src/
├── config/           # Chain config, thresholds, env loading
├── agents/
│   ├── BaseAgent.ts       # Abstract agent with reasoning logs
│   ├── StrategyAgent.ts   # Detects trades from lead wallet (scans real blocks)
│   ├── RiskAgent.ts       # 5-dimension risk scoring
│   ├── ExecutionAgent.ts  # Mirrors trades via WDK sendTransaction()
│   ├── ProfitAgent.ts     # Real ETH fee distribution via WDK
│   ├── AgentOrchestrator.ts  # Pipeline manager
│   └── types.ts           # Shared type definitions
├── wallet/
│   └── WalletService.ts   # WDK wallet operations (@tetherto/wdk)
├── subscription/
│   └── SubscriptionManager.ts  # User → Trader subscriptions
├── trading/
│   └── CopyTradeEngine.ts     # Main engine
├── mcp/
│   └── McpServer.ts       # MCP tool server (wdk-mcp compatible)
├── demo/
│   └── simulate.ts        # End-to-end demo script
├── utils/
│   └── logger.ts          # Winston logger
└── server.ts              # Express API server

dashboard/
├── index.html         # Dashboard UI
├── styles.css         # Dark glassmorphism theme
└── app.js             # Frontend logic
```

---

## AI Agents

| Agent | Role | Key Logic |
|-------|------|-----------|
| **Strategy Agent** | Monitors lead trader wallet, detects trades | Block scanning, tx decoding, swap detection |
| **Risk Agent** | Evaluates trade safety (5 dimensions) | Weighted scoring: liquidity, slippage, size, gas, token risk |
| **Execution Agent** | Mirrors approved trades to subscribers | Proportional sizing, balance checks, WDK sendTransaction() |
| **Profit Agent** | Distributes 2% performance fee | Real ETH transfer to lead trader via WDK |

All agents produce **transparent reasoning logs** explaining every decision.

---

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/wallets` | Create wallet via WDK |
| `GET` | `/api/wallets` | List wallets |
| `GET` | `/api/wallets/:address/balance` | Get real Sepolia balance |
| `POST` | `/api/wallets/track` | Track external address as lead trader |
| `POST` | `/api/wallets/import` | Import wallet from seed phrase |
| `POST` | `/api/subscriptions` | Subscribe to trader |
| `GET` | `/api/subscriptions` | List subscriptions |
| `POST` | `/api/trades/simulate` | Simulate a trade |
| `POST` | `/api/trades/scan` | Scan blockchain for real trades |
| `GET` | `/api/trades/history` | Trade history |
| `GET` | `/api/agents/reasoning` | Reasoning logs |
| `GET` | `/api/blockchain/info` | Live blockchain info |
| `POST` | `/api/engine/start` | Start monitoring |
| `POST` | `/api/engine/stop` | Stop monitoring |
| `GET` | `/api/mcp/tools` | List MCP tools |
| `POST` | `/api/mcp/call` | Call an MCP tool |

---

## Design Decisions

1. **WDK-first**: All wallet ops use the real WDK SDK, with ethers.js only as fallback for external address queries
2. **Self-custodial**: Seed phrases stay on the user's device, never sent to servers
3. **Transparent AI**: Every agent logs its reasoning — no black-box decisions
4. **Real blockchain**: All balance queries and transactions on Ethereum Sepolia
5. **MCP standard**: Tool names follow the wdk-mcp convention for interoperability

---

## Known Limitations

- Wallets need Sepolia ETH (from faucets) to execute real transactions
- Risk scoring uses heuristic rules (production would use ML models)
- Trade detection uses polling (production would use WebSocket subscriptions)
- In-memory state (production would use a database)

---

## License

MIT — Built for Tether Hackathon Galáctica: WDK Edition 1
