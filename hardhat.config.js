import "dotenv/config";
import "@nomicfoundation/hardhat-ethers";

const PRIVATE_KEY = process.env.PRIVATE_KEY || "";

/** @type {import('hardhat/config').HardhatUserConfig} */
export default {
  solidity: {
    version: "0.8.33",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      viaIR: true
    }
  },
  paths: {
    sources: "./src",
    tests: "./test-js",
    cache: "./cache-hardhat",
    artifacts: "./artifacts"
  },
  networks: {
    monadTestnet: {
      url: process.env.MONAD_TESTNET_RPC_URL || "",
      chainId: Number(process.env.MONAD_TESTNET_CHAIN_ID || 10143),
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : []
    },
    monadMainnet: {
      url: process.env.MONAD_MAINNET_RPC_URL || "",
      chainId: Number(process.env.MONAD_MAINNET_CHAIN_ID || 101),
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : []
    }
  }
};
