from kubedeck_backend.core.models import LlmAnalyzeResourceRequest
from kubedeck_backend.llm.context import REDACTED, TRUNCATED_MARKER, build_resource_context, sanitize, sanitize_text


def test_sanitize_redacts_secret_data_and_sensitive_keys():
    payload = {
        "kind": "Secret",
        "metadata": {"name": "db", "annotations": {"token": "abc"}},
        "data": {"password": "c2VjcmV0"},
        "stringData": {"apiKey": "secret"},
    }

    result = sanitize(payload)

    assert result["data"] == REDACTED
    assert result["stringData"] == REDACTED
    assert result["metadata"]["annotations"]["token"] == REDACTED


def test_sanitize_text_redacts_auth_password_and_private_key():
    text = "Authorization: Bearer abc123\npassword=secret\n-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----"

    result = sanitize_text(text)

    assert "abc123" not in result
    assert "secret" not in result
    assert "BEGIN PRIVATE KEY" not in result
    assert REDACTED in result


def test_build_resource_context_truncates_and_marks_context():
    request = LlmAnalyzeResourceRequest(
        clusterId="cluster-a",
        resource="pods",
        kind="Pod",
        namespace="default",
        name="pod-a",
        yaml="apiVersion: v1\nkind: Pod\n" + ("x" * 500),
    )

    context, context_chars, truncated = build_resource_context(request, 240)

    assert truncated is True
    assert context.endswith(TRUNCATED_MARKER)
    assert context_chars == len(context)
