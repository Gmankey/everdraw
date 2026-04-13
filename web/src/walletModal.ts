// mainnet config — chain 143
import { createWeb3Modal, defaultConfig } from '@web3modal/ethers'

const chainId = Number(import.meta.env.VITE_CHAIN_ID) || 143
const isMainnet = chainId === 143

const monadChain = {
  chainId,
  name: isMainnet ? 'Monad' : 'Monad Testnet',
  currency: 'MON',
  explorerUrl: isMainnet ? 'https://monadexplorer.com' : 'https://testnet.monadexplorer.com',
  rpcUrl: import.meta.env.VITE_RPC_URL || (isMainnet ? 'https://rpc.monad.xyz' : 'https://testnet-rpc.monad.xyz'),
}

const metadata = {
  name: 'EverDraw',
  description: 'No-loss lottery on Monad. Win the pot or keep your lot.',
  url: 'https://everdraw.xyz',
  icons: ['https://everdraw.xyz/favicon.png'],
}

export const modal = createWeb3Modal({
  ethersConfig: defaultConfig({
    metadata,
    auth: {
      email: false,
      socials: [],
    },
  }),
  chains: [monadChain],
  projectId: import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || 'demo-project-id',
  enableAnalytics: false,
  enableSwaps: false,
  enableOnramp: false,
})

