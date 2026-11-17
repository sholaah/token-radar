// radar-2: the token radar's value model. One snapshot in, one ranked board out. Standard library only.
//
// WHAT IS RANKED. A protocol is pre-token when mcap_usd, gecko_id and symbol are all null. The board holds
// every watchlist slug (the floor) plus every other pre-token protocol that passes the watchlist's own
// exclusion rule (below), whatever its TVL. Protocols whose token already trades are never ranked; they go
// in the separate `live` set with the market's own market cap.
//
// EXCLUSION RULE (same as the house watchlist, applied by category and name, never by protocol):
//   category in EXCLUDED_CATEGORIES, or name ends in a version marker (" V2", " v2", " 2.0"),
//   or name has the whole word wrapped/staked/staking (any case), or name starts with an exchange name.
//
// IMPLIED VALUE (a fully diluted token value claim, in US dollars):
//   implied = round( tvl_usd x category_multiple x growth_mult x maturity_mult x chain_factor )
//
//   category_multiple  market cap / TVL a protocol of that category would carry. Derived by rule from this
//                      snapshot's live-token protocols: median(mcap/tvl) of the category, shrunk toward the
//                      all-protocol median G = 0.205 with weight K = 5 comparables:
//                        multiple = (n x median + 5 x G) / (n + 5), capped at CATEGORY_CAP = 0.75.
//                      Categories with no live comparable use G. The table CATEGORY_MULTIPLE holds the result.
//                      "Revenue multiple" here is a value-per-TVL proxy: the snapshot carries no revenue.
//   growth_mult        1 + clamp(change_7d, -60, 120) / 100 x 0.5          range 0.70 .. 1.60; null -> 0 %
//   maturity_mult      0.6 + 0.4 x min(age_days, 1095) / 1095              range 0.60 .. 1.00
//                      age_days = as_of - listed_at: how long DefiLlama has tracked it with no token.
//                      listed_at null -> 365 days, and the row's confidence drops.
//   chain_factor       CHAIN_FACTOR of the deepest chain it runs on (unlisted chains 1.00, no chain 0.95)
//                      + 0.02 for each further chain (at most 4 extra), clamped to 0.90 .. 1.25.
//
// CONFIDENCE (0..1, shown as high >= 0.75, medium >= 0.5, else low), the sum of:
//   0.30 listed_at known; 0.20 change_7d reported; 0.20 category in CATEGORY_MULTIPLE;
//   0.15 tvl_usd >= 20,000,000; 0.15 age_days >= 180.
//
// RANKING. Sort by implied value descending, ties by slug; rank is the position 1..N. Implied value is an
// entry's own estimate of what the token might be worth if the record stayed as it is. It is not a price,
// not a prediction that a token will launch, and not make.fun's claim.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-2';

/** Category market-cap-to-TVL multiples (see the header for the rule that produced them). */
export const CATEGORY_MULTIPLE: Record<string, number> = {
  'Risk Curators': 0.67,
  Dexs: 0.3,
  'Onchain Capital Allocator': 0.15,
  RWA: 0.25,
  Lending: 0.15,
  Yield: 0.19,
  Derivatives: 0.75,
  CDP: 0.19,
  'Yield Aggregator': 0.18,
  'Basis Trading': 0.47,
  Chain: 0.68,
  'Staking Pool': 0.15,
  'Liquidity Manager': 0.17,
  'Leveraged Farming': 0.2,
  Restaking: 0.15,
  'Dual-Token Stablecoin': 0.18,
  'Prediction Market': 0.75,
  'Cross Chain Bridge': 0.66,
  Payments: 0.2,
  Indexes: 0.18,
};

/** Used for a category with no live comparable: the all-protocol median of mcap / TVL. */
export const DEFAULT_MULTIPLE = 0.205;

/** Chain depth factor: how much exit liquidity and user flow a chain gives a token. Applied by chain name only. */
export const CHAIN_FACTOR: Record<string, number> = {
  Ethereum: 1.15,
  Solana: 1.08,
  Bitcoin: 1.08,
  Base: 1.08,
  Arbitrum: 1.08,
  'Hyperliquid L1': 1.08,
  Binance: 1.08,
};

/** The model's constants as the dashboard states them. */
export interface ModelConstants {
  default_multiple: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  chain_default: number;
  chain_none: number;
  chain_extra: number;
  chain_extra_max: number;
  chain_min: number;
  chain_max: number;
  category_multiple: Record<string, number>;
  chain_factor: Record<string, number>;
}

export const MODEL: ModelConstants = {
  default_multiple: DEFAULT_MULTIPLE,
  growth_weight: 0.5,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
  chain_default: 1.0,
  chain_none: 0.95,
  chain_extra: 0.02,
  chain_extra_max: 4,
  chain_min: 0.9,
  chain_max: 1.25,
  category_multiple: CATEGORY_MULTIPLE,
  chain_factor: CHAIN_FACTOR,
};

/** How many live-token protocols the live set carries, by market cap. */
export const LIVE_ROWS = 100;

/** Categories the watchlist rule leaves out: bridges, liquid (re)staking wrappers and exchanges. */
export const EXCLUDED_CATEGORIES: readonly string[] = ['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX'];

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** The per-row diagnostics: every factor of the implied value, so a reader can redo the product. */
export interface RowModel {
  tvl_usd: number;
  category_multiple: number;
  category_known: boolean;
  growth_pct: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  age_days: number | null;
  chain_factor: number;
  chain_basis: string | null;
  confidence: number;
  confidence_label: 'high' | 'medium' | 'low';
}

/** One row of board.json: the ranked board's row (pre-token protocols only). */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  token_status: 'pre-token';
  on_watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  model: RowModel;
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the market's own market cap is shown, never a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  symbol: string | null;
  tvl_usd: number;
  mcap_usd: number;
  mcap_to_tvl: number;
  change_7d: number | null;
}

/** The dashboard's compact view of one board row. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  on_watchlist: boolean;
  implied_value_usd: number;
  category_multiple: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  chain_factor: number;
  confidence: number;
  confidence_label: 'high' | 'medium' | 'low';
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;
const bySlugOrder = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `listedAt` to `asOf`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE_PREFIX = /^(binance|coinbase|bybit|kraken|bitget|okx|bitfinex|gemini)/i;

/** Whether the watchlist's exclusion rule drops this protocol (by category and name only). */
export function isExcluded(p: SnapshotProtocol): boolean {
  return (
    (p.category !== null && EXCLUDED_CATEGORIES.includes(p.category)) ||
    VERSIONED.test(p.name) ||
    WRAPPED_WORD.test(p.name) ||
    EXCHANGE_PREFIX.test(p.name)
  );
}

/** Whether a protocol is one the board may rank: pre-token and not excluded. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && !isExcluded(p);
}

/** The chain factor and the chain that set it, by rule: the deepest named chain plus a small breadth bonus. */
export function chainFactor(chains: string[], model: ModelConstants): { factor: number; basis: string | null } {
  if (chains.length === 0) return { factor: model.chain_none, basis: null };
  let best = -Infinity;
  let basis: string | null = null;
  for (const c of chains) {
    const f = model.chain_factor[c] ?? model.chain_default;
    if (f > best) {
      best = f;
      basis = c;
    }
  }
  const extra = Math.min(chains.length - 1, model.chain_extra_max) * model.chain_extra;
  return { factor: Math.min(model.chain_max, Math.max(model.chain_min, best + extra)), basis };
}

/** The factors and the implied value one protocol gets under `model`. */
export function impliedValue(p: SnapshotProtocol, asOf: string, model: ModelConstants, floorUsd: number): { implied: number; detail: RowModel } {
  const age = ageDays(asOf, p.listed_at);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, finite(p.change_7d, 0)));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageUsed = Math.min(Math.max(age ?? model.unknown_age_days, 0), model.maturity_days);
  const maturityMult = model.maturity_floor + (ageUsed / model.maturity_days) * model.maturity_range;
  const known = p.category !== null && Object.hasOwn(model.category_multiple, p.category);
  const catMult = known ? model.category_multiple[p.category as string]! : model.default_multiple;
  const { factor, basis } = chainFactor(p.chains, model);
  const implied = Math.max(1, Math.round(p.tvl_usd * catMult * growthMult * maturityMult * factor));
  /* Confidence is how much of the number the record actually supports, not how
   * good the protocol is: a known listing date, a reported seven-day change, a
   * category with live comparables, TVL at or above the watchlist floor, more
   * than a year tokenless, and more than two chains each add their share. */
  const confidence = round4(
    (age !== null ? 0.15 : 0) +
      (p.change_7d !== null ? 0.15 : 0) +
      (known ? 0.2 : 0) +
      (p.tvl_usd >= floorUsd ? 0.25 : 0) +
      (age !== null && age >= 365 ? 0.15 : 0) +
      (p.chains.length >= 3 ? 0.1 : 0),
  );
  return {
    implied,
    detail: {
      tvl_usd: p.tvl_usd,
      category_multiple: catMult,
      category_known: known,
      growth_pct: round4(growthPct),
      growth_multiplier: round4(growthMult),
      maturity_multiplier: round4(maturityMult),
      age_days: age,
      chain_factor: round4(factor),
      chain_basis: basis,
      confidence,
      confidence_label: confidence >= 0.75 ? 'high' : confidence >= 0.5 ? 'medium' : 'low',
    },
  };
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's one action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm') || c.includes('liquidity') || c === 'farm') return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('basis') || c.includes('option')) return `Deposit $${capital} of USDC as margin or vault funds on ${name} and open one small hedged position.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}.`;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time. The plan is derived from
 * the protocol's own record (category, chains, TVL, age), never from a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  return [
    { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
    { text: actionFor(p, capital, chain), cost: `$${capital} of capital and about $${capital >= 150 ? 8 : 4} of gas`, time: '15 minutes to set up' },
    { text: 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.', cost: 'about $2 of gas a week', time: '10 minutes a week' },
    { text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`, cost: `the $${capital} stays in the position`, time: `${hold} days` },
    { text: "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
    { text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.', cost: 'nothing but the log', time: '5 minutes' },
  ];
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Check the protocol's own page.`;
  return s;
}

/** The ranked board: the watchlist plus every other rankable pre-token protocol, best first, ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const wl = new Set(snapshot.watchlist);
  // The watchlist is the floor: its slugs are kept even if the exclusion rule would drop them.
  const chosen = snapshot.protocols.filter((p) => wl.has(p.slug) || isRankable(p));
  const scored = chosen.map((p) => ({ p, ...impliedValue(p, snapshot.as_of, model, snapshot.floor_usd) }));
  scored.sort((a, b) => b.implied - a.implied || bySlugOrder(a.p.slug, b.p.slug));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    listed_at: s.p.listed_at,
    token_status: 'pre-token' as const,
    on_watchlist: wl.has(s.p.slug),
    age_days: s.detail.age_days,
    implied_value_usd: s.implied,
    model: s.detail,
    farm_steps: farmSteps(s.p, s.detail.age_days).map(stepText),
  }));
}

/** The live set: protocols whose token already trades, with the market's own market cap, kept off the board. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.category !== 'CEX')
    .sort((a, b) => b.mcap_usd! - a.mcap_usd! || bySlugOrder(a.slug, b.slug))
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      symbol: p.symbol,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd!,
      mcap_to_tvl: p.tvl_usd > 0 ? round4(p.mcap_usd! / p.tvl_usd) : 0,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    listed_at: row.listed_at,
    age_days: row.age_days,
    on_watchlist: row.on_watchlist,
    implied_value_usd: row.implied_value_usd,
    category_multiple: row.model.category_multiple,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    chain_factor: row.model.chain_factor,
    confidence: row.model.confidence,
    confidence_label: row.model.confidence_label,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: board.filter((r) => !r.on_watchlist).length,
    live_size: live.length,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

/** Why a board is not one the gate will take, or null: size, coverage, known slugs, ranks, order, one shared value, farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 400) return `the board has ${board.length} rows, outside 100..400`;
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  const seen = new Set<string>();
  for (const r of board) {
    if (!known.has(r.slug)) return `${r.slug} is not a snapshot protocol`;
    if (seen.has(r.slug)) return `${r.slug} appears twice`;
    seen.add(r.slug);
    if (r.name.trim() === '') return `${r.slug} has no name`;
  }
  const missing = snapshot.watchlist.filter((s) => !seen.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  const byRank = [...board].sort((a, b) => a.rank - b.rank);
  for (let i = 1; i < byRank.length; i++) if (byRank[i]!.implied_value_usd > byRank[i - 1]!.implied_value_usd) return `rank ${i + 1} outranks rank ${i} on implied value`;
  if (byRank[0]!.implied_value_usd === byRank[byRank.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${byRank[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) {
      const n = s.trim().length;
      if (n < 20 || n > 600) return `${r.slug} has a farm step of ${n} characters`;
    }
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 1e14) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
