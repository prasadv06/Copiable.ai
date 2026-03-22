const { ethers } = require('ethers');

const V1_ABI = ["function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) payable returns (uint256 amountOut)"];
const V2_ABI = ["function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) payable returns (uint256 amountOut)"];

console.log("V1 Selector:", new ethers.Interface(V1_ABI).getFunction("exactInputSingle").selector);
console.log("V2 Selector:", new ethers.Interface(V2_ABI).getFunction("exactInputSingle").selector);
