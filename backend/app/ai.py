import json
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

from app.board import BoardError, BoardStore
from app.openrouter import OpenRouterClient


class AIError(Exception):
    status_code = 502


class ChatMessage(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=1000)


class AIRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    message: str = Field(min_length=1, max_length=2000)
    history: list[ChatMessage] = Field(default_factory=list, max_length=20)

    @field_validator("message")
    @classmethod
    def nonempty_message(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Message cannot be empty")
        return value.strip()


class RenameColumn(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    type: Literal["rename_column"]
    column_id: str = Field(alias="columnId")
    title: str


class AddCard(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    type: Literal["add_card"]
    column_id: str = Field(alias="columnId")
    title: str
    details: str


class EditCard(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    type: Literal["edit_card"]
    card_id: str = Field(alias="cardId")
    title: str
    details: str


class DeleteCard(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    type: Literal["delete_card"]
    card_id: str = Field(alias="cardId")


class MoveCard(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    type: Literal["move_card"]
    card_id: str = Field(alias="cardId")
    to_column_id: str = Field(alias="toColumnId")
    to_index: int = Field(alias="toIndex", ge=0)


Operation = Annotated[
    RenameColumn | AddCard | EditCard | DeleteCard | MoveCard,
    Field(discriminator="type"),
]


class AIPlan(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    text: str = Field(min_length=1, max_length=2000)
    operations: list[Operation] = Field(max_length=20)


OPERATION_FIELDS = {
    "rename_column": {"columnId": "string", "title": "string"},
    "add_card": {"columnId": "string", "title": "string", "details": "string"},
    "edit_card": {"cardId": "string", "title": "string", "details": "string"},
    "delete_card": {"cardId": "string"},
    "move_card": {"cardId": "string", "toColumnId": "string", "toIndex": "integer"},
}

RESPONSE_SCHEMA = {
    "type": "object",
    "properties": {
        "text": {"type": "string", "description": "A short reply to show the user."},
        "operations": {
            "type": "array",
            "description": "Ordered board changes; use an empty array if no change is needed.",
            "items": {"anyOf": [
                {
                    "type": "object",
                    "properties": {
                        "type": {"type": "string", "const": kind},
                        **{field: {"type": field_type} for field, field_type in fields.items()},
                    },
                    "required": ["type", *fields],
                    "additionalProperties": False,
                }
                for kind, fields in OPERATION_FIELDS.items()
            ]},
        },
    },
    "required": ["text", "operations"],
    "additionalProperties": False,
}

SYSTEM_PROMPT = (
    "You help manage one Kanban board. Return a short user-facing reply and an ordered list "
    "of board operations. Use only existing card and column IDs from the current board. "
    "The five columns are fixed; you may rename them but never create, delete, or reorder them. "
    "Add new cards to the end of a column. A move's toIndex is zero-based after removing "
    "the card from its old position, and may equal the destination's resulting length. "
    "Do not invent card IDs for newly added cards. Use no operations if the user asks only "
    "a question or if the requested change is unclear."
)


def generate_reply(
    username: str, request: AIRequest, boards: BoardStore, openrouter: OpenRouterClient
) -> dict:
    board = boards.get(username)
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        *(item.model_dump() for item in request.history[-10:]),
        {"role": "user", "content": json.dumps({"board": board, "message": request.message})},
    ]
    raw = openrouter.structured(messages, RESPONSE_SCHEMA)
    try:
        plan = AIPlan.model_validate_json(raw)
    except ValidationError as exc:
        raise AIError("AI returned invalid board instructions") from exc
    if not plan.text.strip():
        raise AIError("AI returned an empty reply")

    try:
        updated = boards.apply_operations(
            username, [operation.model_dump(by_alias=True) for operation in plan.operations]
        )
    except BoardError as exc:
        raise AIError("AI proposed invalid board changes; no changes saved") from exc
    return {"text": plan.text.strip(), "board": updated}
