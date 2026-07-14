# Alpha Miner (Java)

Classic Alpha-algorithm process discovery (van der Aalst et al., IEEE TKDE
2004) - and the platform's **reference JVM module**: the backend is a single
self-contained Java jar, no Python code at all.

## How it runs

- `manifest.yaml` declares `runtime: {kind: jvm, jar: dist/alpha-miner-all.jar}`.
- The platform launches the jar as a worker process (`java -Xmx1g -jar ...`)
  speaking the wire protocol in [`modules/PROTOCOL.md`](../PROTOCOL.md).
- On every `log.imported` a precompute job mines the Petri net
  (`duckdb_fetch` for the ordered case/activity rows, progress + cooperative
  cancellation throughout) and caches it as JSON.
- `GET /api/v1/modules/alpha_miner_java/model` serves the net; the manifest's
  `datasets:` entry (shape `graph`, kind `petri_net`) lets the platform's
  generic visualization render it on dashboards - zero frontend code here.

## The jar (provenance)

`dist/alpha-miner-all.jar` is a **committed build artefact** - the api image
ships only a JRE and `modules/` is bind-mounted, so the platform cannot build
it. Source lives in
[`packages/module-sdk-jvm/examples/alpha-miner`](../../packages/module-sdk-jvm/examples/alpha-miner);
rebuild with

```bash
make sdk-jvm   # needs a JDK 17+ on the dev machine
```

which recompiles the SDK + example and copies the fat jar back here. The
conformance suite (`apps/api/tests/test_worker_conformance.py`) exercises the
same SDK internals, so meaningful drift between source and committed jar
fails tests.

## Limits

- The classic Alpha pair search is exponential in the worst case - the module
  caps at 40 distinct activities and fails with a clear message beyond that
  (filter the log first).
- Alpha is presented for its historical/didactic value: it has no noise
  handling. For production discovery use the `discovery` module's inductive
  miner variants.
