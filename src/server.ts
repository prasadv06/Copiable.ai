import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { CopyTradeEngine } from './trading/CopyTradeEngine.js';
import { McpServer } from './mcp/McpServer.js';
import { StrategyAgent } from './agents/StrategyAgent.js';
import { config } from './config/index.js';
import { logger } from './utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── Initialize Core Services ──────────────────────────────────
const engine = new CopyTradeEngine();
const mcpServer = new McpServer(engine);

// ─── Express App ───────────────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json());

// Serve dashboard static files
const dashboardPath = path.resolve(__dirname, '../dashboard');
app.use(express.static(dashboardPath));

// ─── API Routes ────────────────────────────────────────────────

// Health check
app.get('/api/health', (_req, res) => {
    res.json({
        status: 'ok',
        engine: engine.isEngineRunning() ? 'running' : 'stopped',
        timestamp: new Date().toISOString(),
    });
});

// ── Wallet Routes ──────────────────────────────────────────────

// Create wallet
app.post('/api/wallets', async (req, res) => {
    try {
        const { label, isLeadTrader } = req.body;
        if (!label) {
            res.status(400).json({ error: 'label is required' });
            return;
        }
        const wallet = await engine.walletService.createWallet(label, isLeadTrader || false);
        res.json({
            id: wallet.id,
            label: wallet.label,
            address: wallet.address,
            isLeadTrader: wallet.isLeadTrader,
            createdAt: wallet.createdAt,
        });
    } catch (error) {
        res.status(500).json({ error: String(error) });
    }
});

// List wallets
app.get('/api/wallets', (_req, res) => {
    const wallets = engine.walletService.getAllWallets().map(w => ({
        id: w.id,
        label: w.label,
        address: w.address,
        isLeadTrader: w.isLeadTrader,
        createdAt: w.createdAt,
    }));
    res.json({ wallets });
});

// Get wallet balance
app.get('/api/wallets/:address/balance', async (req, res) => {
    try {
        const balance = await engine.walletService.getBalance(req.params.address);
        res.json(balance);
    } catch (error) {
        res.status(500).json({ error: String(error) });
    }
});

// ── Wallet Connect ─────────────────────────────────────────────

// Connect wallet (MetaMask) → create or retrieve WDK wallet
app.post('/api/wallets/connect', async (req, res) => {
    try {
        const { address } = req.body;
        if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
            res.status(400).json({ error: 'Valid Ethereum address is required' });
            return;
        }
        const result = await engine.connectWallet(address);
        const balance = await engine.walletService.getBalance(result.wdkWallet.address);
        res.json({
            isNew: result.isNew,
            connectedAddress: result.user.connectedAddress,
            wdkAddress: result.wdkWallet.address,
            wdkWalletId: result.wdkWallet.id,
            label: result.user.label,
            balance,
            etherscanUrl: `https://sepolia.etherscan.io/address/${result.wdkWallet.address}`,
        });
    } catch (error) {
        res.status(500).json({ error: String(error) });
    }
});

// Get user profile by connected address
app.get('/api/users/:address', async (req, res) => {
    try {
        const user = engine.store.getUser(req.params.address);
        if (!user) {
            res.status(404).json({ error: 'User not found. Connect your wallet first.' });
            return;
        }
        const balance = await engine.walletService.getBalance(user.wdkAddress);
        const following = engine.getFollowedTraders(req.params.address);
        res.json({ user, balance, following });
    } catch (error) {
        res.status(500).json({ error: String(error) });
    }
});

// ── Follow / Unfollow Traders ──────────────────────────────────

// Follow a trader for live monitoring
app.post('/api/monitoring/follow', (req, res) => {
    try {
        const { traderAddress, followedBy, label } = req.body;
        if (!traderAddress || !followedBy) {
            res.status(400).json({ error: 'traderAddress and followedBy are required' });
            return;
        }
        if (!/^0x[a-fA-F0-9]{40}$/.test(traderAddress)) {
            res.status(400).json({ error: 'Invalid trader address format' });
            return;
        }
        const result = engine.followTrader(traderAddress, followedBy, label);
        res.json({
            ...result,
            message: `Now monitoring ${result.label} for trades`,
            engineRunning: engine.isEngineRunning(),
        });
    } catch (error) {
        res.status(500).json({ error: String(error) });
    }
});

// Unfollow a trader
app.delete('/api/monitoring/follow/:traderAddress', (req, res) => {
    const followedBy = req.query.followedBy as string;
    if (!followedBy) {
        res.status(400).json({ error: 'followedBy query param is required' });
        return;
    }
    const success = engine.unfollowTrader(req.params.traderAddress, followedBy);
    res.json({ success });
});

// Get monitoring status
app.get('/api/monitoring/status', (_req, res) => {
    const follows = engine.getFollowedTraders();
    res.json({
        engineRunning: engine.isEngineRunning(),
        followedTraders: follows,
        count: follows.length,
    });
});

// Track an external Sepolia address as a lead trader (no seed phrase needed)
app.post('/api/wallets/track', async (req, res) => {
    try {
        const { address, label } = req.body;
        if (!address) {
            res.status(400).json({ error: 'address is required' });
            return;
        }
        // Validate it looks like an Ethereum address
        if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
            res.status(400).json({ error: 'Invalid Ethereum address format' });
            return;
        }
        const wallet = engine.trackExternalTrader(address, label || `External Trader (${address.slice(0, 8)}...)`);
        const balance = await engine.walletService.getBalance(address);
        res.json({
            ...wallet,
            balance,
            etherscanUrl: `https://sepolia.etherscan.io/address/${address}`,
        });
    } catch (error) {
        res.status(500).json({ error: String(error) });
    }
});

// Import a wallet from seed phrase
app.post('/api/wallets/import', async (req, res) => {
    try {
        const { label, seedPhrase, isLeadTrader } = req.body;
        if (!label || !seedPhrase) {
            res.status(400).json({ error: 'label and seedPhrase are required' });
            return;
        }
        const wallet = await engine.walletService.importWallet(label, seedPhrase, isLeadTrader || false);
        res.json({
            id: wallet.id,
            label: wallet.label,
            address: wallet.address,
            isLeadTrader: wallet.isLeadTrader,
            createdAt: wallet.createdAt,
        });
    } catch (error) {
        res.status(500).json({ error: String(error) });
    }
});

// Scan blockchain for REAL trades from a trader address
app.post('/api/trades/scan', async (req, res) => {
    try {
        const { traderAddress } = req.body;
        if (!traderAddress) {
            res.status(400).json({ error: 'traderAddress is required' });
            return;
        }
        const trades = await engine.orchestrator.detectTrades(traderAddress);
        res.json({
            traderAddress,
            tradesFound: trades.length,
            trades: trades.map(t => ({
                ...t,
                etherscanUrl: `https://sepolia.etherscan.io/tx/${t.txHash}`,
            })),
            network: 'Ethereum Sepolia (chainId 11155111)',
        });
    } catch (error) {
        res.status(500).json({ error: String(error) });
    }
});

// Get blockchain info (current block, network)
app.get('/api/blockchain/info', async (req, res) => {
    try {
        const provider = engine.walletService.getProvider();
        const [blockNumber, network, feeData] = await Promise.all([
            provider.getBlockNumber(),
            provider.getNetwork(),
            provider.getFeeData(),
        ]);
        res.json({
            network: 'Ethereum Sepolia',
            chainId: Number(network.chainId),
            currentBlock: blockNumber,
            gasPrice: feeData.gasPrice ? `${(Number(feeData.gasPrice) / 1e9).toFixed(2)} Gwei` : 'unknown',
            rpcUrl: config.rpcUrl,
            explorerUrl: 'https://sepolia.etherscan.io',
        });
    } catch (error) {
        res.status(500).json({ error: String(error) });
    }
});

// ── Subscription Routes ────────────────────────────────────────

// Subscribe to trader
app.post('/api/subscriptions', (req, res) => {
    try {
        const { walletId, traderAddress, maxTradeSize } = req.body;
        if (!walletId || !traderAddress) {
            res.status(400).json({ error: 'walletId and traderAddress are required' });
            return;
        }
        const sub = engine.subscriptionManager.subscribe(walletId, traderAddress, maxTradeSize);
        res.json(sub);
    } catch (error) {
        res.status(500).json({ error: String(error) });
    }
});

// List subscriptions
app.get('/api/subscriptions', (_req, res) => {
    res.json({ subscriptions: engine.subscriptionManager.getAllSubscriptions() });
});

// Unsubscribe
app.delete('/api/subscriptions/:id', (req, res) => {
    const success = engine.subscriptionManager.unsubscribe(req.params.id);
    res.json({ success });
});

// ── Trade Routes ───────────────────────────────────────────────

// Simulate a trade (demo mode)
app.post('/api/trades/simulate', async (req, res) => {
    try {
        const { traderAddress } = req.body;
        if (!traderAddress) {
            res.status(400).json({ error: 'traderAddress is required' });
            return;
        }
        const result = await engine.processSimulatedTrade(traderAddress);
        res.json({
            tradeEvent: result.tradeEvent,
            riskAssessment: result.riskAssessment,
            executions: result.executions,
            profitShares: result.profitShares,
            reasoningLog: result.reasoningLog,
            totalTimeMs: result.totalTimeMs,
        });
    } catch (error) {
        res.status(500).json({ error: String(error) });
    }
});

// Get trade history
app.get('/api/trades/history', (_req, res) => {
    res.json({ history: engine.getTradeHistory() });
});

// Get reasoning logs
app.get('/api/agents/reasoning', (_req, res) => {
    res.json({ logs: engine.getReasoningLogs() });
});

// Get pipeline results
app.get('/api/agents/pipeline-results', (_req, res) => {
    res.json({ results: engine.orchestrator.getPipelineResults() });
});

// ── Engine Control ─────────────────────────────────────────────

// Start monitoring
app.post('/api/engine/start', (_req, res) => {
    engine.start();
    res.json({ status: 'started' });
});

// Stop monitoring
app.post('/api/engine/stop', (_req, res) => {
    engine.stop();
    res.json({ status: 'stopped' });
});

// ── MCP Tool Proxy ─────────────────────────────────────────────

// List available MCP tools
app.get('/api/mcp/tools', (_req, res) => {
    res.json({ tools: mcpServer.listTools() });
});

// Call an MCP tool
app.post('/api/mcp/call', async (req, res) => {
    try {
        const { tool, params } = req.body;
        if (!tool) {
            res.status(400).json({ error: 'tool name is required' });
            return;
        }
        const result = await mcpServer.callTool(tool, params || {});
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: String(error) });
    }
});

// ── Dashboard fallback ─────────────────────────────────────────
app.get('/', (_req, res) => {
    res.sendFile(path.join(dashboardPath, 'index.html'));
});

// ─── Start Server ──────────────────────────────────────────────
app.listen(config.port, () => {
    logger.info(`\n${'═'.repeat(60)}`);
    logger.info('  🏛️  AUTONOMOUS COPY TRADING SYNDICATE');
    logger.info('  Tether Hackathon Galáctica: WDK Edition 1');
    logger.info(`${'─'.repeat(60)}`);
    logger.info(`  Server:    http://localhost:${config.port}`);
    logger.info(`  Dashboard: http://localhost:${config.port}`);
    logger.info(`  API:       http://localhost:${config.port}/api`);
    logger.info(`  Network:   Ethereum Sepolia (chain ${config.chainId})`);
    logger.info(`  USDt:      ${config.usdtAddress}`);
    logger.info(`  Mode:      REAL BLOCKCHAIN (${config.rpcUrl})`);
    logger.info(`${'═'.repeat(60)}\n`);
});

export { app, engine, mcpServer };

