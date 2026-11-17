import "dotenv/config";
import "@nomicfoundation/hardhat-ethers";

const PRIVATE_KEY = process.env.PRIVATE_KEY || "";

function guardedMainnetRpc() {
  const value = process.env.MONAD_MAINNET_RPC_URL || "";
  if (!value) return { url: "", httpHeaders: {} };
  const parsed = new URL(value);
  const hostname = parsed.hostname.toLowerCase();
  if (hostname === "alchemy.com" || hostname.endsWith(".alchemy.com")) {
    throw new Error("Direct paid mainnet RPC is disabled; use a scoped budget-gateway URL");
  }
  if (parsed.username || parsed.password) throw new Error("RPC credentials must not be embedded in MONAD_MAINNET_RPC_URL");
  const token = process.env.MONAD_MAINNET_RPC_BEARER_TOKEN || process.env.RPC_GATEWAY_BEARER_TOKEN || "";
  const gatewayRole = parsed.pathname.match(/^\/rpc\/([a-z0-9-]+)$/)?.[1] || "";
  if (gatewayRole && token.length < 32) throw new Error("MONAD_MAINNET_RPC_BEARER_TOKEN is required for the scoped gateway");
  const approvedGatewayHost = process.env.MONAD_MAINNET_RPC_GATEWAY_HOST || "everdraw-rpc-egress-mainnet.fly.dev";
  if (gatewayRole && parsed.hostname !== approvedGatewayHost) {
    throw new Error(`Refusing to send a gateway bearer token to unapproved host ${parsed.hostname}`);
  }
  if (!gatewayRole && token) throw new Error("Refusing to send a gateway bearer token to a non-gateway endpoint");
  return {
    url: value,
    httpHeaders: token ? { Authorization: `Bearer ${token}` } : {},
  };
}

const mainnetRpc = guardedMainnetRpc();

/** @type {import('hardhat/config').HardhatUserConfig} */
export default {
  solidity: {
    version: "0.8.33",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: "paris",
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
      url: mainnetRpc.url,
      httpHeaders: mainnetRpc.httpHeaders,
      chainId: Number(process.env.MONAD_MAINNET_CHAIN_ID || 143),
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : []
    }
  }
};
