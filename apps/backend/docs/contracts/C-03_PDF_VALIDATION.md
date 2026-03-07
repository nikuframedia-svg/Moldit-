# C-03 — PDF Validation (Não-Canónico)

- **Contract ID**: C-03
- **Version**: 20260204.1
- **Status**: ACTIVE
- **Created**: 2026-02-04
- **Last Updated**: 2026-02-04
- **Owner**: PP1 Engineering Team
- **Related Contracts**: C-00, C-01
- **Related Decisions**: DEC-0001

## Objetivo

Este contrato define como validar e extrair dados de PDFs de export do MRP (ex.: `PP_PG1.pdf`, `PP_PG2.pdf`) para fins de **validação visual e comparação**, mas **não como input canónico** para o solver.

## Não-objetivo

Este contrato não define:
- PDF como fonte de verdade (PDFs são derivados, não canónicos)
- Import de PDF para solver (solver usa `InputSnapshot` de XLSX/API)
- Parsing completo de PDF (apenas validação e extração limitada)

## Schema

Este contrato não possui JSON Schema próprio. Extracts de PDF são estruturas ad-hoc para validação.

### Estrutura de Extract (v1)

```json
{
  "pdf_id": "uuid",
  "filename": "PP_PG1.pdf",
  "extracted_at": "2026-02-04T16:30:00Z",
  "metadata": {
    "mrp_timestamp": "02/02/2026 04:03",
    "printed_at": "02/02/2026 04:36",
    "app_version": "25.10 (26/01/2026)",
    "area": "[PG1] - Prensas Mecanicas > 200 T"
  },
  "resources": ["PRM019", "PRM032", "PRM043"],
  "tools": ["BFP080", "BFP082", ...],
  "components": ["EMP0601", "EMP0665", ...],
  "horizon": ["02/02/26", "03/02/26", ...],
  "mo_by_day": [2.6, 0.4, 4.1, ...]
}
```

## Invariantes

1. **PDF não é canónico**: PDFs são exports derivados, nunca fonte de verdade.
2. **Validação apenas**: PDFs são usados para validação visual e comparação, não para planeamento.
3. **Semântica de célula não definida**: PDF contém múltiplas camadas (valor principal, valor secundário, cor de fundo) sem contrato fechado.

## Validações

### Validações obrigatórias

1. PDF existe e é válido
2. Metadata extraível (MRP timestamp, área, versão)
3. Recursos/máquinas identificáveis (PRM###, PRH###)
4. Ferramentas identificáveis (BFP###)
5. Horizonte temporal extraível

### Códigos de erro

- `ERR_PDF_INVALID`: Ficheiro não é PDF válido
- `ERR_PDF_UNREADABLE`: PDF não pode ser lido/parseado
- `ERR_PDF_SEMANTICS_UNDEFINED`: Semântica de célula não definida (não pode ser usado como input)

## Casos edge

### E3.1 — Semântica de Célula Não Definida

**Cenário**: PDF contém células com múltiplos valores (principal, secundário) e cores de fundo sem contrato fechado.

**Decisão**: 
- Extrair dados brutos quando possível
- Marcar como "não-canónico"
- Não usar para planeamento
- Usar apenas para validação visual

**Justificação**: Sem contrato fechado de semântica, parsing do PDF não pode ser usado como input canónico.

## Exemplos

Ver `/fixtures/pdf_parsing/` (quando criados).

## Testes obrigatórios

- [ ] Unit: extração de metadata de PDF
- [ ] Unit: identificação de recursos/máquinas
- [ ] Contract: PDF não é usado como input canónico

## Critérios de aceitação

- [ ] PDF identificado como não-canónico
- [ ] Validação limitada documentada
- [ ] Casos edge documentados

## Referências

- Documento Mestre: Secção 5.1, 5.2 (Análise de PDFs)
- Contrato C-01: InputSnapshot (fonte de verdade)
