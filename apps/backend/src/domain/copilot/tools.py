"""Copilot function-calling tools — 18 tools for GPT-4o.

Each tool is a dict compatible with OpenAI's function calling schema.
Execution logic is in engine.py.
"""

from __future__ import annotations

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "adicionar_regra",
            "description": "Adicionar uma nova regra de scheduling (SE/ENTÃO).",
            "parameters": {
                "type": "object",
                "properties": {
                    "id": {"type": "string", "description": "ID único da regra"},
                    "name": {"type": "string", "description": "Nome descritivo"},
                    "condition_type": {
                        "type": "string",
                        "description": "Tipo de condição (ex: machine_load_above)",
                    },
                    "condition_params": {
                        "type": "object",
                        "description": "Parâmetros da condição",
                    },
                    "action_type": {
                        "type": "string",
                        "description": "Tipo de acção (ex: set_priority)",
                    },
                    "action_params": {"type": "object", "description": "Parâmetros da acção"},
                },
                "required": ["id", "name", "condition_type", "action_type"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "remover_regra",
            "description": "Remover uma regra existente pelo seu ID.",
            "parameters": {
                "type": "object",
                "properties": {
                    "id": {"type": "string", "description": "ID da regra a remover"},
                },
                "required": ["id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "alterar_definicao",
            "description": "Alterar uma definição de configuração da fábrica.",
            "parameters": {
                "type": "object",
                "properties": {
                    "key": {
                        "type": "string",
                        "description": "Chave da configuração (ex: scheduling.buffer_days)",
                    },
                    "value": {"description": "Novo valor"},
                },
                "required": ["key", "value"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "explicar_referencia",
            "description": "Explicar detalhes de uma referência/SKU: stock, encomendas, máquina, prioridade.",
            "parameters": {
                "type": "object",
                "properties": {
                    "sku": {"type": "string", "description": "Código da referência/SKU"},
                },
                "required": ["sku"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "ver_alertas",
            "description": "Ver alertas actuais de produção, ordenados por severidade.",
            "parameters": {
                "type": "object",
                "properties": {
                    "severity": {
                        "type": "string",
                        "enum": ["atraso", "red", "yellow", "all"],
                        "description": "Filtrar por severidade",
                    },
                    "limit": {
                        "type": "integer",
                        "description": "Número máximo de alertas (default: 10)",
                    },
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "ver_carga_maquinas",
            "description": "Ver carga actual de todas as máquinas ou de uma específica.",
            "parameters": {
                "type": "object",
                "properties": {
                    "machine_id": {
                        "type": "string",
                        "description": "ID da máquina (mostra todas se omitido)",
                    },
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "agrupar_material",
            "description": "Criar regra para agrupar referências com matéria-prima comum na mesma máquina.",
            "parameters": {
                "type": "object",
                "properties": {
                    "sku_list": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Lista de SKUs a agrupar",
                    },
                    "machine_id": {"type": "string", "description": "Máquina destino"},
                    "reason": {"type": "string", "description": "Razão do agrupamento"},
                },
                "required": ["sku_list", "machine_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "mover_referencia",
            "description": "Mover uma referência para outra máquina.",
            "parameters": {
                "type": "object",
                "properties": {
                    "sku": {"type": "string", "description": "Código da referência"},
                    "target_machine": {"type": "string", "description": "Máquina destino"},
                    "reason": {"type": "string", "description": "Razão da mudança"},
                },
                "required": ["sku", "target_machine"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "recalcular_plano",
            "description": "Recalcular o plano de produção com a configuração actual.",
            "parameters": {
                "type": "object",
                "properties": {},
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "sugerir_melhorias",
            "description": "Analisar o plano actual e sugerir melhorias.",
            "parameters": {
                "type": "object",
                "properties": {
                    "focus": {
                        "type": "string",
                        "enum": ["otd", "setup", "load_balance", "all"],
                        "description": "Área de foco (default: all)",
                    },
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "explicar_decisao",
            "description": "Explicar porque uma produção está agendada neste sítio (máquina, dia, turno).",
            "parameters": {
                "type": "object",
                "properties": {
                    "sku": {"type": "string", "description": "Referência/SKU a explicar"},
                    "machine_id": {"type": "string", "description": "Máquina (opcional)"},
                    "day_idx": {"type": "integer", "description": "Dia (opcional)"},
                },
                "required": ["sku"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "explicar_logica",
            "description": "Explicar a lógica de scheduling actual: que algoritmo, que regras, que prioridades.",
            "parameters": {
                "type": "object",
                "properties": {
                    "aspecto": {
                        "type": "string",
                        "enum": [
                            "geral",
                            "dispatch",
                            "constraints",
                            "overflow",
                            "twins",
                            "alertas",
                            "replan",
                        ],
                        "description": "Aspecto da lógica a explicar",
                    },
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "ver_decisoes",
            "description": "Ver o registo de decisões do scheduling (audit trail).",
            "parameters": {
                "type": "object",
                "properties": {
                    "tipo": {
                        "type": "string",
                        "description": "Filtrar por tipo (ex: OVERFLOW_ROUTE, ADVANCE_PRODUCTION)",
                    },
                    "machine_id": {"type": "string", "description": "Filtrar por máquina"},
                    "limit": {
                        "type": "integer",
                        "description": "Máximo de resultados (default: 20)",
                    },
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "ver_producao_hoje",
            "description": "Ver a produção planeada para um dia específico, agrupada por máquina.",
            "parameters": {
                "type": "object",
                "properties": {
                    "day_idx": {
                        "type": "integer",
                        "description": "Índice do dia (0 = hoje, 1 = amanhã, etc.). Default: 0",
                    },
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "ver_robustez",
            "description": "Mostra a análise Monte Carlo do plano: probabilidade OTD, jobs vulneráveis, buffers sugeridos.",
            "parameters": {
                "type": "object",
                "properties": {},
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "check_ctp",
            "description": "Verificar Capable-to-Promise: se uma encomenda pode ser entregue a tempo, com cenários alternativos.",
            "parameters": {
                "type": "object",
                "properties": {
                    "sku": {"type": "string", "description": "Referência/SKU a verificar"},
                    "quantity": {"type": "integer", "description": "Quantidade da encomenda"},
                    "target_day": {
                        "type": "integer",
                        "description": "Dia alvo de entrega (índice, 0 = hoje)",
                    },
                },
                "required": ["sku", "quantity", "target_day"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "schedule_whatif",
            "description": "Simular cenário what-if: adicionar/remover procura, máquina em baixo, rush order. Compara baseline vs cenário.",
            "parameters": {
                "type": "object",
                "properties": {
                    "mutations": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "type": {
                                    "type": "string",
                                    "enum": [
                                        "add_demand",
                                        "remove_demand",
                                        "machine_down",
                                        "rush_order",
                                    ],
                                    "description": "Tipo de mutação",
                                },
                                "target_id": {
                                    "type": "string",
                                    "description": "SKU ou máquina afectada",
                                },
                                "params": {
                                    "type": "object",
                                    "description": "Parâmetros (day_idx, qty para demand; nenhum para machine_down)",
                                },
                            },
                            "required": ["type", "target_id"],
                        },
                        "description": "Lista de mutações a aplicar",
                    },
                },
                "required": ["mutations"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "simulate_overtime",
            "description": "Simular impacto de activar o 3º turno (noite) numa ou todas as máquinas.",
            "parameters": {
                "type": "object",
                "properties": {
                    "machine_id": {
                        "type": "string",
                        "description": "Máquina para 3º turno (todas se omitido)",
                    },
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "explicar_decisao_id",
            "description": "Explicar uma decisão específica pelo seu ID, incluindo raciocínio detalhado e contexto.",
            "parameters": {
                "type": "object",
                "properties": {
                    "decision_id": {
                        "type": "string",
                        "description": "ID da decisão (ex: 'OVERFLOW_ROUTE_SKU123_D5')",
                    },
                },
                "required": ["decision_id"],
            },
        },
    },
]
