import { v4 as uuid } from 'uuid';
import { ethers } from 'ethers';
import WDK from '@tetherto/wdk';
import WalletManagerEvmErc4337 from '@tetherto/wdk-wallet-evm-erc-4337';
import ParaSwapProtocolEvm from '@tetherto/wdk-protocol-swap-velora-evm';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import type { ManagedWallet, WalletBalance } from '../agents/types.js';

// ─── ERC-20 ABI fragment for balance queries ──────────────────
const ERC20_ABI = [
    'function balanceOf(address owner) view returns (uint256)',
    'function decimals() view returns (uint8)',
    'function symbol() view returns (string)',
    'function transfer(address to, uint256 amount) returns (bool)',
];
/**
 * WDK EVM ERC-4337 wallet configuration for Sepolia testnet.
 */
const WDK_EVM_CONFIG = {
    chainId: config.chainId,
    provider: config.rpcUrl,
    safeModulesVersion: config.safeModulesVersion,
    entryPointAddress: config.entryPointAddress,
    bundlerUrl: config.bundlerUrl,
    paymasterUrl: config.paymasterUrl,
    paymasterAddress: config.paymasterAddress,
    paymasterToken: { address: config.usdtAddress },
};

/**
 * WalletService — Self-custodial wallet operations via Tether's WDK.
 *
 * Uses @tetherto/wdk (Wallet Development Kit) and @tetherto/wdk-wallet-evm
 * for BIP-39 seed phrase generation, BIP-44 key derivation, and EVM
 * wallet account management on Ethereum Sepolia.
 *
 * WDK Docs: https://docs.wallet.tether.io
 * WDK GitHub: https://github.com/tetherto/wdk-core
 */
export class WalletService {
    private wallets: Map<string, ManagedWallet> = new Map();
    private wdkInstances: Map<string, { wdk: InstanceType<typeof WDK>; account: any }> = new Map();
    private provider: ethers.JsonRpcProvider;

    constructor() {
        this.provider = new ethers.JsonRpcProvider(config.rpcUrl);
    }

    /**
     * Create a new self-custodial wallet using Tether's WDK.
     *
     * Uses WDK.getRandomSeedPhrase() for BIP-39 mnemonic generation,
     * then WDK.registerWallet() + getAccount() for EVM account derivation.
     */
    async createWallet(label: string, isLeadTrader = false): Promise<ManagedWallet> {
        // ─── Step 1: Generate seed phrase via WDK ────────────────
        const seedPhrase = WDK.getRandomSeedPhrase();

        logger.info(`🔐 WDK: Generated BIP-39 seed phrase for "${label}"`);

        // ─── Step 2: Initialize WDK with the seed ────────────────
        // @ts-ignore: WDK loosely types plugins but strictly checks EVM base classes
        const wdk = new WDK(seedPhrase)
            .registerWallet('ethereum', WalletManagerEvmErc4337 as any, WDK_EVM_CONFIG as any);

        // ─── Step 3: Derive account via WDK (BIP-44 m/44'/60'/0'/0/0) ──
        const account = await wdk.getAccount('ethereum', 0);
        const address = await account.getAddress();

        logger.info(`🔑 WDK ERC-4337: Derived Smart Account: ${address.slice(0, 8)}...${address.slice(-4)}`);

        const wallet: ManagedWallet = {
            id: uuid(),
            label,
            seedPhrase,
            address,
            createdAt: new Date().toISOString(),
            isLeadTrader,
        };

        this.wallets.set(wallet.id, wallet);
        this.wdkInstances.set(wallet.id, { wdk, account });

        logger.info(`🔑 Wallet created via WDK: ${label} (${address.slice(0, 8)}...${address.slice(-4)})`, {
            walletId: wallet.id,
            isLeadTrader,
            sdk: '@tetherto/wdk + @tetherto/wdk-wallet-evm-erc-4337',
        });

        return wallet;
    }

    /**
     * Import a wallet from an existing seed phrase via WDK.
     */
    async importWallet(label: string, seedPhrase: string, isLeadTrader = false, existingId?: string): Promise<ManagedWallet> {
        // Validate seed phrase via WDK
        if (!WDK.isValidSeed(seedPhrase)) {
            throw new Error('Invalid seed phrase — WDK validation failed');
        }

        // @ts-ignore: WDK loosely types plugins but strictly checks EVM base classes
        const wdk = new WDK(seedPhrase)
            .registerWallet('ethereum', WalletManagerEvmErc4337 as any, WDK_EVM_CONFIG as any);

        const account = await wdk.getAccount('ethereum', 0);
        const address = await account.getAddress();

        const wallet: ManagedWallet = {
            id: existingId || uuid(),
            label,
            seedPhrase,
            address,
            createdAt: new Date().toISOString(),
            isLeadTrader,
        };

        this.wallets.set(wallet.id, wallet);
        this.wdkInstances.set(wallet.id, { wdk, account });
        logger.info(`📥 Wallet imported via WDK ERC-4337: ${label} (${address.slice(0, 8)}...)`);

        return wallet;
    }

    /**
     * Get wallet balances (ETH + USDt on Sepolia).
     * Uses WDK account.getBalance() for ETH, and account.getTokenBalance() for USDt.
     */
    async getBalance(address: string): Promise<WalletBalance> {
        const SEP_WETH = '0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14';
        const SEP_LINK = '0x779877A7B0D9E8603169DdbD7836e478b4624789';

        try {
            // Try WDK account first (for managed wallets)
            const wdkEntry = this.findWdkByAddress(address);
            if (wdkEntry) {
                const ethBalanceWei = await wdkEntry.account.getBalance();
                let usdtBalance = 0n, wethBalance = 0n, linkBalance = 0n, usdcBalance = 0n, aaveBalance = 0n;
                try {
                    usdtBalance = await wdkEntry.account.getTokenBalance(config.usdtAddress);
                    wethBalance = await wdkEntry.account.getTokenBalance(SEP_WETH);
                    linkBalance = await wdkEntry.account.getTokenBalance(SEP_LINK);
                    usdcBalance = await wdkEntry.account.getTokenBalance(config.usdcAddress);
                    aaveBalance = await wdkEntry.account.getTokenBalance(config.aaveAddress);
                } catch { }

                return {
                    address,
                    ethBalance: ethers.formatEther(ethBalanceWei),
                    usdtBalance: ethers.formatUnits(usdtBalance, 6),
                    wethBalance: ethers.formatEther(wethBalance),
                    linkBalance: ethers.formatEther(linkBalance),
                    usdcBalance: ethers.formatUnits(usdcBalance, 6),
                    aaveBalance: ethers.formatEther(aaveBalance),
                    lastUpdated: new Date().toISOString(),
                };
            }

            // Fallback to ethers.js for external addresses
            const ethBalance = await this.provider.getBalance(address);
            const usdtContract = new ethers.Contract(config.usdtAddress, ERC20_ABI, this.provider);
            const wethContract = new ethers.Contract(SEP_WETH, ERC20_ABI, this.provider);
            const linkContract = new ethers.Contract(SEP_LINK, ERC20_ABI, this.provider);
            const usdcContract = new ethers.Contract(config.usdcAddress, ERC20_ABI, this.provider);
            const aaveContract = new ethers.Contract(config.aaveAddress, ERC20_ABI, this.provider);
            let usdtBalance = 0n, wethBalance = 0n, linkBalance = 0n, usdcBalance = 0n, aaveBalance = 0n;

            try {
                usdtBalance = await usdtContract.balanceOf(address);
                wethBalance = await wethContract.balanceOf(address);
                linkBalance = await linkContract.balanceOf(address);
                usdcBalance = await usdcContract.balanceOf(address);
                aaveBalance = await aaveContract.balanceOf(address);
            } catch { }

            return {
                address,
                ethBalance: ethers.formatEther(ethBalance),
                usdtBalance: ethers.formatUnits(usdtBalance, 6),
                wethBalance: ethers.formatEther(wethBalance),
                linkBalance: ethers.formatEther(linkBalance),
                usdcBalance: ethers.formatUnits(usdcBalance, 6),
                aaveBalance: ethers.formatEther(aaveBalance),
                lastUpdated: new Date().toISOString(),
            };
        } catch (error) {
            logger.warn(`Failed to fetch balance for ${address}: ${error}`);
            return {
                address,
                ethBalance: '0.0',
                usdtBalance: '0.0',
                lastUpdated: new Date().toISOString(),
            };
        }
    }

    /**
     * Send a native ETH transaction via WDK's sendTransaction.
     * Falls back to ethers.js if WDK instance not available.
     */
    async sendETH(walletId: string, toAddress: string, amountEth: string): Promise<string> {
        const wallet = this.wallets.get(walletId);
        if (!wallet) throw new Error(`Wallet not found: ${walletId}`);

        const wdkEntry = this.wdkInstances.get(walletId);

        if (wdkEntry) {
            // Send via WDK's sendTransaction
            logger.info(`📤 WDK sendTransaction: ${amountEth} ETH → ${toAddress.slice(0, 8)}...`);
            const result = await wdkEntry.account.sendTransaction({
                to: toAddress,
                value: ethers.parseEther(amountEth),
            });
            logger.info(`📤 WDK TX sent: ${result.hash.slice(0, 10)}...`);
            return result.hash;
        }

        // Fallback to ethers.js signer
        const mnemonic = ethers.Mnemonic.fromPhrase(wallet.seedPhrase);
        const hdNode = ethers.HDNodeWallet.fromMnemonic(mnemonic, `m/44'/60'/0'/0/0`);
        const signer = hdNode.connect(this.provider);

        const tx = await signer.sendTransaction({
            to: toAddress,
            value: ethers.parseEther(amountEth),
        });

        logger.info(`📤 ETH sent: ${amountEth} ETH → ${toAddress.slice(0, 8)}... (tx: ${tx.hash.slice(0, 10)}...)`);
        await tx.wait();
        return tx.hash;
    }

    /**
     * Send an ERC-20 token transfer (USDt) via WDK's transfer method.
     */
    async sendToken(
        walletId: string,
        toAddress: string,
        tokenAddress: string,
        amount: string,
        decimals: number = 6
    ): Promise<string> {
        const wallet = this.wallets.get(walletId);
        if (!wallet) throw new Error(`Wallet not found: ${walletId}`);

        const wdkEntry = this.wdkInstances.get(walletId);

        if (wdkEntry) {
            // Use WDK's transfer method
            logger.info(`📤 WDK transfer: ${amount} tokens → ${toAddress.slice(0, 8)}...`);
            const result = await wdkEntry.account.transfer({
                token: tokenAddress,
                recipient: toAddress,
                amount: ethers.parseUnits(amount, decimals),
            });
            logger.info(`📤 WDK token TX: ${result.hash.slice(0, 10)}...`);
            return result.hash;
        }

        // Fallback to ethers.js
        const mnemonic = ethers.Mnemonic.fromPhrase(wallet.seedPhrase);
        const hdNode = ethers.HDNodeWallet.fromMnemonic(mnemonic, `m/44'/60'/0'/0/0`);
        const signer = hdNode.connect(this.provider);

        const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, signer);
        const parsedAmount = ethers.parseUnits(amount, decimals);

        const tx = await tokenContract.transfer(toAddress, parsedAmount);
        logger.info(`📤 Token sent: ${amount} → ${toAddress.slice(0, 8)}... (tx: ${tx.hash.slice(0, 10)}...)`);
        await tx.wait();
        return tx.hash;
    }

    /**
     * Swap tokens using WDK Velora aggregator (ParaSwap) via ERC-4337
     */
    async swapTokens(
        walletId: string,
        tokenInAddress: string,
        tokenOutAddress: string,
        amountInStr: string,
        decimals: number = 18
    ): Promise<string> {
        const wdkEntry = this.wdkInstances.get(walletId);
        if (!wdkEntry) throw new Error(`Wallet not found or not initialized in WDK: ${walletId}`);

        logger.info(`🔄 WDK Velora Swap (or V3 Fallback): ${amountInStr} ${tokenInAddress.slice(0, 8)} → ${tokenOutAddress.slice(0, 8)}...`);
        const amountIn = ethers.parseUnits(amountInStr, decimals);

        if (config.chainId === 11155111) {
            logger.info(`⚡ Sepolia Testnet detected natively — bypassing Velora limits by injecting real Uniswap V3 Smart Account transaction!`);
            const V3_ROUTER = '0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E';
            const wethAddress = '0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14';
            
            const tIn = (tokenInAddress === '0x0' || tokenInAddress.toLowerCase() === config.wethAddress.toLowerCase()) ? wethAddress : tokenInAddress;
            const tOut = (tokenOutAddress === '0x0' || tokenOutAddress.toLowerCase() === config.wethAddress.toLowerCase()) ? wethAddress : tokenOutAddress;

            const ERC20_ABI_LOCAL = ['function approve(address spender, uint256 amount) returns (bool)'];
            const erc20 = new ethers.Interface(ERC20_ABI_LOCAL);
            const approveData = erc20.encodeFunctionData('approve', [V3_ROUTER, amountIn]);

            const V3_ABI = ["function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) payable returns (uint256 amountOut)"];
            const v3 = new ethers.Interface(V3_ABI);
            
            const smartAccountAddress = await wdkEntry.account.getAddress();
            const swapData = v3.encodeFunctionData("exactInputSingle", [{
                tokenIn: tIn,
                tokenOut: tOut,
                fee: 10000,
                recipient: smartAccountAddress,
                amountIn: amountIn,
                amountOutMinimum: 0n,
                sqrtPriceLimitX96: 0n
            }]);

            const batchTxs = [];

            // If the input token is WETH, automatically wrap the Native ETH
            if (tIn.toLowerCase() === wethAddress.toLowerCase()) {
                const WETH_ABI = ['function deposit() payable'];
                const wethIface = new ethers.Interface(WETH_ABI);
                logger.info(`📤 ERC-4337 Batch includes: Native ETH to WETH Wrapper`);
                batchTxs.push({ to: wethAddress, data: wethIface.encodeFunctionData('deposit'), value: amountIn });
            }

            logger.info(`📤 ERC-4337 Batch includes: Router Approval & V3 Swap`);
            batchTxs.push({ to: tIn, data: approveData, value: 0n });
            batchTxs.push({ to: V3_ROUTER, data: swapData, value: 0n });

            logger.info(`⚡ Pushing atomic ERC-4337 Multi-Call Batch to Pimlico (Paid in USDt)...`);
            const result = await wdkEntry.account.sendTransaction(batchTxs);

            logger.info(`✅ WDK Swap Batch TX sent: ${result.hash.slice(0, 10)}... (Paid gas in USDt)`);
            return result.hash;
        }

        logger.info(`Executing production Velora ParaSwap protocol...`);
        const swapProtocol = new ParaSwapProtocolEvm(wdkEntry.account);
        const NATIVE_ETH = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';
        const tIn = (tokenInAddress === '0x0' || tokenInAddress.toLowerCase() === config.wethAddress.toLowerCase()) ? NATIVE_ETH : tokenInAddress;
        const tOut = (tokenOutAddress === '0x0' || tokenOutAddress.toLowerCase() === config.wethAddress.toLowerCase()) ? NATIVE_ETH : tokenOutAddress;

        const result = await swapProtocol.swap(
            { tokenIn: tIn, tokenOut: tOut, tokenInAmount: amountIn },
            { paymasterToken: config.usdtAddress }
        );

        logger.info(`✅ WDK Swap TX sent: ${result.hash.slice(0, 10)}... (Paid gas in USDt)`);
        return result.hash;
    }

    /**
     * Estimate gas cost for a transaction (in ETH).
     */
    async estimateGasCost(toAddress: string, amountEth: string): Promise<string> {
        try {
            const feeData = await this.provider.getFeeData();
            const gasEstimate = await this.provider.estimateGas({
                to: toAddress,
                value: ethers.parseEther(amountEth),
            });
            const gasCost = gasEstimate * (feeData.gasPrice || 0n);
            return ethers.formatEther(gasCost);
        } catch {
            return '0.001'; // default estimate
        }
    }

    /**
     * Get a signer for a wallet (for advanced operations).
     */
    getSigner(walletId: string): ethers.HDNodeWallet {
        const wallet = this.wallets.get(walletId);
        if (!wallet) throw new Error(`Wallet not found: ${walletId}`);

        const mnemonic = ethers.Mnemonic.fromPhrase(wallet.seedPhrase);
        return ethers.HDNodeWallet.fromMnemonic(mnemonic, `m/44'/60'/0'/0/0`).connect(this.provider);
    }

    // ─── Private helpers ────────────────────────────────────────

    private findWdkByAddress(address: string): { wdk: InstanceType<typeof WDK>; account: any } | undefined {
        for (const [id, wallet] of this.wallets.entries()) {
            if (wallet.address.toLowerCase() === address.toLowerCase()) {
                return this.wdkInstances.get(id);
            }
        }
        return undefined;
    }

    // ─── Accessors ──────────────────────────────────────────────

    getWallet(walletId: string): ManagedWallet | undefined {
        return this.wallets.get(walletId);
    }

    getWalletByAddress(address: string): ManagedWallet | undefined {
        for (const w of this.wallets.values()) {
            if (w.address.toLowerCase() === address.toLowerCase()) return w;
        }
        return undefined;
    }

    getAllWallets(): ManagedWallet[] {
        return Array.from(this.wallets.values());
    }

    getLeadTraders(): ManagedWallet[] {
        return this.getAllWallets().filter(w => w.isLeadTrader);
    }

    getProvider(): ethers.JsonRpcProvider {
        return this.provider;
    }
}
