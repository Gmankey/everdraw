export function buildV5ClaimManyArgs(claimProofs) {
  const pending = (Array.isArray(claimProofs) ? claimProofs : []).filter((proof) => proof?.claimable)
  return {
    leaves: pending.map((proof) => ({
      distributionId: proof.distribution_id,
      leafIndex: proof.leaf_index,
      account: proof.account,
      token: proof.token,
      amount: proof.amount,
      kind: proof.kind,
    })),
    proofs: pending.map((proof) => proof.proof),
  }
}
