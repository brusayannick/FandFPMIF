# VM Cheat Sheet

Quick command reference for the uni VM (`pm-mate.uni-muenster.de`). Full
context in [`DEPLOY.md`](./DEPLOY.md). **All VM access needs the FB4-DEV-VPN.**

## Connect

```bash
ssh -p 2222 pm-admin@pm-mate-vm.uni-muenster.de
ssh-copy-id -p 2222 pm-admin@pm-mate-vm.uni-muenster.de   # once, to skip password
```

Compose stack lives in `~/mate`. The prod overlay is always both files:

```bash
DC="docker compose -f docker-compose.yml -f docker-compose.prod.yml"
```

## Deploy

```bash
make deploy                 # from laptop: push branch + redeploy + health-check
./scripts/deploy.sh --no-push   # redeploy origin's current state, no push
```

Manual, on the VM:

```bash
cd ~/mate && git pull && $DC up -d --build
```

- `NEXT_PUBLIC_*` change → needs `--build` (inlined into the client bundle).
- Caddyfile-only change → `$DC restart proxy`.

## Run / stop / status

```bash
$DC up -d --build        # bring up (first boot ~10 min: module deps)
$DC ps                   # status
$DC restart api          # restart one service
$DC down                 # stop (keeps volumes/data)
$DC down -v              # stop + WIPE Keycloak users (re-imports realm next boot)
```

## Logs

```bash
$DC logs -f api                 # follow API
$DC logs --tail=80 api web      # last 80 lines
$DC logs -f proxy keycloak
```

## Verify

```bash
curl -I https://pm-mate.uni-muenster.de            # web
curl https://pm-mate.uni-muenster.de/health        # api
curl https://pm-mate.uni-muenster.de/auth/realms/flows-funds/.well-known/openid-configuration | grep '"issuer"'
# expect: "issuer":"https://pm-mate.uni-muenster.de/auth/realms/flows-funds"
```

## First-time setup

```bash
git clone <repo-url> ~/mate && cd ~/mate
sudo apt install -y jq
./infra/bootstrap-vm.sh          # writes .env + patches realm + starts stack
```

Admin console: `https://pm-mate.uni-muenster.de/auth/admin`
(`KEYCLOAK_ADMIN` / `KEYCLOAK_ADMIN_PASSWORD` from `.env`).

## Backup

```bash
tar czf mate-data-$(date +%F).tgz -C ~/mate data    # SQLite + Parquet + results
docker run --rm -v kc-data:/v -v "$PWD":/b alpine tar czf /b/kc-data.tgz -C /v .  # Keycloak users
```

## Troubleshoot

| Symptom | First check |
| --- | --- |
| API 401s after login | `KEYCLOAK_ISSUER` ≠ minted issuer (verify step 3) |
| "invalid redirect_uri" | prod URL not in realm `redirectUris`/`webOrigins` |
| Live jobs/AI never update | uni proxy not passing WebSocket/SSE (raise with FB4 IT) |
| `tls` cert error on proxy | mount all of `/etc/letsencrypt`, not just `live/` |
