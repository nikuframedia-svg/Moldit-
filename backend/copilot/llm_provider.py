"""LLM Provider — Spec 10.

Supports OpenAI and Ollama via function calling.
LLM NEVER calculates — only decides which tool to call.
"""

from __future__ import annotations

import json
import logging
import os
from abc import ABC, abstractmethod

from backend.copilot.types import LLMResponse, ToolCall

logger = logging.getLogger(__name__)


class LLMProvider(ABC):
    """Base class for LLM providers."""

    @abstractmethod
    async def chat_with_tools(
        self,
        messages: list[dict],
        tools: list[dict],
        system_prompt: str,
    ) -> LLMResponse:
        """Send messages + tools to LLM, return response."""


class OpenAIProvider(LLMProvider):
    """OpenAI-compatible provider (GPT-4o, etc.)."""

    def __init__(self) -> None:
        import openai

        api_key = os.environ.get("MOLDIT_OPENAI_API_KEY", "")
        self.model = os.environ.get("MOLDIT_OPENAI_MODEL", "gpt-4o")
        self.client = openai.OpenAI(api_key=api_key)

    async def chat_with_tools(
        self,
        messages: list[dict],
        tools: list[dict],
        system_prompt: str,
    ) -> LLMResponse:
        full_messages = [{"role": "system", "content": system_prompt}] + messages

        response = self.client.chat.completions.create(
            model=self.model,
            messages=full_messages,
            tools=tools,
            tool_choice="auto",
        )

        choice = response.choices[0]
        message = choice.message

        tool_calls = None
        if message.tool_calls:
            tool_calls = [
                ToolCall(
                    id=tc.id,
                    name=tc.function.name,
                    arguments=tc.function.arguments,
                )
                for tc in message.tool_calls
            ]

        finish = "tool_calls" if tool_calls else "stop"
        return LLMResponse(
            content=message.content,
            tool_calls=tool_calls,
            finish_reason=finish,
        )


class OllamaProvider(LLMProvider):
    """Ollama local provider."""

    def __init__(self) -> None:
        import httpx

        self.base_url = os.environ.get("MOLDIT_OLLAMA_URL", "http://localhost:11434")
        self.model = os.environ.get("MOLDIT_OLLAMA_MODEL", "qwen2.5:14b")
        self.client = httpx.AsyncClient(timeout=60.0)

    async def chat_with_tools(
        self,
        messages: list[dict],
        tools: list[dict],
        system_prompt: str,
    ) -> LLMResponse:
        full_messages = [{"role": "system", "content": system_prompt}] + messages

        # Ollama function calling format
        ollama_tools = []
        for t in tools:
            fn = t.get("function", t)
            ollama_tools.append({
                "type": "function",
                "function": {
                    "name": fn["name"],
                    "description": fn.get("description", ""),
                    "parameters": fn.get("parameters", {}),
                },
            })

        payload = {
            "model": self.model,
            "messages": full_messages,
            "tools": ollama_tools,
            "stream": False,
        }

        resp = await self.client.post(f"{self.base_url}/api/chat", json=payload)
        resp.raise_for_status()
        data = resp.json()

        message = data.get("message", {})
        content = message.get("content")

        tool_calls = None
        raw_calls = message.get("tool_calls", [])
        if raw_calls:
            tool_calls = []
            for i, tc in enumerate(raw_calls):
                fn = tc.get("function", {})
                args = fn.get("arguments", {})
                if isinstance(args, dict):
                    args = json.dumps(args)
                tool_calls.append(ToolCall(
                    id=f"ollama_{i}",
                    name=fn.get("name", ""),
                    arguments=args,
                ))

        finish = "tool_calls" if tool_calls else "stop"
        return LLMResponse(
            content=content,
            tool_calls=tool_calls,
            finish_reason=finish,
        )


class AnthropicProvider(LLMProvider):
    """Anthropic Claude provider with tool use."""

    def __init__(self) -> None:
        import anthropic

        api_key = os.environ.get("MOLDIT_ANTHROPIC_API_KEY", "")
        self.model = os.environ.get(
            "MOLDIT_ANTHROPIC_MODEL", "claude-sonnet-4-20250514",
        )
        self.client = anthropic.Anthropic(api_key=api_key)

    async def chat_with_tools(
        self,
        messages: list[dict],
        tools: list[dict],
        system_prompt: str,
    ) -> LLMResponse:
        # Convert OpenAI tool format to Anthropic format
        anthropic_tools = []
        for t in tools:
            fn = t.get("function", t)
            anthropic_tools.append({
                "name": fn["name"],
                "description": fn.get("description", ""),
                "input_schema": fn.get("parameters", {"type": "object"}),
            })

        # Convert messages: Anthropic doesn't use "system" role in messages
        # and tool_calls/tool results have different format
        converted = []
        for m in messages:
            role = m.get("role", "user")
            if role == "system":
                # Skip system messages — they go in the system param
                continue
            if role == "tool":
                # Anthropic: tool results are user messages with tool_result
                converted.append({
                    "role": "user",
                    "content": [{
                        "type": "tool_result",
                        "tool_use_id": m.get("tool_call_id", ""),
                        "content": m.get("content", ""),
                    }],
                })
                continue
            if role == "assistant" and m.get("tool_calls"):
                # Anthropic: tool calls are content blocks
                content_blocks = []
                if m.get("content"):
                    content_blocks.append({
                        "type": "text",
                        "text": m["content"],
                    })
                for tc in m["tool_calls"]:
                    fn = tc.get("function", {})
                    args = fn.get("arguments", "{}")
                    if isinstance(args, str):
                        try:
                            args = json.loads(args)
                        except json.JSONDecodeError:
                            args = {}
                    content_blocks.append({
                        "type": "tool_use",
                        "id": tc.get("id", ""),
                        "name": fn.get("name", ""),
                        "input": args,
                    })
                converted.append({
                    "role": "assistant",
                    "content": content_blocks,
                })
                continue
            # Regular user/assistant message
            converted.append({
                "role": role,
                "content": m.get("content", ""),
            })

        try:
            response = self.client.messages.create(
                model=self.model,
                max_tokens=4096,
                system=system_prompt,
                messages=converted,
                tools=anthropic_tools,
            )
        except Exception as e:
            logger.error("Anthropic API error: %s", e)
            return LLMResponse(
                content=f"Erro na API: {e}",
                tool_calls=None,
                finish_reason="stop",
            )

        # Parse response
        content_text = ""
        tool_calls = []
        for block in response.content:
            if block.type == "text":
                content_text += block.text
            elif block.type == "tool_use":
                tool_calls.append(ToolCall(
                    id=block.id,
                    name=block.name,
                    arguments=json.dumps(block.input),
                ))

        finish = (
            "tool_calls" if tool_calls
            else "stop"
        )
        return LLMResponse(
            content=content_text or None,
            tool_calls=tool_calls or None,
            finish_reason=finish,
        )


def get_provider() -> LLMProvider:
    """Factory: select provider via MOLDIT_LLM_BACKEND env var."""
    backend = os.environ.get("MOLDIT_LLM_BACKEND", "openai").lower()
    if backend == "ollama":
        return OllamaProvider()
    if backend == "anthropic":
        return AnthropicProvider()
    return OpenAIProvider()
