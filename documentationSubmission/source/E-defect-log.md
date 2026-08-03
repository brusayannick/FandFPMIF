# Defect and Resolution Log

The significant problems encountered during the project, with the section documenting the resulting design consequence. Roughly chronological.

[[TABLE]]
caption: Defects, root causes and resolutions.
| Symptom and root cause | Resolution | See |
| --- | --- | --- |
| A valid XES log imported with the wrong event element detected, because detection sampled only the first 200 records | Detection widened and made schema-aware rather than sample-based | §4.6 |
| First boot appeared to hang for minutes: per-module dependency resolution, dominated by one module's TensorFlow stack | Ten-minute health-check grace period, dependency hash caching, explicit warning in the setup documentation | §5.3, §7.2 |
| Image build failed at `uv sync`: lock-file writes fail on macOS Docker Desktop bind mounts, which restrict atomic renames | Installer switched to `uv venv` plus `uv pip install`, which writes no lock file | §4.10 |
| Identity provider container never became healthy: the health check used a bash-only construct under a shell that was not bash | Container shell pointed at bash | §9.4 |
| Login looped after a successful sign-in: the issuer was the container name rather than the public URL, so minted tokens did not match | Issuer set to the public origin; verification step 3 of §7.5 catches it in one command | §7.5 |
| Reverse proxy answered 502 after login: the session cookie carried the full token and grew past 4 KB | Identity token dropped from the cookie, then a server-side session store keyed by an opaque identifier | §9.4 |
| Login looped in Safari but not Chrome: Safari evicts oversized chunked cookies where Chrome tolerates them | Server-side session store made mandatory in production; verification step 4 requires testing in Safari | §7.5 |
| University identity provider rejected the token exchange with `invalid_client`: it requires `client_secret_basic` | Configuration script sets the authentication method explicitly. The provider must be deleted and recreated, because Keycloak ignores the provider type on update | §7.4 |
| Live job progress never updated in production while everything else worked: the edge proxy does not carry WebSocket upgrades, so the handshake arrived as a plain `GET` and 404'd | Both live streams migrated to Server-Sent Events over `fetch`; authentication moved from the query string to a header | §4.10 |
| Gateway timeout on the deployed instance: long request paths held open behind two proxies | Long operations moved behind the job runtime; proxy timeouts aligned | §4.7 |
| Bridged worker died without an error: a JSON-RPC message exceeded the stream reader's 64 KiB line limit, raising a buffer error that tore down the connection | Limit raised well past any control message; DataFrames moved to a Parquet handoff so bulk data never crosses the socket | §4.10, §5.4 |
| Bridged worker survived its parent, holding a socket and an environment | Parent-death guard made mandatory in the protocol, with a regression test | §5.5 |
| A module crash disabled that module until the next platform restart | Backed-off respawn with a bounded attempt count, covered by a regression test | §4.10 |
| A module environment built on the host crashed on import inside the container, having been built under a different interpreter | The platform's Python version folded into the dependency hash, so such an environment rebuilds automatically | §5.3 |
| A panel built locally and failed in the browser: the import allow-list had been edited in one of its two consumers only | Parity test asserting the bundler's external list and the runtime installer's list never diverge | §5.7, §9.3 |
| Disk on the deployed instance grew far beyond the imported data: the first object-storage implementation was a write-through mirror whose local copy was never evicted, and the largest artefacts bypassed synchronisation | Four-phase redesign making object storage authoritative and local disk a bounded LRU cache, closing the bypass holes, enforcing the quota, making hydration partial | §4.6, §9.4 |
| Dashboard cards rendered empty after a board change: card state and grid geometry were stored separately and could disagree | Board state consolidated into a single JSON blob written atomically | §4.9 |
| Every import produced a failed job on a fresh deployment: the drift-detection module is enabled by default and subscribes to the import event, but no trained model ships with it | Global model pinning added as an administrative action and documented. **The proper fix, skipping cleanly when no model is configured, is not done** | §7.4, §11.3 |
| Platform stopped slowly: bridged workers and offloaded processes were not part of the shutdown sequence | Child-process supervision with an explicit shutdown path, covered by a test | §4.7 |
| External vector store rejected writes: after a configuration change the index dimension no longer matched the embedding model | Documented as a module-level operational step; the platform does not manage third-party service state | §6.5 |
| A user could remove a module the deployment needed, because installation is per user by design and had no override | Module policy: an administrator can pin a module as globally enabled or locked | §4.4 |
[[/TABLE]]
