# TEAM UP — multiplayer team building + sales games

Live, phone-based team challenges. One organizer runs the event from a laptop or projector; everyone else scans a QR code and plays on their phone.

## How it's put together

One Node server does everything: it serves the web app **and** runs the real-time games. That means one deploy, one URL, and phones connect to the same address the organizer uses.

```
client/   React web app (organizer screen + phone screen)
server/   Express + Socket.io server
  games.js    ← all questions, choices, answers and clues live here (edit this file to change content)
  engine.js   game rules: teams, rounds, timers, clues, scoring
  index.js    web server, real-time connections, saving to disk
```

## Run it on your computer

Requires Node.js 20 or newer.

```bash
npm install
npm run install:all
npm run dev
```

Open http://localhost:5173.

**Phones on the same Wi-Fi:** open the organizer screen using the computer's network address, e.g. `http://192.168.1.20:5173` (not `localhost`), and the QR code will work for phones. Allow port 5173 through the computer's firewall.

## Put it online

### Option A — Render (easiest)
1. Push this folder to a GitHub repository.
2. In Render: **New → Blueprint**, choose the repo. `render.yaml` sets everything up.
3. When it's live, open the `https://….onrender.com` address. The QR code automatically points phones there.

The blueprint uses Render's free plan. Free services fall asleep after ~15 minutes without visitors (first load then takes ~1 minute) and forget events whenever they restart, so open the site a few minutes before your session. To keep events across restarts, switch to the paid *Starter* plan and add the 1 GB disk shown (commented out) in `render.yaml`.

### Option B — Any Node host (Railway, Fly.io, a VPS…)
- Build command: `npm run build`
- Start command: `npm start`
- The host must support WebSockets (all of the above do) and set `PORT` (they do automatically).
- To keep events across restarts, mount a persistent volume and set `DATA_FILE` to a path on it, e.g. `/data/events.json`.

### Option C — Docker
```bash
docker build -t team-up .
docker run -p 3001:3001 -v teamup-data:/data team-up
```
Then put it behind HTTPS (e.g. Caddy, Nginx, or your cloud provider's load balancer).

### Settings (all optional)
| Variable | What it does |
|---|---|
| `PORT` | Port to listen on (hosts set this for you). |
| `DATA_FILE` | Where events are saved. Default `server/data/events.json`. |
| `ALLOWED_ORIGINS` | Only if the web app is hosted on a different domain from the server, e.g. `https://play.example.com`. |
| `VITE_SERVER_URL` | Build-time, only for that same split setup: the server's URL. |

## Running an event
1. Create an event, choose the arena and 2–6 teams.
2. Put the organizer screen on the projector. People scan the QR code or type the PIN.
3. Players are auto-balanced across teams. Click a team name to rename it, use the menu on a player to move them, × to remove.
4. Pick a game. Questions and choices appear on the big screen and on phones; in **The Missing Information** each player also gets private clues (spread so that even a 1–2 person team sees every clue).
5. The first answer from each team counts. The round ends when every team has answered, the timer runs out, or you press **End round now**.
6. Scores carry across games; **End event** shows the final winner on every phone.

If a phone locks, loses Wi-Fi or the page is reloaded, it rejoins automatically as the same player. The organizer screen does the same.

## Tests
```bash
npm test
```
Covers clue distribution, scoring, timers, reconnects, validation and save/restore.

## Limits and what's not included
- Events are saved to a single file on the server; this suits one server instance, not a cluster.
- No user accounts: whoever holds the organizer link on their device controls the event. Don't share it.
- Basic abuse protection only (per-connection rate limits, max 20 new events per network per hour, 300 players per event). Events idle for 24 hours are deleted.
- Don't use it for sensitive corporate data.
- No AI, analytics reports or payments yet.
