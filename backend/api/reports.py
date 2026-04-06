"""Reports API — Moldit Planner (Module B).

Generate and download PDF reports (daily, weekly, client).
"""

from __future__ import annotations

import logging
from datetime import datetime

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel

from backend.copilot.state import state

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/reports", tags=["reports"])


def _require_data():
    if state.engine_data is None:
        raise HTTPException(503, "Sem dados carregados.")


def _get_generator():
    from backend.reports.generator import ReportGenerator
    return ReportGenerator()


@router.get("/daily")
async def get_daily_report(date: str = ""):
    """Generate daily report PDF."""
    _require_data()
    if not date:
        date = datetime.now().strftime("%Y-%m-%d")

    gen = _get_generator()
    html = gen.generate_daily(
        score=state.score,
        segmentos=state.segments,
        moldes=state.engine_data.moldes,
        config=state.config,
        date=date,
    )
    pdf = gen.html_to_pdf(html)
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="moldit_diario_{date}.pdf"'},
    )


@router.get("/weekly")
async def get_weekly_report(week: str = ""):
    """Generate weekly report PDF."""
    _require_data()
    if not week:
        week = datetime.now().strftime("%Y-W%W")

    gen = _get_generator()
    html = gen.generate_weekly(
        score=state.score,
        segmentos=state.segments,
        moldes=state.engine_data.moldes,
        config=state.config,
        week=week,
    )
    pdf = gen.html_to_pdf(html)
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="moldit_semanal_{week}.pdf"'},
    )


@router.get("/client")
async def get_client_report(molde_id: str = ""):
    """Generate client-facing report for one mold."""
    _require_data()
    if not molde_id:
        raise HTTPException(400, "Parametro molde_id obrigatorio.")

    gen = _get_generator()
    html = gen.generate_client(
        molde_id=molde_id,
        score=state.score,
        segmentos=state.segments,
        moldes=state.engine_data.moldes,
    )
    pdf = gen.html_to_pdf(html)
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={
            "Content-Disposition":
            f'inline; filename="moldit_cliente_{molde_id}.pdf"',
        },
    )


@router.get("/preview")
async def preview_report(tipo: str = "diario", molde_id: str = "", date: str = ""):
    """Return HTML preview (not PDF) for a report."""
    _require_data()
    gen = _get_generator()

    if tipo == "diario":
        html = gen.generate_daily(
            state.score, state.segments, state.engine_data.moldes,
            state.config, date or datetime.now().strftime("%Y-%m-%d"),
        )
    elif tipo == "semanal":
        html = gen.generate_weekly(
            state.score, state.segments, state.engine_data.moldes,
            state.config, date or datetime.now().strftime("%Y-W%W"),
        )
    elif tipo == "cliente":
        if not molde_id:
            raise HTTPException(400, "molde_id obrigatorio para relatorio cliente.")
        html = gen.generate_client(
            molde_id, state.score, state.segments, state.engine_data.moldes,
        )
    else:
        raise HTTPException(400, f"Tipo de relatorio desconhecido: {tipo}")

    return Response(content=html, media_type="text/html")


class SendRequest(BaseModel):
    tipo: str
    destinatarios: list[str]
    molde_id: str = ""
    date: str = ""
    notas: str = ""


@router.post("/send")
async def send_report_email(body: SendRequest):
    """Generate PDF and send via email."""
    _require_data()
    from backend.reports.email_sender import send_report

    gen = _get_generator()

    if body.tipo == "diario":
        html = gen.generate_daily(
            state.score, state.segments, state.engine_data.moldes,
            state.config, body.date,
        )
        filename = f"moldit_diario_{body.date}.pdf"
        subject = f"Moldit — Relatório Diário {body.date}"
    elif body.tipo == "cliente":
        html = gen.generate_client(
            body.molde_id, state.score, state.segments,
            state.engine_data.moldes,
        )
        filename = f"moldit_cliente_{body.molde_id}.pdf"
        subject = f"Moldit — Relatório Molde {body.molde_id}"
    else:
        raise HTTPException(400, f"Tipo nao suportado para envio: {body.tipo}")

    pdf = gen.html_to_pdf(html)

    # SMTP config from environment or defaults
    import os
    ok = send_report(
        to=body.destinatarios,
        subject=subject,
        pdf_bytes=pdf,
        filename=filename,
        smtp_host=os.getenv("MOLDIT_SMTP_HOST", "localhost"),
        smtp_port=int(os.getenv("MOLDIT_SMTP_PORT", "587")),
        smtp_user=os.getenv("MOLDIT_SMTP_USER", ""),
        smtp_password=os.getenv("MOLDIT_SMTP_PASSWORD", ""),
    )

    if not ok:
        raise HTTPException(500, "Falha ao enviar email.")

    return {"status": "ok", "enviado_para": body.destinatarios}
