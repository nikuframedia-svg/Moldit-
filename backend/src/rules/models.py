"""Rule, Condition, Action Pydantic models for the PP1 rules engine."""

from pydantic import BaseModel


class Condition(BaseModel):
    """A condition to evaluate against scheduling context."""

    type: str  # ID from catalogue
    params: dict = {}


class Action(BaseModel):
    """An action to apply when a rule's condition is met."""

    type: str  # ID from catalogue
    params: dict = {}


class Rule(BaseModel):
    """A scheduling rule: IF condition THEN action."""

    id: str
    name: str  # e.g., "Nao produzir com cobertura alta"
    description: str  # Free text in PT
    condition: Condition
    action: Action
    active: bool = True
    priority: int = 0  # evaluation order (lower = first)
    created_by: str = "system"  # "system", "user", "copilot", or person name
