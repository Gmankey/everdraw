export type RpcProviderRole = 'canonical' | 'logs' | 'fallback';

export interface RpcTelemetrySnapshot {
  calls: Record<string, number>;
  errors: Record<string, number>;
  wireCalls: Record<string, number>;
  wireErrors: Record<string, number>;
  fallbackReasons: Record<string, number>;
  fallbackRequestsInWindow: number;
  fallbackBudgetPerHour: number;
  fallbackBudgetScope: 'process';
  fallbackBudgetWindowStartedAt: string | null;
  lastFallbackAt: string | null;
}

export interface RpcPolicyOptions {
  timeoutMs: number;
  attempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  fallbackMaxRequestsPerHour: number;
  fallbackCooldownMs: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

function increment(target: Record<string, number>, key: string): void {
  target[key] = (target[key] ?? 0) + 1;
}

export function redactRpcSecrets(value: unknown): string {
  return String(value ?? '')
    .replace(/https?:\/\/[^\s"'<>]*(?:alchemy\.com|tenderly\.co)[^\s"'<>]*/gi, '[redacted-rpc-url]')
    .replace(/https?:\/\/[^\s"'<>]*\/v2\/[^\s"'<>]+/gi, '[redacted-rpc-url]')
    .replace(/([?&](?:api[_-]?key|access[_-]?key|token)=)[^&\s"'<>]+/gi, '$1[redacted]');
}

export class RpcPolicy {
  private readonly calls: Record<string, number> = {};
  private readonly errors: Record<string, number> = {};
  private readonly wireCalls: Record<string, number> = {};
  private readonly wireErrors: Record<string, number> = {};
  private readonly fallbackReasons: Record<string, number> = {};
  private windowStartedAt = 0;
  private fallbackRequests = 0;
  private lastFallbackAtMs = 0;
  private fallbackBlockedUntilMs = 0;

  constructor(private readonly options: RpcPolicyOptions) {}

  async request<T>(input: {
    role: Exclude<RpcProviderRole, 'fallback'>;
    method: string;
    operation: () => Promise<T>;
    fallback?: () => Promise<T>;
    fallbackReason?: string;
  }): Promise<T> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= this.options.attempts; attempt += 1) {
      try {
        return await this.attempt(input.role, input.method, input.operation);
      } catch (error) {
        lastError = error;
        if (attempt < this.options.attempts) {
          await (this.options.sleep ?? defaultSleep)(
            Math.min(this.options.maxDelayMs, this.options.baseDelayMs * (2 ** (attempt - 1))),
          );
        }
      }
    }

    if (!input.fallback) throw lastError;
    this.reserveFallback(input.fallbackReason ?? `${input.role}:${input.method}`);
    return this.attempt('fallback', input.method, input.fallback);
  }

  recordWireRequest(role: RpcProviderRole, method: string): void {
    increment(this.wireCalls, `${role}:${method}`);
  }

  recordWireError(role: RpcProviderRole, method: string): void {
    increment(this.wireErrors, `${role}:${method}`);
  }

  snapshot(): RpcTelemetrySnapshot {
    return {
      calls: { ...this.calls },
      errors: { ...this.errors },
      wireCalls: { ...this.wireCalls },
      wireErrors: { ...this.wireErrors },
      fallbackReasons: { ...this.fallbackReasons },
      fallbackRequestsInWindow: this.fallbackRequests,
      fallbackBudgetPerHour: this.options.fallbackMaxRequestsPerHour,
      fallbackBudgetScope: 'process',
      fallbackBudgetWindowStartedAt: this.windowStartedAt ? new Date(this.windowStartedAt).toISOString() : null,
      lastFallbackAt: this.lastFallbackAtMs ? new Date(this.lastFallbackAtMs).toISOString() : null,
    };
  }

  private async attempt<T>(role: RpcProviderRole, method: string, operation: () => Promise<T>): Promise<T> {
    const key = `${role}:${method}`;
    increment(this.calls, key);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${key} timed out after ${this.options.timeoutMs}ms`)),
          this.options.timeoutMs,
        );
      });
      return await Promise.race([operation(), timeout]);
    } catch (error) {
      increment(this.errors, key);
      if (role === 'fallback') {
        this.fallbackBlockedUntilMs = (this.options.now ?? Date.now)() + this.options.fallbackCooldownMs;
      }
      throw error;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private reserveFallback(reason: string): void {
    const now = (this.options.now ?? Date.now)();
    if (!this.windowStartedAt || now - this.windowStartedAt >= 3_600_000) {
      this.windowStartedAt = now;
      this.fallbackRequests = 0;
    }
    if (this.options.fallbackMaxRequestsPerHour === 0) {
      throw new Error(`Indexer fallback disabled after ${reason}`);
    }
    if (this.fallbackRequests >= this.options.fallbackMaxRequestsPerHour) {
      throw new Error(`Indexer fallback hourly budget exhausted after ${reason}`);
    }
    if (now < this.fallbackBlockedUntilMs) {
      throw new Error(`Indexer fallback cooldown active after ${reason}`);
    }
    this.fallbackRequests += 1;
    this.lastFallbackAtMs = now;
    increment(this.fallbackReasons, reason);
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
