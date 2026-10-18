# Buck v1.5 — Stronger Search Bots (Experimental)

Separate bot-test deployment only. Upload all files to your bot GitHub repository and let Render redeploy.

## Changes
- Information-set trick search evaluates contract outcomes (making/setting the bid), not just total tricks.
- Randomized hidden-card assignment with public void-suit constraints, including effective trump suits.
- Multiple simulated continuation styles reduce reliance on one brittle play heuristic.
- Larger endgame search budget and double-dummy minimax for the last two cards.
- No direct access to actual opponents' hidden cards; inputs are seat-filtered `Engine.viewFor` and public card memory.
- Bidding, declines, exchanges and game UI unchanged from v1.4.

## Limitations
This is not proven optimal, and the search can still be fooled by hidden information. Simulated opponents are approximations, and the late-hand minimax uses sampled complete hands. The sampler relaxes void constraints if its limited backtracking fails, so inferred voids are not guaranteed to hold in every simulation. Benchmark results on a small number of games are not statistically conclusive.

## Testing
`node benchmark.js 2` runs a seeded two-game comparison against the old heuristic baseline. Increase cautiously; search is CPU intensive and free Render servers are limited.
