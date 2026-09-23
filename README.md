# Ignite Time

A small, self-hosted time tracker built to replace Harvest: pick your name,
click a client, the timer starts. Add notes, stop it, and it's logged. Every
teammate sees the same live client list and history — no per-seat fee, no
third party.

It's a plain Node.js app (Express) with data stored in a single JSON file on
disk — no database server to install, no build step, nothing to compile.
That makes it easy to run anywhere you can run Node, including a cheap VPS,
a spare office machine, or a small free-tier host.

**One thing this can't be:** a static Netlify site. Netlify (where
`ignitedigitalmarketing.us` subdomains currently live) only serves files —
it can't keep a shared, always-on server process running, and this app
needs one so everyone's timers and history stay in sync. See "Where to
host it" below for options that work.

## Run it locally first

```bash
cd timetracker
npm install
npm start
```

Then open **http://localhost:4100**. That's it — clients and a starter
teammate list are seeded automatically on first run (edit or add to both
right from the app).

## Data

Everything lives in `data/db.json`, created the first time the server
starts. Back it up like any file — copy it, put it in your normal backup
routine, whatever you already do for the office server. There's no
database to install or maintain.

## Optional: a shared passcode

By default anyone who can reach the URL can use the app (fine on an
internal network or if the URL is unlisted). To require a simple shared
passcode, set an environment variable before starting the server:

```bash
TIMETRACKER_PASSWORD="something-only-your-team-knows" npm start
```

Everyone enters it once per browser. This is a light gate, not real
per-person login — good enough to keep the app off of Google, not
enough to treat as a security boundary for sensitive data.

## Where to host it

Pick whichever fits how Ignite already operates:

- **A small VPS you control** (DigitalOcean, Linode, Vultr, or a spare
  machine in the office) — closest to "truly self-hosted." Install
  Node 18+, copy this folder over, run `npm install`, then keep it
  running with a process manager:
  ```bash
  npm install -g pm2
  pm2 start server.js --name ignite-time
  pm2 save
  ```
  Put it behind Nginx or Caddy for a real domain (e.g.
  `time.ignitedigitalmarketing.us`) and free HTTPS via Let's Encrypt.

- **Render.com or Railway.app** — both run a plain Node app like this
  one directly from a GitHub repo, with a persistent disk you attach for
  the `data/` folder so `db.json` survives restarts and deploys. Free or
  a few dollars a month depending on usage. Simplest option if nobody at
  Ignite wants to manage a server.

- **An existing office server**, if you have one for internal tools —
  same steps as the VPS option above.

Whichever you choose, point a subdomain at it
(`time.ignitedigitalmarketing.us` would match the existing
`intern.` / `tn.` / `ms.` pattern) once it's running.

## Customizing

- **Clients**: managed in-app (`+ add client`); nothing to edit in code.
- **Teammates**: managed in-app (`+ teammate`), or edit the seed list in
  `db.js` before first run.
- **Branding**: colors and fonts are in `public/styles.css`
  (`--navy-950`, `--orange`, Big Shoulders Display + Montserrat — matching
  Ignite's existing design system).
- **Port**: defaults to 4100; override with `PORT=xxxx npm start`.

## What it does (and doesn't) do

Does: per-employee running timer, one active timer at a time per person,
notes on each entry, full history with filters by teammate and by week
/ month / all-time, per-client time totals, add/rename/archive clients,
add teammates.

Doesn't (yet, but could be added later if useful): invoicing, hourly
billing rates, CSV/PDF export, real user accounts with passwords, budgets
or alerts per client. Harvest's paid tiers are mostly this extra layer on
top of the same core loop — worth adding only the pieces Ignite actually
uses day to day.
