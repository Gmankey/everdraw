import { createWeb3Modal, defaultConfig } from '@web3modal/ethers'

const monadTestnet = {
  chainId: 10143,
  name: 'Monad Testnet',
  currency: 'MON',
  explorerUrl: 'https://testnet.monadexplorer.com',
  rpcUrl: import.meta.env.VITE_RPC_URL || 'https://testnet-rpc.monad.xyz',
}

const metadata = {
  name: 'EverDraw',
  description: 'No-loss lottery on Monad. Win the pot or keep your lot.',
  url: 'https://everdraw.xyz',
  icons: ['https://everdraw.xyz/favicon.ico'],
}

export const modal = createWeb3Modal({
  ethersConfig: defaultConfig({
    metadata,
    auth: {
      email: false,
      socials: [],
      showWallets: false,
    },
  }),
  chains: [monadTestnet],
  projectId: import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || 'demo-project-id',
  enableAnalytics: false,
  enableSwaps: false,
  enableOnramp: false,
})
