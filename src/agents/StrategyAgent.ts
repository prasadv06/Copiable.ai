import { BaseAgent } from './BaseAgent.js';
import { ethers } from 'ethers';
import { config } from '../config/index.js';
import type { AgentDecision, TradeDetectedEvent, TokenInfo } from './types.js';
import { v4 as uuid } from 'uuid';

// ERC-20 Transfer event signature
const TRANSFER_TOPIC = ethers.id('Transfer(address,address,uint256)');

// Uniswap V2/V3 Swap signatures
const SWAP_V2_TOPIC = ethers.id('Swap(address,uint256,uint256,uint256,uint256,address)');

/**
 * StrategyAgent — Monitors a lead trader's wallet and detects trade activity.
 *
 * Uses nonce-based change detection:
 * 1. Checks if the trader's nonce has increased (= new transaction sent)
 * 2. If yes, scans recent blocks to find the new transaction(s)
 * 3. Decodes transaction logs to identify swaps, transfers, and contract calls
 * 4. Emits TradeDetectedEvent with structured trade data
 *
 * Falls back to scanning last 5 blocks if nonce detection fails.
 */
export class StrategyAgent extends BaseAgent {
    private provider: ethers.JsonRpcProvider;
    private lastKnownNonce: number = -1;
    private lastCheckedBlock: number = 0;
    private detectedTrades: TradeDetectedEvent[] = [];
    private processedTxHashes: Set<string> = new Set();
    private tokenCache: Map<string, TokenInfo> = new Map();

    constructor() {
        super('StrategyAgent', 'Monitors lead trader wallet and detects trade activity');
        this.provider = new ethers.JsonRpcProvider(config.rpcUrl);
    }

    async analyze(context: Record<string, unknown>): Promise<AgentDecision> {
        const traderAddress = context.traderAddress as string;
        this.addReasoning(`Scanning blockchain for transactions from lead trader: ${traderAddress}`);

        try {
            const trades = await this.detectNewTrades(traderAddress);

            if (trades.length === 0) {
                return {
                    decision: 'SKIP',
                    confidence: 100,
                    reasoning: 'No new trade activity detected from lead trader',
                    details: {},
                };
            }

            this.detectedTrades.push(...trades);

            this.addReasoning(`🎯 Detected ${trades.length} trade(s) from lead trader`, {
                trades: trades.map(t => ({
                    type: t.type,
                    tokenIn: t.tokenIn.symbol,
                    tokenOut: t.tokenOut.symbol,
                    amountIn: t.amountIn,
                    txHash: t.txHash.slice(0, 12) + '...',
                })),
            });

            return {
                decision: 'APPROVE',
                confidence: 90,
                reasoning: `Detected ${trades.length} trade(s) from lead trader wallet`,
                details: { trades },
            };
        } catch (error) {
            this.addReasoning(`Error scanning blockchain: ${error}`);
            return {
                decision: 'SKIP',
                confidence: 50,
                reasoning: `Scan error: ${error}`,
                details: {},
            };
        }
    }

    /**
     * Detect new trades using nonce comparison + block scanning.
     *
     * Step 1: Check if the trader's nonce increased (fast, single RPC call).
     * Step 2: If nonce changed, scan recent blocks to find the transaction (slower).
     * Step 3: If this is the first run, just record the current nonce and wait.
     */
    private async detectNewTrades(traderAddress: string): Promise<TradeDetectedEvent[]> {
        const addr = traderAddress.toLowerCase();

        // Step 1: Get current nonce and block number
        const [currentNonce, currentBlock] = await Promise.all([
            this.provider.getTransactionCount(addr, 'latest'),
            this.provider.getBlockNumber(),
        ]);

        this.addReasoning(`Nonce check: current=${currentNonce}, lastKnown=${this.lastKnownNonce}, block=${currentBlock}`);

        // First run: initialize and skip
        if (this.lastKnownNonce === -1) {
            this.lastKnownNonce = currentNonce;
            this.lastCheckedBlock = currentBlock;
            this.addReasoning(`First run — initialized nonce=${currentNonce}, block=${currentBlock}. Watching for changes...`);
            return [];
        }

        // No new transactions
        if (currentNonce <= this.lastKnownNonce) {
            this.addReasoning(`No new transactions (nonce unchanged at ${currentNonce})`);
            // Still update lastCheckedBlock so we don't rescan old blocks
            this.lastCheckedBlock = currentBlock;
            return [];
        }

        // ✅ Nonce increased! New transaction(s) detected.
        const newTxCount = currentNonce - this.lastKnownNonce;
        this.addReasoning(`🚨 Nonce increased by ${newTxCount}! Scanning blocks ${this.lastCheckedBlock} to ${currentBlock} for new transaction(s)...`);

        // Update nonce immediately to avoid re-processing
        this.lastKnownNonce = currentNonce;

        // Step 2: Scan blocks to find the new transaction(s)
        const trades = await this.scanBlocksForTrader(addr, this.lastCheckedBlock, currentBlock);
        this.lastCheckedBlock = currentBlock;

        return trades;
    }

    /**
     * Scan a range of blocks to find transactions from the trader.
     * Uses getBlock with prefetchedTransactions to get full tx data in one call per block.
     */
    private async scanBlocksForTrader(
        traderAddress: string,
        fromBlock: number,
        toBlock: number
    ): Promise<TradeDetectedEvent[]> {
        const trades: TradeDetectedEvent[] = [];

        // Limit scan range to last 20 blocks max to avoid timeout
        const startBlock = Math.max(fromBlock, toBlock - 20);

        for (let blockNum = startBlock; blockNum <= toBlock; blockNum++) {
            try {
                // Fetch block WITH full transaction objects
                const block = await this.provider.getBlock(blockNum, true);
                if (!block) continue;

                // Use prefetched transactions to avoid individual RPC calls
                const txs = block.prefetchedTransactions || [];
                if (txs.length === 0) continue;

                // Check each transaction in the block
                for (const tx of txs) {
                    const txHash = tx.hash;
                    if (this.processedTxHashes.has(txHash.toLowerCase())) continue;

                    try {
                        // Only care about transactions FROM the lead trader
                        if (tx.from.toLowerCase() !== traderAddress) continue;

                        this.addReasoning(`📍 Found tx from trader in block ${blockNum}: ${txHash.slice(0, 14)}...`);
                        this.processedTxHashes.add(txHash.toLowerCase());

                        // Get receipt for log analysis
                        const receipt = await this.provider.getTransactionReceipt(txHash);
                        if (!receipt) {
                            this.addReasoning(`⚠️ Could not get receipt for ${txHash.slice(0, 14)}... creating basic event`);
                            trades.push({
                                id: uuid(),
                                timestamp: new Date().toISOString(),
                                traderAddress,
                                txHash: tx.hash,
                                type: tx.value > 0n ? 'TRANSFER' : 'CONTRACT_INTERACTION',
                                tokenIn: { address: '0x0', symbol: tx.value > 0n ? 'ETH' : 'CONTRACT', decimals: 18 },
                                tokenOut: { address: tx.to || '0x0', symbol: tx.value > 0n ? 'ETH' : 'CALL', decimals: 18 },
                                amountIn: tx.value > 0n ? ethers.formatEther(tx.value) : '0.01',
                                amountOut: '0',
                                gasUsed: '21000',
                                gasPriceGwei: ethers.formatUnits(tx.gasPrice || 0n, 'gwei'),
                            });
                            continue;
                        }

                        const trade = await this.decodeTrade(tx, receipt, traderAddress);
                        if (trade) {
                            trades.push(trade);
                        }
                    } catch (txErr) {
                        this.addReasoning(`⚠️ Error fetching tx ${txHash.slice(0, 14)}...: ${txErr}`);
                        continue;
                    }
                }
            } catch (blockErr) {
                this.addReasoning(`⚠️ Error fetching block ${blockNum}: ${blockErr}`);
                continue;
            }
        }

        if (trades.length === 0) {
            this.addReasoning(`No matching transactions found in blocks ${startBlock}-${toBlock}. The tx might be in a block we already passed.`);
        }

        return trades;
    }

    /**
     * Decode a transaction into a TradeDetectedEvent.
     */
    private async decodeTrade(
        tx: ethers.TransactionResponse,
        receipt: ethers.TransactionReceipt,
        traderAddress: string
    ): Promise<TradeDetectedEvent | null> {
        const addr = traderAddress.toLowerCase();
        
        // 1. Identify what the trader sent (tokenIn)
        let tokenInAddress = '0x0';
        let amountIn = ethers.formatEther(tx.value || 0n);
        
        // If they didn't send ETH, they must be sending an ERC20 token
        if (tx.value === 0n) {
            // Find a Transfer log where `from` is the trader
            const sentLog = receipt.logs.find(log => 
                log.topics[0] === TRANSFER_TOPIC && 
                log.topics.length >= 2 && 
                ethers.dataSlice(log.topics[1], 12).toLowerCase() === addr
            );
            if (sentLog) {
                tokenInAddress = sentLog.address;
                amountIn = '0.01'; // Fallback for ERC20 amounts simplified
            }
        }

        // 2. Identify what the trader received (tokenOut)
        let tokenOutAddress = '0x0';
        
        // Find a Transfer log where `to` is the trader
        const receivedLog = receipt.logs.find(log => 
            log.topics[0] === TRANSFER_TOPIC && 
            log.topics.length >= 3 && 
            ethers.dataSlice(log.topics[2], 12).toLowerCase() === addr
        );
        
        if (receivedLog) {
            tokenOutAddress = receivedLog.address;
        }

        const swapLog = receipt.logs.find(log => log.topics[0] === SWAP_V2_TOPIC);

        // A trade is a SWAP if we identified both an IN and an OUT, 
        // OR if tokenIn is ETH ('0x0' and tx.value > 0) and we have a tokenOut!
        const isSwap = swapLog || 
                       (tokenInAddress !== '0x0' && tokenOutAddress !== '0x0') || 
                       (tokenInAddress === '0x0' && tokenOutAddress !== '0x0' && tx.value > 0n);

        if (isSwap) {
            const tokenIn = await this.resolveToken(tokenInAddress);
            const tokenOut = await this.resolveToken(tokenOutAddress);

            return {
                id: uuid(),
                timestamp: new Date().toISOString(),
                traderAddress,
                txHash: tx.hash,
                type: 'SWAP',
                tokenIn,
                tokenOut,
                amountIn: amountIn === '0.0' ? '0.01' : amountIn,
                amountOut: '0',
                gasUsed: receipt.gasUsed.toString(),
                gasPriceGwei: ethers.formatUnits(receipt.gasPrice || 0n, 'gwei'),
            };
        }

        if (tokenOutAddress !== '0x0' || tokenInAddress !== '0x0') {
            const tokenAddress = tokenOutAddress !== '0x0' ? tokenOutAddress : tokenInAddress;
            const token = await this.resolveToken(tokenAddress);
            return {
                id: uuid(),
                timestamp: new Date().toISOString(),
                traderAddress,
                txHash: tx.hash,
                type: 'TRANSFER',
                tokenIn: token,
                tokenOut: token,
                amountIn: amountIn === '0.0' ? '0.01' : amountIn,
                amountOut: '0',
                gasUsed: receipt.gasUsed.toString(),
                gasPriceGwei: ethers.formatUnits(receipt.gasPrice || 0n, 'gwei'),
            };
        }

        if (tx.value > 0n) {
            // Native ETH transfer
            return {
                id: uuid(),
                timestamp: new Date().toISOString(),
                traderAddress,
                txHash: tx.hash,
                type: 'TRANSFER',
                tokenIn: { address: '0x0', symbol: 'ETH', decimals: 18 },
                tokenOut: { address: '0x0', symbol: 'ETH', decimals: 18 },
                amountIn: ethers.formatEther(tx.value),
                amountOut: ethers.formatEther(tx.value),
                gasUsed: receipt.gasUsed.toString(),
                gasPriceGwei: ethers.formatUnits(receipt.gasPrice || 0n, 'gwei'),
            };
        }

        // Catch-all: contract interaction (WETH wrap, approve, etc.)
        return {
            id: uuid(),
            timestamp: new Date().toISOString(),
            traderAddress,
            txHash: tx.hash,
            type: 'CONTRACT_INTERACTION',
            tokenIn: { address: tx.to || '0x0', symbol: 'CONTRACT', decimals: 18 },
            tokenOut: { address: tx.to || '0x0', symbol: 'CALL', decimals: 18 },
            amountIn: '0.01',
            amountOut: '0',
            gasUsed: receipt.gasUsed.toString(),
            gasPriceGwei: ethers.formatUnits(receipt.gasPrice || 0n, 'gwei'),
        };
    }

    /**
     * Resolve a token address to TokenInfo.
     */
    private async resolveToken(address: string): Promise<TokenInfo> {
        const addr = address.toLowerCase();

        const known = config.knownTokens.get(addr);
        if (known) {
            return { address, symbol: known.symbol, decimals: known.decimals };
        }

        if (this.tokenCache.has(addr)) {
            return this.tokenCache.get(addr)!;
        }

        try {
            const contract = new ethers.Contract(
                address,
                ['function symbol() view returns (string)', 'function decimals() view returns (uint8)'],
                this.provider
            );
            
            const [symbol, decimals] = await Promise.all([
                contract.symbol().catch(() => 'UNKNOWN'),
                contract.decimals().catch(() => 18)
            ]);

            const info = { address, symbol, decimals: Number(decimals) };
            this.tokenCache.set(addr, info);
            return info;
        } catch {
            const info = { address, symbol: 'UNKNOWN', decimals: 18 };
            this.tokenCache.set(addr, info);
            return info;
        }
    }

    /**
     * Create a simulated trade event (for demo purposes).
     */
    static createSimulatedTrade(traderAddress: string, overrides?: Partial<TradeDetectedEvent>): TradeDetectedEvent {
        return {
            id: uuid(),
            timestamp: new Date().toISOString(),
            traderAddress,
            txHash: `0x${Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('')}`,
            type: 'SWAP',
            tokenIn: { address: config.wethAddress, symbol: 'WETH', decimals: 18 },
            tokenOut: { address: config.usdtAddress, symbol: 'USDt', decimals: 6 },
            amountIn: '0.5',
            amountOut: '950.00',
            gasUsed: '185000',
            gasPriceGwei: '2.5',
            ...overrides,
        };
    }

    getDetectedTrades(): TradeDetectedEvent[] {
        return [...this.detectedTrades];
    }

    resetLastBlock(): void {
        this.lastCheckedBlock = 0;
        this.lastKnownNonce = -1;
        this.processedTxHashes.clear();
    }
}
