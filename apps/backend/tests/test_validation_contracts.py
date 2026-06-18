import pytest
from fastapi import HTTPException

from kubedeck_backend.api.validation import validate_identifier


@pytest.mark.parametrize("value", ["pod-1", "svc.default", "apps:v1"])
def test_validate_identifier_accepts_supported_values(value):
    assert validate_identifier(value, "name") == value


def test_validate_identifier_trims_whitespace():
    assert validate_identifier("  pod-1  ", "name") == "pod-1"


@pytest.mark.parametrize("value", ["", "   "])
def test_validate_identifier_rejects_empty_values(value):
    with pytest.raises(HTTPException) as exc:
        validate_identifier(value, "name")

    assert exc.value.status_code == 400
    assert exc.value.detail["code"] == "INVALID_IDENTIFIER"
    assert "must not be empty" in exc.value.detail["message"]


@pytest.mark.parametrize("value", ["pods/nginx", r"pods\nginx", "pods\x00nginx"])
def test_validate_identifier_rejects_path_separators_and_null_byte(value):
    with pytest.raises(HTTPException) as exc:
        validate_identifier(value, "name")

    assert exc.value.status_code == 400
    assert exc.value.detail["code"] == "INVALID_IDENTIFIER"
    assert "invalid path separator" in exc.value.detail["message"]


def test_validate_identifier_rejects_unsupported_characters():
    with pytest.raises(HTTPException) as exc:
        validate_identifier("pod$name", "name")

    assert exc.value.status_code == 400
    assert exc.value.detail["code"] == "INVALID_IDENTIFIER"
    assert "unsupported characters" in exc.value.detail["message"]


def test_validate_identifier_enforces_max_length():
    assert validate_identifier("abc", "name", max_length=3) == "abc"

    with pytest.raises(HTTPException) as exc:
        validate_identifier("abcd", "name", max_length=3)

    assert exc.value.status_code == 400
    assert exc.value.detail["code"] == "INVALID_IDENTIFIER"
    assert "too long" in exc.value.detail["message"]
