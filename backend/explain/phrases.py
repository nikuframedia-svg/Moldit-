"""Phrase generator — Moldit Planner.

Every number in the UI comes with a Portuguese phrase that explains
what it means, why it matters, and what to do about it.
Pattern: O QUÊ + PORQUE + IMPACTO + AÇÃO.
"""
from __future__ import annotations

from .formats import fmt_dias, fmt_horas, fmt_pct

# ── INICIO page ──────────────────────────────────────────────────────

def frase_resumo_fabrica(
    score: dict,
    deadlines: list[dict],
    stress: list[dict],
    actions: list[dict],
) -> dict:
    """Single headline for the INICIO page (24px)."""
    n_critical = sum(1 for a in actions if a.get("severity") == "critical")
    late = [d for d in deadlines if not d.get("on_time", True)]
    max_stress = max((s.get("stress_pct", 0) for s in stress), default=0)
    max_stress_machine = ""
    for s in stress:
        if s.get("stress_pct", 0) == max_stress:
            max_stress_machine = s.get("maquina_id", "")

    if n_critical > 0 and late:
        molde = late[0].get("molde", "?")
        return {
            "text": (
                f"O {molde} vai falhar o prazo se nao agir hoje. "
                f"{'Mais ' + str(n_critical - 1) + ' problemas.' if n_critical > 1 else ''}"
            ).strip(),
            "color": "red",
        }
    if late:
        molde = late[0].get("molde", "?")
        dias = abs(late[0].get("dias_atraso", 0))
        return {
            "text": (
                f"O {molde} precisa de atencao: "
                f"esta atrasado {fmt_dias(dias)}."
            ),
            "color": "orange",
        }
    if max_stress > 90:
        return {
            "text": (
                f"Tudo dentro do prazo. "
                f"A {max_stress_machine} precisa de atencao ({fmt_pct(max_stress)} de carga)."
            ),
            "color": "orange",
        }
    return {
        "text": "Hoje esta tudo dentro do prazo. Nenhum problema identificado.",
        "color": "green",
    }


def frase_cartao_tempo(score: dict, deadlines: list[dict]) -> dict:
    """Status card: total production time."""
    makespan = score.get("makespan_total_dias", 0)
    # Find earliest deadline and compute slack
    min_deadline_dias = 999
    for d in deadlines:
        deadline_dia = d.get("deadline_dia", 999)
        if deadline_dia < min_deadline_dias:
            min_deadline_dias = deadline_dia

    folga = min_deadline_dias - makespan if min_deadline_dias < 999 else 0

    if folga > 5:
        cor = "green"
        frase = f"Dentro do prazo. {fmt_dias(folga)} de folga."
    elif folga > 0:
        cor = "orange"
        frase = f"Dentro do prazo mas com pouca margem ({fmt_dias(folga)})."
    else:
        cor = "red"
        frase = f"Fora do prazo por {fmt_dias(abs(folga))}."

    return {"valor": fmt_dias(makespan), "frase": frase, "cor": cor}


def frase_cartao_prazos(deadlines: list[dict]) -> dict:
    """Status card: deadline compliance."""
    total = len(deadlines)
    on_time = sum(1 for d in deadlines if d.get("on_time", True))
    late = [d for d in deadlines if not d.get("on_time", True)]

    if total == 0:
        return {"valor": "-", "frase": "Sem moldes carregados.", "cor": "green"}

    if on_time == total:
        return {
            "valor": f"{on_time} de {total}",
            "frase": "Todos os moldes dentro do prazo.",
            "cor": "green",
        }

    late_names = ", ".join(d.get("molde", "?") for d in late[:3])
    return {
        "valor": f"{on_time} de {total}",
        "frase": (
            f"{on_time} moldes dentro do prazo. "
            f"{total - on_time} atrasado{'s' if total - on_time > 1 else ''} ({late_names})."
        ),
        "cor": "red" if on_time < total * 0.7 else "orange",
    }


def frase_cartao_maquinas(stress: list[dict]) -> dict:
    """Status card: machine utilization."""
    if not stress:
        return {"valor": "-", "frase": "Sem dados de maquinas.", "cor": "green"}

    avg = sum(s.get("stress_pct", 0) for s in stress) / len(stress)
    busiest = max(stress, key=lambda s: s.get("stress_pct", 0))
    busiest_name = busiest.get("maquina_id", "?")
    busiest_pct = busiest.get("stress_pct", 0)

    if avg > 85:
        cor = "red"
        frase = f"Carga alta. A mais ocupada: {busiest_name} ({fmt_pct(busiest_pct)})."
    elif avg > 65:
        cor = "green"
        frase = f"Carga media. A mais ocupada: {busiest_name} ({fmt_pct(busiest_pct)})."
    else:
        cor = "green"
        frase = "Carga leve. Muita capacidade disponivel."

    return {"valor": fmt_pct(avg), "frase": frase, "cor": cor}


def frase_cartao_trocas(score: dict) -> dict:
    """Status card: setup hours."""
    setups = score.get("total_setups", 0)
    n_moldes = score.get("n_moldes", 0) or 1

    if setups < 30:
        frase = "Poucas trocas de trabalho. Bom."
        cor = "green"
    elif setups < 60:
        frase = f"Normal para {n_moldes} moldes em paralelo."
        cor = "green"
    else:
        frase = f"Muitas trocas ({fmt_horas(setups)}). Considere o preset 'Menos trocas'."
        cor = "orange"

    return {"valor": fmt_horas(setups), "frase": frase, "cor": cor}


def frase_alerta(action: dict) -> dict:
    """Transform a backend action_item into 4-part alert."""
    return {
        "titulo": action.get("phrase", action.get("title", "")),
        "porque": action.get("body", action.get("detail", "")),
        "impacto": _inferir_impacto(action),
        "opcoes": _extrair_opcoes(action),
        "severidade": action.get("severity", "warning"),
    }


def _inferir_impacto(action: dict) -> str:
    cat = action.get("category", "")
    if cat == "deadline":
        return "Se nao agir, o molde vai falhar o prazo de entrega."
    if cat == "bottleneck":
        return "Se a maquina avariar ou atrasar, pode afetar varios moldes."
    if cat == "conditional":
        return "Esta operacao precisa de decisao para o planeamento continuar."
    return ""


def _extrair_opcoes(action: dict) -> list[dict]:
    result = []
    suggestions = action.get("actions", action.get("suggestion", []))
    if isinstance(suggestions, str):
        suggestions = [suggestions]
    for s in suggestions:
        result.append({"texto": s, "endpoint": ""})
    return result


# ── MOLDES page ──────────────────────────────────────────────────────

def frase_resumo_molde(
    molde: dict,
    deadline_info: dict | None = None,
    ml_analogo: dict | None = None,
) -> str:
    """Headline for a mold in the MOLDES page."""
    ops_done = molde.get("ops_concluidas", 0)
    ops_total = molde.get("total_ops", 0)

    parts = [f"{ops_done} de {ops_total} operacoes feitas"]

    if deadline_info:
        if deadline_info.get("on_time", True):
            dias = deadline_info.get("dias_folga", 0)
            if dias > 0:
                parts.append(f"Dentro do prazo com {fmt_dias(dias)} de folga")
            else:
                parts.append("Dentro do prazo")
        else:
            dias = abs(deadline_info.get("dias_atraso", 0))
            parts.append(f"Atrasado {fmt_dias(dias)}")

    text = ". ".join(parts) + "."

    if ml_analogo and ml_analogo.get("frase"):
        text += " " + ml_analogo["frase"]

    return text


def frase_operacao_ml(
    op: dict,
    prediction: dict | None = None,
) -> str:
    """ML phrase for an operation (inline in OpTable)."""
    if not prediction:
        return ""

    estimado = prediction.get("estimado_mpp", 0)
    previsao = prediction.get("previsao_ml", 0)
    p10 = prediction.get("intervalo_p10", 0)
    p90 = prediction.get("intervalo_p90", 0)
    confianca = prediction.get("confianca", 0)

    if confianca < 0.2:
        return ""

    delta = previsao - estimado
    delta_pct = (delta / estimado * 100) if estimado > 0 else 0

    if abs(delta_pct) < 5:
        frase = f"Plano: {fmt_horas(estimado)}. Previsao: semelhante."
    elif delta > 0:
        frase = (
            f"Plano: {fmt_horas(estimado)}. "
            f"Previsao real: {fmt_horas(previsao)} (+{abs(delta_pct):.0f}%). "
            f"Melhor caso: {fmt_horas(p10)}. Pior caso: {fmt_horas(p90)}."
        )
    else:
        frase = (
            f"Plano: {fmt_horas(estimado)}. "
            f"Previsao real: {fmt_horas(previsao)} ({delta_pct:.0f}%). "
            f"Pode terminar mais cedo."
        )

    if confianca >= 0.8:
        frase += " Confianca: alta."
    elif confianca >= 0.5:
        frase += " Confianca: media."
    else:
        frase += " Confianca: baixa (poucos dados)."

    return frase


def frase_risco_molde(risk_result: dict) -> str:
    """Risk panel phrase for a mold."""
    p50 = risk_result.get("compliance_p50", 0)
    p80 = risk_result.get("compliance_p80", 0)
    mk_p50 = risk_result.get("makespan_p50", 0)
    mk_p90 = risk_result.get("makespan_p95", 0)
    n = risk_result.get("n_samples", 500)

    lines = [
        f"Simulamos {n} cenarios possiveis, variando os tempos "
        "de cada operacao com base no que aconteceu em moldes anteriores.",
        "",
        "Se tudo correr normalmente:",
        f"  Acabamos em {fmt_dias(mk_p50)}.",
    ]

    if p50 > 0.9:
        lines.append("  Dentro do prazo.")
    else:
        lines.append("  Com risco de atraso.")

    lines.extend([
        "",
        "No pior cenario realista (5% de chance):",
        f"  Acabamos em {fmt_dias(mk_p90)}.",
        "",
    ])

    prob_pct = p80 * 100
    lines.append(
        f"Resumindo: ha {prob_pct:.0f}% de probabilidade de cumprir o prazo."
    )

    return "\n".join(lines)


def frase_analogo(analogo: dict) -> str:
    """Analogy narrative for a similar past project."""
    molde = analogo.get("molde_id", "?")
    sim = analogo.get("similaridade", 0)
    makespan = analogo.get("makespan_real_dias", 0)
    compliance = analogo.get("compliance", True)
    nota = analogo.get("nota", "")

    lines = [
        f"Este molde e parecido com o {molde} ({sim * 100:.0f}% de semelhanca).",
    ]

    if compliance:
        lines.append(f"O {molde} foi concluido em {fmt_dias(makespan)}, dentro do prazo.")
    else:
        lines.append(f"O {molde} demorou {fmt_dias(makespan)} e atrasou.")

    if nota:
        lines.append(f"O que aconteceu: {nota}")

    return " ".join(lines)


def frase_resultado_simulacao(
    before: dict,
    after: dict,
    mutations: list[dict],
) -> str:
    """Simulation result in plain language."""
    mk_before = before.get("makespan_total_dias", 0)
    mk_after = after.get("makespan_total_dias", 0)
    comp_before = before.get("deadline_compliance", 0)
    comp_after = after.get("deadline_compliance", 0)

    delta_mk = mk_after - mk_before
    delta_comp = comp_after - comp_before

    parts = []
    if delta_mk < 0:
        parts.append(f"Ganha {fmt_dias(abs(delta_mk))} no tempo total")
    elif delta_mk > 0:
        parts.append(f"Perde {fmt_dias(delta_mk)} no tempo total")

    if delta_comp > 0:
        parts.append("melhora o cumprimento de prazos")
    elif delta_comp < 0:
        parts.append("piora o cumprimento de prazos")

    if not parts:
        return "Sem impacto significativo no plano."

    return ". ".join(parts).capitalize() + "."


# ── EQUIPA page ──────────────────────────────────────────────────────

def frase_equipa_resumo(
    operadores: list[dict],
    conflicts: list[dict],
    dia_label: str = "Amanha",
) -> str:
    """Headline for the EQUIPA page."""
    total = len(operadores)
    disponiveis = sum(1 for o in operadores if o.get("disponivel", True))
    n_conflicts = len(conflicts)

    frase = f"{dia_label} precisamos de {total} operadores. "
    if disponiveis >= total:
        frase += "Todos disponiveis."
    else:
        deficit = total - disponiveis
        frase += f"Temos {disponiveis} disponiveis. Faltam {deficit}."

    if n_conflicts > 0:
        frase += f" {n_conflicts} conflito{'s' if n_conflicts > 1 else ''} por resolver."

    return frase


def frase_pessoa(operador: dict, alocacao: str = "") -> str:
    """Phrase for one person in the EQUIPA list."""
    nome = operador.get("nome", "?")
    disponivel = operador.get("disponivel", True)
    turno = operador.get("turno", "")
    zona = operador.get("zona", "")

    if not disponivel:
        motivo = operador.get("motivo_ausencia", "indisponivel")
        return f"{nome} — {motivo.capitalize()}."

    if alocacao:
        return f"{nome} — {alocacao}."

    if zona and turno:
        return f"{nome} — {zona}, turno {turno}. Disponivel."

    return f"{nome} — Livre. Pode ser alocado."


def frase_conflito(conflict: dict) -> dict:
    """Conflict phrase with suggestion and action."""
    desc = conflict.get("descricao", "")
    sugestao = conflict.get("sugestao", "")

    if not desc:
        maquinas = ", ".join(conflict.get("maquinas", []))
        deficit = conflict.get("deficit", 0)
        desc = f"Faltam {deficit} operadores para {maquinas}."

    return {
        "descricao": desc,
        "sugestao": sugestao or "Usar distribuicao automatica.",
        "acao_endpoint": "/api/workforce/auto-allocate",
    }


# ── CONFIG / Aprendizagem ────────────────────────────────────────────

def frase_aprendizagem(
    ml_status: dict,
    evolution: list[dict],
    calibration: dict | None = None,
) -> list[str]:
    """5 plain-language phrases about ML learning progress."""
    frases = []
    n_proj = ml_status.get("n_projetos", 0)
    n_ops = ml_status.get("n_operacoes", 0)

    # 1. Evolution of accuracy
    if len(evolution) >= 2:
        old_mae = evolution[0].get("mae", 0)
        new_mae = evolution[-1].get("mae", 0)
        if old_mae > 0 and new_mae < old_mae:
            frases.append(
                f"Ha {len(evolution)} meses, as previsoes erravam em media "
                f"{fmt_horas(old_mae)}. Agora erram {fmt_horas(new_mae)}. "
                "O sistema esta a melhorar."
            )
        else:
            frases.append(
                f"As previsoes erram em media {fmt_horas(new_mae)}."
            )
    else:
        frases.append(
            "Ainda nao temos dados suficientes para medir a evolucao."
        )

    # 2. Data volume
    if n_proj > 0:
        frases.append(
            f"O sistema ja aprendeu com {n_proj} moldes "
            f"e {n_ops:,} operacoes.".replace(",", ".")
        )
    else:
        frases.append(
            "O sistema ainda nao tem dados historicos. "
            "Comece por concluir moldes para alimentar a aprendizagem."
        )

    # 3. Last update (from ML status)
    last = ml_status.get("last_retrain", "")
    if last:
        frases.append(
            f"Ultima atualizacao das previsoes: {last[:16].replace('T', ' ')}."
        )

    # 4. Machine reliability (if calibration available)
    if calibration and "fiabilidade" in calibration:
        fiab = calibration["fiabilidade"]
        if fiab:
            best = max(fiab.values(), key=lambda f: f.get("uptime_pct", 0))
            worst = min(fiab.values(), key=lambda f: f.get("uptime_pct", 0))
            frases.append(
                f"A {worst.get('maquina_id', '?')} tem "
                f"{fmt_pct((1 - worst.get('uptime_pct', 1)) * 100)} de tempo parado. "
                f"A {best.get('maquina_id', '?')} e a mais fiavel "
                f"({fmt_pct(best.get('uptime_pct', 1) * 100)} activa)."
            )

    # 5. Coverage
    if evolution:
        coverage = evolution[-1].get("coverage", 0)
        frases.append(
            f"As previsoes cobrem o resultado real "
            f"{fmt_pct(coverage * 100)} das vezes. Objectivo: 90%."
        )

    return frases[:5]
