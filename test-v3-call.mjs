import { ethers } from 'ethers';

async function main() {
    const provider = new ethers.JsonRpcProvider('https://ethereum-sepolia-rpc.publicnode.com');
    const V3_ROUTER = '0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E';
    const smartAccountAddress = '0x8Fa7f32f7A3ced08b55d96DdaEd135fd3C8a7305';
    
    const WETH = '0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14';
    const LINK = '0x779877A7B0D9E8603169DdbD7836e478b4624789';
    const amountIn = ethers.parseUnits('0.0001', 18);

    const V3_ABI = ["function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) payable returns (uint256 amountOut)"];
    const v3 = new ethers.Interface(V3_ABI);
    
    // Simulate with all 4 fees!
    for (const fee of [100, 500, 3000, 10000]) {
        try {
            const swapData = v3.encodeFunctionData("exactInputSingle", [{
                tokenIn: WETH,
                tokenOut: LINK,
                fee: fee,
                recipient: smartAccountAddress,
                deadline: Math.floor(Date.now() / 1000) + 60 * 20,
                amountIn: amountIn,
                amountOutMinimum: 0n,
                sqrtPriceLimitX96: 0n
            }]);
            
            // To simulate, we need WETH. We can impersonate a large WETH holder or just ignore error and decode.
            // Using standard provider.call
            const res = await provider.call({
                from: smartAccountAddress,
                to: V3_ROUTER,
                data: swapData
            });
            console.log(`Fee ${fee} Success!`, res);
        } catch(e) {
            console.log(`Fee ${fee} Error:`, e.data || e.message);
        }
    }
}
main();
