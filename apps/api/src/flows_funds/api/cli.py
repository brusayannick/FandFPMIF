"""CLI entry point — `flows-funds-api` script (declared in pyproject.toml).

Currently a thin wrapper around uvicorn so the API can be launched without
remembering the full module path. Heavier subcommands (db migrate, module
sync, etc.) land alongside the relevant phases.
"""

from __future__ import annotations

import argparse

import uvicorn


def main() -> None:
    parser = argparse.ArgumentParser(prog="flows-funds-api")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--reload", action="store_true")
    args = parser.parse_args()

    uvicorn.run(
        "flows_funds.api.main:app",
        host=args.host,
        port=args.port,
        reload=args.reload,
    )


if __name__ == "__main__":
    main()
