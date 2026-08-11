export async function runV5ConfirmedFollowups({
  context,
  onReceipt,
  refresh,
  afterConfirm,
}) {
  onReceipt?.(context)
  try {
    await refresh?.(context.account)
  } catch {}
  await afterConfirm?.(context)
}
