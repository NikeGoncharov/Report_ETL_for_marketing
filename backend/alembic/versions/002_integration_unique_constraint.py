"""Add unique constraint on integrations(project_id, type)

Одна интеграция каждого типа на проект. Устраняет дубли, из-за которых
scalar_one_or_none падал с MultipleResultsFound (HTTP 500).

Revision ID: 002
Revises: 001
Create Date: 2026-07-07

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = '002'
down_revision: Union[str, None] = '001'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Дедуп на случай уже существующих дублей: оставляем самую свежую строку
    # (max id) каждой пары (project_id, type), иначе unique-констрейнт не создастся.
    op.execute(
        """
        DELETE FROM integrations
        WHERE id NOT IN (
            SELECT MAX(id) FROM integrations GROUP BY project_id, type
        )
        """
    )
    # SQLite не умеет ADD CONSTRAINT на месте — batch пересоздаёт таблицу.
    with op.batch_alter_table("integrations") as batch_op:
        batch_op.create_unique_constraint(
            "uq_integration_project_type", ["project_id", "type"]
        )


def downgrade() -> None:
    with op.batch_alter_table("integrations") as batch_op:
        batch_op.drop_constraint("uq_integration_project_type", type_="unique")
