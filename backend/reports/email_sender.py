"""Email sender for reports — Moldit Planner (Module B).

Sends PDF reports as email attachments via SMTP.
"""

from __future__ import annotations

import logging
import smtplib
from email.message import EmailMessage

logger = logging.getLogger(__name__)


def send_report(
    to: list[str],
    subject: str,
    pdf_bytes: bytes,
    filename: str = "relatorio.pdf",
    body_text: str = "",
    smtp_host: str = "localhost",
    smtp_port: int = 587,
    smtp_user: str = "",
    smtp_password: str = "",
    from_addr: str = "moldit@moldit.pt",
    use_tls: bool = True,
) -> bool:
    """Send a PDF report via email.

    Returns True on success, False on failure.
    """
    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = from_addr
    msg["To"] = ", ".join(to)
    msg.set_content(body_text or f"Segue em anexo: {subject}")
    msg.add_attachment(
        pdf_bytes,
        maintype="application",
        subtype="pdf",
        filename=filename,
    )

    try:
        with smtplib.SMTP(smtp_host, smtp_port, timeout=30) as server:
            if use_tls:
                server.starttls()
            if smtp_user:
                server.login(smtp_user, smtp_password)
            server.send_message(msg)
        logger.info("Report sent to %s: %s", to, subject)
        return True
    except Exception:
        logger.exception("Failed to send report to %s", to)
        return False
