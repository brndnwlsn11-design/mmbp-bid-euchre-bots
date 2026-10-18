# Buck Bot Test Edition (v1.3 beta)

This package combines v1.2.1 avatars, eight Minnesota table-talk emotes, perspective-based Good Guys / Bad Guys labels, and server-side BuckBots.

**Deploy:** Upload all SIX files to the root of your new GitHub repository, connect a new Render Node web service, and use the existing build/start settings (`npm install`, `npm start`). Do not upload the ZIP itself.

**Bots:** The first human to sit at a new table is host. Before the game begins, the host can add bots to empty seats. Filling the fourth seat automatically starts the game. Bots take legal actions using their own seat view; they do not see hidden hands. Bot seats cannot be replaced during a game. Humans advance to the next hand.

**Beta limitations:** Bots are heuristic, not master-level; they always elect to defend when allowed, and they do not defer defensive decline to a human partner in this test build. A human/bot partnership may therefore not have the final-decision behavior discussed for a future version. No persistent storage on Render free instances is guaranteed.

# Bid euchre

Online bid euchre for four friends, with our house rules.

## Run it on your own computer
1. Install Node.js (version 18 or newer) from nodejs.org.
2. In this folder, run: `node server.js`
3. Open http://localhost:3000 in a browser.

## Put it online (Render, free)
1. Put these files in a GitHub repository.
2. On render.com, create a new Web Service from that repository.
3. Set the start command to `node server.js` and pick the Free instance type.
4. Open the address Render gives you, start a table, and send the link to your friends.

Free hosting puts the app to sleep after about 15 idle minutes and forgets tables when it restarts.
Players' browsers ping the server every few minutes during a game to keep it awake.

## House rules (as built)
- 24 cards (A-9), four players, partners sit across, no kitty, dealer rotates left each hand.
- One round of bidding starting left of the dealer. Bids: 3, 4, 5, 6, 12, 24. Each bid must beat the last. If everyone passes, the dealer must bid.
- Bid winner declares trump; on bids of 4-6 they may declare high or low instead (no trump, jacks are plain, ace is the worst card in low).
- Lead: declarer leads; low: left of declarer; high: right of declarer.
- Defenders (the defender left of the declarer decides for the team) may decline a trump game and give the bid points away. High and low cannot be declined.
- 12 and 24 are played alone (partner sits out). With 12, declarer and partner swap one card first.
- Scoring: the bidding team scores every trick they take if they make the bid (3-6). Miss it and they lose the bid. 12/24 need all six tricks, worth 12/24. Defenders score one point per trick; taking none means they lose the bid amount.
- First to 52 wins.

## Tests
`npm test` checks the rules and plays full games through the server.

## Buck v1.1 changes
- Defenders declining a normal trump contract award the bidding team 6 points; declining 12/24 awards 12/24.
- When everyone passes, the dealer must bid. Defenders cannot decline only if that forced dealer bid is 3; if the dealer bids 4 or higher, normal decline rules apply.
- A player holding four cards of one rank can declare a misdeal during bidding; the hand is redealt by the same dealer, with no score change.
- Active turns have a prominent banner and outlined action panel.
- Hover over or tap the score for a running hand-by-hand scoring ledger.

To deploy: upload the five application files (not this ZIP itself) into the root of the existing GitHub repository and commit changes. Render should redeploy from that commit.

## Buck v1.2 (avatars and table talk; no bots)
- Choose a classic board-game-inspired token and one of six colors when taking a seat. Your choice is remembered in your browser for future tables.
- Tap your own avatar during a game to open eight Minnesota-style table-talk emotes. Speech bubbles appear to everyone briefly. Emotes never submit game actions.
- The score and results label your own partnership **Good Guys** and the opposing partnership **Bad Guys**; labels reverse for opponents.
- Built on the human-only v1.1.1 game; no bot code is included. Existing rooms remain compatible, with default avatars for previously seated players.
