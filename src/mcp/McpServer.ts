import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import type { CopyTradeEngine } from '../trading/CopyTradeEngine.js';

/**
 * McpServer — Model Context Protocol server exposing wallet tools.
 *
 * Compatible with the wdk-mcp standard (https://github.com/dieselftw/wdk-mcp)
 * and designed to work with OpenClaw (https://openclaw.ai) or any MCP-compatible
 * AI agent framework.
 *
 * Tool names align with the wdk-mcp convention:
 *   create_wallet, get_balance, list_wallets, send_transaction, etc.
 *
 * All wallet operations use @tetherto/wdk (Tether's Wallet Development Kit)
 * for self-custodial, BIP-39/BIP-44 key management.
 *
 * References:
 *   - wdk-mcp: https://github.com/dieselftw/wdk-mcp
 *   - OpenClaw: https://github.com/openclaw/openclaw
 *   - WDK SDK: https://github.com/tetherto/wdk-core
 */

export interface McpTool {
    name: string;
    description: string;
    parameters: Record<string, { type: string; description: string; required?: boolean }>;
}

export interface McpToolResult {
    success: boolean;
    data: unknown;
    reasoning?: string;
}

export class McpServer {
    private engine: CopyTradeEngine;
    private tools: Map<string, McpTool> = new Map();
    private handlers: Map<string, (params: Record<string, unknown>) => Promise<McpToolResult>> = new Map();

    constructor(engine: CopyTradeEngine) {
        this.engine = engine;
        this.registerTools();
    }

    /**
     * Register all available MCP tools.
     */
    private registerTools(): void {
        // ── create_wallet ──────────────────────────────────
        this.registerTool(
            {
                name: 'create_wallet',
                description: 'Create a new self-custodial wallet using WDK. Generates a BIP-39 seed phrase and derives an EVM address on Sepolia testnet.',
                parameters: {
                    label: { type: 'string', description: 'Human-readable label for the wallet', required: true },
                    isLeadTrader: { type: 'boolean', description: 'Whether this wallet belongs to a lead trader' },
                },
            },
            async (params) => {
                const wallet = await this.engine.walletService.createWallet(
                    params.label as string,
                    params.isLeadTrader as boolean || false
                );
                return {
                    success: true,
                    data: {
                        walletId: wallet.id,
                        address: wallet.address,
                        label: wallet.label,
                        isLeadTrader: wallet.isLeadTrader,
                    },
                    reasoning: `Created wallet "${wallet.label}" with address ${wallet.address}`,
                };
            }
        );

        // ── get_balance ────────────────────────────────────
        this.registerTool(
            {
                name: 'get_balance',
                description: 'Get ETH and USDt balances for a wallet address on Sepolia.',
                parameters: {
                    address: { type: 'string', description: 'Ethereum address to check', required: true },
                },
            },
            async (params) => {
                const balance = await this.engine.walletService.getBalance(params.address as string);
                return {
                    success: true,
                    data: balance,
                    reasoning: `Balance for ${params.address}: ${balance.ethBalance} ETH, ${balance.usdtBalance} USDt`,
                };
            }
        );

        // ── list_wallets ───────────────────────────────────
        this.registerTool(
            {
                name: 'list_wallets',
                description: 'List all managed wallets in the system.',
                parameters: {},
            },
            async () => {
                const wallets = this.engine.walletService.getAllWallets().map(w => ({
                    id: w.id,
                    label: w.label,
                    address: w.address,
                    isLeadTrader: w.isLeadTrader,
                    createdAt: w.createdAt,
                }));
                return {
                    success: true,
                    data: { wallets, count: wallets.length },
                    reasoning: `Found ${wallets.length} wallet(s)`,
                };
            }
        );

        // ── subscribe_to_trader ────────────────────────────
        this.registerTool(
            {
                name: 'subscribe_to_trader',
                description: 'Subscribe a wallet to copy trades from a lead trader.',
                parameters: {
                    walletId: { type: 'string', description: 'Subscriber wallet ID', required: true },
                    traderAddress: { type: 'string', description: 'Lead trader address to follow', required: true },
                    maxTradeSize: { type: 'string', description: 'Maximum trade size to mirror (in ETH)' },
                },
            },
            async (params) => {
                const sub = this.engine.subscriptionManager.subscribe(
                    params.walletId as string,
                    params.traderAddress as string,
                    params.maxTradeSize as string | undefined
                );
                return {
                    success: true,
                    data: sub,
                    reasoning: `Wallet ${params.walletId} now following trader ${params.traderAddress}`,
                };
            }
        );

        // ── simulate_trade ─────────────────────────────────
        this.registerTool(
            {
                name: 'simulate_trade',
                description: 'Simulate a trade detection from a lead trader to test the agent pipeline.',
                parameters: {
                    traderAddress: { type: 'string', description: 'Lead trader address', required: true },
                },
            },
            async (params) => {
                const result = await this.engine.processSimulatedTrade(params.traderAddress as string);
                return {
                    success: true,
                    data: {
                        riskScore: result.riskAssessment.overallScore,
                        approved: result.riskAssessment.approved,
                        executionsCount: result.executions.length,
                        successfulExecutions: result.executions.filter(e => e.success).length,
                        totalTimeMs: result.totalTimeMs,
                    },
                    reasoning: result.riskAssessment.reasoning,
                };
            }
        );

        // ── get_reasoning_logs ─────────────────────────────
        this.registerTool(
            {
                name: 'get_reasoning_logs',
                description: 'Get all reasoning logs from the AI agents.',
                parameters: {},
            },
            async () => {
                const logs = this.engine.getReasoningLogs();
                return {
                    success: true,
                    data: { logs, count: logs.length },
                    reasoning: `Retrieved ${logs.length} reasoning entries`,
                };
            }
        );

        // ── get_trade_history ──────────────────────────────
        this.registerTool(
            {
                name: 'get_trade_history',
                description: 'Get the history of all processed trades.',
                parameters: {},
            },
            async () => {
                const history = this.engine.getTradeHistory();
                return {
                    success: true,
                    data: { history, count: history.length },
                    reasoning: `Retrieved ${history.length} trade history entries`,
                };
            }
        );

        // ── send_transaction ───────────────────────────────
        this.registerTool(
            {
                name: 'send_transaction',
                description: 'Send ETH from a managed wallet to an address.',
                parameters: {
                    walletId: { type: 'string', description: 'Source wallet ID', required: true },
                    toAddress: { type: 'string', description: 'Destination address', required: true },
                    amount: { type: 'string', description: 'Amount of ETH to send', required: true },
                },
            },
            async (params) => {
                const txHash = await this.engine.walletService.sendETH(
                    params.walletId as string,
                    params.toAddress as string,
                    params.amount as string
                );
                return {
                    success: true,
                    data: { txHash },
                    reasoning: `Sent ${params.amount} ETH to ${params.toAddress}`,
                };
            }
        );

        logger.info(`🔧 MCP Server: ${this.tools.size} tools registered`);
    }

    /**
     * Register a tool with its handler.
     */
    private registerTool(
        tool: McpTool,
        handler: (params: Record<string, unknown>) => Promise<McpToolResult>
    ): void {
        this.tools.set(tool.name, tool);
        this.handlers.set(tool.name, handler);
    }

    /**
     * Call a tool by name with parameters.
     */
    async callTool(name: string, params: Record<string, unknown> = {}): Promise<McpToolResult> {
        const handler = this.handlers.get(name);
        if (!handler) {
            return { success: false, data: null, reasoning: `Unknown tool: ${name}` };
        }

        try {
            logger.info(`🔧 MCP Tool Call: ${name}`, params);
            const result = await handler(params);
            return result;
        } catch (error) {
            const errMsg = error instanceof Error ? error.message : String(error);
            return { success: false, data: null, reasoning: `Tool error: ${errMsg}` };
        }
    }

    /**
     * List all available tools (for MCP discovery).
     */
    listTools(): McpTool[] {
        return Array.from(this.tools.values());
    }

    /**
     * Get tool schema (for MCP introspection).
     */
    getToolSchema(name: string): McpTool | undefined {
        return this.tools.get(name);
    }
}
