#!/bin/bash
# Build multi-arch Docker images and push to Docker Hub.
#
# Prerequisites:
#   1. Docker Desktop running (with buildx)
#   2. Logged in: docker login
#
# Usage (from project root):
#   bash scripts/docker-publish.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

REPO="fxcgvhjkihugyftd"
PLATFORMS="linux/amd64,linux/arm64"

# Ensure buildx builder exists
docker buildx inspect pp1-builder >/dev/null 2>&1 || \
  docker buildx create --name pp1-builder --use

docker buildx use pp1-builder

# Build and push images (pnpm workspace handles scheduling-engine dependency)
echo "==> Building and pushing backend (Python 3.13)..."
docker buildx build \
  --platform "$PLATFORMS" \
  --tag "$REPO/pp1-backend:latest" \
  --push \
  "$PROJECT_DIR/apps/backend"

echo "==> Building and pushing frontend (Node 22 + Nginx 1.27)..."
docker buildx build \
  --platform "$PLATFORMS" \
  --tag "$REPO/pp1-frontend:latest" \
  --build-arg VITE_APP_MODE=mock \
  --build-arg VITE_API_BASE_URL=/api \
  -f "$PROJECT_DIR/apps/frontend/Dockerfile" \
  --push \
  "$PROJECT_DIR"

echo "==> Done. Images pushed to $REPO on Docker Hub (amd64 + arm64)."
