/**
 * Live spot quotes — the real resource body behind the metered endpoint.
 *
 * The agent pays per call; what it receives is actual market data from
 * Binance's public market-data endpoint (no API key, reachable from
 * serverless runtimes). Pointing this at another vendor is a one-function
 * change — everything else in the payment path stays the same.
 */

const UPSTREAM = "https://data-api.binance.vision/api/v3/ticker/24hr";

/** task id → upstream symbol — the tasks this endpoint quotes. */
const QUOTE_SYMBOLS: Record<string, string> = {
  "quote:BTC": "BTCUSDT",
  "quote:ETH": "ETHUSDT",
  "quote:SOL": "SOLUSDT",
};

export function isQuoteTask(task: string): boolean {
  return task in QUOTE_SYMBOLS;
}

export type Quote = {
  pair: string;
  price: number;
  bid: number;
  ask: number;
  change24hPct: number;
  high24h: number;
  low24h: number;
  asOf: string;
  source: string;
  latencyMs: number;
};

export async function fetchQuote(task: string): Promise<Quote> {
  const symbol = QUOTE_SYMBOLS[task];
  if (!symbol) throw new Error(`not a quoted task: ${task}`);

  const started = Date.now();
  const res = await fetch(`${UPSTREAM}?symbol=${symbol}`, {
    headers: { accept: "application/json" },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`upstream responded ${res.status}`);

  const t = (await res.json()) as {
    lastPrice: string;
    bidPrice: string;
    askPrice: string;
    priceChangePercent: string;
    highPrice: string;
    lowPrice: string;
    closeTime: number;
  };

  return {
    pair: `${symbol.replace("USDT", "")}/USDT`,
    price: Number(t.lastPrice),
    bid: Number(t.bidPrice),
    ask: Number(t.askPrice),
    change24hPct: Number(t.priceChangePercent),
    high24h: Number(t.highPrice),
    low24h: Number(t.lowPrice),
    asOf: new Date(t.closeTime).toISOString(),
    source: "binance-public-market-data",
    latencyMs: Date.now() - started,
  };
}
