# token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/sholaah/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/sholaah/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A radar for protocols that record no token yet. It ranks every pre-token protocol in
one sealed snapshot by an implied value, covers all 40 watchlist slugs, adds the 158
pre-token protocols below the floor, and gives each row a farm plan with a cost and a
time. The page reads an offline `data.js`: no network, no dependency, no build step.

The number is stated on the page and in the source: TVL times a category multiple
(the median market cap over TVL of that category's protocols that already trade,
shrunk toward the all-protocol default of 0.205), times a seven-day growth factor
(clamped to -60 and +120 per cent, weighted at 0.5), times a maturity factor that runs
0.6 to 1.0 across 1095 days tokenless, times a chain factor. Every row carries its own
factors, so a reader can check the arithmetic in the detail view.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input input/snapshot.json
```

Then open `out/dashboard/index.html` in a browser. The board is one page; a row opens
the protocol's detail view at `#/p/<slug>`, and `#/cat/<category>` filters by category.

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
