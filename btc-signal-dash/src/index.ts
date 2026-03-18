import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

type Config = {
  symbol: string;
  timezone: string;
  polling: { market_ms: number; slow_ms: number; polymarket_ms?: number };
  sessions: { eu_open_utc: string; us_open_utc: string };
  telegram: { bot_token: string; chat_id: string };
};

type SlowState = {
  fundingPct: number;
  oiNow: number;
  oiPrev: number | null;
  oiDelta1hUsd: number;
  lsRatio: number;
  updatedAt: number;
};

type PolyState = { lines: string[]; ageSec: number | null; updatedAt: number };

type AlertState = { eu: string | null; us: string | null };

type Snapshot = {
  price: number;
  regime: string;
  sigma: number;
  cvd15: number;
  cvd60: number;
  fundingPct: number;
  oiDelta1hUsd: number;
  lsRatio: number;
  walls: { put: string; call: string };
  poly: { lines: string[]; ageSec: number | null };
};

const BINANCE = 'https://api.binance.com';
const BINANCE_FAPI = 'https://fapi.binance.com';
const DERIBIT = 'https://www.deribit.com/api/v2';
const POLY_GAMMA = 'https://gamma-api.polymarket.com';

function loadConfig(): Config {
  const cfgPath = path.resolve(process.cwd(), 'config/default.yaml');
  const raw = fs.readFileSync(cfgPath, 'utf8');
  return yaml.load(raw) as Config;
}

async function jget<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { 'user-agent': 'btc-signal-dash/0.1' } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} @ ${url}`);
  return (await res.json()) as T;
}

function fmtMoney(n: number): string {
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function fmtPct(n: number): string {
  return `${n >= 0 ? '+' : ''}${n.toFixed(4)}%`;
}

function toAest(ts = Date.now(), tz = 'Australia/Sydney'): string {
  return new Intl.DateTimeFormat('en-AU', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date(ts));
}

function parseUtcHm(hm: string, now = new Date()): Date {
  const [h, m] = hm.split(':').map(Number);
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), h, m, 0));
  if (d.getTime() <= now.getTime()) d.setUTCDate(d.getUTCDate() + 1);
  return d;
}

function countdown(to: Date): string {
  const ms = to.getTime() - Date.now();
  const mins = Math.max(0, Math.floor(ms / 60000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `in ${h}h ${m}m` : `in ${m}m`;
}

function loadAlertState(): AlertState {
  try {
    const p = path.resolve(process.cwd(), 'data/alert-state.json');
    const raw = fs.readFileSync(p, 'utf8');
    const j = JSON.parse(raw);
    return { eu: j?.eu ?? null, us: j?.us ?? null };
  } catch {
    return { eu: null, us: null };
  }
}

function saveAlertState(s: AlertState): void {
  const p = path.resolve(process.cwd(), 'data/alert-state.json');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(s, null, 2));
}

async function sendTelegram(token: string, chatId: string, text: string): Promise<void> {
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const body = new URLSearchParams({ chat_id: chatId, text, disable_web_page_preview: 'true' });
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`telegram ${res.status}: ${t}`);
  }
}

function buildSnapshotText(kind: 'EU' | 'US', openAt: Date, s: Snapshot): string {
  const polyLines = s.poly.lines.slice(0, 4).map((l) => `- ${l}`).join('\n');
  const stale = s.poly.ageSec !== null && s.poly.ageSec > 60;
  const age = s.poly.ageSec === null ? 'n/a ⚠ unavailable' : `${s.poly.ageSec}s ${stale ? '⚠ stale' : '✓'}`;

  return [
    `🔔 ${kind} session opens in 15m (${openAt.toUTCString()})`,
    `PRICE: ${fmtMoney(s.price)} (${kind} pre-open snapshot)`,
    `REGIME: ${s.regime} (sigma_1h ${s.sigma.toFixed(2)}%)`,
    `CVD 15m/60m: ${s.cvd15 >= 0 ? '+' : ''}${s.cvd15.toFixed(2)} / ${s.cvd60 >= 0 ? '+' : ''}${s.cvd60.toFixed(2)}`,
    `FUNDING: ${fmtPct(s.fundingPct)} | OI Δ1h: ${fmtMoney(s.oiDelta1hUsd)} | L/S: ${s.lsRatio.toFixed(2)}`,
    `OPTIONS: Put ${s.walls.put} | Call ${s.walls.call}`,
    `POLY BTC brackets:\n${polyLines}\n(quote age: ${age})`,
  ].join('\n');
}

async function fetchBinancePrice(symbol: string): Promise<number> {
  const q = new URLSearchParams({ symbol }).toString();
  const r = await jget<{ price: string }>(`${BINANCE}/api/v3/ticker/price?${q}`);
  return Number(r.price);
}

async function fetchKlines(symbol: string, interval: string, limit: number): Promise<any[]> {
  const q = new URLSearchParams({ symbol, interval, limit: String(limit) }).toString();
  return await jget<any[]>(`${BINANCE}/api/v3/klines?${q}`);
}

function sigma1hPctFrom1m(klines: any[]): number {
  const closes = klines.map((k) => Number(k[4]));
  const rets: number[] = [];
  for (let i = 1; i < closes.length; i++) rets.push(Math.log(closes[i] / closes[i - 1]));
  const mean = rets.reduce((a, b) => a + b, 0) / Math.max(1, rets.length);
  const varr = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, rets.length - 1);
  const sd = Math.sqrt(varr);
  return sd * 100;
}

function proxyCvdNorm(klines: any[]): number {
  const vals = klines.map((k) => {
    const vol = Number(k[5]);
    const takerBuy = Number(k[9]);
    if (!vol) return 0;
    return (2 * takerBuy - vol) / vol;
  });
  return vals.reduce((a, b) => a + b, 0) / Math.max(1, vals.length);
}

function regimeFromSigma(sigmaPct: number): 'LOW_VOL' | 'HIGH_VOL' | 'TREND' {
  if (sigmaPct < 0.18) return 'LOW_VOL';
  if (sigmaPct < 0.45) return 'HIGH_VOL';
  return 'TREND';
}

async function fetchSlow(symbol: string, prevOi: number | null): Promise<SlowState> {
  const qs = new URLSearchParams({ symbol, limit: '1' }).toString();
  const [funding, oi, ls] = await Promise.all([
    jget<any[]>(`${BINANCE_FAPI}/fapi/v1/fundingRate?${qs}`),
    jget<{ openInterest: string }>(`${BINANCE_FAPI}/fapi/v1/openInterest?symbol=${symbol}`),
    jget<any[]>(`${BINANCE_FAPI}/futures/data/globalLongShortAccountRatio?symbol=${symbol}&period=1h&limit=1`),
  ]);

  const oiNow = Number(oi.openInterest);
  const oiDelta1hUsd = prevOi ? (oiNow - prevOi) * (await fetchBinancePrice(symbol)) : 0;

  return {
    fundingPct: Number(funding[0]?.fundingRate ?? 0) * 100,
    oiNow,
    oiPrev: prevOi,
    oiDelta1hUsd,
    lsRatio: Number(ls[0]?.longShortRatio ?? 1),
    updatedAt: Date.now(),
  };
}

async function fetchDeribitWalls(spot: number): Promise<{ put: string; call: string }> {
  const data = await jget<any>(`${DERIBIT}/public/get_book_summary_by_currency?currency=BTC&kind=option`);
  const rows = data?.result ?? [];
  const lo = spot * 0.9;
  const hi = spot * 1.1;

  let bestPut = { strike: 0, oi: 0 };
  let bestCall = { strike: 0, oi: 0 };

  for (const r of rows) {
    const inst: string = r.instrument_name || '';
    const oi = Number(r.open_interest ?? 0);
    const m = inst.match(/^BTC-\d{1,2}[A-Z]{3}\d{2}-(\d+)-(P|C)$/);
    if (!m) continue;

    const strike = Number(m[1]);
    if (!Number.isFinite(strike) || strike < lo || strike > hi) continue;

    const side = m[2];
    if (side === 'P' && oi > bestPut.oi) bestPut = { strike, oi };
    if (side === 'C' && oi > bestCall.oi) bestCall = { strike, oi };
  }

  const fmtWall = (w: { strike: number; oi: number }, side: 'put' | 'call') => {
    if (!w.strike || !w.oi) return `${side} wall n/a (±10% band)`;
    return `${Math.round(w.strike / 1000)}k (${Math.round(w.oi).toLocaleString()} BTC)`;
  };

  return {
    put: fmtWall(bestPut, 'put'),
    call: fmtWall(bestCall, 'call'),
  };
}

async function fetchPolymarketBrackets(price: number): Promise<{ lines: string[]; ageSec: number | null }> {
  const fallback = () => {
    const lo = Math.floor((price - 2000) / 2000) * 2000;
    return {
      lines: [
        `${Math.floor(lo / 1000)}-${Math.floor((lo + 2000) / 1000)}k: n/a`,
        `${Math.floor((lo + 2000) / 1000)}-${Math.floor((lo + 4000) / 1000)}k: n/a`,
        `${Math.floor((lo + 4000) / 1000)}-${Math.floor((lo + 6000) / 1000)}k: n/a`,
        `${Math.floor((lo + 6000) / 1000)}-${Math.floor((lo + 8000) / 1000)}k: n/a`,
      ],
      ageSec: null as number | null,
    };
  };

  const asArr = (v: unknown): unknown[] => {
    if (Array.isArray(v)) return v;
    if (typeof v === 'string') {
      try {
        const j = JSON.parse(v);
        if (Array.isArray(j)) return j;
      } catch {
        // ignore
      }
    }
    return [];
  };

  const toYesPrice = (m: any): { px: number; source: 'mid' | 'last' | 'indicative' | 'na' } => {
    const bid = Number(m?.bestBid ?? NaN);
    const ask = Number(m?.bestAsk ?? NaN);
    if (Number.isFinite(bid) && Number.isFinite(ask) && bid >= 0 && ask >= 0 && ask >= bid) {
      return { px: (bid + ask) / 2, source: 'mid' };
    }

    const outcomes = asArr(m?.outcomes).map(String).map((s) => s.toLowerCase());
    const prices = asArr(m?.outcomePrices).map((x) => Number(x));
    const yesIx = outcomes.findIndex((o) => o === 'yes');
    if (yesIx >= 0 && Number.isFinite(prices[yesIx])) {
      return { px: prices[yesIx], source: 'indicative' };
    }

    const p = Number(m?.lastTradePrice ?? NaN);
    if (Number.isFinite(p)) return { px: p, source: 'last' };

    return { px: NaN, source: 'na' };
  };

  try {
    const markets = await jget<any[]>(`${POLY_GAMMA}/markets?limit=500&active=true&closed=false&tag_id=235`);

    // Primary path: explicit daily range brackets.
    const reBetween = /between \$(\d{1,3}(?:,\d{3})*) and \$(\d{1,3}(?:,\d{3})*) on ([a-z]+ \d{1,2})\?/i;
    const betweenRows = markets
      .map((m) => {
        const q = String(m?.question ?? '');
        const hit = q.match(reBetween);
        if (!hit) return null;

        const low = Number(hit[1].replaceAll(',', ''));
        const high = Number(hit[2].replaceAll(',', ''));
        const dateLabel = hit[3].toLowerCase();
        const yes = toYesPrice(m);
        const updatedMs = Number(m?.updatedAt ? Date.parse(m.updatedAt) : NaN);

        return {
          low,
          high,
          dateLabel,
          yesPx: Number.isFinite(yes.px) ? Math.max(0, Math.min(1, yes.px)) : NaN,
          source: yes.source,
          updatedMs: Number.isFinite(updatedMs) ? updatedMs : NaN,
        };
      })
      .filter(
        (x): x is { low: number; high: number; dateLabel: string; yesPx: number; source: 'mid' | 'last' | 'indicative' | 'na'; updatedMs: number } =>
          !!x
      );

    const now = new Date();
    const todayLabel = now.toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'America/New_York' }).toLowerCase();
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const tomorrowLabel = tomorrow.toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'America/New_York' }).toLowerCase();

    if (betweenRows.length >= 4) {
      const byToday = betweenRows.filter((p) => p.dateLabel === todayLabel);
      const byTomorrow = betweenRows.filter((p) => p.dateLabel === tomorrowLabel);
      const set = byToday.length >= 4 ? byToday : byTomorrow.length >= 4 ? byTomorrow : betweenRows;

      const sorted = set.sort((a, b) => a.low - b.low);
      let idx = sorted.findIndex((r) => price >= r.low && price < r.high);
      if (idx < 0) {
        idx = sorted.reduce((best, r, i) => {
          const mid = (r.low + r.high) / 2;
          const bestMid = (sorted[best].low + sorted[best].high) / 2;
          return Math.abs(mid - price) < Math.abs(bestMid - price) ? i : best;
        }, 0);
      }

      const start = Math.max(0, Math.min(sorted.length - 4, idx - 1));
      const picked = sorted.slice(start, start + 4);
      const lines = picked.map((r) => {
        const label = Number.isFinite(r.yesPx) ? `${Math.round(r.yesPx * 100)}¢` : 'n/a';
        const src = r.source === 'last' ? ' (last trade)' : r.source === 'indicative' ? ' (indicative)' : '';
        return `${Math.floor(r.low / 1000)}-${Math.floor(r.high / 1000)}k: ${label}${src}`;
      });
      const ageSecVals = picked
        .map((p) => (Number.isFinite(p.updatedMs) ? Math.max(0, Math.round((Date.now() - p.updatedMs) / 1000)) : NaN))
        .filter(Number.isFinite);
      const ageSec = ageSecVals.length ? Math.max(...(ageSecVals as number[])) : null;
      return { lines, ageSec };
    }

    // Fallback path: derive wide annual brackets from "reach" ladder if explicit brackets are unavailable.
    const reReach = /will bitcoin reach \$(\d{1,3}(?:,\d{3})*) by ([a-z]+ \d{1,2}, \d{4})\?/i;
    const ladder = markets
      .map((m) => {
        const q = String(m?.question ?? '');
        const hit = q.match(reReach);
        if (!hit) return null;
        const strike = Number(hit[1].replaceAll(',', ''));
        const yes = toYesPrice(m);
        const updatedMs = Number(m?.updatedAt ? Date.parse(m.updatedAt) : NaN);
        return {
          strike,
          expiry: hit[2].toLowerCase(),
          yesPx: Number.isFinite(yes.px) ? Math.max(0, Math.min(1, yes.px)) : NaN,
          updatedMs: Number.isFinite(updatedMs) ? updatedMs : NaN,
        };
      })
      .filter((x): x is { strike: number; expiry: string; yesPx: number; updatedMs: number } => !!x && Number.isFinite(x.strike));

    if (ladder.length < 6) return fallback();

    const byExpiry = new Map<string, { strike: number; expiry: string; yesPx: number; updatedMs: number }[]>();
    for (const r of ladder) {
      if (!byExpiry.has(r.expiry)) byExpiry.set(r.expiry, []);
      byExpiry.get(r.expiry)!.push(r);
    }

    const sortedExp = [...byExpiry.entries()].sort((a, b) => b[1].length - a[1].length);
    const set = sortedExp[0][1].sort((a, b) => a.strike - b.strike);
    if (set.length < 6) return fallback();

    const rows: { low: number; high: number; p: number; updatedMs: number }[] = [];
    for (let i = 0; i < set.length - 1; i++) {
      const low = set[i].strike;
      const high = set[i + 1].strike;
      const p = Number.isFinite(set[i].yesPx) && Number.isFinite(set[i + 1].yesPx) ? Math.max(0, Math.min(1, set[i].yesPx - set[i + 1].yesPx)) : NaN;
      rows.push({ low, high, p, updatedMs: Math.max(set[i].updatedMs, set[i + 1].updatedMs) });
    }

    let idx = rows.findIndex((r) => price >= r.low && price < r.high);
    if (idx < 0) {
      idx = rows.reduce((best, r, i) => {
        const mid = (r.low + r.high) / 2;
        const bestMid = (rows[best].low + rows[best].high) / 2;
        return Math.abs(mid - price) < Math.abs(bestMid - price) ? i : best;
      }, 0);
    }

    const start = Math.max(0, Math.min(rows.length - 4, idx - 1));
    const picked = rows.slice(start, start + 4);
    const lines = picked.map((r) => `${Math.floor(r.low / 1000)}-${Math.floor(r.high / 1000)}k: ${Number.isFinite(r.p) ? `${Math.round(r.p * 100)}¢` : 'n/a'} (derived)`);
    const ageSecVals = picked
      .map((p) => (Number.isFinite(p.updatedMs) ? Math.max(0, Math.round((Date.now() - p.updatedMs) / 1000)) : NaN))
      .filter(Number.isFinite);
    const ageSec = ageSecVals.length ? Math.max(...(ageSecVals as number[])) : null;
    return { lines, ageSec };
  } catch {
    return fallback();
  }
}

function breakoutLine(price: number, step: number): string {
  const boundary = Math.round(price / step) * step;
  return `NONE (last boundary: ${Math.floor(boundary / 1000)}k, score: pending)`;
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  let slow: SlowState = {
    fundingPct: 0,
    oiNow: 0,
    oiPrev: null,
    oiDelta1hUsd: 0,
    lsRatio: 1,
    updatedAt: 0,
  };
  let polyState: PolyState = { lines: ['n/a', 'n/a', 'n/a', 'n/a'], ageSec: null, updatedAt: 0 };
  const alertState = loadAlertState();

  const polyFastMs = cfg.polling.polymarket_ms ?? cfg.polling.market_ms;

  console.log('BTC Signal Dash Ticket 1 process started.');

  while (true) {
    try {
      if (Date.now() - slow.updatedAt > cfg.polling.slow_ms) {
        slow = await fetchSlow(cfg.symbol, slow.oiNow || null);
      }

      const price = await fetchBinancePrice(cfg.symbol);

      if (Date.now() - polyState.updatedAt > polyFastMs) {
        const p = await fetchPolymarketBrackets(price);
        polyState = { ...p, updatedAt: Date.now() };
      }

      const [k15, k60, walls] = await Promise.all([
        fetchKlines(cfg.symbol, '1m', 15),
        fetchKlines(cfg.symbol, '1m', 60),
        fetchDeribitWalls(price),
      ]);

      const sigma = sigma1hPctFrom1m(k60);
      const regime = regimeFromSigma(sigma);
      const cvd15 = proxyCvdNorm(k15);
      const cvd60 = proxyCvdNorm(k60);

      const eu = parseUtcHm(cfg.sessions.eu_open_utc);
      const us = parseUtcHm(cfg.sessions.us_open_utc);

      const lsInterpret = slow.lsRatio > 1.6 ? 'longs crowded — reversion setup' : slow.lsRatio < 0.8 ? 'shorts crowded — squeeze setup' : 'neutral';
      const fundingInterpret = slow.fundingPct > 0 ? 'longs paying — elevated' : 'shorts paying — elevated';
      const oiInterpret = slow.oiDelta1hUsd >= 0 ? 'new positions opening' : 'positions closing';

      console.clear();
      console.log(`=== BTC Signal Dash | ${toAest(Date.now(), cfg.timezone)} AEST ===\n`);
      console.log(`PRICE: ${fmtMoney(price)} (Binance ${cfg.symbol} spot)`);
      console.log(`REGIME: ${regime} (sigma_1h: ${sigma.toFixed(2)}%)\n`);

      console.log('PROXY CVD:');
      console.log(` 15m: ${cvd15 >= 0 ? '+' : ''}${cvd15.toFixed(2)} (normalized)`);
      console.log(` 60m: ${cvd60 >= 0 ? '+' : ''}${cvd60.toFixed(2)} (normalized)\n`);

      console.log(`BREAKOUT: ${breakoutLine(price, 2000)}\n`);
      console.log(`FUNDING: ${fmtPct(slow.fundingPct)} (${fundingInterpret})`);
      console.log(`OI DELTA: ${fmtMoney(slow.oiDelta1hUsd)} last 1h (${oiInterpret})`);
      console.log(`L/S RATIO: ${slow.lsRatio.toFixed(2)} (${lsInterpret})\n`);

      console.log(`OPTIONS: Put wall ${walls.put} | Call wall ${walls.call}\n`);

      console.log('SESSIONS:');
      console.log(` EU open: ${countdown(eu)}`);
      console.log(` US open: ${countdown(us)}\n`);

      console.log('POLYMARKET (24h BTC):');
      for (const line of polyState.lines.slice(0, 4)) console.log(` ${line}`);
      const stale = polyState.ageSec !== null && polyState.ageSec > 60;
      const ageLabel = polyState.ageSec === null ? 'n/a' : `${polyState.ageSec}s`;
      const ageStatus = polyState.ageSec === null ? '⚠ unavailable' : stale ? '⚠ stale (>60s)' : '✓';
      console.log(` (quote age: ${ageLabel} ${ageStatus})`);

      // Ticket 2: Telegram pre-session alerts (15 minutes before open), one per session per day.
      if (cfg.telegram.bot_token && cfg.telegram.chat_id) {
        const snapshot: Snapshot = {
          price,
          regime,
          sigma,
          cvd15,
          cvd60,
          fundingPct: slow.fundingPct,
          oiDelta1hUsd: slow.oiDelta1hUsd,
          lsRatio: slow.lsRatio,
          walls,
          poly: { lines: polyState.lines, ageSec: polyState.ageSec },
        };

        const checkAndSend = async (kind: 'EU' | 'US', openAt: Date, keyName: 'eu' | 'us') => {
          const msToOpen = openAt.getTime() - Date.now();
          const dayKey = openAt.toISOString().slice(0, 10);
          const inWindow = msToOpen <= 15 * 60_000 && msToOpen > 14 * 60_000;
          if (!inWindow) return;
          if (alertState[keyName] === dayKey) return;

          const text = buildSnapshotText(kind, openAt, snapshot);
          await sendTelegram(cfg.telegram.bot_token, cfg.telegram.chat_id, text);
          alertState[keyName] = dayKey;
          saveAlertState(alertState);
          console.log(`[telegram] sent ${kind} pre-open alert for ${dayKey}`);
        };

        await checkAndSend('EU', eu, 'eu');
        await checkAndSend('US', us, 'us');
      }
    } catch (err: any) {
      console.error('tick error:', err?.message ?? err);
    }

    await new Promise((r) => setTimeout(r, cfg.polling.market_ms));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
