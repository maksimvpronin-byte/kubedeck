from __future__ import annotations


SYSTEM_PROMPT = (
    "You are a Kubernetes/SRE diagnostic assistant inside KubeDeck. "
    "Analyze only the provided Kubernetes context. Do not invent facts. "
    "Separate observed facts from hypotheses. Explain clearly and practically. "
    "Prioritize actionable checks. Mention dangerous actions clearly. "
    "Never ask for credentials. Never output secrets. "
    "If context is insufficient, say what is missing. "
    "Answer in current UI language if provided, otherwise Russian by default."
)

DEFAULT_USER_REQUEST = (
    "Analyze this Kubernetes resource and explain possible problems, causes, "
    "and next checks in human-readable language."
)


def build_user_prompt(context: str, user_request: str | None) -> str:
    request = (user_request or "").strip() or DEFAULT_USER_REQUEST
    return f"{context}\n\nUSER REQUEST\n{request}"
