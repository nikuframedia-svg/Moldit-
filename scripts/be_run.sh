#!/bin/bash
# Script para executar backend
# Conforme SP-BE-01

set -e

cd "$(dirname "$0")/../apps/backend" || exit 1

echo "🚀 Iniciando backend..."
echo "  - Host: 0.0.0.0"
echo "  - Port: 8000"
echo "  - API: /v1"
echo ""

# Verificar se venv existe
if [ ! -d "venv" ]; then
    echo "⚠️  Virtual environment não encontrado. Criando..."
    python3 -m venv venv
    source venv/bin/activate
    pip install -r requirements.txt
else
    source venv/bin/activate
fi

# Executar servidor
uvicorn src.main:app --reload --host 0.0.0.0 --port 8000
