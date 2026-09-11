export function v5WalletModalView(account) {
  return account ? 'Account' : 'Connect'
}

export function v5WalletSessionAccount(session, providerAccounts = []) {
  if (!session?.isConnected) return ''
  const candidate = session.address || providerAccounts[0] || ''
  return String(candidate)
}

export function sameWalletAccount(left, right) {
  return String(left || '').toLowerCase() === String(right || '').toLowerCase()
}
