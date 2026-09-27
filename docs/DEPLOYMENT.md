# Deployment

The stack runs as one compose project on the Mac Studio and is published through a dedicated
Cloudflare tunnel. Nothing is port-forwarded: every service binds to `127.0.0.1`, and `cloudflared`
dials out.

```
interviewer ──TLS──▶ Cloudflare ──▶ Access (email policy) ──▶ tunnel ──▶ ui:80 (nginx) ──▶ api:4310 ──▶ postgres
candidate   ──TLS──▶ Cloudflare ──▶ Access BYPASS for /c/*, /api/candidate/*, /assets/* ──┘
```

## Live environment

| | |
|---|---|
| URL | https://hiring.basistrading.net |
| Tunnel | `talent-os` — `4c03f66d-3753-41fb-b753-fdbe1611707a`, remotely-managed, ingress → `http://ui:80` |
| DNS | `hiring` CNAME → `<tunnel-id>.cfargotunnel.com`, proxied |
| Access app | **BTNET Talent OS** — `hiring.basistrading.net`, 24h session, *Website Access Policy*: allow `hiteshbhatia3559@gmail.com` |
| Bypass app | **BTNET Talent OS Candidate Links** — `…/c`, `…/api/candidate`, `…/assets`, policy *Candidate links bypass* (everyone) |

The bypass app matches whole path segments: `/api/candidates` (the full candidate list) and `/cabc`
still redirect to the Access login. This was verified on 2026-09-27. Re-check it after any change:

```bash
for p in / /api/candidates /api/export/candidates.csv /c/x /api/candidate/x/state /assets/x.js; do
  printf '%-30s ' "$p"; curl -s -o /dev/null -w '%{http_code}\n' "https://hiring.basistrading.net$p"
done
# expect 302 for the first three (Access login) and 200/404 (never 302) for the last three
```

**Never serve anything sensitive under `/c/`, `/api/candidate/` or `/assets/`.** Those prefixes are
public. The candidate endpoint is an allowlist by construction (see `CandidateState` in
`api/src/contracts/api.ts`).

To add panellists (e.g. Jonathan Mathai and Dr. Nag for Stage 4), add their emails to the
*Website Access Policy* on **BTNET Talent OS**. Do not loosen the bypass app.

## Running it

```bash
cp .env.example .env     # CLOUDFLARE_TUNNEL_TOKEN = `cloudflared tunnel token talent-os`
node kit/parse-kit.ts private/kits/quant-trader-interview-kit.md private/kits/quant-trader.seed.json
docker compose up -d --build                  # local only: http://localhost:8170
docker compose --profile tunnel up -d         # publish
```

The API seeds `KIT_SEED_PATH` on boot when that kit version isn't loaded yet. It never overwrites a
loaded kit, because thresholds may have been edited in-app. To force a content update, which keeps
existing thresholds:

```bash
docker compose exec api node dist/seed/cli.js /kits/quant-trader.seed.json --force
```

## Identity

Cloudflare Access injects `Cf-Access-Authenticated-User-Email` and `Cf-Access-Jwt-Assertion`. The
API takes the interviewer's identity from them. `DEV_USER_EMAIL` is a local-only fallback and must
be empty in production.

**Hardening to finish.** Set `ACCESS_AUD` (the *BTNET Talent OS* app's AUD tag, noted in `.env`) and
`ACCESS_TEAM_DOMAIN=basistradingdotnet.cloudflareaccess.com` so that the API verifies the JWT rather
than trusting the email header. This was left off on launch day because a login through Access is
needed to test it.

## Recordings

Candidate recordings (v1) live in the `talent-os_recordings` volume, mounted at `/recordings` in the
API container.
- **Size:** about 600 MB per hour of test (camera ≈ 400 kbps, screen ≈ 900 kbps at 5 fps).
- **Retention:** the API deletes recordings `RECORDING_RETENTION_DAYS` (90) after the hiring
  decision; undecided candidates fall back to 12 months after the session.
- **Exposure:** recordings are served only on the protected `/api/sessions/:id/recordings/*`, never
  on the public candidate path.
- **Backups:** the volume is excluded from the database dump below, on purpose. Recordings are
  short-lived evidence, not records.

## Backups

Interview data lives in the `talent-os_pgdata` volume on the Studio. Take a snapshot before any
schema change:

```bash
docker compose exec -T postgres pg_dump -U talent talent_os | gzip > ~/backups/talent-os-$(date +%F-%H%M).sql.gz
```

## Verifying

```bash
docker compose ps
docker compose logs cloudflared | grep 'Registered tunnel connection'
curl -s https://hiring.basistrading.net/api/candidate/not-a-token/state -o /dev/null -w '%{http_code}\n'   # 404
```

A `530`/`1033` page means the tunnel is down. A `302` to `cloudflareaccess.com` on a protected path
means Access is working.
