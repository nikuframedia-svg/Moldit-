"""Copilot FastAPI endpoint.

POST /api/copilot/chat  — LLM chat with function calling
POST /api/copilot/load  — Load project plan and initialize state
"""

from __future__ import annotations

import json
import logging

from dotenv import load_dotenv

load_dotenv()

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from backend.copilot.engine import execute_tool
from backend.copilot.llm_provider import get_provider
from backend.copilot.prompts import build_system_prompt
from backend.copilot.state import state
from backend.copilot.tools import TOOLS

logger = logging.getLogger(__name__)

from backend.api.console import router as console_router
from backend.api.data import router as data_router
from backend.api.explorer import router as explorer_router

app = FastAPI(title="Moldit Copilot", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(console_router)
app.include_router(data_router)
app.include_router(explorer_router)


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    messages: list[ChatMessage]


class LoadRequest(BaseModel):
    project_path: str
    config_path: str = "config/factory.yaml"


@app.post("/api/copilot/chat")
async def copilot_chat(request: ChatRequest):
    """Chat with the copilot. LLM decides which tools to call."""
    provider = get_provider()
    system_prompt = build_system_prompt(state)
    messages = [{"role": m.role, "content": m.content} for m in request.messages]
    widgets = []
    tools_used = 0

    for iteration in range(5):  # max 5 tool-call rounds
        response = await provider.chat_with_tools(messages, TOOLS, system_prompt)

        if response.tool_calls:
            # Append assistant message with tool calls
            messages.append({
                "role": "assistant",
                "content": response.content or "",
                "tool_calls": [
                    {
                        "id": tc.id,
                        "type": "function",
                        "function": {"name": tc.name, "arguments": tc.arguments},
                    }
                    for tc in response.tool_calls
                ],
            })

            for tc in response.tool_calls:
                result_json, is_widget = execute_tool(tc.name, tc.arguments)
                tools_used += 1

                if is_widget:
                    try:
                        parsed = json.loads(result_json)
                        if "error" not in parsed:
                            widgets.append({"type": "dynamic_viz", "data": parsed})
                    except json.JSONDecodeError:
                        pass

                # Append tool result for next LLM turn
                messages.append({
                    "role": "tool",
                    "tool_call_id": tc.id,
                    "content": result_json,
                })

            continue

        # No tool calls — final response
        return {
            "response": response.content or "",
            "widgets": widgets,
            "tools_used": tools_used,
        }

    return {
        "response": "Limite de iterações atingido.",
        "widgets": widgets,
        "tools_used": tools_used,
    }


@app.post("/api/copilot/load")
async def load_project(request: LoadRequest):
    """Load a project plan file and initialize the copilot state."""
    raise NotImplementedError("Moldit project loading — Phase 2")


@app.get("/api/copilot/health")
async def health():
    """Health check."""
    has_data = state.engine_data is not None
    return {
        "status": "ok",
        "has_data": has_data,
        "n_segments": len(state.segments),
    }
