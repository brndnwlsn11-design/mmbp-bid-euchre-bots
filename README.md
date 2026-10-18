# Buck v1.5.1 — Trick-Play Candidate (Bot Test Only)

This is a **candidate** upgrade over v1.5, not a proven stronger opponent. It retains the same bidding, defensive decline, exchange, scoring, avatars, Good Guys / Bad Guys display, and cabin emotes.

## Changes to `master.js`
- Increase early-hand rollout sampling from 75 to 150 for six/five-card positions, and to 100 for four-card positions.
- Make simulated continuation players much less likely to overtake a partner who is already winning a trick.
- Add urgency based on how many tricks the bidding partnership still needs to make its contract, or how many tricks defenders need to set it.
- Increase attempts/backtracking for unseen-hand allocation consistent with known void suits; do not silently discard those constraints. If a consistent allocation cannot be found, use a conservative legal card rather than an invented impossible deal.

## Evidence and caveats
- `node compare.js 2` completed four head-to-head full matches on paired seeds; results were 2–2. This is **not evidence of a strength improvement**. Longer comparisons exceeded execution limits and were not completed.
- The previous 45-decision audit was a useful diagnostic but did not measure the counterfactual value of these specific changes. It does not justify calling this an optimal or master-level bot.
- More samples can increase server latency. Test on the separate Render site, especially early-hand turns. The search remains an approximation and does not know other hands.
- The paired benchmark uses identical initial deal seeds with sides reversed, but game trajectories diverge; it is not a perfect duplicate-deal trick-level evaluator.

## Test and install
Run `node --check master.js`, `node compare.js 2`, and `node benchmark.js 2` locally. Upload the application files to your separate bot-test GitHub repository. Do not deploy this over the human-only site.

`master_v15.js`, `bot_v15.js`, and `compare.js` are comparison-only files, not required by the web server. They are included for reproducibility.
