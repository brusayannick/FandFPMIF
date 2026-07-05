# Deploying Mate to the uni VM

Production deployment to `pm-mate.uni-muenster.de`, fronted by the FB4 reverse
proxy. For the local-`localhost` setup, see [`README.md`](./README.md) – this
doc only covers the server. **All VM access needs the FB4-DEV-VPN.**

## Quick reference (cheat sheet)

The daily-driver commands. The numbered walkthrough below is the full,
first-time setup. The prod overlay is always **both** compose files:

```bash
DC="docker compose -f docker-compose.yml -f docker-compose.prod.yml"
```

```bash
# Connect (compose stack lives in ~/mate)
ssh -p 2222 pm-admin@pm-mate-vm.uni-muenster.de
ssh-copy-id -p 2222 pm-admin@pm-mate-vm.uni-muenster.de   # once, to skip the password

# Deploy
make deploy                      # from laptop: push branch + redeploy + health-check
./scripts/deploy.sh --no-push    # redeploy origin's current state, no push
cd ~/mate && git pull && $DC up -d --build   # manual, on the VM

# Run / stop / status
$DC up -d --build        # bring up (first boot ~10 min: module deps)
$DC ps                   # status
$DC restart api          # restart one service
$DC restart proxy        # after a Caddyfile-only change
$DC down                 # stop (keeps volumes/data)
$DC down -v              # stop + WIPE Keycloak users (re-imports realm next boot)

# Logs
$DC logs -f api                 # follow API
$DC logs --tail=80 api web      # last 80 lines
$DC logs -f proxy keycloak
```

- `NEXT_PUBLIC_*` change → needs `--build` (inlined into the client bundle).
- Caddyfile-only change → `$DC restart proxy`.

## How the two proxies fit together

```
        Internet
           │  https://pm-mate.uni-muenster.de  (public cert on the uni proxy)
           ▼
   ┌──────────────────┐
   │  uni edge proxy  │   forwards :80 and :443  ──►  the VM's :443
   └──────────────────┘
           │  HTTPS (one pipe, one port)
           ▼
   ┌────────────────────────────────────────────────────────┐
   │  VM :443  →  proxy container (Caddy)                     │
   │  terminates TLS with the pm-mate-vm Let's Encrypt cert   │
   │  and routes by path:                                     │
   │    /api/v1/*  + /health   →  api:8000                    │
   │    /auth/*                →  keycloak:8080               │
   │    everything else        →  web:3000  (incl. /api/auth) │
   └────────────────────────────────────────────────────────┘
```

The uni edge proxy only knows "this hostname → that one port"; it can't split
your three services. The **on-VM Caddy container does that split** and
terminates TLS using the cert the uni dropped at
`/etc/letsencrypt/live/pm-mate-vm.uni-muenster.de/`. The public cert
(`pm-mate`) lives on the uni proxy; the VM cert (`pm-mate-vm`) just secures the
proxy↔VM hop, which is why Caddy binds by port and ignores the hostname
mismatch.

Result: the browser talks to a **single same-origin** `https://pm-mate.uni-muenster.de`,
so the per-port CORS and `/etc/hosts` Keycloak hacks from the local setup are gone.

## Prerequisites

- Access to the **FB4-DEV-VPN** (Cisco Secure Client → `https://vpn.uni-muenster.de/fb4-dev`, uni username + password + OTP).
- SSH to the VM: `ssh -p 2222 pm-admin@pm-mate-vm.uni-muenster.de`.
- Docker Engine + Compose v2 (≥ 2.24 for the `!reset`/`!override` merge tags) on the VM.
- The cert files present at `/etc/letsencrypt/live/pm-mate-vm.uni-muenster.de/{fullchain,privkey}.pem` and readable by the Docker daemon (root) – they are, by default. Certbot auto-renews them; Caddy re-reads on restart.

## Files this deployment adds

| File | Purpose |
| --- | --- |
| [`docker-compose.prod.yml`](./docker-compose.prod.yml) | Prod overlay – adds the proxy, repoints URLs, drops public ports + the macOS cv4cdd mount. |
| [`infra/caddy/Caddyfile`](./infra/caddy/Caddyfile) | TLS termination on `:443` + path routing. |
| `.env` (you create it on the VM – see §4) | Rotated secrets + Keycloak admin creds. |

## 0. Smoke-test the `:443` pipe first

Before deploying the app, confirm the uni forwarding + cert chain work
end-to-end. On the VM, serve a one-line page on `:443` with the real cert
(this exercises the same `tls <cert> <key>` mechanism production uses):

```bash
cat > /tmp/hello.Caddyfile <<'EOF'
{
	auto_https off
}
:443 {
	tls /etc/letsencrypt/live/pm-mate-vm.uni-muenster.de/fullchain.pem /etc/letsencrypt/live/pm-mate-vm.uni-muenster.de/privkey.pem
	respond "hello from pm-mate"
}
EOF

docker run --rm -p 443:443 \
  -v /etc/letsencrypt:/etc/letsencrypt:ro \
  -v /tmp/hello.Caddyfile:/etc/caddy/Caddyfile:ro \
  caddy:2-alpine
```

From your laptop (outside the uni net): `curl https://pm-mate.uni-muenster.de`.
Seeing `hello from pm-mate` means the pipe is good. `Ctrl-C` to stop, then
proceed.

## 1. Clone on the VM

```bash
ssh -p 2222 pm-admin@pm-mate-vm.uni-muenster.de
git clone <repo-url> ~/mate && cd ~/mate
```

`docker-compose.prod.yml` and `infra/caddy/Caddyfile` come with the repo.
(`~/mate` is the path `scripts/deploy.sh` expects – override with `DEPLOY_DIR`
if you clone elsewhere.)

## 2. Secrets + realm – one command

`infra/bootstrap-vm.sh` does the two fiddly bits in one go (covers §4 too):

```bash
sudo apt install -y jq        # the script needs jq
./infra/bootstrap-vm.sh
```

It (1) generates `.env` with fresh secrets, (2) patches the realm so the prod
domain is allowed and the client secret matches `.env`, and (3) starts the
stack (`docker compose … up -d --build`) after a free-port check – so it
covers §4 and §5 too. Pass `--no-start` to only write config. It's idempotent
and prints the Keycloak admin login at the end. Then jump to §6 (verify).

### Why this is needed / what it touches

Two things must line up or login fails:

- **Client secret** – the web app authenticates to Keycloak with a shared
  secret. It lives in **both** `.env` (`KEYCLOAK_CLIENT_SECRET`) and the realm
  JSON (`secret`); they must be **identical**. The script generates one value
  and writes it to both.
- **Redirect URI / web origin** – Keycloak only redirects back to URLs that are
  pre-approved. The default is `localhost:3000`; the script adds
  `https://pm-mate.uni-muenster.de` (keeping localhost, so local dev still
  works). Without it: "Invalid redirect_uri".

The realm imports from `infra/keycloak/realm-export/flows-funds-realm.json`
**only on the first boot** (empty Keycloak DB). On a re-deploy the import is
skipped – change realm settings in the admin console at
`https://pm-mate.uni-muenster.de/auth/admin` (login = `KEYCLOAK_ADMIN` /
`KEYCLOAK_ADMIN_PASSWORD`) instead.

<details>
<summary>Manual alternative (no script)</summary>

In the `flows-funds-web` client of the realm JSON, before first boot:

- `redirectUris`: add `"https://pm-mate.uni-muenster.de/api/auth/callback/keycloak"`
- `webOrigins`: add `"https://pm-mate.uni-muenster.de"`
- `attributes."post.logout.redirect.uris"`: append `##https://pm-mate.uni-muenster.de/login##https://pm-mate.uni-muenster.de/`
- `rootUrl` / `baseUrl`: set to `https://pm-mate.uni-muenster.de`
- `secret`: replace with a fresh value and use the **same** one for `KEYCLOAK_CLIENT_SECRET` in `.env` (§4).
</details>

### University login (skip the Keycloak form)

To send every login straight to the university's OIDC IdP and never render
Keycloak's own login page:

1. Register an OIDC client with the university. The redirect URI is Keycloak's
   broker callback, whose last path segment is the IdP **alias** (not the
   protocol):
   `https://pm-mate.uni-muenster.de/auth/realms/flows-funds/broker/keycloak-oidc/endpoint`
   Keep the Keycloak IdP alias equal to that segment (`keycloak-oidc`) so this
   URI never has to be re-registered.
2. Configure the realm (IdP + redirect + silent first login) on the **running**
   Keycloak – the realm JSON only imports into an empty DB:
   ```bash
   UNIV_CLIENT_ID=... UNIV_CLIENT_SECRET=... \
   UNIV_DISCOVERY_URL=https://idp.uni-muenster.de/.../.well-known/openid-configuration \
   KC_SERVER=http://localhost:8080/auth \
     ./infra/keycloak/configure-university-idp.sh   # IDP_ALIAS defaults to keycloak-oidc
   ```
3. Set `KEYCLOAK_IDP_HINT=keycloak-oidc` in `.env` (already defaulted in
   `docker-compose.prod.yml`) and restart the `web` service.

Break-glass: the local `admin@flows-funds.local` user still works via the
Keycloak admin console (`master` realm), which the redirect does not touch.

## 3. cv4cdd model (optional)

The base compose mounts a macOS-only path for the cv4cdd model; the prod
overlay drops it. If you want cv4cdd on the VM, copy the model onto the host
and add a mount under `api.volumes` in `docker-compose.prod.yml`:

```yaml
    volumes: !override
      - ./data:/app/data
      - ./modules:/app/modules
      - /srv/flows-funds/cv4cdd_model:/srv/flows-funds/cv4cdd_model:ro
```

Then set its `model_path` under **Settings → Modules → Temporal Dynamics** to
that absolute path. Otherwise just disable the cv4cdd module in the UI.

## 4. Create `.env` (rotated secrets)

```dotenv
# Public origin / Auth.js
AUTH_SECRET=<openssl rand -base64 32>

# Keycloak (the web client's confidential secret – must equal the realm JSON)
KEYCLOAK_CLIENT_SECRET=<same fresh secret as in the realm JSON>

# Keycloak Postgres + admin console
KEYCLOAK_DB_PASSWORD=<fresh>
KEYCLOAK_ADMIN=admin
KEYCLOAK_ADMIN_PASSWORD=<fresh – this is your admin console login>
```

The URL-derived, non-secret settings (issuer, JWKS, CORS, `NEXT_PUBLIC_API_URL`,
`AUTH_URL`, Keycloak hostname/relative-path) are all set in
`docker-compose.prod.yml`, so they don't belong in `.env`.

## 4a. Resource limits & multi-tenant fairness (optional)

One VM is shared across all tenants. These knobs bound how much CPU/RAM one user's
heavy module mining can take and stop a runaway offload from starving others. All
optional with safe defaults – add to `.env` only to tune. Env names are the
uppercased field names (case-insensitive).

```dotenv
# CPU offload (ctx.run_in_process – pm4py/networkx mining runs in its own process,
# one short-lived process per call, hard-killable by the job timeout).
MODULE_PROCESS_POOL_SIZE=4    # max concurrent offload processes (default min(cores, 8))
MAX_OFFLOADS_PER_USER=2       # per-tenant offload cap (default 0 = pool size, i.e. no per-user limit)

# A job (and its offloads) past this many seconds is force-stopped – now a real
# SIGKILL of the offload process, not just a flipped DB row.
JOB_EXECUTION_TIMEOUT_SECONDS=1800   # default 1800 (30 min); lower if every job is known-fast

# Parallel asyncio job slots (admin can also change this live at Settings → Jobs).
WORKER_CONCURRENCY=2          # default 2

# DuckDB, per query – stop one big-log query or a many-card dashboard from grabbing
# every core / all RAM.
DUCKDB_THREADS=4              # default 0 = all cores
DUCKDB_MEMORY_LIMIT=4GB       # default empty = DuckDB's own default
```

On a shared box set `MAX_OFFLOADS_PER_USER` **below** `MODULE_PROCESS_POOL_SIZE` so no
single user can hold every offload slot, and cap `DUCKDB_THREADS` / `DUCKDB_MEMORY_LIMIT`
so one query can't monopolise cores or RAM. Leaving them unset keeps single-tenant
behaviour (no per-user throttling).

## 5. Bring it up

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
docker compose logs -f api      # first boot installs module deps – up to ~10 min (cv4cdd pulls TensorFlow)
```

Subsequent boots reuse the cached wheels under `data/uv-python/` and start in
seconds.

## 6. Verify (in order – each step rules out one layer)

```bash
# 1. Next.js reachable through the proxy
curl -I https://pm-mate.uni-muenster.de

# 2. API reachable through the proxy (unauthenticated liveness)
curl https://pm-mate.uni-muenster.de/health

# 3. Keycloak issuer is the PUBLIC URL (not `keycloak`/localhost) – if this is
#    wrong, the OIDC login loop breaks
curl https://pm-mate.uni-muenster.de/auth/realms/flows-funds/.well-known/openid-configuration | grep '"issuer"'
#    expect: "issuer":"https://pm-mate.uni-muenster.de/auth/realms/flows-funds"
```

Then in a browser:

4. Log in with `admin@flows-funds.local` / `flowsfunds` (Keycloak forces a
   password reset) – exercises the full OIDC redirect chain.
5. **Upload a log, run a job, and open Mate AI.** This confirms WebSockets
   (live job/event updates) and SSE (AI streaming) survive *both* proxies. If
   live updates stall but everything else works, the uni proxy likely needs
   WebSocket/streaming passthrough enabled for this alias – that's the first
   thing to raise with FB4 IT.
6. **Confirm the realm-hardening one-shot ran.** The `keycloak-config` service
   patches `sslRequired` + session lifetimes once per deploy, then exits:
   `$DC logs keycloak-config` → expect
   `realm 'flows-funds' hardening applied: sslRequired=EXTERNAL …`. A non-zero
   exit leaves Keycloak + app running but the realm unpatched — fix
   `KEYCLOAK_ADMIN_PASSWORD` and re-run `$DC up -d`.
7. **Log in once in Safari, not only Chrome.** Safari enforces cookie
   size/eviction more strictly. The server-side session store (`SESSION_STORE_DIR`
   on the web service, §5) keeps the auth cookie ~64 B so the full Keycloak token
   never chunks — without it Safari drops a chunk and loops between the app and
   `/login` (Chrome tolerates the same chunked cookie). See Troubleshooting.

> **Staged rollout — internal OIDC back-channel (removes the TLS bypass).** The
> web container sets `NODE_TLS_REJECT_UNAUTHORIZED=0` to tolerate the cert-name
> mismatch on the server-side Keycloak hop. To remove it, in order: (1) uncomment
> `KEYCLOAK_INTERNAL_URL: http://keycloak:8080/auth/realms/flows-funds` on the web
> service, `$DC up -d`; (2) verify a full login **and** a token refresh (leave a
> tab idle past the access-token expiry, then click — must not bounce to `/login`)
> both succeed; (3) only then delete `NODE_TLS_REJECT_UNAUTHORIZED`. A wrong
> internal URL breaks login, and dropping the bypass first removes the fallback —
> never combine the steps.

## Updating a running deployment

### One-command deploy from your laptop (recommended)

With the VM clone in place and `.env` set, push-to-deploy from your machine
**while on the FB4-DEV-VPN**:

```bash
make deploy          # or: ./scripts/deploy.sh
```

This pushes the current branch, then over SSH does `git reset --hard origin/<branch>`,
rebuilds, restarts, and health-checks `https://pm-mate.uni-muenster.de/health`.
A cloud GitHub Action can't do this – GitHub's runners aren't on the VPN, so
they can't reach the VM's SSH port. The deploy clone mirrors git; your secrets
stay safe in the gitignored `.env` (untouched by the reset). Override the
target with `DEPLOY_HOST` / `DEPLOY_DIR` / `DEPLOY_BRANCH` env vars if needed,
and run `ssh-copy-id -p 2222 pm-admin@pm-mate-vm.uni-muenster.de` once to skip
the password prompt.

### Or manually on the VM

```bash
cd mate && git pull
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

- Changing `NEXT_PUBLIC_API_URL` (or any `NEXT_PUBLIC_*`) requires `--build` – it's inlined into the client bundle.
- After editing only `infra/caddy/Caddyfile`: `docker compose -f docker-compose.yml -f docker-compose.prod.yml restart proxy`.
- The realm JSON is **not** re-imported once the Keycloak DB exists – change realm settings in the admin console, or `docker compose down -v` to wipe the Keycloak volume and re-import (this also drops all Keycloak users).

## MCP server (let external tools read process data)

Opt-in. When enabled, the API mounts a **read-only** [Model Context Protocol](https://modelcontextprotocol.io)
server at `/mcp` (streamable HTTP) so external MCP clients – Claude Desktop,
claude.ai, a customer's own agent – can read a user's process-mining outputs.

- **Enable:** set `MCP_ENABLED=1` in `.env` (default off). Optionally set
  `API_BASE_URL=https://<your-origin>` so the UI advertises the right endpoint
  (otherwise it's derived from the request).
- **Auth:** no anonymous access. Each user mints a personal access token (PAT)
  at **Settings → API & MCP**; the client sends it as
  `Authorization: Bearer mate_pat_…`. A PAT acts as its owner with no admin
  role and reads only that user's data (same tenant isolation as the rest of
  the platform). PATs are the only machine-to-machine credential – Keycloak
  only issues short-lived, browser-bound tokens.
- **Proxy:** streamable HTTP is the same SSE-style passthrough as `/events`
  (§6 step 5) – the existing proxy chain carries it; no WebSocket upgrade.
- **Tools (read-only, curated):** `list_processes`, `list_modules`,
  `get_module_output`, `get_process_overview`, plus curated `get_bottlenecks` /
  `get_conformance` / `get_process_model` / `get_drifts` and `get_server_info`.
  Output is curated module summaries only – never raw event rows.

Example Claude Desktop entry (the UI generates this with your URL filled in):

```json
{ "mcpServers": { "mate": {
  "url": "https://<your-origin>/mcp",
  "headers": { "Authorization": "Bearer mate_pat_…" }
} } }
```

### Enterprise hardening

- **Egress consent:** with `MCP_REQUIRE_EGRESS_CONSENT=1` (default) each user
  must opt in (Settings → API & MCP) before any tool returns their data – a
  local-first acknowledgement that data leaves the box. Set `0` to make minting
  a token sufficient.
- **Scopes:** tokens carry granted scopes (`processes:read`, `modules:read`);
  an empty grant means all read scopes. Tools enforce them.
- **Rate limit + concurrency + timeout** (single-instance, in-process):
  `MCP_RATE_LIMIT_PER_MINUTE` (0 disables) + `MCP_RATE_LIMIT_BURST`,
  `MCP_MAX_CONCURRENCY_PER_USER` / `MCP_MAX_CONCURRENCY_GLOBAL`,
  `MCP_TOOL_TIMEOUT_SECONDS`. **Scaling out to >1 API replica needs a shared
  store** for these and stateful sessions – not built; call it out before HA.
- **OAuth (SSO):** the server is an OAuth resource server advertising Keycloak
  via RFC 9728 (`/.well-known/oauth-protected-resource`, and a
  `WWW-Authenticate: …resource_metadata=…` on 401). Pre-register a **public**
  OAuth client in Keycloak (DCR is not assumed) and set `MCP_OAUTH_CLIENT_ID`;
  the client id + metadata URL surface in Settings → API & MCP. Clients then
  run auth-code + PKCE against Keycloak and call `/mcp` with the resulting JWT
  (validated by the existing JWKS path). PATs remain the simplest fallback.
- **Admin governance:** live enable/disable (no restart) + the token mint
  policy (`all_users` / `admin_only` / `disabled`) at Settings → API & MCP
  (admin only); an org-wide token list + revoke is there too. Backed by
  `GET/PUT /api/v1/system/mcp` and `/api/v1/admin/api-tokens`.
- **Audit:** every tool call emits a `mcp.audit` structured log line (always,
  for SIEM) + a best-effort analytics event for the admin insights UI.
- **Metrics:** Prometheus at `GET /api/v1/system/mcp-metrics` (admin) –
  `mate_mcp_tool_calls_total`, `mate_mcp_tool_latency_seconds`,
  `mate_mcp_rate_limited_total`, `mate_mcp_active_calls`.

> **OAuth needs `API_BASE_URL`.** The OAuth discovery document and the
> `WWW-Authenticate` challenge are built **only** from `API_BASE_URL` (never the
> request `Host` header, to avoid pointing a client's login at a forged host).
> Without it, OAuth discovery is simply not advertised (PATs still work).
>
> **Hardening backlog (not yet built):** (1) per-scope mapping for Keycloak JWTs
> — today any JWT with the API audience gets all read scopes; add a dedicated
> MCP audience/client-scope to downscope. (2) A pre-auth IP/global throttle —
> the per-user limiter only applies after a principal resolves (a bogus PAT
> still costs one indexed lookup). (3) Shared rate-limit/session store for
> multi-replica scale-out. (4) Idle eviction of the in-process limiter maps.
> Never run `DEMO_MODE=1` with MCP in production — the demo bypass is refused on
> `/mcp`, but the combination is logged loudly as a misconfiguration.

## Backup

`./data/` (SQLite metadata + Parquet logs + module results + cached runtimes)
is bind-mounted – back it up by copying the directory. Keycloak users live in
the `kc-data` Docker volume; include it if you need to preserve logins.

```bash
tar czf mate-data-$(date +%F).tgz -C ~/mate data                                   # SQLite + Parquet + results
docker run --rm -v kc-data:/v -v "$PWD":/b alpine tar czf /b/kc-data.tgz -C /v .   # Keycloak users
```

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| Every API call 401s after login | `KEYCLOAK_JWKS_URL` missing the `/auth` prefix, or `KEYCLOAK_ISSUER` ≠ the issuer Keycloak actually mints (check §6 step 3). |
| Redirect loop / "invalid redirect_uri" at login | Prod `redirectUris`/`webOrigins` not added to the realm (§2), or realm imported before the edit. |
| Safari (not Chrome) loops between the app and `/login` after a successful login | `SESSION_STORE_DIR` unset on the web service → the full Keycloak token rides in the session cookie, chunks past 4KB, and Safari drops/evicts a chunk so `auth()` can't decode it. Set `SESSION_STORE_DIR: /app/sessions` + the `./data/web-sessions` volume (§5) so the cookie holds only an opaque id. |
| Login page styled wrong / 404 on `/auth/...` assets | `KC_HTTP_RELATIVE_PATH` and the Caddy `/auth/*` route out of sync. |
| Live jobs/AI never update, page otherwise fine | WebSocket/SSE not passed through by the uni proxy (§6 step 5). |
| `tls` cert errors on proxy start | Mounted only `live/` instead of all of `/etc/letsencrypt` – the symlinks into `archive/` break. |
| MCP client gets 401 at `/mcp` | Token missing, revoked, expired, or not a `mate_pat_…` PAT (mint one at Settings → API & MCP). |
| MCP endpoint 404s | `MCP_ENABLED` not set on the API service. |
