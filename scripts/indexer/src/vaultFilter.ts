const ADDRESS_PATTERN = /^0x[0-9a-f]{40}$/i;

export type VaultQuery = {
  valid: boolean;
  address: string | null;
};

export function normalizeVaultQuery(value: unknown): VaultQuery {
  if (value == null || value === '') return { valid: true, address: null };
  if (typeof value !== 'string' || !ADDRESS_PATTERN.test(value)) return { valid: false, address: null };
  return { valid: true, address: value.toLowerCase() };
}

export function scopeRowsByVault<T extends { vaultAddress: string }>(rows: T[], vaultAddress: string | null): T[] {
  if (!vaultAddress) return rows;
  return rows.filter((row) => row.vaultAddress.toLowerCase() === vaultAddress);
}
