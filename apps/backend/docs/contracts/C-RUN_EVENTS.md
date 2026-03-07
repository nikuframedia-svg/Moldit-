# C-RUN — Run Events

- **Contract ID**: C-RUN
- **Version**: 20260205.1
- **Status**: ACTIVE
- **Created**: 2026-02-05
- **Last Updated**: 2026-02-05
- **Owner**: PP1 Engineering Team
- **Related Contracts**: C-00, C-05, C-07, C-08
- **Related Decisions**: DEC-0001

## Objetivo

Este contrato define eventos de execução (RUN): avarias, absentismo, erros de produção, que disparam replaneamento incremental e aprendizagem.

## Não-objetivo

Este contrato não define:
- Integração com MES real (isso é fase posterior)
- Algoritmo de replan incremental (v0 usa re-solve completo)

## Schema

### Tipos de Eventos

1. **MachineDown**: Máquina avariada
   - `resource_code`: Código da máquina
   - `start_time`: Início do downtime
   - `end_time`: Fim do downtime (ou null se desconhecido)
   - `reason`: Motivo (opcional)

2. **MachineUp**: Máquina recuperada
   - `resource_code`: Código da máquina
   - `recovered_at`: Momento da recuperação

3. **OperatorAbsent**: Operador ausente
   - `pool_code`: Pool afetado (X ou Y)
   - `date`: Data
   - `shift_code`: Turno (X ou Y)
   - `operators_count`: Número de operadores ausentes

4. **OperatorBack**: Operador regressou
   - `pool_code`: Pool afetado
   - `date`: Data
   - `shift_code`: Turno
   - `operators_count`: Número de operadores que regressaram

5. **QualityHold**: Paragem por qualidade
   - `resource_code`: Máquina afetada
   - `start_time`: Início
   - `end_time`: Fim (ou null)
   - `reason`: Motivo

6. **ScrapEvent**: Evento de scrap/retrabalho
   - `workorder_id`: WorkOrder afetado
   - `scrap_qty`: Quantidade de scrap
   - `occurred_at`: Momento do evento

### Event Schema

```json
{
  "event_id": "string (UUID)",
  "event_type": "MachineDown | MachineUp | OperatorAbsent | OperatorBack | QualityHold | ScrapEvent",
  "occurred_at": "ISO 8601 datetime",
  "resource_code": "string (optional)",
  "pool_code": "string (optional)",
  "workorder_id": "string (optional)",
  "start_time": "ISO 8601 datetime (optional)",
  "end_time": "ISO 8601 datetime (optional)",
  "date": "YYYY-MM-DD (optional)",
  "shift_code": "X | Y (optional)",
  "operators_count": "integer (optional)",
  "scrap_qty": "number (optional)",
  "reason": "string (optional)",
  "metadata": "object (optional)"
}
```

## Invariantes

1. **Append-only**: Eventos são imutáveis após criação.
2. **Idempotência**: O mesmo `event_id` não pode produzir duplicados.
3. **LLM não executa replan**: LLM apenas pode explicar ou propor PR.

## Validações

### Validações obrigatórias

1. `event_id` é único (idempotência)
2. `event_type` é válido
3. Campos obrigatórios por tipo estão presentes
4. Datas/tempos são válidos

## Aplicação de Eventos

### MachineDown
- Insere downtime interval no calendário do recurso
- Bloqueia capacidade da máquina no intervalo

### OperatorAbsent
- Reduz capacidade do pool no turno/dia
- Aplica-se ao calendário de capacidade

### MachineUp / OperatorBack
- Remove/revoga o evento correspondente (MachineDown/OperatorAbsent)

## Trigger de Replan

Quando um evento é criado:
1. Cria scenario automático "EVENT-<event_id>"
2. Corre solver em modo incremental (v0: re-solve completo)
3. Produz diff e sugestão/PR draft

## Referências

- Documento Mestre: Secção 6.9 (Sandbox), SP-BE-12
- Contrato C-05: Solver Interface
- Contrato C-07: Calendars and Pools
- Contrato C-08: Sandbox Scenarios
