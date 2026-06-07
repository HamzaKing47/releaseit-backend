# Deploy on a DigitalOcean droplet (backend + WAHA)

This runs the Node backend **and** WAHA (WhatsApp) on one droplet with a
single command. Frontend stays on Vercel (free); MongoDB stays on Atlas (free).

## 1. Create the server

**Cheapest / best value → Hetzner Cloud** (recommended):

- Hetzner Cloud Console → **Add Server**
- Image: **Ubuntu 24.04**
- Type: **CX22 (x86, 2 vCPU / 4 GB / 40 GB)** ≈ €3.79–4.35/mo
  - Use **CX22 (x86)**, not CAX (ARM) — avoids Docker/WAHA image issues.
- Region: nearest available
- Auth: SSH key

**Or DigitalOcean** (pricier for the same RAM):

- Create → Droplets → Ubuntu 24.04 → Basic → **$6/mo (1 GB)** (or $12 / 2 GB)

Note the server's **public IP**. The remaining steps are identical on either provider.

## 2. Connect + install Docker

```bash
ssh root@YOUR_DROPLET_IP
curl -fsSL https://get.docker.com | sh
```

## 3. Get the backend code

```bash
git clone YOUR_BACKEND_REPO_URL app
cd app
```

## 4. Create the .env

```bash
cp .env.example .env
nano .env      # paste the same values you used on Render (Mongo URI, Shopify keys…)
```

Save with `Ctrl+O`, `Enter`, then `Ctrl+X`.

## 5. Start everything (one command)

```bash
docker compose up -d --build
```

Check it's running:

```bash
docker compose ps
docker compose logs -f backend     # Ctrl+C to stop watching
```

Backend is now live at `http://YOUR_DROPLET_IP:5000`.

## 6. Point the frontend + Shopify at the droplet

- In the **frontend** (`src/backend.js`), set `BACKEND` to `http://YOUR_DROPLET_IP:5000`, redeploy on Vercel.
- In the Shopify dev dashboard, set the redirect/app URLs to the droplet (or your domain) if needed.

## 7. Connect WhatsApp (scan QR)

Open the app's WhatsApp settings in the Shopify admin → scan the QR code.
The session is saved on the droplet, so it survives restarts.

---

## Useful commands

```bash
docker compose restart          # restart after env changes
docker compose down             # stop everything
docker compose up -d --build    # rebuild after code changes (git pull first)
docker compose logs -f waha     # watch WhatsApp logs
```

## Going to production later

- Add a **domain + free SSL** (Nginx + certbot, or Caddy) instead of the raw IP.
- For 20 clients you'll need **WAHA Plus** (multi-session) + a 4–8 GB droplet.
- Keep WhatsApp numbers warmed up to avoid bans (WAHA is an unofficial API).
