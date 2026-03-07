#!/bin/bash
# Build Docker images locally (sem push ao registry).
#
# Prerequisites:
#   1. Docker Desktop running
#   2. pnpm installed
#
# Usage (from project root):
#   bash scripts/docker-build.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Build Docker images (pnpm workspace handles scheduling-engine dependency)
echo "==> Building Docker images..."
cd "$PROJECT_DIR"
docker compose build

echo "==> Done. Images built locally."
