#!/bin/bash
# Script para executar testes do backend
# Conforme SP-BE-01

set -e

cd "$(dirname "$0")/../apps/backend" || exit 1

echo "🧪 Executando testes do backend..."
echo "  - Testes unitários (middleware)"
echo "  - Testes de integração"
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

# Instalar pytest se não estiver instalado
pip install pytest pytest-asyncio httpx > /dev/null 2>&1 || true

# Executar testes
pytest -v

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Todos os testes passaram."
else
    echo ""
    echo "❌ Alguns testes falharam."
    exit 1
fi
