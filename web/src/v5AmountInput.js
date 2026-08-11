import { formatEther } from 'ethers'

export function formatV5MaxInput(wei, { isDeposit = false } = {}) {
  const formatted = formatEther(BigInt(wei || 0n))
  if (!isDeposit) return formatted

  const [whole, decimals = ''] = formatted.split('.')
  const trimmed = decimals.slice(0, 4).replace(/0+$/, '')
  return trimmed ? `${whole}.${trimmed}` : whole
}
