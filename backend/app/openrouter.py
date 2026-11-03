import os

import httpx


OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
MODEL = "openai/gpt-oss-120b"


class OpenRouterError(Exception):
    def __init__(self, message: str, status_code: int = 502) -> None:
        super().__init__(message)
        self.status_code = status_code


class OpenRouterClient:
    def __init__(self, transport: httpx.BaseTransport | None = None) -> None:
        self.transport = transport

    def ask(self, prompt: str) -> str:
        return self._complete({
            "model": MODEL,
            "messages": [{"role": "user", "content": prompt}],
        })

    def structured(self, messages: list[dict[str, str]], schema: dict) -> str:
        return self._complete({
            "model": MODEL,
            "messages": messages,
            "response_format": {
                "type": "json_schema",
                "json_schema": {"name": "board_reply", "strict": True, "schema": schema},
            },
            "provider": {"require_parameters": True},
        })

    def _complete(self, payload: dict) -> str:
        api_key = os.getenv("OPENROUTER_API_KEY", "").strip()
        if not api_key:
            raise OpenRouterError("OPENROUTER_API_KEY is not configured", 503)

        try:
            with httpx.Client(transport=self.transport, timeout=30) as client:
                response = client.post(
                    OPENROUTER_URL,
                    headers={"Authorization": f"Bearer {api_key}"},
                    json=payload,
                )
                response.raise_for_status()
        except httpx.TimeoutException as exc:
            raise OpenRouterError("OpenRouter request timed out", 504) from exc
        except httpx.HTTPStatusError as exc:
            status = exc.response.status_code
            if status == 401:
                raise OpenRouterError("OpenRouter rejected the API key (HTTP 401)") from exc
            raise OpenRouterError(f"OpenRouter request failed (HTTP {status})") from exc
        except httpx.RequestError as exc:
            raise OpenRouterError("Could not reach OpenRouter") from exc

        try:
            answer = response.json()["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError, ValueError) as exc:
            raise OpenRouterError("OpenRouter returned an invalid response") from exc
        if not isinstance(answer, str) or not answer.strip():
            raise OpenRouterError("OpenRouter returned an empty answer")
        return answer.strip()
