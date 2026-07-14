# Deploying to a VPS with Dokploy

The dashboard is a single Node service (Express API + built React client) using
a local SQLite database. It deploys as one Docker container.

## 1. Build

Dokploy should use the included **`Dockerfile`** (not Nixpacks). In the app's
Build settings choose **Dockerfile**. (A `nixpacks.toml` is included as a
fallback — it installs the same `python3` + C++ toolchain that `better-sqlite3`
needs. The original `npm ci` failure was that toolchain missing.)

If your repo root is the `dashboard/` folder, the Dockerfile is at the root and
needs no extra path config. If the repo root is one level up, set the build
context / Dockerfile path to `dashboard/`.

## 2. Environment variables

Set these in Dokploy (Environment). Never commit real secrets — `.env` is
gitignored; these are configured in the panel instead.

    NODE_ENV=production
    PUBLIC_URL=https://kumora.io
    DATA_DIR=/app/data

    DEEPSEEK_API_KEY=sk-...            # required — email generation
    DEEPSEEK_MODEL=deepseek-v4-flash

    # Owner/default sending config (each user can override in Settings):
    RESEND_API_KEY=re_...
    FROM_EMAIL=hello@yourdomain
    FROM_NAME=...
    PHYSICAL_ADDRESS=...              # required for compliant sending
    TEST_MODE=true                    # keep true until you've verified sending

`PORT` defaults to 4820; point Dokploy's proxy at that port. `HOST` is chosen
automatically (0.0.0.0 in production) — leave it unset.

## 3. Persistent volume (IMPORTANT)

The SQLite DB holds all users, leads, and settings. Without a volume, **every
redeploy starts empty**. Mount a volume:

    Volume  →  mount path: /app/data

That matches `DATA_DIR=/app/data`, so the DB file lives at `/app/data/app.db`
on the volume and survives redeploys and restarts.

## 4. Domain + TLS

Point **kumora.io** at the app in Dokploy's Domains tab and enable HTTPS
(Let's Encrypt). The session cookie is marked `Secure` in production, so the
site must be served over HTTPS for login to work.

## 5. Connect the Chrome extension

The extension defaults to `https://kumora.io`. After deploy:

1. Load the extension in Chrome.
2. Scrape a Maps search, click **⇪ Send to Dashboard** → **Connect account**.
3. Log in / register on kumora.io, click **Authorize** — the key is stored
   automatically and leads push to your account.

To test against a local server instead, the extension has a dev toggle
(`useDevServer`) that points it at `http://127.0.0.1:4820`.

## Notes

- First boot auto-runs the JSON→SQLite migration if legacy files are present;
  on a fresh VPS there are none, so it starts clean.
- Health/readiness: `GET /api/health` returns `{ ok: true }`.
