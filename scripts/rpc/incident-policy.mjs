export function isDirectPaidProvider(url) {
  const hostname = new URL(url).hostname.toLowerCase();
  return hostname === "alchemy.com" || hostname.endsWith(".alchemy.com");
}

export function assertRpcIncidentPolicy(url) {
  if (!isDirectPaidProvider(url)) return;
  const error = new Error(
    "RPC incident policy: direct paid-provider access is disabled; use the budgeted RPC egress gateway",
  );
  error.code = "RPC_POLICY_DENIED";
  throw error;
}

export function disableHiddenTransportRetries(request) {
  request.retryFunc = async () => false;
  return request;
}
