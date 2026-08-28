export async function runV5ConfirmedFollowups({
  context,
  onReceipt,
  refresh,
  afterConfirm,
}) {
  onReceipt?.(context)
  try {
    await refresh?.(context.account)
  } catch {
    // Refresh failure must not turn a confirmed transaction into a failed action.
  }
  await afterConfirm?.(context)
}
