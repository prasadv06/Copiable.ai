const { ethers } = require('ethers');

async function main() {
    const provider = new ethers.JsonRpcProvider('https://ethereum-sepolia-rpc.publicnode.com');
    const factory = new ethers.Contract('0x0227628f3F023bb0B980b67D528571c95c6DaC1c', [
        'function getPool(address, address, uint24) view returns (address)'
    ], provider);
    
    const WETH = '0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14';
    const LINK = '0x779877A7B0D9E8603169DdbD7836e478b4624789';
    
    for (const fee of [100, 500, 3000, 10000]) {
        const pool = await factory.getPool(WETH, LINK, fee);
        console.log(`Fee ${fee}: ${pool}`);
        if (pool !== '0x0000000000000000000000000000000000000000') {
             const poolContract = new ethers.Contract(pool, ['function slot0() view returns (uint160,int24,uint16,uint16,uint16,uint8,bool)'], provider);
             const slot = await poolContract.slot0().catch(()=>'error');
             console.log(`Slot0:`, slot);
        }
    }
}
main();
