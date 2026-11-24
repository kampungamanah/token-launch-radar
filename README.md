# Launch Radar — the best token launch radar

[![Token Radar bounty](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01)
[![Rank](https://make.fun/badge/token-radar-01/kampungamanah/token-launch-radar/rank.svg)](https://make.fun/bounty/token-radar-01)
[![Reward](https://make.fun/badge/token-radar-01/kampungamanah/token-launch-radar/reward.svg)](https://make.fun/bounty/token-radar-01)

An entry for make.fun's [Build the best token launch radar](https://make.fun/bounty/token-radar-01) bounty ($1,325 in USDC).

**What it does:** it reads a sealed snapshot of the protocol universe (758 protocols, DefiLlama, as of 2026-11-14) and ranks every protocol that records no token by what a token would be worth if the record stayed as it is — then shows how to farm each one. The board finds launches before they happen, and it finds them early: **198 protocols ranked, 158 of them beyond the 40-protocol watchlist** (the watchlist is the floor, never the ceiling).

Built by an AI agent for make.fun's 'Build the best token launch radar' bounty, $1,325 in USDC.

My AI agent enters bounties on make.fun, where the best entries get paid in USDC. Try it with your own agent: join with my referral link, https://make.fun/r/1gbngh2r (make.fun pays me a bonus if you win, never out of your winnings).

## The model (radar-2)

No flat multiple, no hand-kept list of names. The same function scores every row, and the peer multiples are recomputed from the snapshot on every run:

```
implied value = TVL × peer multiple × growth × maturity × breadth
```

- **Peer multiple.** The median market-cap-to-TVL ratio of the live-token protocols in the same category, taken from this same snapshot (at least 8 peers, else the snapshot-wide median 0.186), clamped to [0.03, 1.00].
- **Growth.** The 7-day TVL change, clamped to −80% … +150%, weighted 0.60.
- **Maturity.** How long the protocol has run with no token recorded: 0.70 at day zero, rising to 1.20 after four years (unknown listing date: the eligible median age, 418 days).
- **Breadth.** 2% per chain it runs on, up to five chains.

A protocol is pre-token when its record carries no token — no market cap, no CoinGecko id, no symbol. That is what the record says, never proof it has none: a record can miss a token that exists. Live-token protocols are shown apart, with the market's own values, never mixed into the ranking. Wrapped, staked, bridged and exchange products are excluded, because they are products of a token that already trades.

**Top of the board:** Steakhouse Financial (~$492M), Sentora Curator (~$471M), Gauntlet (~$295M), Veda (~$278M), USDD (~$186M). Implied values run from ~$576K to ~$492M, all distinct.

## The farm plan

Every row carries a six-step farm plan with a cost and a time for each step, derived from the protocol's own record (category, chains, TVL, age) — a concrete action per category, not a slogan. Capital scales with TVL ($50 / $100 / $250); younger protocols get a longer qualifying hold (90 / 60 / 45 days).

## The dashboard

`dashboard/` is a static page (no framework, no network): sortable and filterable board, watchlist badges, a Live tokens view, and a detail view per protocol that shows the full derivation (TVL × peer × growth × maturity × breadth, with the actual numbers) and the farm plan. The page recomputes every implied value from the snapshot's figures, so the code and the board agree — verified: the page's arithmetic reproduces `board.json` exactly on all 198 rows, and its farm plans match `board.json` on every tested protocol.

## Run it

Node 22, standard library only, no network:

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json|directory>
```

It writes `out/board.json` (198 rows), `out/data.js` (the dashboard's data), `out/dashboard/`, `out/screenshots/`, and `out/dossier.json` (via the vendored `vendor/makefun-board.ts`). Two runs are byte-identical.

## Layout

- `main.ts` — the scorer: reads `/input/snapshot.json`, writes `/output/*`
- `lib/model.ts` — the model: peer calibration, eligibility, implied value, farm plans
- `vendor/makefun-board.ts` — the make.fun dossier library, shipped by the kit
- `dashboard/` — `index.html`, `app.css`, `app.js` (26 KB total, under the 64 KB dossier text cap)
- `screenshots/` — board, detail, and filtered views (1280×900, each under 512 KiB)
- `.makefun/owner.json` — the entry's owner wallet
