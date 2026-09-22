# Deploying the prototype

The prototype is deployed as a Docker web service on **Render**, in the **Frankfurt** region, on a paid always-on instance (0.5 vCPU / 512 MB, roughly USD 7/month, no idle spin-down).

- Live URL: https://genelink-prototype.onrender.com
- Source: https://github.com/vkakorsu/genelink-prototype (public, `main` branch)

The demo holds no personal data and uses fictional parties, so a small instance is appropriate. It is still deployed in the EU on purpose: the platform will hold personal data of EU users in production, and the proposal says EU-resident hosting from day one. The demo should not contradict that.

## How it was deployed

The repository is public on GitHub under `vkakorsu/genelink-prototype`, with GitHub Actions (`.github/workflows/ci.yml`) running ESLint, the configuration linter, the type check, the 121 tests and the production build on every push.

The Render service was created with the official Render CLI (`render` v2.28.0), authenticated via device authorization:

```powershell
render login
render workspace set <workspace-id>
render services create `
  --name genelink-prototype `
  --type web_service `
  --repo https://github.com/vkakorsu/genelink-prototype `
  --branch main `
  --runtime docker `
  --region frankfurt `
  --plan starter `
  --health-check-path / `
  --env-var NODE_ENV=production `
  --env-var NEXT_TELEMETRY_DISABLED=1 `
  --confirm
```

Render builds the `Dockerfile` at the repository root. The Dockerfile runs `npm run test:ci` inside the image build, so a failing test fails the deploy. The container listens on port 3000; Render routes public traffic to it automatically.

## If the service is ever moved back to the free plan

Render's free plan spins a service down after 15 minutes without traffic and takes up to a minute to wake. If the service is downgraded, mask this with a free UptimeRobot monitor:

1. Create an UptimeRobot account (free, no card).
2. Add an **HTTP(s)** monitor for `https://genelink-prototype.onrender.com` with a 5-minute interval.
3. The ping prevents the idle spin-down and stays well within the 750 free instance hours Render allows per month.

This is an external keep-alive for a demo, not a production pattern. In production the platform runs on paid, always-on infrastructure.

## Redeploying after a change

```powershell
render deploys create <service-id> --confirm
```

Find the service id with `render services list`. To get automatic deploys on every push to `main`, connect the GitHub account in the Render dashboard under the service's **Settings > Build & Deploy** (the service was created over the public HTTPS URL, so Render can clone it but does not receive push webhooks until GitHub is connected).

## Alternatives considered

- **Northflank free sandbox.** Advertised as always-on in EU regions, but the EU regions are pay-as-you-go at sign-up and a card is required. Rejected.
- **Koyeb free, Frankfurt.** Requires a card, defaults new sign-ups to a paid plan, and the free instance still scales to zero after an hour idle. Rejected.
- **Oracle Cloud Always Free VM, Frankfurt.** The most robust free option (a real VM that never sleeps) but requires a card for identity verification and manual VM setup: Ubuntu 24.04, open ports 80/443, install Docker, `docker build -t genelink-prototype .`, `docker run -d -p 80:3000 --restart unless-stopped genelink-prototype`.
- **Hetzner CX22** (Falkenstein or Nuremberg), a few euros a month, same `docker run` command. Fallback if Render changes terms or the service needs more than one instance.

## Moving hosts: the Compose route

`docker-compose.yml` defines the whole stack (application, PostgreSQL 18, S3-compatible object storage) so that moving to another EU provider or to Landscape Alliance's own infrastructure is the same three steps everywhere:

1. Provision a Linux host with Docker in the EU region of choice (Hetzner, IONOS, Scaleway, OVH, or an internal VM).
2. Clone the repository, set `POSTGRES_PASSWORD` and `MINIO_ROOT_PASSWORD` in a `.env` file, run `docker compose up -d`.
3. Point DNS at the host and put a TLS terminator in front (Caddy or the provider's load balancer).

For the prototype the database and storage services start but are unused. For the MVP they are the persistence and document adapters' targets, and the same file runs staging and production. The proposal's move-hosting runbook (Part 10.1) is exercised once during the build by deploying staging to a second provider with this file.

## Verification checklist

1. Open https://genelink-prototype.onrender.com in a private window.
2. The home page loads and the banner reads "Prototype with fictional parties".
3. `/persona` lists the seats. `/cases` shows the seeded cases.
4. `/cases/case_1_ke` shows halted stages routing to a named owner.
5. `/verify` reports the audit chain verified.
