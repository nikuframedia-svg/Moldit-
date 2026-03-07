# DEC-0002: Split de Operações entre Turnos

**Data:** 2026-02-05  
**Autor:** Auto (Cursor AI Assistant)  
**Status:** APROVADO  
**Versão:** 1.0.0

---

## Contexto

**Ponto em Aberto:** OP-05 (Secção 14.1 do PP1_DOCUMENTO_MESTRE_v3.md)

**Questão:** Deve o sistema permitir que uma operação seja "splitada" (dividida) entre múltiplos turnos?

**Impacto:** Esta decisão afeta diretamente a modelação do solver e a complexidade do sistema.

---

## Decisão v1

**NÃO permitir split de operações entre turnos.**

### Regra Operacional

Se uma operação não cabe completamente no turno atual (considerando capacidade disponível e janela de tempo), o solver deve:

1. **Empurrar a operação completa para o próximo slot disponível** (próximo turno ou dia)
2. **Nunca dividir a operação em partes parciais**

### Justificação

1. **Simplicidade e Consistência:**
   - Operações completas são mais fáceis de rastrear e auditar
   - Evita estados intermediários complexos (ex.: "50% da operação no turno X, 50% no turno Y")
   - Reduz risco de inconsistências de dados

2. **Modelação Realista:**
   - Na prática industrial, operações de produção raramente são interrompidas e retomadas em turnos diferentes
   - Setup e preparação são feitos uma vez por operação completa
   - Qualidade e rastreabilidade são mais simples com operações completas

3. **Complexidade Técnica:**
   - Split requer tracking de estados parciais
   - Aumenta complexidade do solver (decisões sobre onde dividir)
   - Aumenta complexidade de validação e testes

4. **KPIs e Métricas:**
   - Operações completas facilitam cálculo de KPIs (tardiness, churn, setup_count)
   - Evita ambiguidade em métricas de tempo de execução

---

## Impacto em KPIs

### Impacto Positivo

- **Simplicidade de Cálculo:** KPIs mais diretos (tardiness = atraso da operação completa)
- **Consistência:** Sem necessidade de agregar partes parciais
- **Auditabilidade:** Rastreamento mais simples

### Impacto Negativo (Limitação Conhecida)

- **Tardiness Potencialmente Maior:** Se uma operação não cabe no turno, pode ser empurrada para o próximo dia, aumentando tardiness
- **Utilização de Capacidade:** Pode haver "waste" de capacidade no final de turnos (se operação não cabe, slot fica vazio)

### Mitigação

- **Otimização de Sequenciamento:** Solver deve priorizar operações menores no final de turnos
- **Overtime (Futuro):** Se necessário, permitir overtime para completar operações críticas (não é split, é extensão do turno)

---

## Critério para Reabrir Decisão

Esta decisão pode ser reaberta se:

1. **Evidência de Necessidade:** Casos reais onde split é crítico para viabilidade do plano
2. **Mudança de Requisitos:** Cliente solicita explicitamente suporte a split
3. **Análise de Impacto:** Estudo mostra que split reduz significativamente tardiness sem aumentar complexidade

**Processo de Reabertura:**
- Criar DEC-0002-v2 com análise de impacto
- Implementar split apenas se benefício > custo de complexidade
- Requer validação com casos reais e testes de regressão

---

## Implementação

### Solver (SP-BE-09)

O solver PLAN-MIN já implementa esta regra:

- Operações são atribuídas a máquinas e turnos completas
- Se não cabe no turno, `assign_to_shift()` retorna `None` e operação é empurrada para próximo slot
- Não há lógica de split no código

### Validação

**Teste de Regressão:**
- Criar fixture com operação que não cabe em turno único
- Verificar que operação é empurrada para próximo turno/dia
- Verificar que operação nunca é dividida

**Exemplo de Caso de Teste:**
```python
# Operação com duração = 10h
# Turno X tem capacidade = 8h
# Resultado esperado: operação vai para próximo turno/dia (não split)
```

---

## Referências

- **OP-05:** Secção 14.1 do PP1_DOCUMENTO_MESTRE_v3.md
- **SP-BE-09:** Implementação do solver PLAN-MIN
- **SP-DEC-0002:** Este documento

---

## Aprovação

**Aprovado por:** Auto (Cursor AI Assistant)  
**Data:** 2026-02-05  
**Versão:** 1.0.0
