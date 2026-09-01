// mainnet config - chain 143
import { createAppKit } from '@reown/appkit/react'
import { EthersAdapter } from '@reown/appkit-adapter-ethers'
import { resolveWalletConnectProjectId } from './walletProjectId.js'

const chainId = Number(import.meta.env.VITE_CHAIN_ID) || 143
const isMainnet = chainId === 143

const monadChain = {
  id: chainId,
  name: isMainnet ? 'Monad' : 'Monad Testnet',
  nativeCurrency: { name: 'Monad', symbol: 'MON', decimals: 18 },
  rpcUrls: {
    default: {
      http: [import.meta.env.VITE_RPC_URL || (isMainnet ? 'https://rpc.monad.xyz' : 'https://testnet-rpc.monad.xyz')],
    },
  },
  blockExplorers: {
    default: { name: 'Monad Explorer', url: isMainnet ? 'https://monadexplorer.com' : 'https://testnet.monadexplorer.com' },
  },
  testnet: !isMainnet,
}

const metadata = {
  name: 'EverDraw',
  description: 'No-loss lottery on Monad. Win the pot or keep your lot.',
  url: 'https://everdraw.xyz',
  icons: ['https://everdraw.xyz/favicon.png'],
}

export const modal = createAppKit({
  adapters: [new EthersAdapter()],
  networks: [monadChain],
  metadata,
  projectId: resolveWalletConnectProjectId({
    projectId: import.meta.env.VITE_WALLETCONNECT_PROJECT_ID,
    chainId,
    production: import.meta.env.PROD,
  }),
  features: {
    analytics: false,
    email: false,
    socials: [],
    swaps: false,
    onramp: false,
  },
})
