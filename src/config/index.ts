import dotenv from 'dotenv';
dotenv.config();

export const config = {
    // Ethereum Sepolia Testnet
    chainId: 11155111,
    rpcUrl: process.env.SEPOLIA_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com',

    // Pimlico (bundler & paymaster for ERC-4337)
    pimlicoApiKey: process.env.PIMLICO_API_KEY || '',
    get bundlerUrl() {
        return `https://api.pimlico.io/v1/sepolia/rpc?apikey=${this.pimlicoApiKey}`;
    },
    get paymasterUrl() {
        return `https://api.pimlico.io/v2/sepolia/rpc?apikey=${this.pimlicoApiKey}`;
    },

    // ERC-4337 contracts on Sepolia
    entryPointAddress: '0x0000000071727De22E5E9d8BAf0edAc6f37da032',
    paymasterAddress: '0x777777777777AeC03fd955926DbF81597e66834C',
    safeModulesVersion: '0.3.0' as const,

    // USDt mock on Sepolia
    usdtAddress: '0xd077a400968890eacc75cdc901f0356c943e4fdb',

    // WETH on Sepolia
    wethAddress: '0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9',

    // USDC and AAVE on Sepolia
    usdcAddress: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
    aaveAddress: '0x5bb220afc6e2e008cb2302a83536a019ed245aa2',

    // Common token addresses for risk checks
    knownTokens: new Map<string, { symbol: string; decimals: number; trusted: boolean }>([
        ['0xd077a400968890eacc75cdc901f0356c943e4fdb', { symbol: 'USDt', decimals: 6, trusted: true }],
        ['0x7b79995e5f793a07bc00c21412e50ecae098e7f9', { symbol: 'WETH', decimals: 18, trusted: true }],
        ['0x1c7d4b196cb0c7b01d743fbc6116a902379c7238', { symbol: 'USDC', decimals: 6, trusted: true }],
        ['0x5bb220afc6e2e008cb2302a83536a019ed245aa2', { symbol: 'AAVE', decimals: 18, trusted: true }],
    ]),

    // Agent configuration
    performanceFeePct: 2, // 2% performance fee to lead trader
    maxSlippagePct: 5,    // reject trades with >5% slippage
    maxGasCostUsd: 50,    // reject trades where gas > $50
    minLiquidityUsd: 1000, // reject tokens with <$1000 liquidity
    monitorIntervalMs: 10_000, // poll every 10 seconds

    // Server
    port: parseInt(process.env.PORT || '3001', 10),

    // Transfer max fee (in wei)
    transferMaxFee: 100_000_000_000_000,

    // OpenAI (optional — for enhanced agent reasoning)
    openaiApiKey: process.env.OPENAI_API_KEY || '',
};
