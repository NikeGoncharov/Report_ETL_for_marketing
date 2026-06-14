"""Admin CLI: список пользователей и установка пароля.

Запускать из каталога backend интерпретатором из venv, например:
    /home/user/venv/bin/python manage.py list-users
    /home/user/venv/bin/python manage.py set-password me@example.com 'НовыйПароль'

set-password создаёт пользователя, если его ещё нет, и обходит
ALLOWED_REGISTRATION_EMAILS (это администраторская операция). Использует
ту же БД и тот же алгоритм хэширования, что и приложение.
"""
import sys

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.config import DATABASE_URL_SYNC
from app.models import User
from app.auth import get_password_hash


def _engine():
    return create_engine(DATABASE_URL_SYNC)


def list_users() -> None:
    with Session(_engine()) as session:
        users = session.execute(select(User).order_by(User.id)).scalars().all()
        if not users:
            print("Пользователей нет.")
            return
        for u in users:
            print(f"  id={u.id}  {u.email}  (создан {u.created_at})")
        print(f"Всего: {len(users)}")


def set_password(email: str, password: str) -> None:
    email = email.strip().lower()
    with Session(_engine()) as session:
        user = session.execute(
            select(User).where(User.email == email)
        ).scalar_one_or_none()

        if user is None:
            user = User(email=email, password_hash=get_password_hash(password))
            session.add(user)
            session.commit()
            print(f"Создан пользователь {email} (id={user.id}), пароль установлен.")
        else:
            user.password_hash = get_password_hash(password)
            session.commit()
            print(f"Пароль пользователя {email} (id={user.id}) обновлён.")


def main() -> None:
    args = sys.argv[1:]
    if not args:
        print(__doc__)
        sys.exit(1)

    command = args[0]
    if command == "list-users":
        list_users()
    elif command == "set-password":
        if len(args) != 3:
            print("Использование: manage.py set-password <email> <пароль>")
            sys.exit(1)
        set_password(args[1], args[2])
    else:
        print(f"Неизвестная команда: {command}")
        print(__doc__)
        sys.exit(1)


if __name__ == "__main__":
    main()
