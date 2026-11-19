"""``python -m sandbox_kit_clone.agent --root /workspace --port 50051``."""

from __future__ import annotations

import argparse
import logging
from pathlib import Path

from sandbox_kit_clone.agent.server import serve


def main() -> None:
    parser = argparse.ArgumentParser(description="Sandbox Kit exec agent (gRPC)")
    parser.add_argument("--root", default="/workspace", help="gốc workspace")
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=50051)
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    serve(Path(args.root), args.host, args.port)


if __name__ == "__main__":
    main()
