from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class Contract(BaseModel):
    model_config = ConfigDict(extra="forbid")


class SourceCreate(Contract):
    id: str | None = Field(default=None, max_length=120)
    title: str = Field(min_length=1, max_length=240)
    content: str = Field(min_length=1, max_length=50000)
    authority: Literal["reviewed", "authoritative"] = "reviewed"


class MemoryCreate(Contract):
    id: str | None = Field(default=None, max_length=120)
    kind: Literal["semantic", "plan", "procedural"] = "semantic"
    subject: str = Field(min_length=1, max_length=200)
    predicate: str = Field(min_length=1, max_length=100)
    value: Any
    inputs: list[str] = Field(min_length=1, max_length=24)
    verified_receipt_id: str | None = None
    applicability: dict = Field(default_factory=dict)
    valid_until: float | None = None


class SupportCreate(Contract):
    inputs: list[str] = Field(min_length=1, max_length=24)


class Revoke(Contract):
    reason: str = Field(min_length=1, max_length=2000)
    idempotency_key: str = Field(min_length=1, max_length=120)


class TaskCreate(Contract):
    id: str | None = Field(default=None, max_length=120)
    supplier_id: str = Field(min_length=1, max_length=200)
    invoice_id: str = Field(min_length=1, max_length=200)
    goal: str = Field(default="Prepare and execute the approved simulated invoice payment.", max_length=2000)
    constraints: list[str] = Field(default_factory=list, max_length=24)


class RunStart(Contract):
    role: Literal["planner", "executor"]
    mode: Literal["live", "scripted"] = "live"


class ToolCall(Contract):
    name: str
    arguments: dict = Field(default_factory=dict)


class PaymentPayload(Contract):
    supplier_id: str = Field(min_length=1, max_length=200)
    invoice_id: str = Field(min_length=1, max_length=200)
    amount_minor: int = Field(gt=0, le=10000000, strict=True)
    currency: str = Field(pattern=r"^[A-Z]{3}$")
    routing_token: str = Field(pattern=r"^BANK-DEMO-[A-Z0-9_-]{1,80}$")


class InvoiceFacts(Contract):
    supplier_id: str = Field(min_length=1, max_length=200)
    amount_minor: int = Field(gt=0, le=10000000, strict=True)
    currency: str = Field(pattern=r"^[A-Z]{3}$")


class ActionCreate(Contract):
    run_id: str
    payload: PaymentPayload
    idempotency_key: str = Field(min_length=1, max_length=120)


class Correction(Contract):
    source: SourceCreate
    memory: MemoryCreate
    supersedes_id: str | None = None


class DemoSeed(Contract):
    reset: bool = False
    confirm: Literal["reset-this-demo-tenant"] | None = None


class DomainError(Exception):
    def __init__(self, code: str, message: str, status: int = 409, **details):
        self.code, self.message, self.status, self.details = code, message, status, details
        super().__init__(message)

