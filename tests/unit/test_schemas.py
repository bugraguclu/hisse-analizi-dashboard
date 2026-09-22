"""Request/response schema validation."""

import uuid
from datetime import datetime, timezone

import pytest
from pydantic import ValidationError

from src.core.enums import NotificationStatus
from src.core.version import get_version
from src.schemas.events import (
    BackfillRequest,
    FinancialStatementOut,
    HealthOut,
    NotificationOut,
    NotificationRuleCreate,
    PollingStateOut,
    PollRunRequest,
    mask_email,
)


def test_notification_rule_is_validated_and_normalized():
    rule = NotificationRuleCreate(company_ticker=" thyao ", email=" ali@example.com ", source_filters=["KAP", "kap", " "])
    assert rule.company_ticker == "THYAO"
    assert rule.email == "ali@example.com"
    assert rule.source_filters == ["kap"]


@pytest.mark.parametrize(
    "email", ["not-an-email", "a@b", "a@example.com\r\nBcc: evil@example.com", "x" * 250 + "@example.com"]
)
def test_invalid_emails_are_rejected(email):
    with pytest.raises(ValidationError):
        NotificationRuleCreate(email=email)


def test_invalid_ticker_and_source_filters_are_rejected():
    with pytest.raises(ValidationError):
        NotificationRuleCreate(email="a@example.com", company_ticker="TH-YAO")
    with pytest.raises(ValidationError):
        NotificationRuleCreate(email="a@example.com", source_filters=["kap; drop table"])


def test_poll_and_backfill_requests_are_bounded():
    assert PollRunRequest(source_code="kap").source_code == "kap"
    with pytest.raises(ValidationError):
        PollRunRequest(source_code="nope")
    with pytest.raises(ValidationError):
        BackfillRequest(days=0)
    with pytest.raises(ValidationError):
        BackfillRequest(days=100_000)


def test_public_notification_output_masks_the_recipient():
    out = NotificationOut(
        id=uuid.uuid4(),
        email="test@example.com",
        provider="dry_run",
        status=NotificationStatus.SENT,
        created_at=datetime.now(timezone.utc),
    )
    assert out.model_dump(mode="json")["email"] == "t***@example.com"
    assert mask_email("broken") == "***"


def test_polling_state_error_is_truncated():
    out = PollingStateOut(id=uuid.uuid4(), source_id=uuid.uuid4(), consecutive_failures=1, last_error="e" * 1000)
    assert len(out.model_dump()["last_error"]) == 300


def test_health_defaults_to_current_version():
    assert HealthOut().version == get_version()


def test_financial_statement_currency_defaults_to_try():
    out = FinancialStatementOut(
        id=uuid.uuid4(), period="2025", statement_type="balance_sheet", currency=None, data_json={},
        fetched_at=datetime.now(timezone.utc),
    )
    assert out.currency == "TRY"
