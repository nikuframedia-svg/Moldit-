# FRONTEND DESIGN SYSTEM — PRODPLAN PP1

> Este documento é a ÚNICA fonte de verdade para todo o frontend.
> Claude Code DEVE seguir cada regra aqui descrita sem exceção.
> Qualquer desvio é um bug.
> Última atualização: 2026-02-12

---

## 0. FILOSOFIA

```
MINIMALISMO FUNCIONAL — Cada pixel tem um propósito.
Zero decoração. Zero animação. Zero ruído visual.
Interativo por natureza. Dinâmico por design.
A informação é a interface.
```

### Princípios Invioláveis

1. **Nada se mexe sem razão** — Zero animações CSS, zero Framer Motion, zero keyframes, zero transitions decorativas. A única transition permitida é `opacity 0.15s` em hover states e `background 0.15s` em botões. NADA MAIS.
2. **Densidade informacional alta** — Mostrar o máximo de dados úteis no mínimo de espaço. Sem padding excessivo, sem espaços vazios decorativos.
3. **Hierarquia por contraste** — Não usar tamanho exagerado para criar hierarquia. Usar peso da fonte (400 vs 600) e opacidade do texto (100% vs 50%).
4. **Interatividade óbvia** — Todo elemento clicável tem feedback visual instantâneo (hover state). O utilizador nunca adivinha o que é interativo.
5. **Dark-only** — Nunca, em nenhuma circunstância, usar cores de light mode.
6. **Sem emojis em UI** — Nunca usar emojis como ícones. Usar apenas SVG inline simples (stroke, nunca fill) OU ícones circulares preenchidos (ver secção 7).
7. **Cards são autónomos** — Cada card tem o seu header com título, controlo (dropdown/toggle) e menu de overflow. O card funciona como uma mini-aplicação independente.

---

## 1. CORES

### 1.1 Backgrounds — Hierarquia de 4 Níveis

USAR SEMPRE estas variáveis. Nunca inventar tons.

```css
--bg-void:      #060810;    /* Nível 0 — fundo da página, o mais escuro possível */
--bg-base:      #0c1017;    /* Nível 1 — superfície base (topbar) */
--bg-card:      #12171f;    /* Nível 2 — cards, painéis, secções */
--bg-raised:    #1a2029;    /* Nível 3 — inputs, dropdowns, table headers, pill-bg activa */
```

Regra: cada nível de profundidade sobe exatamente 1 nível de background.
Página → bg-void. TopBar → bg-base. Card dentro da página → bg-card. Input/dropdown dentro do card → bg-raised.

### 1.2 Borders

```css
--border-subtle:   rgba(255, 255, 255, 0.06);   /* Separadores entre cards, dividers internos */
--border-default:  rgba(255, 255, 255, 0.09);   /* Borders de inputs, cards com destaque */
--border-hover:    rgba(255, 255, 255, 0.14);   /* Hover em cards/inputs */
--border-active:   rgba(20, 184, 166, 0.40);    /* Focus/active state */
```

Regra: NUNCA usar borders sólidas (ex: #333). SEMPRE rgba com alpha baixo.

### 1.3 Texto — 4 Níveis de Contraste

```css
--text-primary:    #e8ecf2;   /* Valores, headings, conteúdo principal — weight 600 */
--text-secondary:  #8899aa;   /* Labels, descrições, subtítulos — weight 400 */
--text-muted:      #556677;   /* Timestamps, info terciária, placeholders, footer de card — weight 400 */
--text-ghost:      #334455;   /* Disabled text, separadores textuais, skeleton blocks — weight 400 */
```

Regra: O branco puro (#ffffff) é PROIBIDO em texto corrido. O máximo é --text-primary (#e8ecf2).
EXCEÇÃO ÚNICA: o texto dentro de botão primary PODE usar #ffffff.

### 1.4 Accent — Teal (Cor Única de Acento)

```css
--accent:          #14b8a6;   /* Links, estados ativos, badges primários, greeting destaque, barras de gráfico */
--accent-hover:    #0d9488;   /* Hover em elementos accent */
--accent-bg:       rgba(20, 184, 166, 0.10);  /* Fundo de badges, tags, selected states */
--accent-border:   rgba(20, 184, 166, 0.25);  /* Border de items selecionados */
--accent-light:    #2dd4bf;   /* Versão mais clara para gradientes em barras de gráfico */
```

Regra: Teal é a ÚNICA cor de acento na interface. Não existem outros azuis, roxos ou laranjas decorativos.
EXCEÇÃO ÚNICA: O botão CTA principal usa --cta-gradient (ver 1.7).

### 1.5 Cores Semânticas (APENAS para estados de dados)

Estas cores existem APENAS para representar estados/severidades e trends. NUNCA usar para decoração.

```css
/* Positivo / Sucesso / Melhoria / Trend Up */
--semantic-green:     #10b981;
--semantic-green-bg:  rgba(16, 185, 129, 0.12);

/* Negativo / Erro / Degradação / Trend Down */
--semantic-red:       #ef4444;
--semantic-red-bg:    rgba(239, 68, 68, 0.12);

/* Aviso / Pendente / Atenção */
--semantic-amber:     #f59e0b;
--semantic-amber-bg:  rgba(245, 158, 11, 0.12);

/* Informação / Neutro */
--semantic-blue:      #3b82f6;
--semantic-blue-bg:   rgba(59, 130, 246, 0.12);
```

Regra para badges e trends: SEMPRE usar a versão `-bg` como background com a cor base como text color.
NUNCA usar backgrounds sólidos em badges. SEMPRE rgba com alpha 0.12.

Trends usam diretamente a cor semântica sem fundo:
```
+59% vs last month  →  color: var(--semantic-green)
-16% vs last month  →  color: var(--semantic-red)
```

### 1.6 Superfícies Interativas

```css
--hover-overlay:   rgba(255, 255, 255, 0.03);   /* Hover sobre rows, cards, list items */
--active-overlay:  rgba(255, 255, 255, 0.06);   /* Active/pressed state */
--selected-bg:     rgba(20, 184, 166, 0.08);    /* Item selecionado em lista/tab */
```

### 1.7 Cores Especiais (LIMITADAS a componentes específicos)

```css
/* CTA Button — APENAS no botão principal de call-to-action */
--cta-bg:          #e74c3c;                      /* Vermelho/coral vivo */
--cta-hover:       #c0392b;                      /* Hover do CTA */
--cta-radius:      9999px;                       /* EXCEÇÃO: pill shape apenas para CTA */

/* Icon circles — fundos dos ícones circulares em KPI cards */
--icon-circle-accent:  rgba(20, 184, 166, 0.15);  /* Teal: shipments, delivered */
--icon-circle-blue:    rgba(59, 130, 246, 0.15);   /* Blue: distance, analytics */
--icon-circle-green:   rgba(16, 185, 129, 0.15);   /* Green: OEE, success */
--icon-circle-amber:   rgba(245, 158, 11, 0.15);   /* Amber: warnings */

/* Notification badge */
--notif-bg:        #ef4444;                       /* Vermelho sólido para contadores de notificação */
```

---

## 2. TIPOGRAFIA

### 2.1 Font Stack

```css
--font-body:  'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
--font-mono:  'JetBrains Mono', 'Fira Code', 'Consolas', monospace;
```

Regra: NÃO usar 'Outfit' para headings. NÃO usar 'Inter'. NÃO usar 'Roboto'.
Headings e body usam ambos --font-body. A diferença é APENAS o weight.

### 2.2 Escala Tipográfica — APENAS 6 Tamanhos

```css
--text-xs:   11px;    /* Timestamps, metadata terciária, badges, trend text, card footer */
--text-sm:   12px;    /* Labels, table headers, nav items, dropdown items, secondary info */
--text-base: 13px;    /* Body text, valores em tabelas, descrições, subtítulos */
--text-md:   15px;    /* Títulos de cards, section headers, card header titles */
--text-lg:   20px;    /* KPI values (números grandes nos cards) */
--text-xl:   24px;    /* Page greeting APENAS ("Hi Name, Good Morning!") — máximo 1 por página */
```

Regra: NUNCA usar mais de 6 tamanhos. NUNCA usar rem. SEMPRE px.
NUNCA ter text maior que 24px. O 24px é APENAS para greeting. KPIs usam 20px.
Sem hero text. Sem display fonts. Sem 32px headings.

### 2.3 Font Weights — APENAS 3

```
400  — Texto normal (body, descrições, metadata, trend text, timestamps)
500  — Labels, tab items ativos, nomes em listas, card header titles, nav items
600  — KPI values, greeting name, section emphasis
```

Regra: NUNCA usar 700, 800, 900. Sem bold. Sem extra-bold. O 600 semibold é o máximo.

### 2.4 Regras Tipográficas Específicas

```css
/* Greeting — "Hi Martim, Good Morning!" */
.greeting__name    { font-size: 24px; font-weight: 600; color: var(--text-primary); }
.greeting__message { font-size: 24px; font-weight: 400; color: var(--accent); }
/* O nome é branco, a mensagem é teal. Inline na mesma linha. */

/* KPI value — "1200", "3047", "46%" */
font-size: 20px;
font-weight: 600;
color: var(--text-primary);
font-variant-numeric: tabular-nums;
/* Sufixo de unidade: font-size: 13px; font-weight: 400; color: var(--text-muted); margin-left: 2px; */
/* Exemplo: "530" em 20px + "km" em 13px muted */

/* Trend text — "+59% vs last month" */
font-size: 11px;
font-weight: 400;
/* Cor: --semantic-green se positivo, --semantic-red se negativo */

/* IDs, hashes, tracking codes, order IDs — "#281731-22-922ppk", "#1032-392pk" */
font-family: var(--font-mono);
font-size: 11px;
color: var(--text-secondary);
letter-spacing: 0.02em;

/* Card title — "Income Tracker", "Total Shipments" */
font-size: 15px;
font-weight: 500;
color: var(--text-primary);

/* Card subtitle / label acima do valor — "Total Shipments", "Avg. Distance" */
font-size: 13px;
font-weight: 400;
color: var(--text-secondary);

/* Table headers — "Order ID", "Category", "Status" */
font-size: 12px;
font-weight: 500;
color: var(--text-muted);
text-transform: uppercase;
letter-spacing: 0.06em;

/* Section footer text — "Displays data for this month..." */
font-size: 11px;
font-weight: 400;
color: var(--text-muted);
```

---

## 3. SPACING

### 3.1 Escala — APENAS 6 Valores

```css
--space-2:   2px;    /* Micro gaps (entre unidade e valor KPI, dot e label) */
--space-4:   4px;    /* Gap mínimo (entre badges, entre mini-elements, icon e text inline) */
--space-8:   8px;    /* Gap padrão (entre items de lista, padding interno de badges) */
--space-12:  12px;   /* Padding de inputs, gap entre grupos de conteúdo, entre card sections */
--space-16:  16px;   /* Padding de cards, gap entre cards no grid */
--space-24:  24px;   /* Gap entre secções maiores, margin vertical entre blocos de página */
```

Regra: NUNCA usar valores fora desta escala. NUNCA 10px, 14px, 18px, 20px, 32px, 48px.
O espaço máximo entre quaisquer elementos é 24px. Sem margens generosas.

### 3.2 Aplicação

```
Padding interno de card:                 16px
Gap entre cards no grid:                 16px
Gap entre secções verticais na página:   24px
Padding interno de input:                8px 12px
Padding de badge/tag:                    2px 8px
Padding de botão primary:                8px 16px
Padding de botão secondary/ghost:        6px 12px
Padding de table cell:                   8px 12px
Padding da topbar (vertical):            0 (centrar com height)
Padding da topbar (horizontal):          16px
Gap entre icon e texto no card header:   8px
Gap entre KPI value e trend:             4px
Gap entre nav items na topbar:           0 (usar padding individual 8px 12px)
Espaço entre card header e conteúdo:     12px
Espaço entre greeting e grid:            24px
```

---

## 4. FORMAS

### 4.1 Border Radius — APENAS 4 Valores

```css
--radius-xs:  3px;    /* Mini elements: dots inline em paginação, progress bar fill */
--radius-sm:  4px;    /* Badges, tags, mini-elements, inputs */
--radius-md:  6px;    /* Botões secondary/ghost, dropdowns */
--radius-lg:  8px;    /* Cards, modais, painéis */
```

Regra: NUNCA border-radius > 8px. NUNCA 12px, 16px, 20px, 24px.
EXCEÇÕES ÚNICAS:
- Status dots: border-radius: 50% (são circles)
- Icon circles em KPI cards: border-radius: 50% (são circles)
- CTA button: border-radius: 9999px (pill shape)
- Avatar circle: border-radius: 50%
- Notification count badge: border-radius: 50%

### 4.2 Shadows — APENAS 2

```css
--shadow-card:    0 1px 3px rgba(0, 0, 0, 0.2);
--shadow-overlay: 0 8px 24px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255, 255, 255, 0.06);
```

Regra: NUNCA usar glow effects. NUNCA box-shadow com cores. NUNCA neon.
NUNCA glassmorphism. Sem backdrop-filter. Sem blur.

---

## 5. COMPONENTES BASE

### 5.1 Card — Componente Mais Usado

O card é o átomo fundamental. TODOS os blocos de conteúdo vivem dentro de cards.

```
┌──────────────────────────────────────────────────────┐
│ ● Title                        [Dropdown ▾] [···]    │  ← Card Header
│──────────────────────────────────────────────────────│  ← Separador implícito (espaço, sem border)
│                                                      │
│  [ Conteúdo do Card ]                                │  ← Card Body
│                                                      │
│──────────────────────────────────────────────────────│
│  Footer text muted                                   │  ← Card Footer (opcional)
└──────────────────────────────────────────────────────┘
```

```css
.card {
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);        /* 8px */
  padding: 16px;
  box-shadow: var(--shadow-card);
  display: flex;
  flex-direction: column;
}

/* Hover: APENAS se o card inteiro for clicável */
.card--clickable:hover {
  border-color: var(--border-hover);
  background: #141a22;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}
```

Regra: Cards NÃO se movem no hover. Sem translateY. Sem scale. Sem elevação.
O ÚNICO feedback é mudança de border-color e background sutil.

### 5.2 Card Header — Anatomia Obrigatória

Cada card TEM de ter um header com esta estrutura:

```
[Icon Circle]  Title Text              [Control] [Overflow ···]
```

```css
.card__header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}

/* Icon circle — círculo colorido com ícone SVG dentro */
.card__icon {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  /* Background definido pela variante: --icon-circle-accent, -blue, -green, -amber */
}
.card__icon svg {
  width: 16px;
  height: 16px;
  /* Cor do SVG: a cor semântica correspondente ao circle background */
}

/* Title */
.card__title {
  font-size: 15px;
  font-weight: 500;
  color: var(--text-primary);
  flex: 1;
}

/* Control — dropdown de período ou filtro */
.card__control {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  background: var(--bg-raised);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  font-size: 11px;
  color: var(--text-secondary);
  cursor: pointer;
  transition: border-color 0.15s;
}
.card__control:hover {
  border-color: var(--border-hover);
}
.card__control svg { /* Chevron down */
  width: 12px;
  height: 12px;
  color: var(--text-muted);
}

/* Overflow menu — 3 dots horizontal */
.card__menu {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-sm);
  cursor: pointer;
  color: var(--text-muted);
  transition: background 0.15s;
}
.card__menu:hover {
  background: var(--hover-overlay);
  color: var(--text-secondary);
}
```

Exemplo de variantes de card header (nomes ilustrativos — usar nomes reais do domínio):

```
Machine Load:      ● (green dot 8px) + "Machine Load"       + [Weekly ▾] + [···]
Total Shipments:   ○ (teal circle 32px com icon) + "Total Shipments"  + [···]
OEE by Machine:    (sem icon) + "OEE by Machine"    + [Production ▾] + [···]
Audit Trail:       (sem icon) + "Audit Trail"        + "1-10 of 23" + [≡ Customize]
```

### 5.3 Card Footer

```css
.card__footer {
  margin-top: 12px;
  padding-top: 8px;
  font-size: 11px;
  color: var(--text-muted);
  /* Sem border-top. Separação é apenas pelo espaço. */
}
```

Conteúdo típico do footer: texto contextual ("Displays data for this month and you can display anything you want."), legenda de gráfico (dots coloridos + labels), paginação (dots de navegação entre views).

### 5.4 KPI Card — Padrão com Ícone

O KPI card usa o padrão de card mas com layout específico:

```
┌──────────────────────────────────┐
│  ○                        [···]  │  ← Icon circle 32px (teal/blue/green) + overflow
│  Total Shipments                 │  ← Label 13px --text-secondary
│  1200                            │  ← Value 20px weight 600 --text-primary
│  +59% vs last month              │  ← Trend 11px --semantic-green ou --semantic-red
└──────────────────────────────────┘
```

```css
.kpi-card {
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  padding: 16px;
}

.kpi-card__header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 12px;
}

.kpi-card__icon {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  /* Background por variante */
}

.kpi-card__label {
  font-size: 13px;
  font-weight: 400;
  color: var(--text-secondary);
  margin-bottom: 4px;
}

.kpi-card__value {
  font-size: 20px;
  font-weight: 600;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
  display: flex;
  align-items: baseline;
  gap: 2px;
}

/* Sufixo de unidade (km, %, etc.) */
.kpi-card__unit {
  font-size: 13px;
  font-weight: 400;
  color: var(--text-muted);
}

.kpi-card__trend {
  font-size: 11px;
  font-weight: 400;
  margin-top: 4px;
}
.kpi-card__trend--up   { color: var(--semantic-green); }
.kpi-card__trend--down { color: var(--semantic-red); }
```

### 5.5 Rich Card — Card com Gráfico Embebido (ex: Production Trend)

Card maior que combina header + stat destaque + gráfico + footer:

```
┌───────────────────────────────────────┐
│ ● Production Trend    [Weekly ▾] [···]│  ← Header com dot verde, dropdown, menu
│                                       │
│ ↗ 85% better than last week          │  ← Trend text 11px --semantic-green
│ 34%  rating                           │  ← Value grande 20px + sufixo 13px muted
│                                       │
│  ▍▍▍▎▍▍▍                             │  ← Bar chart (Recharts) — teal bars
│  Mo Tu We Th Fr Sa Su                 │  ← X-axis labels 11px muted
│                                       │
│  ● ● ● ● ● ● ●                       │  ← Dot pagination (qual dataset/view)
│  [1]                                  │  ← Page indicator
│                                       │
│ Displays data for this month...       │  ← Footer text 11px muted
└───────────────────────────────────────┘
```

```css
.rich-card__trend-text {
  font-size: 11px;
  color: var(--semantic-green);
  margin-bottom: 4px;
  display: flex;
  align-items: center;
  gap: 4px;
}
.rich-card__trend-text svg { /* Arrow icon ↗ */
  width: 12px;
  height: 12px;
}

.rich-card__value {
  font-size: 20px;
  font-weight: 600;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
}
.rich-card__value-suffix {
  font-size: 13px;
  font-weight: 400;
  color: var(--text-muted);
  margin-left: 4px;
}

.rich-card__chart {
  margin-top: 12px;
  height: 120px;  /* Altura fixa para gráfico inline */
}

/* Dot pagination — scroll entre views */
.dot-pagination {
  display: flex;
  gap: 4px;
  justify-content: center;
  margin-top: 8px;
}
.dot-pagination__dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--text-ghost);
  cursor: pointer;
  transition: background 0.15s;
}
.dot-pagination__dot--active {
  background: var(--accent);
}
```

### 5.6 Stacked Bar Chart Card (ex: Load Distribution)

```
┌───────────────────────────────────────┐
│ ⚙ Load Distribution   [Monthly▾] [···]│
│                                       │
│  300 ▊▊▊▊▊▊▊▊                        │  ← Stacked horizontal bars
│  200 ▊▊▊▊▊▊▊▊                        │     com 3 faixas de cor
│  100 ▊▊▊▊▊▊▊▊                        │
│                                       │
│ Based on this week's stats.           │
│ ■ 0-100  ■ 101-200  ■ 201-300        │  ← Legenda com dots + labels
└───────────────────────────────────────┘
```

Legenda pattern:
```css
.chart-legend {
  display: flex;
  gap: 12px;
  align-items: center;
}
.chart-legend__item {
  display: flex;
  align-items: center;
  gap: 4px;
}
.chart-legend__dot {
  width: 8px;
  height: 8px;
  border-radius: 2px;  /* Quadrado com cantos arredondados, NÃO circle */
  flex-shrink: 0;
}
.chart-legend__label {
  font-size: 11px;
  color: var(--text-muted);
}
```

Cores das faixas no stacked bar (3 tons de teal escalonados):
```css
Range 0-100:    var(--bg-raised) ou rgba(20, 184, 166, 0.15)  /* Mais escuro */
Range 101-200:  rgba(20, 184, 166, 0.35)                       /* Médio */
Range 201-300:  rgba(20, 184, 166, 0.60)                       /* Mais claro */
```

### 5.7 Horizontal Bar Chart (ex: Demand by Customer)

```
┌──────────────────────────────────────────────────────┐
│ Demand by Customer  14 customers... [Production▾][···]│
│                                                      │
│ 4743  ████████████████████░░░░░░░░░░  ● Many Source  ↗ 4.53% │
│ 9759  █████████████████████████████░  ● All Socials  ↗ 8.15% │
│  604  ████░░░░░░░░░░░░░░░░░░░░░░░░░  ● Socials Net  ↗ 2.30% │
└──────────────────────────────────────────────────────┘
```

```css
.h-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 0;
}

.h-bar__value {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
  min-width: 48px;
  text-align: right;
}

.h-bar__track {
  flex: 1;
  height: 24px;
  background: var(--bg-raised);
  border-radius: var(--radius-sm);
  overflow: hidden;
}

.h-bar__fill {
  height: 100%;
  border-radius: var(--radius-sm);
  /* Gradiente horizontal teal: */
  background: linear-gradient(90deg, var(--accent) 0%, var(--accent-light) 100%);
  /* width: calculada em % */
}

.h-bar__label {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--text-secondary);
  min-width: 120px;
}

.h-bar__label-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--accent);
}

.h-bar__trend {
  font-size: 11px;
  font-weight: 400;
  display: flex;
  align-items: center;
  gap: 2px;
  min-width: 60px;
  text-align: right;
}
```

EXCEÇÃO: o gradiente linear nas barras horizontais é a ÚNICA forma de gradiente permitida, e APENAS dentro de `.h-bar__fill`.

### 5.8 Botões

```css
/* Primary — MÁXIMO 1 por secção visível. Fundo teal. */
.btn-primary {
  background: var(--accent);
  color: #ffffff;
  border: none;
  border-radius: var(--radius-md);
  padding: 8px 16px;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s;
}
.btn-primary:hover { background: var(--accent-hover); }

/* Secondary — maioria dos botões. Border only. */
.btn-secondary {
  background: transparent;
  color: var(--text-secondary);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  padding: 6px 12px;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}
.btn-secondary:hover {
  background: var(--hover-overlay);
  border-color: var(--border-hover);
  color: var(--text-primary);
}

/* Ghost — ações terciárias, icon buttons */
.btn-ghost {
  background: transparent;
  color: var(--text-muted);
  border: none;
  padding: 6px 8px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background 0.15s;
}
.btn-ghost:hover {
  background: var(--hover-overlay);
  color: var(--text-secondary);
}

/* CTA — EXCEÇÃO. APENAS 1 por página. Vermelho/coral, pill shape. */
.btn-cta {
  background: var(--cta-bg);
  color: #ffffff;
  border: none;
  border-radius: 9999px;
  padding: 12px 24px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  width: 100%;
  text-align: center;
  transition: background 0.15s;
}
.btn-cta:hover { background: var(--cta-hover); }

/* Action button — ex: "+ Create New Request" */
.btn-action {
  display: flex;
  align-items: center;
  gap: 4px;
  background: transparent;
  color: var(--text-secondary);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  padding: 6px 12px;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: border-color 0.15s, color 0.15s;
}
.btn-action:hover {
  border-color: var(--border-hover);
  color: var(--text-primary);
}
.btn-action svg { width: 14px; height: 14px; }
```

### 5.9 Input / Select

```css
.input {
  background: var(--bg-raised);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  padding: 8px 12px;
  font-size: 13px;
  color: var(--text-primary);
  font-family: var(--font-body);
  outline: none;
  width: 100%;
  transition: border-color 0.15s;
}
.input::placeholder { color: var(--text-ghost); }
.input:focus { border-color: var(--accent); }
```

Regra: Focus NÃO tem box-shadow ring. APENAS border-color muda.

### 5.10 Badge / Tag

```css
.badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: var(--radius-sm);
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  line-height: 1.4;
}
.badge--success  { background: var(--semantic-green-bg); color: var(--semantic-green); }
.badge--error    { background: var(--semantic-red-bg);   color: var(--semantic-red); }
.badge--warning  { background: var(--semantic-amber-bg); color: var(--semantic-amber); }
.badge--info     { background: var(--semantic-blue-bg);  color: var(--semantic-blue); }
.badge--neutral  { background: rgba(255, 255, 255, 0.06); color: var(--text-secondary); }
.badge--accent   { background: var(--accent-bg);         color: var(--accent); }
```

Badge para status de tracking/order (ex: "In Transit", "Delivered"):
```css
.status-text--transit   { color: var(--semantic-blue); font-size: 11px; font-weight: 500; }
.status-text--delivered { color: var(--semantic-green); font-size: 11px; font-weight: 500; }
.status-text--pending   { color: var(--semantic-amber); font-size: 11px; font-weight: 500; }
.status-text--cancelled { color: var(--semantic-red); font-size: 11px; font-weight: 500; }
```

### 5.11 Tabela — Recent Activities Pattern

```
┌──────────────────────────────────────────────────────────────┐
│ Recent Activities                        1-10 of 23  [≡ Customize]│
│ Track your activity here                                     │
├──────────┬──────────────┬──────────────┬─────────┬──────────┤
│ Order ID │ Category     │ Arrival Time │ Status  │          │
├──────────┼──────────────┼──────────────┼─────────┼──────────┤
│ #1032-.. │ Electronic   │ 7 Jul, 2024  │Delivered│   ⋮      │
│ #1033-.. │ Mechanical   │ 8 Jul, 2024  │In Transit│  ⋮      │
└──────────┴──────────────┴──────────────┴─────────┴──────────┘
```

```css
.table {
  width: 100%;
  border-collapse: collapse;
}

.table__header-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
}
.table__header-title {
  font-size: 15px;
  font-weight: 500;
  color: var(--text-primary);
}
.table__header-subtitle {
  font-size: 11px;
  color: var(--text-muted);
}
.table__header-meta {
  display: flex;
  align-items: center;
  gap: 12px;
}
.table__count {
  font-size: 11px;
  color: var(--text-muted);
}
.table__customize {
  /* Botão ghost com icon ≡ */
}

.table th {
  text-align: left;
  padding: 8px 12px;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  border-bottom: 1px solid var(--border-default);
  background: transparent;
}

.table td {
  padding: 8px 12px;
  font-size: 13px;
  color: var(--text-primary);
  border-bottom: 1px solid var(--border-subtle);
  font-variant-numeric: tabular-nums;
}

.table tr:hover td {
  background: var(--hover-overlay);
}

/* Coluna de ID (mono) */
.table td.mono {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-secondary);
}

/* Coluna de status (texto colorido, sem badge background) */
.table td.status {
  font-size: 11px;
  font-weight: 500;
}

/* Coluna de overflow (3 dots verticais) */
.table td.overflow {
  width: 32px;
  text-align: center;
  color: var(--text-muted);
  cursor: pointer;
}
```

### 5.12 Tab Navigation (TopBar Pills)

Conforme o screenshot, os nav items no topbar são pills com fundo arredondado:

```css
.nav-pills {
  display: flex;
  align-items: center;
  gap: 0;
  background: var(--bg-raised);
  border-radius: var(--radius-md);
  padding: 2px;
  border: 1px solid var(--border-subtle);
}

.nav-pill {
  padding: 6px 16px;
  font-size: 12px;
  font-weight: 400;
  color: var(--text-muted);
  border-radius: var(--radius-sm);
  cursor: pointer;
  background: transparent;
  border: none;
  transition: color 0.15s, background 0.15s;
}

.nav-pill:hover {
  color: var(--text-secondary);
}

.nav-pill--active {
  color: var(--text-primary);
  font-weight: 500;
  background: var(--bg-card);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
}
```

Regra: O grupo de pills tem um fundo raised. O item ativo tem fundo card (1 nível abaixo — parece elevado).
Sem underlines. Sem border-bottom indicators. É APENAS pill background.

### 5.13 Modal

```css
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.60);
  z-index: 900;
  display: flex;
  align-items: center;
  justify-content: center;
}

.modal {
  background: var(--bg-card);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-overlay);
  width: 100%;
  max-width: 520px;
  max-height: 80vh;
  overflow-y: auto;
}

.modal__header {
  padding: 16px;
  border-bottom: 1px solid var(--border-subtle);
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.modal__body { padding: 16px; }

.modal__footer {
  padding: 12px 16px;
  border-top: 1px solid var(--border-subtle);
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
```

Regra: Modal aparece instantaneamente. Sem fade-in. Sem slide. Sem scale.

### 5.14 Dropdown

```css
.dropdown {
  position: absolute;
  top: calc(100% + 4px);
  background: var(--bg-card);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-overlay);
  min-width: 180px;
  padding: 4px;
  z-index: 100;
}

.dropdown__item {
  padding: 8px 12px;
  font-size: 13px;
  color: var(--text-secondary);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background 0.15s;
}
.dropdown__item:hover {
  background: var(--hover-overlay);
  color: var(--text-primary);
}
```

### 5.15 Status Dot

```css
.dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
.dot--lg { width: 8px; height: 8px; }  /* Dots em listas de timeline, tracking */
.dot--green  { background: var(--semantic-green); }
.dot--red    { background: var(--semantic-red); }
.dot--amber  { background: var(--semantic-amber); }
.dot--blue   { background: var(--semantic-blue); }
.dot--muted  { background: var(--text-ghost); }
```

Regra: Dots NÃO têm glow. NÃO têm box-shadow. NÃO pulsam. São flat.

### 5.16 Progress Bar

```css
.progress { height: 4px; background: var(--bg-raised); border-radius: 2px; overflow: hidden; }
.progress__fill { height: 100%; border-radius: 2px; }
```

### 5.17 Scrollbar

```css
::-webkit-scrollbar { width: 6px; height: 6px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--text-ghost); border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: var(--text-muted); }
```

### 5.18 Notification Badge (contador vermelho)

```css
.notif-badge {
  position: absolute;
  top: -4px;
  right: -4px;
  min-width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--notif-bg);  /* #ef4444 */
  color: #ffffff;
  font-size: 9px;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 4px;
}
```

Usado em: bell icon (notificações), calendar badge (tasks pendentes), nav pills (contadores).
É o ÚNICO elemento com background sólido vermelho permitido.

---

## 6. COMPONENTES COMPOSTOS

### 6.1 CTA Card — Call-to-Action (Coluna Direita)

```
┌──────────────────────────────────┐
│ Streamline Your Production       │  ← Title 15px weight 600 --text-primary
│ 24/7 monitoring, always here...  │  ← Subtitle 11px --text-muted
│                                  │
│  ┌────────────────────────────┐  │
│  │     [Imagem/Ilustração]   │  │  ← Imagem 100% width, border-radius 8px
│  └────────────────────────────┘  │
│                                  │
│  ┌────────────────────────────┐  │
│  │    Get Started Now         │  │  ← CTA button (vermelho, pill, full width)
│  └────────────────────────────┘  │
└──────────────────────────────────┘
```

```css
.cta-card {
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  padding: 16px;
}

.cta-card__title {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 4px;
}

.cta-card__subtitle {
  font-size: 11px;
  color: var(--text-muted);
  margin-bottom: 12px;
}

.cta-card__image {
  width: 100%;
  height: auto;
  border-radius: var(--radius-lg);
  margin-bottom: 12px;
  object-fit: cover;
}
```

### 6.2 Tracking Card — Timeline de Delivery

```
┌──────────────────────────────────────────┐
│ Tracking Delivery                  [···] │
│ Track your delivered order.              │
│                                          │
│  Tracking ID          Status             │
│  #281731-22-922ppk    In Transit         │  ← Mono + status colorido
│                                          │
│  ● Order is being processed              │  ← Timeline vertical
│    Today, Factory Floor, 09:12 AM        │
│                                          │
│  ┌──────────────────────────────┐        │
│  │ 👤 Production Team      📞 💬 │        │  ← Courier/team info card
│  │    Courier                    │        │
│  └──────────────────────────────┘        │
│                                          │
│  ● Quality Check                         │  ← Step com dot verde
│    Today, QC Department, 09:30 AM        │
│                                          │
│  ● Materials Prepared                    │  ← Step com dot verde
│    Today, Warehouse, 07:45 AM            │
└──────────────────────────────────────────┘
```

```css
.tracking-card__meta {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 0;
  margin-bottom: 12px;
}

.tracking-card__id-label {
  font-size: 11px;
  color: var(--text-muted);
}
.tracking-card__id-value {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-primary);
  font-weight: 500;
}
.tracking-card__status-label {
  font-size: 11px;
  color: var(--text-muted);
}
```

### 6.3 Timeline Vertical

```css
.timeline {
  display: flex;
  flex-direction: column;
  gap: 0;
  padding-left: 12px;
}

.timeline__step {
  position: relative;
  padding-left: 20px;
  padding-bottom: 16px;
}

/* Linha vertical conectora */
.timeline__step::before {
  content: '';
  position: absolute;
  left: 3px;   /* Centered on the 8px dot */
  top: 10px;
  bottom: 0;
  width: 1px;
  background: var(--border-subtle);
}
.timeline__step:last-child::before {
  display: none;
}

/* Dot no início de cada step */
.timeline__dot {
  position: absolute;
  left: 0;
  top: 2px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  /* Cor por status: --semantic-green (done), --semantic-amber (current), --text-ghost (pending) */
}

.timeline__title {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
}

.timeline__meta {
  font-size: 11px;
  color: var(--text-muted);
  margin-top: 2px;
}
```

### 6.4 Courier/Team Info Block (dentro do tracking card)

```css
.courier-block {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  background: var(--bg-raised);
  border-radius: var(--radius-lg);
  margin: 8px 0;
}

.courier-block__avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: var(--bg-card);
  overflow: hidden;
}
.courier-block__avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.courier-block__info {
  flex: 1;
}
.courier-block__label {
  font-size: 11px;
  color: var(--text-muted);
}
.courier-block__name {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
}

.courier-block__actions {
  display: flex;
  gap: 8px;
}
/* Botões ghost: phone, message icons */
```

### 6.5 Calendar Badge Button

```css
.calendar-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 12px;
  background: transparent;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  font-size: 12px;
  color: var(--text-secondary);
  cursor: pointer;
  position: relative;
  transition: border-color 0.15s;
}
.calendar-btn:hover {
  border-color: var(--border-hover);
}
.calendar-btn svg {
  width: 14px;
  height: 14px;
  color: var(--text-muted);
}
/* O notification badge (vermelho com número) é posicionado no canto superior direito */
```

### 6.6 User Avatar na TopBar

```css
.user-avatar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background 0.15s;
}
.user-avatar:hover {
  background: var(--hover-overlay);
}

.user-avatar__circle {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  overflow: hidden;
}
.user-avatar__circle img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.user-avatar__info {
  display: flex;
  flex-direction: column;
}
.user-avatar__name {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-primary);
}
.user-avatar__email {
  font-size: 11px;
  color: var(--text-muted);
}

.user-avatar__chevron {
  width: 12px;
  height: 12px;
  color: var(--text-muted);
}
```

---

## 7. ÍCONES

### 7.1 Ícones SVG Inline (stroke)

- **Formato**: SVG inline, stroke-only, strokeWidth="1.5", strokeLinecap="round", strokeLinejoin="round"
- **Tamanho padrão**: 16x16
- **Cor**: `currentColor` (herda do parent)
- **Fonte**: Lucide icon set como referência visual
- **NUNCA**: Usar emojis. Usar filled icons (exceção: icon circles). Usar icon fonts. Usar > 18x18.

### 7.2 Icon Circles (preenchidos) — Para KPI Cards e Card Headers

Os icon circles são a EXCEÇÃO à regra de stroke-only. São círculos de 32px com fundo rgba e ícone stroke dentro.

```
Variante Accent (teal):   bg: rgba(20,184,166,0.15)  icon: #14b8a6  → Shipments, Delivered, Production
Variante Blue:             bg: rgba(59,130,246,0.15)  icon: #3b82f6  → Distance, Analytics, Intelligence
Variante Green:            bg: rgba(16,185,129,0.15)  icon: #10b981  → OEE, Efficiency, Success
Variante Amber:            bg: rgba(245,158,11,0.15)  icon: #f59e0b  → Warnings, Pending, Attention
```

### 7.3 Mapeamento Standard

```
Dashboard       → LayoutGrid
Activity        → Clock
Manage          → Sliders
Overview        → Eye
Planning        → Calendar
Shipments       → Package (box)
Distance        → MapPin
Delivered       → Truck
OEE             → Gauge (ou Activity)
Income          → TrendingUp
Analytics       → BarChart3
Search          → Search
Notifications   → Bell
Settings        → Settings2
Create New      → Plus
Calendar        → CalendarDays
Chevron Down    → ChevronDown
More Horizontal → MoreHorizontal
More Vertical   → MoreVertical
Close           → X
Back            → ArrowLeft
Export          → Download
Import          → Upload
Filter          → Filter
Customize       → SlidersHorizontal
Phone           → Phone
Message         → MessageSquare
External Link   → ExternalLink
Copy            → Copy
Edit            → Pencil
Delete          → Trash2
Success/Check   → Check
Error           → AlertCircle
Warning         → AlertTriangle
Info            → Info
```

---

## 8. LAYOUT

### 8.1 Page Structure

```
┌──────────────────────────────────────────────────────────────┐
│ TopBar — fixed top, height: 48px, bg-base, z-index: 100     │
├──────────────────────────────────────────────────────────────┤
│ Greeting Bar — "Hi Name, Good Morning!" + Action Buttons     │
│ padding: 24px 16px 0, margin-top: 48px                       │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  3-Column Grid                                               │
│  ┌──────────┬───────────────────────┬──────────┐             │
│  │ Left     │ Center                │ Right    │             │
│  │ ~300px   │ 1fr                   │ ~300px   │             │
│  └──────────┴───────────────────────┴──────────┘             │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### 8.2 TopBar — Anatomia Exata

```
┌─────────────────────────────────────────────────────────────────────┐
│ ● ProdPlan.    │ [Dashboard][Activity][Manage][Overview][Planning]  │
│                │                                                    │
│                │                          [🔔³] [⚙] [👤 Name ▾]  │
└─────────────────────────────────────────────────────────────────────┘
  ← Logo zone →   ← Nav pills (centradas ou left-aligned) →   ← Right actions →
```

```css
.topbar {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: 48px;
  background: var(--bg-base);
  border-bottom: 1px solid var(--border-subtle);
  display: flex;
  align-items: center;
  padding: 0 16px;
  z-index: 100;
}

.topbar__logo {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-right: 24px;
}
.topbar__logo-icon {
  /* Green circle 24px com icon dentro */
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: var(--accent);
  display: flex;
  align-items: center;
  justify-content: center;
}
.topbar__logo-text {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
}

.topbar__nav {
  flex: 1;
  display: flex;
  justify-content: center;
}

.topbar__actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
```

- **Logo**: Círculo accent 24px + "ProdPlan." text 15px weight 600
- **Nav pills**: Container raised com pills individuais (ver 5.12)
- **Bell**: Icon ghost 16px com notif-badge vermelho (se count > 0)
- **Gear**: Icon ghost 16px
- **User**: Avatar circle 32px + name 12px + chevron 12px

### 8.3 Greeting Bar

```
┌──────────────────────────────────────────────────────────────┐
│ Hi Martim, Good Morning!        [+ Create New Request] [📅 Wed, Jan 28 ³] [🔍] │
└──────────────────────────────────────────────────────────────┘
```

```css
.greeting-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 24px 0;
}

.greeting-bar__text {
  font-size: 24px;
  font-weight: 400;
}
.greeting-bar__name {
  font-weight: 600;
  color: var(--text-primary);
}
.greeting-bar__message {
  color: var(--accent);
}

.greeting-bar__actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
```

Formato do greeting por hora:
```
05:00 - 11:59  →  "Good Morning!"
12:00 - 17:59  →  "Good Afternoon!"
18:00 - 04:59  →  "Good Evening!"
```

### 8.4 Grid Principal — Dashboard

```css
.dashboard-grid {
  display: grid;
  grid-template-columns: 300px 1fr 300px;
  gap: 16px;
  align-items: start;
  padding: 0 16px 24px;
  max-width: 1440px;
  margin: 0 auto;
}

/* Left column — cards verticais empilhados */
.dashboard-grid__left {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* Center column — KPIs em grid 2x2 + charts + table */
.dashboard-grid__center {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.center__kpi-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}

/* Right column — CTA + Tracking */
.dashboard-grid__right {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
```

### 8.5 Grid Patterns — Outras Páginas

```css
/* List pages — full width single column */
.grid-list {
  max-width: 1200px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 0 16px 24px;
}

/* Detail pages — main + sidebar */
.grid-detail {
  display: grid;
  grid-template-columns: 1fr 320px;
  gap: 16px;
  align-items: start;
  max-width: 1200px;
  margin: 0 auto;
  padding: 0 16px 24px;
}

/* KPI row (quando fora do dashboard, inline numa list page) */
.kpi-row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 12px;
}

/* Form — single column centered */
.grid-form {
  max-width: 480px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
```

### 8.6 Responsive — APENAS 2 Breakpoints

```css
@media (max-width: 1024px) {
  .dashboard-grid { grid-template-columns: 1fr 1fr; }
  .dashboard-grid__right { grid-column: 1 / -1; }
  /* Right column passa para baixo, full width */

  .grid-detail { grid-template-columns: 1fr; }
}

@media (max-width: 640px) {
  .dashboard-grid { grid-template-columns: 1fr; }
  .center__kpi-grid { grid-template-columns: 1fr; }
  .kpi-row { grid-template-columns: 1fr 1fr; }
  .greeting-bar { flex-direction: column; align-items: flex-start; gap: 12px; }
}
```

---

## 9. GRÁFICOS E VISUALIZAÇÃO DE DADOS

### 9.1 Biblioteca

Usar **Recharts**. Sem D3 direto. Sem Chart.js. Sem Plotly.

### 9.2 Estilo Global dos Gráficos

```css
/* Tooltip */
.recharts-tooltip {
  background: var(--bg-card);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  padding: 8px 12px;
  box-shadow: var(--shadow-overlay);
}
.recharts-tooltip label { font-size: 11px; color: var(--text-muted); }
.recharts-tooltip value { font-size: 13px; color: var(--text-primary); font-weight: 500; }

/* Axes */
tick fontSize: 11px
tick fill: var(--text-ghost)
axisLine: false
tickLine: false

/* Grid */
stroke: rgba(255, 255, 255, 0.04)
strokeDasharray: none (sólido, não dashed)

/* Cursor/hover area */
fill: rgba(255, 255, 255, 0.02)
```

### 9.3 Paleta de Cores para Séries

```
Série primária:   var(--accent)          #14b8a6
Série secundária: var(--semantic-blue)   #3b82f6
Série terciária:  var(--semantic-amber)  #f59e0b
```

Máximo 3 séries por gráfico. Se precisar de mais, criar gráficos separados.

### 9.4 Bar Chart (ex: Income Tracker)

```
- Barras verticais com border-radius: 2px 2px 0 0 (topo arredondado, base flat)
- Cor: var(--accent) sólido
- Largura das barras: ~70% do espaço disponível
- Tooltip no hover de cada barra
- X-axis labels: Mo Tu We Th Fr Sa Su (abreviado 2 letras)
- Highlight da barra hovered: opacity 1. Barras não-hovered: opacity 0.7.
- Label de valor acima da barra hovered (ex: "$329") — font-size 11px, font-weight 600, color accent
```

### 9.5 Stacked Bar Chart (ex: Logistic Analytics)

```
- Barras verticais empilhadas (3 segmentos)
- Segmentos de baixo para cima: range baixo → range alto
- Cores: 3 tons de teal com alphas diferentes (0.15, 0.35, 0.60)
- Border-radius apenas no segmento do topo: 2px 2px 0 0
- Y-axis: valores numéricos
- Legenda abaixo: squares arredondados 8x8px + label
```

### 9.6 Horizontal Bar Chart (ver componente 5.7)

Barras horizontais com track de fundo + fill com gradiente teal.

### 9.7 Regras Gerais

```
- Máximo 3 cores por gráfico
- SEM gradientes em fills de barras verticais (usar cor sólida)
- EXCEÇÃO: barras horizontais podem ter gradiente linear horizontal
- SEM animações de entrada. Dados aparecem imediatamente.
- dot={false} em line/area charts (sem pontos nos vértices)
- NUNCA usar: 3D, pie charts, donut charts, gauge charts, radar charts
- NUNCA usar: smooth curves (type="monotone"). Usar type="linear" ou barras.
- Area charts: fillOpacity 0.10 (muito sutil)
```

---

## 10. PADRÕES DE INTERAÇÃO

### 10.1 Hover States

```
Cards clicáveis      → border-color: --border-hover + background: #141a22
Table rows           → background: --hover-overlay
Botões primary       → background escurece 1 tom (accent-hover)
Botões secondary     → background: --hover-overlay + border: --border-hover
Botões ghost         → background: --hover-overlay
Links/text links     → color: --accent-hover (sem underline)
Nav pills            → color: --text-secondary
Icon buttons         → background: --hover-overlay
Card menu (···)      → background: --hover-overlay
Dropdown items       → background: --hover-overlay + color: --text-primary
Bar chart bars       → opacity: 1 (non-hovered: 0.7)
```

Regra: TODOS os hovers usam `transition: 0.15s`. NENHUM hover muda tamanho, posição ou sombra.

### 10.2 Selected / Active States

```
Nav pill ativa       → background: --bg-card + box-shadow subtle + weight 500
Tab ativo (underline)→ color: --accent + border-bottom 2px --accent (se usar underline tabs)
Row selecionada      → background: --selected-bg + border-left 2px --accent
Card selecionado     → border-color: --accent-border
Filter chip ativo    → background: --accent-bg + color: --accent
Dropdown open        → trigger border: --accent-border
```

### 10.3 Loading States

```
Initial page load    → Skeleton placeholders (blocos estáticos de --bg-raised)
Data fetching        → Texto "Loading..." em --text-ghost, centrado
Button loading       → Texto muda para "Saving..." + disabled com opacity: 0.5
Table loading        → 5 skeleton rows (blocos de --bg-raised com alturas fixas)
Chart loading        → Área do gráfico com blocos de --bg-raised
```

Regra: Sem spinners animados. Sem skeleton shimmer/pulse. Skeletons são blocos ESTÁTICOS.

### 10.4 Empty States

```
Tabelas vazias       → "No data" em --text-ghost, centrado, 1 linha
Listas vazias        → Texto centrado + botão de ação (se aplicável)
Gráficos vazios      → "No data available" no centro da área
Cards sem conteúdo   → Texto muted + ação sugerida
```

### 10.5 Error States

```
Form validation      → border-color: --semantic-red + texto 11px --semantic-red abaixo do input
API error            → Card com border-left 3px --semantic-red + mensagem + botão "Retry"
Page error           → Bloco centrado: título "Error" + mensagem + botão "Reload"
```

---

## 11. PADRÕES DE PÁGINA

### 11.1 Dashboard (Página Principal)

```
┌──────────────────────────────────────────────────────────────────┐
│ TopBar                                                           │
├──────────────────────────────────────────────────────────────────┤
│ Hi Martim, Good Morning!            [+Create] [📅 Jan 28] [🔍] │
├───────────┬────────────────────────────────┬─────────────────────┤
│ LEFT      │ CENTER                          │ RIGHT              │
│ ~300px    │ 1fr                             │ ~300px             │
│           │                                 │                    │
│ Rich Card │ ┌─────────┐  ┌─────────┐      │ CTA Card           │
│ (Trend)   │ │ KPI 1   │  │ KPI 2   │      │ (Action)           │
│           │ └─────────┘  └─────────┘      │                    │
│ Stacked   │ ┌─────────┐  ┌─────────┐      │ Tracking Card      │
│ Bar Card  │ │ KPI 3   │  │ KPI 4   │      │ (Timeline)         │
│           │ └─────────┘  └─────────┘      │                    │
│ H-Bar     │                                 │                    │
│ Card      │ ┌──────────────────────────┐   │                    │
│           │ │ Data Table               │   │                    │
│           │ └──────────────────────────┘   │                    │
└───────────┴────────────────────────────────┴─────────────────────┘
```

**Coluna Esquerda** (300px) — padrão de layout, nomes ilustrativos:
1. Rich Card — Gráfico de barras + trend + paginação
2. Stacked Bar Card — Barras empilhadas + legenda
3. Horizontal Bar Card — Barras horizontais + trends

**Coluna Centro** (1fr):
1. KPI Grid 2x2: 4 métricas principais do domínio
2. Tabela de dados com status + overflow menu

**Coluna Direita** (300px):
1. CTA Card — Acção principal + botão CTA
2. Tracking Card — Timeline com steps

### 11.2 List Pages (Snapshots, Plans, PRs, Scenarios, Suggestions)

```
┌──────────────────────────────────────────────────────────────────┐
│ TopBar                                                           │
├──────────────────────────────────────────────────────────────────┤
│ Page Title                                    [+ Action Button]  │
├──────────────────────────────────────────────────────────────────┤
│ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐                    │
│ │ Stat 1 │ │ Stat 2 │ │ Stat 3 │ │ Stat 4 │  ← KPI Row        │
│ └────────┘ └────────┘ └────────┘ └────────┘                    │
├──────────────────────────────────────────────────────────────────┤
│ [Filter 1 ▾] [Filter 2 ▾] [Filter 3 ▾]  [Clear]  │ Count: N   │
├──────────────────────────────────────────────────────────────────┤
│ ┌──────────────────────────────────────────────────────────┐    │
│ │ Item Card 1                                              │    │
│ │ Item Card 2                                              │    │
│ │ Item Card 3                                              │    │
│ └──────────────────────────────────────────────────────────┘    │
│ Ou: Tabela com rows                                              │
└──────────────────────────────────────────────────────────────────┘
```

### 11.3 Detail Pages (Plan Detail, PR Detail, Scenario Detail)

```
┌──────────────────────────────────────────────────────────────────┐
│ TopBar                                                           │
├──────────────────────────────────────────────────────────────────┤
│ ← Back    Page Title    Status Badge       [Action 1] [Action 2]│
│           Meta: Created date, Hash, Author                       │
├──────────────────────────────────────────────────────────────────┤
│ [Tab 1] [Tab 2] [Tab 3] [Tab 4] [Tab 5] [Tab 6]               │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Tab Content Area                                                │
│  (Cards, tables, charts, depending on active tab)                │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

---

## 12. PROIBIÇÕES ABSOLUTAS

Lista de coisas que NUNCA devem existir no código:

```
❌ Framer Motion imports
❌ @keyframes em qualquer CSS
❌ animation: em qualquer CSS (exceção: cursor blink em inputs)
❌ transition: com valor > 0.15s
❌ transition: em propriedades que não sejam background, border-color, color, opacity
❌ transform: em hovers (translateY, scale, rotate)
❌ box-shadow: com cores (neon, glow)
❌ backdrop-filter: blur()
❌ Cores #ffffff em texto (exceção: botão primary text)
❌ Cores de light mode (#dcfce7, #fef3c7, #dbeafe, etc.)
❌ font-size > 24px
❌ font-weight > 600
❌ border-radius > 8px (exceção: circles, pill CTA, notification badge)
❌ padding/margin > 24px
❌ Emojis em UI
❌ Pie/donut/radar/gauge charts
❌ Gradientes (exceção: h-bar fill)
❌ Spinners animados
❌ Skeleton shimmer/pulse
❌ 3D transforms
❌ SVG fill icons (exceção: icon circles)
❌ !important em CSS
❌ z-index sem variável
❌ Inline styles para valores estáticos
❌ Cores hardcoded (usar SEMPRE variáveis)
```

---

## 13. CHECKLIST POR COMPONENTE

Antes de entregar qualquer componente, verificar:

```
□ Usa APENAS variáveis CSS definidas neste documento?
□ Font sizes estão na escala de 6? (11/12/13/15/20/24)
□ Font weights são apenas 400/500/600?
□ Spacing está na escala de 6? (2/4/8/12/16/24)
□ Border-radius está na escala de 4? (3/4/6/8)
□ Nenhuma animação/transition além de opacity/background 0.15s?
□ Cards têm header com icon + title + control + overflow?
□ Badges usam backgrounds rgba com alpha 0.12?
□ Hover states são APENAS border-color/background changes?
□ Tabelas têm headers uppercase 12px muted?
□ IDs/hashes usam font-mono 11px?
□ KPI values são 20px weight 600 tabular-nums?
□ Trends são 11px com cor semântica (green/red)?
□ Zero emojis?
□ Zero animações?
```

---

> Este documento é lei. Não há exceções além das explicitamente listadas.
> Se um componente não segue estas regras, está errado e deve ser corrigido.
