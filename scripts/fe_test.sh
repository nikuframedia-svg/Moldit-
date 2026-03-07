#!/bin/bash
# Script para executar testes do frontend
# Conforme SP-FE-09

set -e

cd "$(dirname "$0")/../apps/frontend" || exit 1

echo "🧪 Executando testes do frontend..."
echo "  - Testes de regressão"
echo "  - Testes de contrato (fixtures)"
echo "  - Testes A11y básicos"
echo ""

npm run test -- --run

if [ $? -eq 0 ]; then
  echo ""
  echo "✅ Todos os testes passaram."
else
  echo ""
  echo "❌ Alguns testes falharam."
  exit 1
fi
