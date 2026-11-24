// The token radar's model, version radar-2: one sealed snapshot in, one ranked board out.
//
// The board ranks every protocol the house rule leaves eligible: the watchlist (the floor, never the
// ceiling) plus every other pre-token protocol that is not a wrapped, staked or bridged product of a
// token that already trades. A protocol is pre-token when its record carries no token (no market cap,
// no CoinGecko id, no symbol); live-token protocols are kept apart and shown with the market's own
// values, never mixed into the ranked board. The page says a protocol records no token, never that
// it has none: a record can miss a token that exists.
//
// Implied value is peer-calibrated, never a flat multiple. The multiple a protocol gets is the median
// market-cap-to-TVL ratio of the live-token protocols in its own category in this same snapshot (at
// least 8 peers, else the snapshot-wide median), clamped to [0.03, 1.00]:
//
//   multiple   = peer median mcap / TVL for the category, else the global median
//   growth     = clamp(change_7d, -80, 150) per cent
//   growthMult = 1 + (growth / 100) x 0.60
//   age        = days from listed_at to the snapshot's as_of (unknown: the eligible median age)
//   maturity   = 0.70 + min(age, 1460) / 1460 x 0.50
//   breadth    = 1 + 0.02 x min(chains, 5)
//   implied    = max(1, round(tvl_usd x multiple x growthMult x maturity x breadth))
//
// No protocol name is ever special-cased: the same function scores every row, and the peer multiples
// are recomputed from the snapshot on every run, so the model follows the snapshot's own figures.

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

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  breadth_per_chain: number;
  breadth_max_chains: number;
  peer_min_count: number;
  peer_floor: number;
  peer_cap: number;
}

export const MODEL: ModelConstants = {
  growth_weight: 0.6,
  growth_floor: -80,
  growth_cap: 150,
  maturity_floor: 0.7,
  maturity_range: 0.5,
  maturity_days: 1460,
  breadth_per_chain: 0.02,
  breadth_max_chains: 5,
  peer_min_count: 8,
  peer_floor: 0.03,
  peer_cap: 1.0,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-2';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
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
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    peer_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    breadth_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row; the farm plan is derived in the page. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  peer_multiple: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  breadth_multiplier: number;
}

/** A live-token protocol: it already trades, so the board shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  mcap_tvl_ratio: number | null;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  peer_global: number;
  peer_by_category: Record<string, number>;
  median_age_days: number;
  watchlist: string[];
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

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** The median of a sorted array of numbers. */
function medianOf(sorted: number[]): number {
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Categories that are a wrapped, staked or bridged product of a token that already trades. */
const PRODUCT_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);

/** A name carrying a whole word wrapped, staked or staking is a product of a token that trades. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** A name beginning with an exchange's name is that exchange's product. */
const EXCHANGE_NAME = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is one the board may rank: pre-token and not a product of a trading token. */
export function isEligible(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && PRODUCT_CATEGORIES.has(p.category)) return false;
  if (VERSIONED.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (EXCHANGE_NAME.test(p.name)) return false;
  return true;
}

/** The peer multiples of the snapshot: the median mcap/TVL of live-token protocols, per category. */
export interface PeerTable {
  global: number;
  byCategory: Map<string, number>;
}

export function peerMultiples(protocols: SnapshotProtocol[], model: ModelConstants = MODEL): PeerTable {
  const live = protocols.filter((p) => p.mcap_usd !== null && p.tvl_usd > 0 && p.category !== 'CEX');
  const clamp = (n: number): number => Math.min(model.peer_cap, Math.max(model.peer_floor, n));
  const all = live.map((p) => p.mcap_usd! / p.tvl_usd).sort((a, b) => a - b);
  const global = clamp(medianOf(all));
  const byCategory = new Map<string, number>();
  const perCategory = new Map<string, number[]>();
  for (const p of live) {
    const key = p.category ?? 'null';
    const list = perCategory.get(key) ?? [];
    list.push(p.mcap_usd! / p.tvl_usd);
    perCategory.set(key, list);
  }
  for (const [key, ratios] of perCategory) {
    ratios.sort((a, b) => a - b);
    byCategory.set(key, ratios.length >= model.peer_min_count ? clamp(medianOf(ratios)) : global);
  }
  return { global, byCategory };
}

/** The peer multiple one protocol gets: its category's, else the snapshot-wide median. */
export function peerMultipleFor(p: SnapshotProtocol, peers: PeerTable): number {
  return peers.byCategory.get(p.category ?? 'null') ?? peers.global;
}

/** The multipliers and the implied value one protocol gets under `model`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  peers: PeerTable,
  medianAge: number,
  model: ModelConstants = MODEL,
): { implied: number; growthPct: number; growthMult: number; maturityMult: number; breadthMult: number; peerMultiple: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const peerMultiple = peerMultipleFor(protocol, peers);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? medianAge;
  const maturityMult =
    model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const breadthMult = 1 + model.breadth_per_chain * Math.min(protocol.chains.length, model.breadth_max_chains);
  const implied = Math.max(1, Math.round(protocol.tvl_usd * peerMultiple * growthMult * maturityMult * breadthMult));
  return { implied, growthPct, growthMult, maturityMult, breadthMult, peerMultiple, age };
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The median age, in days, of the eligible protocols with a known listing date. */
export function medianAgeOf(protocols: SnapshotProtocol[], asOf: string): number {
  const ages = protocols
    .map((p) => ageDays(asOf, p.listed_at))
    .filter((a): a is number => a !== null)
    .sort((a, b) => a - b);
  return ages.length === 0 ? 365 : medianOf(ages);
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const peers = peerMultiples(snapshot.protocols, model);
  const eligible = snapshot.protocols.filter(isEligible);
  const medianAge = medianAgeOf(eligible, snapshot.as_of);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the eligibility rule would leave out.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every other eligible protocol, above or below the floor. No TVL cutoff.
  for (const p of eligible) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => {
    const s = impliedValue(p, snapshot.as_of, peers, medianAge, model);
    return { p, ...s };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token' as const,
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      peer_multiple: round4(s.peerMultiple),
      growth_pct: round4(s.growthPct),
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      breadth_multiplier: round4(s.breadthMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Keep the position open and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 1_000_000_000) return 250;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 90;
  if (age < 365) return 60;
  return 45;
}

/** The category's one action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Lend $${capital} of USDC into ${name} on ${chain} and leave it supplied.`;
  if (c.includes('dex') || c.includes('swap') || c.includes('liquidity')) return `Add $${capital} of liquidity to ${name}'s deepest pool on ${chain} and hold the LP position.`;
  if (c.includes('yield') || c.includes('farm') || c.includes('aggregator')) return `Deposit $${capital} of USDC into ${name}'s highest-TVL vault on ${chain}.`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('vault')) return `Allocate $${capital} to a ${name} vault on ${chain} and keep the shares.`;
  if (c.includes('rwa')) return `Mint $${capital} of ${name}'s yield-bearing asset on ${chain} and hold it.`;
  if (c.includes('derivative') || c.includes('perpetual') || c.includes('options')) return `Post $${capital} of USDC as collateral on ${name} and open a small hedged position.`;
  if (c.includes('prediction')) return `Back one outcome with $${capital} on ${name} and leave the position open.`;
  if (c.includes('stable')) return `Mint $${capital} of the stable asset against collateral on ${name} on ${chain}.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover on ${name} on ${chain} and keep the policy active.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} through ${name} on ${chain} and keep the receipt token.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC through ${name} to ${chain} and put the funds to work there.`;
  return `Open a $${capital} position in ${name} on ${chain} and keep it active.`;
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
    {
      text: `Set aside a fresh wallet for this farm only, and store its seed phrase offline.`,
      cost: 'under $3 in gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: actionFor(p, capital, chain),
      cost: `$${capital} of capital plus about $${capital >= 250 ? 8 : 5} in gas`,
      time: '15 minutes to set up',
    },
    {
      text: `Return once a week and make one real action: a deposit, a swap, a vote, or a claim.`,
      cost: 'about $2 in gas per week',
      time: '10 minutes a week',
    },
    {
      text: `Keep the position open for at least ${hold} days, so the activity lands in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Check the protocol's own points or rewards page before you move anything, and claim only through links it publishes.`,
      cost: 'free to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Log the wallet, the dates, and every transaction hash, so you can repeat the farm or unwind it cleanly.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      mcap_tvl_ratio: p.tvl_usd > 0 && p.mcap_usd !== null ? round4(p.mcap_usd / p.tvl_usd) : null,
    }));
}

/** A board row's compact form for data.js, with the model's multipliers unrounded: the page recomputes
 * each implied value from the raw figures, so the page's code and the board's data are visibly the same
 * arithmetic. The farm plan is derived in the page, from the same derivation main.ts runs. */
export function radarRow(
  row: BoardRow,
  raw: { peerMultiple: number; growthMult: number; maturityMult: number; breadthMult: number },
): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    peer_multiple: raw.peerMultiple,
    growth_multiplier: raw.growthMult,
    maturity_multiplier: raw.maturityMult,
    breadth_multiplier: raw.breadthMult,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const peers = peerMultiples(snapshot.protocols, model);
  const eligible = snapshot.protocols.filter(isEligible);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const peerByCategory: Record<string, number> = {};
  for (const [key, value] of [...peers.byCategory.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    peerByCategory[key] = round4(value);
  }
  // The raw multipliers, recomputed from the snapshot for each row, so data.js carries them unrounded.
  const bySlug = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const medianAge = medianAgeOf(eligible, snapshot.as_of);
  const rows = board.map((row) => {
    const p = bySlug.get(row.slug)!;
    const s = impliedValue(p, snapshot.as_of, peers, medianAge, model);
    return radarRow(row, s);
  });
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    peer_global: round4(peers.global),
    peer_by_category: peerByCategory,
    median_age_days: medianAgeOf(eligible, snapshot.as_of),
    watchlist: snapshot.watchlist,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows,
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
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
