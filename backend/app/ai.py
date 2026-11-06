import json
from datetime import date
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

from app.board import PRIORITIES, BoardError, BoardForbidden, BoardStore
from app.openrouter import OpenRouterClient


Priority = Literal["low", "medium", "high"]


class AIError(Exception):
    status_code = 502


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class ChatMessage(StrictModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=1000)


class AIRequest(StrictModel):
    message: str = Field(min_length=1, max_length=2000)
    history: list[ChatMessage] = Field(default_factory=list, max_length=20)

    @field_validator("message")
    @classmethod
    def nonempty_message(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Message cannot be empty")
        return value.strip()


class AddColumn(StrictModel):
    type: Literal["add_column"]
    title: str


class RenameColumn(StrictModel):
    type: Literal["rename_column"]
    column_id: str = Field(alias="columnId")
    title: str


class MoveColumn(StrictModel):
    type: Literal["move_column"]
    column_id: str = Field(alias="columnId")
    to_index: int = Field(alias="toIndex", ge=0)


class AddCard(StrictModel):
    type: Literal["add_card"]
    column_id: str = Field(alias="columnId")
    title: str
    details: str
    priority: Priority
    due_date: str | None = Field(alias="dueDate")
    labels: list[str]
    assignee_id: str | None = Field(alias="assigneeId")


class EditCard(StrictModel):
    type: Literal["edit_card"]
    card_id: str = Field(alias="cardId")
    title: str
    details: str
    priority: Priority
    due_date: str | None = Field(alias="dueDate")
    labels: list[str]
    assignee_id: str | None = Field(alias="assigneeId")


class DeleteCard(StrictModel):
    type: Literal["delete_card"]
    card_id: str = Field(alias="cardId")


class MoveCard(StrictModel):
    type: Literal["move_card"]
    card_id: str = Field(alias="cardId")
    to_column_id: str = Field(alias="toColumnId")
    to_index: int = Field(alias="toIndex", ge=0)


class ArchiveCard(StrictModel):
    type: Literal["archive_card"]
    card_id: str = Field(alias="cardId")


class AddChecklistItem(StrictModel):
    type: Literal["add_checklist_item"]
    card_id: str = Field(alias="cardId")
    text: str


class EditChecklistItem(StrictModel):
    type: Literal["edit_checklist_item"]
    card_id: str = Field(alias="cardId")
    item_id: str = Field(alias="itemId")
    text: str
    done: bool


class DeleteChecklistItem(StrictModel):
    type: Literal["delete_checklist_item"]
    card_id: str = Field(alias="cardId")
    item_id: str = Field(alias="itemId")


Operation = Annotated[
    AddColumn | RenameColumn | MoveColumn | AddCard | EditCard | DeleteCard | MoveCard
    | ArchiveCard | AddChecklistItem | EditChecklistItem | DeleteChecklistItem,
    Field(discriminator="type"),
]


class AIPlan(StrictModel):
    text: str = Field(min_length=1, max_length=2000)
    operations: list[Operation] = Field(max_length=20)


STRING = {"type": "string"}
CARD_FIELDS = {
    "title": STRING,
    "details": STRING,
    "priority": {"type": "string", "enum": list(PRIORITIES)},
    "dueDate": {"type": ["string", "null"], "description": "YYYY-MM-DD or null"},
    "labels": {"type": "array", "items": STRING},
    "assigneeId": {"type": ["string", "null"], "description": "A board member's id or null"},
}
OPERATION_FIELDS = {
    "add_column": {"title": STRING},
    "rename_column": {"columnId": STRING, "title": STRING},
    "move_column": {"columnId": STRING, "toIndex": {"type": "integer"}},
    "add_card": {"columnId": STRING, **CARD_FIELDS},
    "edit_card": {"cardId": STRING, **CARD_FIELDS},
    "delete_card": {"cardId": STRING},
    "move_card": {"cardId": STRING, "toColumnId": STRING, "toIndex": {"type": "integer"}},
    "archive_card": {"cardId": STRING},
    "add_checklist_item": {"cardId": STRING, "text": STRING},
    "edit_checklist_item": {"cardId": STRING, "itemId": STRING, "text": STRING, "done": {"type": "boolean"}},
    "delete_checklist_item": {"cardId": STRING, "itemId": STRING},
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
                    "properties": {"type": {"type": "string", "const": kind}, **fields},
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
    "You help manage one Kanban board in a project management app. Return a short "
    "user-facing reply and an ordered list of board operations. Use only existing card and "
    "column IDs from the current board. You may add, rename, and reorder columns, but never "
    "delete them. New cards and columns are appended to the end. A move's toIndex is "
    "zero-based after removing the item from its old position, and may equal the resulting "
    "length. Titles are at most 200 characters and details at most 2000. Priority is low, "
    "medium, or high. dueDate is YYYY-MM-DD or null. Labels are short tags (at most 10). "
    "assigneeId must be the id of a board member from `members`, or null. "
    "Prefer archive_card over delete_card unless the user asks to delete permanently; "
    "archived cards leave the board but can be restored by the user. "
    "When editing a card, send all of its fields, keeping unchanged values as they are. "
    "Each card has a `checklist` of items {id, text, done}: add items, edit an item's text "
    "or done state (send both), or delete items, using existing item IDs. "
    "Do not invent IDs for items added in the same reply. Today's date is given as `today`. "
    "Use no operations if the user asks only a question or if the request is unclear."
)


def generate_reply(
    user_id: str, board_id: str, request: AIRequest, boards: BoardStore,
    openrouter: OpenRouterClient,
) -> dict:
    board = boards.get(user_id, board_id)
    system = SYSTEM_PROMPT
    if board["role"] == "viewer":
        system += " The user has view-only access: answer questions but return no operations."
    messages = [
        {"role": "system", "content": system},
        *(item.model_dump() for item in request.history[-10:]),
        {"role": "user", "content": json.dumps({
            "today": date.today().isoformat(), "board": board, "message": request.message,
        })},
    ]
    raw = openrouter.structured(messages, RESPONSE_SCHEMA)
    try:
        plan = AIPlan.model_validate_json(raw)
    except ValidationError as exc:
        raise AIError("AI returned invalid board instructions") from exc
    if not plan.text.strip():
        raise AIError("AI returned an empty reply")

    if not plan.operations:
        return {"text": plan.text.strip(), "board": board}
    try:
        updated = boards.apply_operations(
            user_id, board_id,
            [operation.model_dump(by_alias=True) for operation in plan.operations],
            source="ai",
        )
    except BoardForbidden:
        raise
    except BoardError as exc:
        raise AIError("AI proposed invalid board changes; no changes saved") from exc
    return {"text": plan.text.strip(), "board": updated}
