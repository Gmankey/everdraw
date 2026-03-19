import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
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
  fundingPredictedPct: number;
  oiNow: number;
  oiPrev: number | null;
  oiDelta1hUsd: number;
  lsRatio: number;
  updatedAt: number;
};

type PolyState = { lines: string[]; ageSec: number | null; updatedAt: number };

type AlertState = { eu: string | null; us: string | null };

type HistoryPoint = { ts: number; v: number };

type HistoryState = {
  price: HistoryPoint[];
  cvd15: HistoryPoint[];
  funding: HistoryPoint[];
  oiDelta: HistoryPoint[];
  lsRatio: HistoryPoint[];
};

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

type DashboardState = {
  updatedAt: number;
  timezone: string;
  symbol: string;
  price: number;
  regime: string;
  sigma: number;
  cvd15: number;
  cvd60: number;
  fundingPct: number;
  fundingPredictedPct: number;
  oiDelta1hUsd: number;
  lsRatio: number;
  walls: { put: string; call: string };
  sessions: { euIn: string; usIn: string; euMins: number; usMins: number };
  optionsExpiry: {
    expiryIn: string;
    expiryMins: number;
    maxPainStrike: number;
  };
  poly: { lines: string[]; ageSec: number | null };
  strategyContext: {
    regime_label: string;
    setup_text: string | null;
    setup_type: 'strat1' | 'strat2' | 'caution' | 'none';
  };
  history: HistoryState;
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

function countdownMins(to: Date): number {
  return Math.max(0, Math.floor((to.getTime() - Date.now()) / 60000));
}

function nextDeribitDailyExpiry(now = new Date()): Date {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 8, 0, 0));
  if (d.getTime() <= now.getTime()) d.setUTCDate(d.getUTCDate() + 1);
  return d;
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
  const [funding, premium, oi, ls] = await Promise.all([
    jget<any[]>(`${BINANCE_FAPI}/fapi/v1/fundingRate?${qs}`),
    jget<any>(`${BINANCE_FAPI}/fapi/v1/premiumIndex?symbol=${symbol}`),
    jget<{ openInterest: string }>(`${BINANCE_FAPI}/fapi/v1/openInterest?symbol=${symbol}`),
    jget<any[]>(`${BINANCE_FAPI}/futures/data/globalLongShortAccountRatio?symbol=${symbol}&period=1h&limit=1`),
  ]);

  const oiNow = Number(oi.openInterest);
  const spot = await fetchBinancePrice(symbol);
  const oiDelta1hUsd = prevOi ? (oiNow - prevOi) * spot : 0;

  const mark = Number(premium?.markPrice ?? NaN);
  const index = Number(premium?.indexPrice ?? NaN);
  const premiumPct = Number.isFinite(mark) && Number.isFinite(index) && index > 0 ? ((mark - index) / index) * 100 : 0;

  return {
    fundingPct: Number(funding[0]?.fundingRate ?? 0) * 100,
    fundingPredictedPct: premiumPct,
    oiNow,
    oiPrev: prevOi,
    oiDelta1hUsd,
    lsRatio: Number(ls[0]?.longShortRatio ?? 1),
    updatedAt: Date.now(),
  };
}

function parseDeribitExpiryUtc(instrumentName: string): number | null {
  const m = instrumentName.match(/^BTC-(\d{1,2}[A-Z]{3}\d{2})-\d+-(P|C)$/);
  if (!m) return null;
  const token = m[1].toUpperCase();
  const day = Number(token.slice(0, token.length - 5));
  const monTxt = token.slice(token.length - 5, token.length - 2);
  const yy = Number(token.slice(token.length - 2));
  const monMap: Record<string, number> = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };
  const month = monMap[monTxt];
  if (!Number.isFinite(day) || month === undefined || !Number.isFinite(yy)) return null;
  const year = 2000 + yy;
  return Date.UTC(year, month, day, 8, 0, 0);
}

function computeMaxPain(rows: any[], nowTs: number): number {
  const parsed = rows
    .map((r) => {
      const inst = String(r?.instrument_name ?? '');
      const m = inst.match(/^BTC-\d{1,2}[A-Z]{3}\d{2}-(\d+)-(P|C)$/);
      if (!m) return null;
      const strike = Number(m[1]);
      const side = m[2] as 'P' | 'C';
      const oi = Number(r?.open_interest ?? 0);
      const expiryTs = parseDeribitExpiryUtc(inst);
      if (!Number.isFinite(strike) || !Number.isFinite(oi) || !Number.isFinite(expiryTs)) return null;
      return { strike, side, oi, expiryTs: expiryTs as number };
    })
    .filter((x): x is { strike: number; side: 'P' | 'C'; oi: number; expiryTs: number } => !!x)
    .filter((x) => x.expiryTs >= nowTs - 60_000);

  if (!parsed.length) return 0;

  const nearestExpiryTs = parsed.reduce((best, r) => (r.expiryTs < best ? r.expiryTs : best), parsed[0].expiryTs);
  const set = parsed.filter((r) => r.expiryTs === nearestExpiryTs);
  const strikes = [...new Set(set.map((x) => x.strike))].sort((a, b) => a - b);
  if (!strikes.length) return 0;

  let bestStrike = strikes[0];
  let bestPayout = Number.POSITIVE_INFINITY;

  for (const settle of strikes) {
    let payout = 0;
    for (const x of set) {
      if (x.side === 'C') payout += x.oi * Math.max(0, settle - x.strike);
      else payout += x.oi * Math.max(0, x.strike - settle);
    }
    if (payout < bestPayout) {
      bestPayout = payout;
      bestStrike = settle;
    }
  }

  return bestStrike;
}

async function fetchDeribitWallsAndMaxPain(spot: number): Promise<{ put: string; call: string; maxPainStrike: number }> {
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
    maxPainStrike: computeMaxPain(rows, Date.now()),
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
    if (Number.isFinite(bid) && Number.isFinite(ask) && bid >= 0 && ask >= bid) {
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
          !!x,
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

    return fallback();
  } catch {
    return fallback();
  }
}

function breakoutLine(price: number, step: number): string {
  const boundary = Math.round(price / step) * step;
  return `NONE (last boundary: ${Math.floor(boundary / 1000)}k, score: pending)`;
}

function escapeHtml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function computeStrategyContext(
  regime: 'LOW_VOL' | 'HIGH_VOL' | 'TREND',
  lsRatio: number,
  fundingPct: number,
  fundingPredictedPct: number,
  cvd60: number,
  oiDelta1hUsd: number,
): DashboardState['strategyContext'] {
  const regimeLabelByRegime = {
    LOW_VOL: 'Strat 1 day — watch for breakout fakeouts to fade',
    HIGH_VOL: 'Strat 2 day — consider barbell (buy both tails)',
    TREND: 'Caution — trending, avoid mean-reversion entries',
  } as const;

  if (regime === 'LOW_VOL' && (lsRatio > 1.5 && fundingPct > 0.005)) {
    return {
      regime_label: regimeLabelByRegime[regime],
      setup_type: 'strat1',
      setup_text: 'Strat 1 setup active: crowd is long + paying funding; look for breakout fakeouts to fade.',
    };
  }

  if (regime === 'LOW_VOL' && fundingPredictedPct > 0.01 && lsRatio > 1.4) {
    return {
      regime_label: regimeLabelByRegime[regime],
      setup_type: 'strat1',
      setup_text: 'Strat 1 setup forming: predicted funding is rising while longs are crowded.',
    };
  }

  if (regime === 'HIGH_VOL' && Math.abs(cvd60) < 0.05) {
    return {
      regime_label: regimeLabelByRegime[regime],
      setup_type: 'strat2',
      setup_text: 'Strat 2 setup active: high vol with balanced flow; consider barbell exposure to both tails.',
    };
  }

  if (regime === 'TREND' && Math.abs(cvd60) > 0.15 && oiDelta1hUsd > 0) {
    return {
      regime_label: regimeLabelByRegime[regime],
      setup_type: 'caution',
      setup_text: 'Caution setup active: strong directional flow with rising OI; avoid mean-reversion entries.',
    };
  }

  return {
    regime_label: regimeLabelByRegime[regime],
    setup_type: 'none',
    setup_text: null,
  };
}

function etDayKey(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

function pushHistory(arr: HistoryPoint[], point: HistoryPoint): void {
  const bucket = Math.floor(point.ts / 60000);
  const last = arr[arr.length - 1];
  if (last && Math.floor(last.ts / 60000) === bucket) {
    last.ts = point.ts;
    last.v = point.v;
  } else {
    arr.push(point);
    if (arr.length > 1440) arr.splice(0, arr.length - 1440);
  }
}

function renderDashboardHtml(state: DashboardState | null): string {
  if (!state) {
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>BTC Signal Dash</title></head><body style="font-family:system-ui;padding:24px;background:#0b1020;color:#e8ecff"><h1>BTC Signal Dash</h1><p>Waiting for first tick…</p></body></html>`;
  }

  const updated = escapeHtml(toAest(state.updatedAt, state.timezone));
  const polyLines = state.poly.lines.map((l, i) => `<li id="poly-${i}">${escapeHtml(l)}</li>`).join('');

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>BTC Signal Dash</title>
  <style>
    :root{color-scheme:dark}
    body{font-family:Inter,system-ui,sans-serif;background:#0b1020;color:#e8ecff;margin:0;padding:20px}
    .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
    .card{background:#121a35;border:1px solid #263157;border-radius:12px;padding:14px;position:relative}
    .scanner{grid-column:span 3}
    .k{font-size:12px;opacity:.8;text-transform:uppercase;letter-spacing:.04em}
    .v{font-size:24px;font-weight:700;margin-top:4px}
    .muted{opacity:.75}
    .green{color:#4ade80}
    .red{color:#f87171}
    .amber{color:#fbbf24}
    .white{color:#fff}
    .regime-low{background:#14532d}
    .regime-trend{background:#7f1d1d}
    .regime-high{background:#fbbf24;color:#111827}
    .spark{display:block;width:120px;height:40px;margin-top:8px}
    ul{margin:8px 0 0 18px;padding:0}
    li.active-bracket{border-left:4px solid #4ade80;padding-left:8px;font-weight:700}
    .info-icon{position:absolute;top:8px;right:10px;font-size:14px;opacity:.5;cursor:help}
    .info-icon:hover::after{
      content:attr(data-tip);
      position:absolute;right:0;top:20px;
      background:#1e293b;border:1px solid #334155;
      border-radius:8px;padding:10px;width:260px;
      font-size:12px;font-weight:400;white-space:normal;
      z-index:10;color:#e8ecff;line-height:1.35;
    }
  </style>
</head>
<body>
  <h1>BTC Signal Dash</h1>
  <div class="muted" id="meta">${escapeHtml(state.symbol)} · Updated ${updated} (${escapeHtml(state.timezone)}) · <span id="updatedAgo">0s ago</span></div>

  <div class="grid" style="margin-top:12px">
    <div class="card scanner" id="scannerCard">
      <div class="info-icon" data-tip="Combines regime, funding, L/S ratio, and CVD to detect whether today favors Strat 1 (fade breakouts) or Strat 2 (buy both tails). When a setup is active, conditions are aligned for an entry.">ⓘ</div>
      <div class="k">Setup Scanner</div>
      <div class="v" id="regimeLabel">${escapeHtml(state.strategyContext.regime_label)}</div>
      <div id="setupText" class="muted">${escapeHtml(state.strategyContext.setup_text ?? 'No active setup trigger')}</div>
    </div>

    <div class="card">
      <div class="info-icon" data-tip="Live BTC spot price from Binance. Reference for which Polymarket bracket you're currently in.">ⓘ</div>
      <div class="k">Price</div><div class="v" id="price">${escapeHtml(fmtMoney(state.price))}</div>
      <canvas id="spark-price" class="spark" width="120" height="40"></canvas>
    </div>

    <div class="card">
      <div class="info-icon" data-tip="Based on 1-hour realized volatility. LOW_VOL = Strat 1 day. HIGH_VOL = Strat 2 day. TREND = caution.">ⓘ</div>
      <div class="k">Regime</div><div class="v" id="regime">${escapeHtml(state.regime)}</div><div class="muted" id="sigma">σ₁h ${state.sigma.toFixed(2)}%</div>
    </div>

    <div class="card">
      <div class="info-icon" data-tip="Proxy Cumulative Volume Delta. Positive = buyers dominating. Negative = sellers. When price breaks a bracket but CVD is flat, the move is likely a fakeout — your Strat 1 entry signal.">ⓘ</div>
      <div class="k">CVD 15m/60m</div><div class="v"><span id="cvd15">${state.cvd15.toFixed(2)}</span> / <span id="cvd60">${state.cvd60.toFixed(2)}</span></div>
      <canvas id="spark-cvd15" class="spark" width="120" height="40"></canvas>
    </div>

    <div class="card">
      <div class="info-icon" data-tip="Futures funding rate. Positive = longs paying (crowded). Negative = shorts paying. Elevated funding + crowded L/S = reversion setup. Predicted value shows where funding is heading next hour.">ⓘ</div>
      <div class="k">Funding</div>
      <div id="fundingCurrent">Current: <span id="funding">${escapeHtml(fmtPct(state.fundingPct))}</span></div>
      <div id="fundingPred">Predicted: <span id="fundingPredicted">${escapeHtml(fmtPct(state.fundingPredictedPct))}</span></div>
      <canvas id="spark-funding" class="spark" width="120" height="40"></canvas>
    </div>

    <div class="card">
      <div class="info-icon" data-tip="Open interest change last hour. Rising = new positions (conviction). Falling = positions closing (less follow-through).">ⓘ</div>
      <div class="k">OI Δ1h</div><div class="v" id="oiDelta">${escapeHtml(fmtMoney(state.oiDelta1hUsd))}</div>
      <canvas id="spark-oi" class="spark" width="120" height="40"></canvas>
    </div>

    <div class="card">
      <div class="info-icon" data-tip="Long/short account ratio. Above 1.6 = longs crowded (bearish). Below 0.8 = shorts crowded (bullish). Extremes support mean-reversion.">ⓘ</div>
      <div class="k">L/S Ratio</div><div class="v" id="lsRatio">${state.lsRatio.toFixed(2)}</div>
      <canvas id="spark-ls" class="spark" width="120" height="40"></canvas>
    </div>

    <div class="card">
      <div class="info-icon" data-tip="EU/US session opens drive the biggest BTC candles. Options expiry releases the max pain magnet — real breakouts often follow.">ⓘ</div>
      <div class="k">Countdowns</div>
      <div id="euIn">EU open: ${escapeHtml(state.sessions.euIn)}</div>
      <div id="usIn">US open: ${escapeHtml(state.sessions.usIn)}</div>
      <div id="optExpiry">Options expiry: ${escapeHtml(state.optionsExpiry.expiryIn)} (max pain: ${Math.round(state.optionsExpiry.maxPainStrike / 1000)}k)</div>
    </div>

    <div class="card">
      <div class="info-icon" data-tip="Largest put/call OI within ±10% of spot. Put wall = support, call wall = resistance. Price gravitates toward or bounces off these.">ⓘ</div>
      <div class="k">Options Walls</div><div id="putWall">Put: ${escapeHtml(state.walls.put)}</div><div id="callWall">Call: ${escapeHtml(state.walls.call)}</div>
    </div>

    <div class="card">
      <div class="info-icon" data-tip="Current 24h BTC bracket prices. Highlighted bracket = where BTC sits now. When price breaks into a new bracket, check if the old bracket drops below your entry threshold.">ⓘ</div>
      <div class="k">Polymarket Brackets</div><ul id="polyList">${polyLines}</ul><div class="muted" id="polyAge"></div>
    </div>
  </div>

  <script>
    let latest = ${JSON.stringify(state)};
    let lastUpdatedAt = latest.updatedAt;

    const setText = (id, txt) => {
      const el = document.getElementById(id);
      if (el) el.textContent = txt;
    };

    const setClass = (id, classes) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.classList.remove('green','red','amber','white','regime-low','regime-trend','regime-high');
      for (const c of classes) el.classList.add(c);
    };

    const colorByCvd = (v) => v > 0.05 ? 'green' : v < -0.05 ? 'red' : 'white';
    const colorByFunding = (v) => v < -0.0005 ? 'green' : v > 0.0005 ? 'red' : 'white';
    const colorByLs = (v) => v < 0.8 ? 'green' : v > 1.6 ? 'red' : 'white';
    const colorByOi = (v) => v > 100000 ? 'green' : v < -100000 ? 'red' : 'white';

    function sessionClass(mins){
      if (mins < 15) return 'red';
      if (mins < 30) return 'amber';
      return 'white';
    }

    function optionsClass(mins){
      if (mins < 60) return 'red';
      if (mins < 240) return 'amber';
      return 'white';
    }

    function refreshColors(s){
      setClass('cvd15', [colorByCvd(s.cvd15)]);
      setClass('cvd60', [colorByCvd(s.cvd60)]);
      setClass('funding', [colorByFunding(s.fundingPct)]);
      setClass('fundingPredicted', [colorByFunding(s.fundingPredictedPct)]);
      setClass('lsRatio', [colorByLs(s.lsRatio)]);
      setClass('oiDelta', [colorByOi(s.oiDelta1hUsd)]);

      const regimeClass = s.regime === 'LOW_VOL' ? 'regime-low' : s.regime === 'TREND' ? 'regime-trend' : 'regime-high';
      setClass('regime', [regimeClass]);

      const ageEl = document.getElementById('polyAge');
      if (ageEl) {
        const stale = s.poly.ageSec === null || s.poly.ageSec > 60;
        ageEl.textContent = s.poly.ageSec === null ? 'quote age: n/a ✖ unavailable' : ('quote age: ' + s.poly.ageSec + 's ' + (stale ? '✖ stale' : '✓ fresh'));
        ageEl.classList.remove('green','red','amber','white');
        ageEl.classList.add(stale ? 'red' : 'green');
      }

      setClass('euIn', [sessionClass(s.sessions.euMins)]);
      setClass('usIn', [sessionClass(s.sessions.usMins)]);
      setClass('optExpiry', [optionsClass(s.optionsExpiry.expiryMins)]);
    }

    function parseBracketLine(t){
      const m = t.match(/(\d+)\s*[-–—]\s*(\d+)\s*k/i);
      if (!m) return null;
      return { lo: Number(m[1]) * 1000, hi: Number(m[2]) * 1000 };
    }

    function highlightBracket(s){
      const items = Array.from(document.querySelectorAll('#polyList li'));
      for (const li of items) li.classList.remove('active-bracket');
      const p = s.price;
      for (const li of items) {
        const t = li.textContent || '';
        const b = parseBracketLine(t);
        if (!b) continue;
        if (p >= b.lo && p < b.hi) {
          li.classList.add('active-bracket');
          break;
        }
      }
    }

    function drawSparkline(canvasId, points, color){
      const c = document.getElementById(canvasId);
      if (!c || !c.getContext) return;
      const ctx = c.getContext('2d');
      if (!ctx) return;

      ctx.clearRect(0,0,c.width,c.height);
      if (!Array.isArray(points) || points.length < 2) return;

      const vals = points.map(p => Number(p.v)).filter(Number.isFinite);
      if (vals.length < 2) return;
      const min = Math.min(...vals);
      const max = Math.max(...vals);
      const span = Math.max(1e-9, max - min);

      ctx.strokeStyle = color;
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      for (let i = 0; i < vals.length; i++) {
        const x = (i / (vals.length - 1)) * (c.width - 2) + 1;
        const y = c.height - ((vals[i] - min) / span) * (c.height - 4) - 2;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    function applySparks(s){
      const cvdColor = colorByCvd(s.cvd15) === 'green' ? '#4ade80' : colorByCvd(s.cvd15) === 'red' ? '#f87171' : '#e8ecff';
      const fundingColor = colorByFunding(s.fundingPct) === 'green' ? '#4ade80' : colorByFunding(s.fundingPct) === 'red' ? '#f87171' : '#e8ecff';
      const oiColor = colorByOi(s.oiDelta1hUsd) === 'green' ? '#4ade80' : colorByOi(s.oiDelta1hUsd) === 'red' ? '#f87171' : '#e8ecff';
      const lsColor = colorByLs(s.lsRatio) === 'green' ? '#4ade80' : colorByLs(s.lsRatio) === 'red' ? '#f87171' : '#e8ecff';
      drawSparkline('spark-price', s.history?.price || [], '#60a5fa');
      drawSparkline('spark-cvd15', s.history?.cvd15 || [], cvdColor);
      drawSparkline('spark-funding', s.history?.funding || [], fundingColor);
      drawSparkline('spark-oi', s.history?.oiDelta || [], oiColor);
      drawSparkline('spark-ls', s.history?.lsRatio || [], lsColor);
    }

    function applyState(s){
      latest = s;
      lastUpdatedAt = s.updatedAt;

      setText('meta', s.symbol + ' · Updated ' + new Date(s.updatedAt).toLocaleString('en-AU', { timeZone: s.timezone }) + ' (' + s.timezone + ') · ');
      const meta = document.getElementById('meta');
      if (meta && !document.getElementById('updatedAgo')) {
        const span = document.createElement('span');
        span.id = 'updatedAgo';
        meta.appendChild(span);
      }
      setText('price', '$' + Math.round(s.price).toLocaleString());
      setText('regime', s.regime);
      setText('sigma', 'σ₁h ' + s.sigma.toFixed(2) + '%');
      setText('cvd15', s.cvd15.toFixed(2));
      setText('cvd60', s.cvd60.toFixed(2));
      setText('funding', (s.fundingPct >= 0 ? '+' : '') + s.fundingPct.toFixed(4) + '%');
      setText('fundingPredicted', (s.fundingPredictedPct >= 0 ? '+' : '') + s.fundingPredictedPct.toFixed(4) + '%');
      setText('oiDelta', '$' + Math.round(s.oiDelta1hUsd).toLocaleString());
      setText('lsRatio', s.lsRatio.toFixed(2));
      setText('euIn', 'EU open: ' + s.sessions.euIn);
      setText('usIn', 'US open: ' + s.sessions.usIn);
      setText('optExpiry', 'Options expiry: ' + s.optionsExpiry.expiryIn + ' (max pain: ' + Math.round(s.optionsExpiry.maxPainStrike / 1000) + 'k)');
      setText('putWall', 'Put: ' + s.walls.put);
      setText('callWall', 'Call: ' + s.walls.call);
      setText('regimeLabel', s.strategyContext.regime_label);
      setText('setupText', s.strategyContext.setup_text || 'No active setup trigger');

      const list = document.getElementById('polyList');
      if (list) {
        list.innerHTML = (s.poly.lines || []).map((l, i) => '<li id="poly-' + i + '">' + l.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;') + '</li>').join('');
      }

      refreshColors(s);
      highlightBracket(s);
      applySparks(s);
    }

    async function poll(){
      try {
        const r = await fetch('/api/state', { cache: 'no-store' });
        if (!r.ok) return;
        const s = await r.json();
        if (s && s.updatedAt && s.updatedAt !== lastUpdatedAt) applyState(s);
      } catch {}
    }

    function tickAgo(){
      const el = document.getElementById('updatedAgo');
      if (!el) return;
      const sec = Math.max(0, Math.floor((Date.now() - lastUpdatedAt) / 1000));
      el.textContent = sec + 's ago';
    }

    refreshColors(latest);
    highlightBracket(latest);
    applySparks(latest);
    setInterval(poll, 10000);
    setInterval(tickAgo, 1000);
    tickAgo();
  </script>
</body>
</html>`;
}

function startDashboardServer(getState: () => DashboardState | null): void {
  if (process.env.DASHBOARD !== '1' && process.env.DASHBOARD !== 'true') return;
  const host = process.env.DASHBOARD_HOST || '0.0.0.0';
  const port = Number(process.env.DASHBOARD_PORT || '8787');

  const server = http.createServer((req, res) => {
    if (!req.url) {
      res.statusCode = 400;
      res.end('bad request');
      return;
    }

    if (req.url === '/api/state') {
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.end(JSON.stringify(getState()));
      return;
    }

    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(renderDashboardHtml(getState()));
  });

  server.listen(port, host, () => {
    console.log(`[dashboard] http://${host}:${port}`);
  });
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  let slow: SlowState = {
    fundingPct: 0,
    fundingPredictedPct: 0,
    oiNow: 0,
    oiPrev: null,
    oiDelta1hUsd: 0,
    lsRatio: 1,
    updatedAt: 0,
  };
  let polyState: PolyState = { lines: ['n/a', 'n/a', 'n/a', 'n/a'], ageSec: null, updatedAt: 0 };
  let dashboardState: DashboardState | null = null;
  const alertState = loadAlertState();

  const history: HistoryState = { price: [], cvd15: [], funding: [], oiDelta: [], lsRatio: [] };
  let historyDayKey = etDayKey(Date.now());

  const polyFastMs = cfg.polling.polymarket_ms ?? cfg.polling.market_ms;

  console.log('BTC Signal Dash process started.');
  startDashboardServer(() => dashboardState);

  if (process.env.TEST_ALERT === '1') {
    if (!cfg.telegram.bot_token || !cfg.telegram.chat_id) {
      throw new Error('TEST_ALERT=1 requires telegram.bot_token and telegram.chat_id in config/default.yaml');
    }

    slow = await fetchSlow(cfg.symbol, null);
    const price = await fetchBinancePrice(cfg.symbol);
    const [k15, k60, walls, poly] = await Promise.all([
      fetchKlines(cfg.symbol, '1m', 15),
      fetchKlines(cfg.symbol, '1m', 60),
      fetchDeribitWallsAndMaxPain(price),
      fetchPolymarketBrackets(price),
    ]);

    const sigma = sigma1hPctFrom1m(k60);
    const regime = regimeFromSigma(sigma);
    const cvd15 = proxyCvdNorm(k15);
    const cvd60 = proxyCvdNorm(k60);

    const snapshot: Snapshot = {
      price,
      regime,
      sigma,
      cvd15,
      cvd60,
      fundingPct: slow.fundingPct,
      oiDelta1hUsd: slow.oiDelta1hUsd,
      lsRatio: slow.lsRatio,
      walls: { put: walls.put, call: walls.call },
      poly,
    };

    const now = new Date();
    const text = `🧪 TEST ALERT\n${buildSnapshotText('EU', now, snapshot)}`;
    await sendTelegram(cfg.telegram.bot_token, cfg.telegram.chat_id, text);
    console.log('[telegram] TEST_ALERT sent; exiting.');
    return;
  }

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

      const [k15, k60, wallsMax] = await Promise.all([
        fetchKlines(cfg.symbol, '1m', 15),
        fetchKlines(cfg.symbol, '1m', 60),
        fetchDeribitWallsAndMaxPain(price),
      ]);

      const sigma = sigma1hPctFrom1m(k60);
      const regime = regimeFromSigma(sigma);
      const cvd15 = proxyCvdNorm(k15);
      const cvd60 = proxyCvdNorm(k60);

      const eu = parseUtcHm(cfg.sessions.eu_open_utc);
      const us = parseUtcHm(cfg.sessions.us_open_utc);
      const expiry = nextDeribitDailyExpiry();
      const expiryMins = countdownMins(expiry);
      const strategyContext = computeStrategyContext(regime, slow.lsRatio, slow.fundingPct, slow.fundingPredictedPct, cvd60, slow.oiDelta1hUsd);

      const nowTs = Date.now();
      const dayKey = etDayKey(nowTs);
      if (dayKey !== historyDayKey) {
        history.price = [];
        history.cvd15 = [];
        history.funding = [];
        history.oiDelta = [];
        history.lsRatio = [];
        historyDayKey = dayKey;
      }

      pushHistory(history.price, { ts: nowTs, v: price });
      pushHistory(history.cvd15, { ts: nowTs, v: cvd15 });
      pushHistory(history.funding, { ts: nowTs, v: slow.fundingPct });
      pushHistory(history.oiDelta, { ts: nowTs, v: slow.oiDelta1hUsd });
      pushHistory(history.lsRatio, { ts: nowTs, v: slow.lsRatio });

      dashboardState = {
        updatedAt: nowTs,
        timezone: cfg.timezone,
        symbol: cfg.symbol,
        price,
        regime,
        sigma,
        cvd15,
        cvd60,
        fundingPct: slow.fundingPct,
        fundingPredictedPct: slow.fundingPredictedPct,
        oiDelta1hUsd: slow.oiDelta1hUsd,
        lsRatio: slow.lsRatio,
        walls: { put: wallsMax.put, call: wallsMax.call },
        sessions: { euIn: countdown(eu), usIn: countdown(us), euMins: countdownMins(eu), usMins: countdownMins(us) },
        optionsExpiry: {
          expiryIn: countdown(expiry),
          expiryMins,
          maxPainStrike: wallsMax.maxPainStrike,
        },
        poly: { lines: polyState.lines.slice(0, 4), ageSec: polyState.ageSec },
        strategyContext,
        history,
      };

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
      console.log(`FUNDING: ${fmtPct(slow.fundingPct)} | Predicted: ${fmtPct(slow.fundingPredictedPct)} (${fundingInterpret})`);
      console.log(`OI DELTA: ${fmtMoney(slow.oiDelta1hUsd)} last 1h (${oiInterpret})`);
      console.log(`L/S RATIO: ${slow.lsRatio.toFixed(2)} (${lsInterpret})\n`);

      console.log(`OPTIONS: Put wall ${wallsMax.put} | Call wall ${wallsMax.call} | Max pain ${Math.round(wallsMax.maxPainStrike / 1000)}k\n`);

      console.log('COUNTDOWNS:');
      console.log(` EU open: ${countdown(eu)}`);
      console.log(` US open: ${countdown(us)}`);
      console.log(` Options expiry: ${countdown(expiry)}\n`);

      console.log('POLYMARKET (24h BTC):');
      for (const line of polyState.lines.slice(0, 4)) console.log(` ${line}`);
      const stale = polyState.ageSec !== null && polyState.ageSec > 60;
      const ageLabel = polyState.ageSec === null ? 'n/a' : `${polyState.ageSec}s`;
      const ageStatus = polyState.ageSec === null ? '⚠ unavailable' : stale ? '⚠ stale (>60s)' : '✓';
      console.log(` (quote age: ${ageLabel} ${ageStatus})`);

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
          walls: { put: wallsMax.put, call: wallsMax.call },
          poly: { lines: polyState.lines, ageSec: polyState.ageSec },
        };

        const checkAndSend = async (kind: 'EU' | 'US', openAt: Date, keyName: 'eu' | 'us') => {
          const msToOpen = openAt.getTime() - Date.now();
          const dayKey2 = openAt.toISOString().slice(0, 10);
          const inWindow = msToOpen <= 15 * 60_000 && msToOpen > 14 * 60_000;
          if (!inWindow) return;
          if (alertState[keyName] === dayKey2) return;

          const text = buildSnapshotText(kind, openAt, snapshot);
          await sendTelegram(cfg.telegram.bot_token, cfg.telegram.chat_id, text);
          alertState[keyName] = dayKey2;
          saveAlertState(alertState);
          console.log(`[telegram] sent ${kind} pre-open alert for ${dayKey2}`);
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
