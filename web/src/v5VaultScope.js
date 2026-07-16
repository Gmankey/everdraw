const ADDRESS_PATTERN = /^0x[0-9a-f]{40}$/i

export function scopeV5RowsToVault(rows, vaultAddress) {
  const activeVault = String(vaultAddress || '').toLowerCase()
  if (!ADDRESS_PATTERN.test(activeVault)) return []
  return (Array.isArray(rows) ? rows : []).filter(
    (row) => String(row?.vault_address || '').toLowerCase() === activeVault
  )
}
