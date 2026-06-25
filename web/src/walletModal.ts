function getInjectedProvider() {
  if (typeof window === 'undefined') return null
  return window.ethereum || null
}

async function getAccounts(provider) {
  try {
    const accounts = await provider.request({ method: 'eth_accounts' })
    return Array.isArray(accounts) ? accounts : []
  } catch {
    return []
  }
}

export const modal = {
  getWalletProvider() {
    return getInjectedProvider() || undefined
  },

  async open() {
    const provider = getInjectedProvider()
    if (!provider) throw new Error('No injected wallet found. Install MetaMask or Rabby.')
    await provider.request({ method: 'eth_requestAccounts' })
  },

  subscribeProvider(callback) {
    const provider = getInjectedProvider()
    if (!provider) return () => {}

    const emit = async () => {
      const accounts = await getAccounts(provider)
      callback({
        isConnected: accounts.length > 0,
        provider,
        address: accounts[0],
      })
    }

    const onAccountsChanged = () => { emit().catch(() => {}) }
    const onChainChanged = () => { emit().catch(() => {}) }

    provider.on?.('accountsChanged', onAccountsChanged)
    provider.on?.('chainChanged', onChainChanged)
    emit().catch(() => {})

    return () => {
      provider.removeListener?.('accountsChanged', onAccountsChanged)
      provider.removeListener?.('chainChanged', onChainChanged)
    }
  },
}
