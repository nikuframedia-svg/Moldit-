"""Report generator — Moldit Planner (Module B).

Generates HTML reports from schedule data using Jinja2 templates.
Converts to PDF via subprocess (wkhtmltopdf, weasyprint, or playwright).
"""

from __future__ import annotations

import logging
import os
import subprocess
import tempfile
from collections import defaultdict
from dataclasses import asdict
from pathlib import Path

from backend.scheduler.types import SegmentoMoldit

logger = logging.getLogger(__name__)

_TEMPLATES_DIR = str(Path(__file__).parent / "templates")


class ReportGenerator:
    """Generate HTML/PDF reports from schedule state."""

    def __init__(self, templates_dir: str | None = None) -> None:
        try:
            import jinja2
            self._env = jinja2.Environment(
                loader=jinja2.FileSystemLoader(templates_dir or _TEMPLATES_DIR),
                autoescape=True,
            )
        except ImportError:
            self._env = None
            logger.warning("Jinja2 not installed — using inline templates")

    def generate_daily(
        self,
        score: dict,
        segmentos: list[SegmentoMoldit],
        moldes: list,
        config: object,
        date: str = "",
    ) -> str:
        """Generate daily production report as HTML."""
        day_segments = segmentos  # All segments (filter by day if needed)

        # Group by machine
        by_machine: dict[str, list] = defaultdict(list)
        for s in day_segments:
            by_machine[s.maquina_id].append(asdict(s))

        # Group by mold
        by_mold: dict[str, float] = defaultdict(float)
        for s in day_segments:
            by_mold[s.molde] += s.duracao_h

        context = {
            "date": date,
            "score": score,
            "n_machines": len(by_machine),
            "n_segments": len(day_segments),
            "by_machine": dict(by_machine),
            "by_mold": dict(by_mold),
            "moldes": [{"id": m.id, "deadline": m.deadline, "progresso": m.progresso}
                       for m in moldes] if moldes else [],
            "total_hours": sum(s.duracao_h for s in day_segments),
            "total_setups": sum(1 for s in day_segments if s.setup_h > 0),
        }

        if self._env:
            try:
                tpl = self._env.get_template("daily.html")
                return tpl.render(**context)
            except Exception:
                logger.warning("Template daily.html not found, using inline")

        return self._inline_report("Relatório Diário", date, context)

    def generate_weekly(
        self,
        score: dict,
        segmentos: list[SegmentoMoldit],
        moldes: list,
        config: object,
        week: str = "",
    ) -> str:
        """Generate weekly summary report as HTML."""
        by_mold: dict[str, float] = defaultdict(float)
        for s in segmentos:
            by_mold[s.molde] += s.duracao_h

        context = {
            "week": week,
            "score": score,
            "by_mold": dict(by_mold),
            "n_segments": len(segmentos),
            "moldes": [{"id": m.id, "deadline": m.deadline, "progresso": m.progresso}
                       for m in moldes] if moldes else [],
            "total_hours": sum(s.duracao_h for s in segmentos),
        }

        if self._env:
            try:
                tpl = self._env.get_template("weekly.html")
                return tpl.render(**context)
            except Exception:
                pass

        return self._inline_report("Relatório Semanal", week, context)

    def generate_client(
        self,
        molde_id: str,
        score: dict,
        segmentos: list[SegmentoMoldit],
        moldes: list,
    ) -> str:
        """Generate client-facing report for one mold."""
        molde = next((m for m in moldes if m.id == molde_id), None)
        mold_segs = [s for s in segmentos if s.molde == molde_id]
        latest_dia = max((s.dia for s in mold_segs), default=0)

        context = {
            "molde_id": molde_id,
            "cliente": molde.cliente if molde else "",
            "deadline": molde.deadline if molde else "",
            "progresso": molde.progresso if molde else 0,
            "total_ops": molde.total_ops if molde else 0,
            "ops_concluidas": molde.ops_concluidas if molde else 0,
            "conclusao_prevista_dia": latest_dia,
            "n_segments": len(mold_segs),
            "total_hours": sum(s.duracao_h for s in mold_segs),
        }

        if self._env:
            try:
                tpl = self._env.get_template("client.html")
                return tpl.render(**context)
            except Exception:
                pass

        return self._inline_report(f"Relatório — Molde {molde_id}", "", context)

    def html_to_pdf(self, html: str) -> bytes:
        """Convert HTML string to PDF bytes.

        Tries in order: weasyprint (Python), wkhtmltopdf, playwright.
        """
        # Try weasyprint first (pure Python)
        try:
            from weasyprint import HTML
            return HTML(string=html).write_pdf()
        except ImportError:
            pass

        # Fallback: wkhtmltopdf
        try:
            with tempfile.NamedTemporaryFile(suffix=".html", delete=False) as f:
                f.write(html.encode("utf-8"))
                html_path = f.name
            pdf_path = html_path.replace(".html", ".pdf")
            result = subprocess.run(
                ["wkhtmltopdf", "--quiet", html_path, pdf_path],
                capture_output=True, timeout=30,
            )
            if result.returncode == 0 and os.path.exists(pdf_path):
                with open(pdf_path, "rb") as pf:
                    pdf_bytes = pf.read()
                return pdf_bytes
        except (FileNotFoundError, subprocess.TimeoutExpired):
            pass
        finally:
            for p in [html_path, pdf_path]:
                if os.path.exists(p):
                    os.unlink(p)

        # Last resort: return HTML as-is with PDF content-type header
        logger.warning("No PDF engine available — returning HTML")
        return html.encode("utf-8")

    def _inline_report(
        self, title: str, subtitle: str, context: dict,
    ) -> str:
        """Fallback inline HTML report (no Jinja2 needed)."""
        score = context.get("score", {})
        rows = ""

        # KPIs
        compliance = score.get("deadline_compliance", 0)
        makespan = score.get("makespan_total_dias", 0)
        setups = score.get("total_setups", 0)

        # Mold progress
        moldes = context.get("moldes", [])
        for m in moldes:
            rows += (
                f"<tr><td>{m['id']}</td>"
                f"<td>{m.get('deadline', '')}</td>"
                f"<td>{m.get('progresso', 0):.0f}%</td></tr>"
            )

        by_mold = context.get("by_mold", {})
        mold_summary = ""
        for mid, hours in sorted(by_mold.items()):
            mold_summary += f"<li>{mid}: {hours:.1f}h</li>"

        return f"""<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<title>{title}</title>
<style>
  body {{ font-family: -apple-system, 'Helvetica Neue', sans-serif;
         max-width: 800px; margin: 40px auto; color: #1d1d1f; }}
  h1 {{ font-size: 24px; font-weight: 700; }}
  h2 {{ font-size: 16px; font-weight: 600; margin-top: 32px; color: #48484a; }}
  .kpi {{ display: flex; gap: 32px; margin: 24px 0; }}
  .kpi-card {{ background: #f5f5f7; border-radius: 12px; padding: 16px 24px; }}
  .kpi-val {{ font-size: 28px; font-weight: 700; font-feature-settings: 'tnum'; }}
  .kpi-label {{ font-size: 11px; color: #86868b; text-transform: uppercase; }}
  table {{ width: 100%; border-collapse: collapse; margin: 16px 0; }}
  th {{ font-size: 11px; color: #86868b; text-transform: uppercase;
       letter-spacing: 0.04em; text-align: left; padding: 8px 12px;
       border-bottom: 1px solid #e5e5e7; }}
  td {{ font-size: 13px; padding: 8px 12px; border-bottom: 1px solid #f0f0f0; }}
  .footer {{ margin-top: 48px; font-size: 11px; color: #86868b; }}
</style>
</head><body>
<h1>{title}</h1>
<p style="color:#86868b">{subtitle}</p>

<div class="kpi">
  <div class="kpi-card">
    <div class="kpi-val">{compliance:.1f}%</div>
    <div class="kpi-label">Compliance</div>
  </div>
  <div class="kpi-card">
    <div class="kpi-val">{makespan}d</div>
    <div class="kpi-label">Makespan</div>
  </div>
  <div class="kpi-card">
    <div class="kpi-val">{setups}</div>
    <div class="kpi-label">Setups</div>
  </div>
  <div class="kpi-card">
    <div class="kpi-val">{context.get('total_hours', 0):.0f}h</div>
    <div class="kpi-label">Horas Total</div>
  </div>
</div>

<h2>Moldes</h2>
<table><thead><tr><th>Molde</th><th>Deadline</th><th>Progresso</th></tr></thead>
<tbody>{rows}</tbody></table>

<h2>Produção por Molde</h2>
<ul>{mold_summary}</ul>

<div class="footer">
  Gerado por Moldit Planner &bull; {subtitle}
</div>
</body></html>"""
