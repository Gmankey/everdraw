export async function claimFinalizedDrawSafely(drawId, claim, onError = async () => {}) {
  try {
    return await claim();
  } catch (err) {
    const detail = err?.shortMessage || err?.reason || err?.message || String(err);
    const message = `claim draw ${drawId} failed; continuing lifecycle: ${detail}`;
    console.error(message);
    await onError(err, message);
    return false;
  }
}
