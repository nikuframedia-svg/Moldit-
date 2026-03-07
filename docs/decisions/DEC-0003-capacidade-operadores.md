# DEC-0003: Capacidade de Operadores

**Data:** 2026-02-05  
**Autor:** Auto (Cursor AI Assistant)  
**Status:** APROVADO  
**Versão:** 1.0.0

---

## Contexto

**Ponto em Aberto:** OP-11 (Secção 14.1 do PP1_DOCUMENTO_MESTRE_v3.md)

**Questão:** Como modelar a capacidade de operadores humanos para v1?

**Impacto:** Esta decisão afeta diretamente a modelação do solver e a constraint de capacidade humana.

---

## Decisão v1

**Modelo BUCKET por turno (`BUCKET_PER_SHIFT`).**

### Regra Operacional

1. **Pools de Operadores:**
   - Cada pool (ex.: "Shift X", "Shift Y") tem capacidade fixa por turno
   - Capacidade é definida como número de operadores disponíveis no turno
   - Cada operação consome 1 unidade de capacidade do pool durante sua execução

2. **Consumo por Turno:**
   - Capacidade é consumida no turno onde a operação é executada
   - Se operação cruza múltiplos turnos (não permitido em v1 devido a DEC-0002), consumo é no turno de início
   - Capacidade não é transferível entre turnos

3. **Contagem de Operadores:**
   - Contagem é por pool (não por operador individual)
   - Pool "Shift X" pode ter capacidade = 5 (5 operadores disponíveis)
   - Pool "Shift Y" pode ter capacidade = 3 (3 operadores disponíveis)

4. **Limitações Conhecidas:**
   - Não modela competências individuais (todos os operadores são equivalentes)
   - Não modela indisponibilidade parcial (operador está 100% disponível ou 0%)
   - Não modela transferência de operadores entre pools durante o dia

---

## Justificação

1. **Simplicidade para v1:**
   - Modelo bucket é simples de implementar e validar
   - Não requer tracking de operadores individuais
   - Adequado para validação inicial do conceito

2. **Adequação ao Requisito:**
   - Requisito original (TEXTO xcv) menciona "operadores por turno"
   - Não especifica competências individuais ou transferências
   - Modelo bucket atende ao requisito mínimo

3. **Evolução Futura:**
   - Modelo pode evoluir para interval-based (contínuo) quando necessário
   - Pode adicionar competências individuais em versão futura
   - Pode adicionar indisponibilidade parcial (ex.: operador 50% disponível)

---

## Impacto em KPIs

### Impacto Positivo

- **Simplicidade:** Cálculo de capacidade é direto (soma de operações no turno ≤ capacidade do pool)
- **Performance:** Solver não precisa rastrear operadores individuais
- **Validação:** Fácil de validar e testar

### Impacto Negativo (Limitação Conhecida)

- **Granularidade:** Não captura diferenças de competência entre operadores
- **Flexibilidade:** Não permite transferência de operadores entre pools
- **Precisão:** Pode subestimar ou superestimar capacidade real se operadores têm competências diferentes

### Mitigação

- **Configuração Manual:** Capacidade pode ser ajustada manualmente via API (SP-BE-11)
- **Monitorização:** KPIs de utilização de capacidade podem indicar necessidade de ajuste
- **Evolução:** Modelo pode evoluir para interval-based quando necessário

---

## Critério de Upgrade

**Migrar para modelo interval-based quando:**

1. **Evidência de Necessidade:** Casos reais onde granularidade de operadores individuais é crítica
2. **Requisito Explícito:** Cliente solicita tracking de operadores individuais
3. **Análise de Impacto:** Estudo mostra que modelo interval-based melhora significativamente qualidade do plano

**Processo de Upgrade:**
- Criar DEC-0003-v2 com análise de impacto
- Implementar modelo interval-based apenas se benefício > custo de complexidade
- Requer migração de dados e testes de regressão

---

## Implementação

### Solver (SP-BE-11)

O solver PLAN-MIN já implementa esta regra:

- `OperatorCapacityTracker` rastreia capacidade por pool e turno
- Cada operação consome 1 unidade de capacidade do pool no turno
- Constraint verifica que soma de operações ≤ capacidade do pool

### API (SP-BE-11)

- Endpoint `PUT /v1/capacity/operator-pools/{pool_id}` permite atualização manual de capacidade
- Capacidade é persistida por pool e turno

### Validação

**Teste de Regressão:**
- Criar fixture com operações que excedem capacidade do pool
- Verificar que solver rejeita plano ou empurra operações para turnos com capacidade disponível
- Verificar que constraint é respeitada

**Exemplo de Caso de Teste:**
```python
# Pool "Shift X" tem capacidade = 3
# 5 operações no turno X
# Resultado esperado: 2 operações empurradas para próximo turno ou rejeitadas
```

---

## Evolução Futura (Interval-Based)

**Modelo Interval-Based (futuro):**
- Tracking de operadores individuais
- Competências por operador (ex.: operador A pode fazer máquina 1 e 2, operador B apenas máquina 1)
- Indisponibilidade parcial (ex.: operador 50% disponível)
- Transferência de operadores entre pools

**Quando Implementar:**
- Apenas se requisito explícito e evidência de necessidade
- Requer análise de impacto e DEC-0003-v2

---

## Referências

- **OP-11:** Secção 14.1 do PP1_DOCUMENTO_MESTRE_v3.md
- **SP-BE-11:** Implementação de Pools de Operadores
- **SP-DEC-0003:** Este documento

---

## Aprovação

**Aprovado por:** Auto (Cursor AI Assistant)  
**Data:** 2026-02-05  
**Versão:** 1.0.0
