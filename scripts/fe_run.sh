#!/bin/bash
# Script para executar dev server do frontend

cd "$(dirname "$0")/../apps/frontend" || exit 1

echo "🚀 Iniciando dev server do frontend..."
echo "📝 Modo: ${VITE_APP_MODE:-mock} (use VITE_APP_MODE=api para modo API)"
echo "🌐 URL: http://localhost:5173"
echo ""

npm run dev
