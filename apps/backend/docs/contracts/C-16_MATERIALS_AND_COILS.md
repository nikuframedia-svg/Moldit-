# C-16 — Materials and Coils

- **Contract ID**: C-16
- **Version**: 20260205.1
- **Status**: ACTIVE
- **Created**: 2026-02-05
- **Last Updated**: 2026-02-05
- **Owner**: PP1 Engineering Team
- **Related Contracts**: C-00, C-05, C-07
- **Related Decisions**: DEC-0001

## Objetivo

Este contrato define gestão de matéria-prima (MP) por bobines/rolos, preferência por consumo de bobines completas, e constraint de "calço" (recurso partilhado que impede produção simultânea).

## Não-objetivo

Este contrato não define:
- Integração com sistema de stock real
- Inferência de consumption_rate (BOM) sem dados
- Algoritmo completo do solver (isso é C-05)

## Schema

### Material

- `material_code`: Código único do material
- `name`: Nome do material
- `uom`: Unidade de medida (kg, m, etc.)

### MaterialLot/Coil

- `lot_id`: ID único do lote/bobine
- `material_code`: Código do material
- `qty`: Quantidade disponível
- `available_from`: Data/hora a partir da qual está disponível

### MaterialArrival

- `arrival_id`: ID único da chegada
- `material_code`: Código do material
- `eta`: Data/hora estimada de chegada
- `qty`: Quantidade a receber

### ToolMaterialRequirement

- `tool_code`: Código da ferramenta
- `material_code`: Código do material necessário
- `consumption_rate`: Taxa de consumo (qty por unidade de produção)

### Calço

- `calco_id`: ID único do calço
- `name`: Nome do calço
- `capacity`: Capacidade (sempre 1 - não simultâneo)

### ToolCalcoMap

- `tool_code`: Código da ferramenta
- `calco_id`: ID do calço partilhado

## Invariantes

1. **Calço não simultâneo**: Nunca permitir overlap para o mesmo calco_id.
2. **Material disponível**: Se dados de material são incompletos, bloquear automação (modo sugestão) via TrustIndex.

## Validações

### Validações obrigatórias

1. Material existe antes de criar lot/arrival
2. Tool existe antes de criar requirement/mapping
3. Calço existe antes de criar mapping
4. Capacidade de calço = 1

## Constraints no Solver

### Calço

- Para cada operação de produção, identificar calco_id via tool
- Reservar recurso calco_id (capacidade 1) durante a produção
- Impedir sobreposição de operações que usam o mesmo calço

### Materiais (v1)

- Se consumption_rate existir:
  - Calcular consumo total por operação
  - Garantir que stock+arrivals até start_time >= consumo acumulado
- Se não existir consumption_rate:
  - Marcar constraint como "unknown" e penalizar TrustIndex/plan_confidence

## KPIs

- `material_shortage_violations`: Deve ser 0 quando dados completos
- `calco_overlap_violations`: Deve ser 0

## Referências

- Documento Mestre: Secção 6.7 (Função-objectivo), SP-BE-13, requisito xcv
- Contrato C-05: Solver Interface
- Contrato C-07: Calendars and Pools
