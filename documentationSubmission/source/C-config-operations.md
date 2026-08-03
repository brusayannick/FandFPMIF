# Configuration and Operations Reference

The lookup counterpart to Chapter 7. `.env.example` in the repository lists every variable with an inline comment; the table below covers those whose effect is not obvious or whose default is consequential.

Only `NEXT_PUBLIC_API_URL` requires a rebuild, because it is inlined into the client bundle at build time. Every other change needs the affected service brought **up** again rather than restarted, because a restart preserves the old environment.

[[TABLE]]
caption: The environment variables whose default or effect is consequential.
| Variable (default) | Effect |
| --- | --- |
| `NEXT_PUBLIC_API_URL` (`http://localhost:8000`) | The URL the browser uses to reach the API. **Rebuild required.** |
| `AUTH_SECRET` (sample) | Encrypts the session cookie. **Rotate before any non-local deployment.** |
| `KEYCLOAK_CLIENT_SECRET` (sample) | **Must be identical in `.env` and the realm JSON**, or login fails. |
| `KEYCLOAK_ISSUER`, `KEYCLOAK_JWKS_URL` | Must match the issuer Keycloak actually mints, that is the **public** URL in production, with the `/auth` prefix. Getting either wrong produces a login loop. |
| `KEYCLOAK_IDP_HINT` (empty) | Set to the identity-provider alias to skip Keycloak's own login form. |
| `KEYCLOAK_ADMIN_CLIENT_ID`, `_SECRET` | Enables removing the Keycloak account when a user is deleted; without them that step no-ops. |
| `SESSION_STORE_DIR` (unset) | **Set it in production.** Otherwise the full token rides in the cookie, chunks past 4 KB, and Safari loops at login. |
| `USER_TRACKING_ONBOARDING` (`force`) | `force` = on for everyone, no opt-out and no privacy tab; `on` = default on with opt-out; `off` = default off with opt-in. |
| `WORKER_CONCURRENCY` (`2`) | Parallel job slots, 1 to 8; an administrator can also change this live. |
| `JOB_EXECUTION_TIMEOUT_SECONDS` (`1800`) | A job past this is force-stopped, including a real kill of its offloaded processes. `0` disables. |
| `DUCKDB_THREADS` (`0`), `DUCKDB_MEMORY_LIMIT` (unset) | Per-query limits. Set both on a shared machine so one query cannot claim the host. |
| `STORAGE_MODE` (`local`) | `local` or `s3`. Switching migrates existing data rather than stranding it. |
| `LOCAL_CACHE_MAX_BYTES` (`0`) | **Object storage only reclaims disk once this is set.** Without it, S3 mode merely mirrors. |
| `CACHE_EVICT_DRY_RUN` (`true`) | Eviction rehearsal. Soak with it on, then disable it. |
| `JOB_RETENTION_DAYS` (`0`) | Prunes finished job rows, the main growth source in the metadata database. |
| `MCP_ENABLED` (`false`), `API_BASE_URL`, `MCP_TOOLSETS`, `MCP_READ_ONLY` | Enable the MCP server, tell it its public base, and choose which toolsets register and whether write tools register at all. |
| `COMPOSE_PROFILES` (empty) | Optional services, for instance `graph` for the Neo4j sidecar. |
| `ENV` (`prod`) | `dev` additionally enables module hot reload. |
[[/TABLE]]

Remaining variables, documented inline in `.env.example`: `AUTH_URL`, `CORS_ORIGINS`, `KEYCLOAK_CLIENT_ID`, `KEYCLOAK_AUDIENCE`, `KEYCLOAK_ADMIN`, `KEYCLOAK_ADMIN_PASSWORD`, `KEYCLOAK_DB_PASSWORD`, `KEYCLOAK_REALM`, `MODULE_PROCESS_POOL_SIZE`, `SUBPROCESS_RESPAWN_MAX_ATTEMPTS`, `SUBPROCESS_RESPAWN_BACKOFF_CAP_SECONDS`, `SUBPROCESS_CANCEL_GRACE_SECONDS`, `JAVA_BIN`, `EVENT_LOG_CACHE_ENTRIES`, `CACHE_EVICT_MIN_AGE_SECONDS`, `CACHE_EVICT_INTERVAL_SECONDS`, `MCP_OAUTH_CLIENT_ID`, `MCP_RATE_LIMIT_PER_MINUTE`, `MCP_RATE_LIMIT_BURST`, `MCP_WRITE_RATE_LIMIT_PER_MINUTE`, `MCP_MAX_CONCURRENCY_PER_USER`, `MCP_MAX_CONCURRENCY_GLOBAL`, `MCP_TOOL_TIMEOUT_SECONDS`, `MCP_REQUIRE_EGRESS_CONSENT`, `DEMO_MODE`, `DEMO_ADMIN`, `LOG_LEVEL`, `DATA_DIR`, `MODULES_DIR`, `DATABASE_URL`.

## Command reference

[[TABLE]]
caption: Commands, from the Makefile unless noted.
| Command | Effect |
| --- | --- |
| `make install` | `uv sync --extra dev` plus `pnpm install` |
| `make dev`, `make dev-api`, `make dev-web` | Host-native dev servers; `dev-api` runs migrations first |
| `make up`, `make up-dev`, `make down` | Base stack, dev overlay, stop |
| `make build`, `make test`, `make fmt` | Rebuild images; Python test suite; lint and format |
| `make typecheck` | Web type-check. Does **not** cover module panels |
| `make codegen` | Regenerate the web app's API types from a running API |
| `make sdk-jvm` | Build the Java SDK and the reference JVM module jar |
| `make clean` | Wipe event logs, module results and the metadata database. Irreversible |
| `uv run pyright` | Strict type-check of the API sources and Python SDK |
| `uv run pytest modules/<folder>/tests` | One module's tests |
| `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build` | Production deployment |
| `./infra/bootstrap-vm.sh` | One-pass VM bootstrap: secrets, realm patch, start |
[[/TABLE]]

## Proxy configuration, backup and restore

The production overlay adds a Caddy container binding port 443, terminating TLS with the VM's certificate and routing by path: `/api/v1/*` and `/health` to the API, `/auth/*` to the identity provider, and everything else, including the web application's own auth callback, to the web service. Mount the whole certificate directory rather than just the live subdirectory, or the symbolic links into the archive break. A Caddyfile-only change needs the proxy restarted; an environment change needs it brought up again. The chain carries HTTP streaming transparently and **does not carry WebSocket upgrades**, which is why both live streams are Server-Sent Events (§4.10); if everything works except live updates, that is the layer to look at.

**Back up** by copying the bind-mounted `data/` directory, which holds the metadata database, per-user Parquet event data and module results, uploaded modules and cached runtimes. The identity provider's data lives in a separate Docker volume and must be backed up separately if accounts are to survive; taking the stack down with volumes removed wipes accounts and re-imports the realm on the next boot. **Restore** by stopping the stack, replacing `data/`, and starting again. Migrations run automatically on API startup and are not reversible in general, so a backup must precede every update rather than follow it. In object-storage mode the bucket is authoritative and local disk is a cache, so a restore is the bucket plus the metadata database; losing the metadata database orphans every object in the bucket.
