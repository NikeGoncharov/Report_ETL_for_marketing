#!/usr/bin/env python3
"""Резервное копирование SQLite-базы Report: снятие, проверка, восстановление.

Почему не `cp data.db backup.db` (именно так делал крон в deploy/setup.sh):
база работает в режиме WAL, и часть зафиксированных транзакций лежит в отдельном
файле `data.db-wal`. Копия одного только `data.db` молча теряет их, а копия,
снятая посреди чекпоинта, может оказаться битой. Здесь используется онлайн-бэкап
SQLite (sqlite3.Connection.backup) — согласованный снимок прямо на работающей
базе, без остановки сервиса.

Проверки делятся на ЖЁСТКИЕ и МЯГКИЕ, и это различие принципиально. Жёсткая
(файл не открывается, integrity_check, нет таблиц, ноль пользователей) означает
«копия негодна» — файл удаляется. Мягкая (нарушенные внешние ключи в ИСХОДНОЙ
базе, отставание маркеров) означает «с копией что-то не так, но она есть» —
файл остаётся, а команда сообщает о проблеме. Иначе дефект качества данных в
проде каждую ночь удалял бы исправную копию и оставлял систему вовсе без
бэкапов — лечение хуже болезни.

Зависимостей нет, только стандартная библиотека: скрипт запускается системным
python3 на хосте — вне venv приложения и вне контейнера, чтобы бэкап не зависел
от того, поднят ли сейчас сервис. Тест test_backup.py::TestNoDependencies
следит за тем, чтобы это свойство не потерялось.

Команды:
    backup   — снять копию, проверить, удалить устаревшие
    check    — проверить свежесть и целостность копий
    restore  — восстановить базу из копии (сервис должен быть остановлен)
"""
import argparse
import json
import os
import re
import shutil
import sqlite3
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

# Таблицы, без которых копия бессмысленна. Список сверяется с моделями в тесте
# test_backup.py::test_core_tables_match_models — если таблицу добавят или
# переименуют, упадёт тест, а не ночной бэкап.
CORE_TABLES = ("users", "projects", "integrations", "reports", "report_runs")

# Копией считается только файл этого вида. Простого glob "data-*.db" мало:
# положенный рядом руками data-before-migration.db сортируется ВЫШЕ любой даты
# (буква больше цифры) и навсегда становился бы «свежайшей копией» — а именно её
# восстанавливает документированная команда `restore --yes` без --backup.
BACKUP_RE = re.compile(r"^data-(\d{8}-\d{6})Z\.db$")
NAME_FORMAT = "%Y%m%d-%H%M%S"
TMP_SUFFIX = ".db.tmp"
STATUS_NAME = "status.json"
LOCK_NAME = ".backup.lock"
BUSY_TIMEOUT_S = 30.0

DEFAULT_KEEP_DAYS = 30
DEFAULT_KEEP_MIN = 7
DEFAULT_MAX_AGE_HOURS = 48


class BackupError(RuntimeError):
    """Копия негодна или операция не выполнена."""


# --------------------------------------------------------------------------
# Соединения
# --------------------------------------------------------------------------

def _connect(path: Path) -> sqlite3.Connection:
    """Соединение с базой на запись.

    Читать источник через `mode=ro` нельзя: база в режиме WAL, а read-only
    соединению нужен файл -shm, который оно не может создать, — при
    остановленном сервисе открытие упало бы. Мы просто ничего не пишем.
    """
    return sqlite3.connect(str(path), timeout=BUSY_TIMEOUT_S)


def _connect_ro(path: Path) -> sqlite3.Connection:
    """Соединение только на чтение — для проверки готовой копии.

    Копия переводится в journal_mode=DELETE, поэтому -shm ей не нужен и режим
    ro работает. Так проверка физически не может испортить артефакт.
    """
    return sqlite3.connect(f"{path.resolve().as_uri()}?mode=ro", uri=True, timeout=BUSY_TIMEOUT_S)


def _max_ids(conn: sqlite3.Connection) -> dict:
    """Максимальный id по каждой таблице — маркер «докуда доехала копия»."""
    # Имена таблиц берутся из константы модуля, не из ввода.
    return {t: conn.execute(f"SELECT COALESCE(MAX(id), 0) FROM {t}").fetchone()[0] for t in CORE_TABLES}


def _counts(conn: sqlite3.Connection) -> dict:
    return {t: conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0] for t in CORE_TABLES}


# --------------------------------------------------------------------------
# Файлы копий
# --------------------------------------------------------------------------

def backup_files(dest_dir: Path) -> list:
    """Настоящие копии, от старой к новой: [(путь, момент снятия)].

    Момент берётся ИЗ ИМЕНИ, а не из mtime: mtime переписывает любое
    копирование каталога (rsync без -t, распаковка архива, docker cp), и
    свежесть по нему врёт в обе стороны.
    """
    if not dest_dir.exists():
        return []
    found = []
    for path in dest_dir.iterdir():
        match = BACKUP_RE.match(path.name)
        if not match or not path.is_file():
            continue
        taken_at = datetime.strptime(match.group(1), NAME_FORMAT).replace(tzinfo=timezone.utc)
        found.append((path, taken_at))
    found.sort(key=lambda pair: pair[1])
    return found


def foreign_files(dest_dir: Path) -> list:
    """Посторонние файлы в каталоге копий — о них стоит сказать вслух."""
    if not dest_dir.exists():
        return []
    skip = {STATUS_NAME, LOCK_NAME}
    return sorted(
        p.name
        for p in dest_dir.iterdir()
        if p.is_file() and p.name not in skip and not BACKUP_RE.match(p.name) and not p.name.endswith(TMP_SUFFIX)
    )


def latest_backup(dest_dir: Path):
    files = backup_files(dest_dir)
    return files[-1][0] if files else None


def _age_hours(taken_at: datetime) -> float:
    return (datetime.now(timezone.utc) - taken_at).total_seconds() / 3600


# --------------------------------------------------------------------------
# Проверка
# --------------------------------------------------------------------------

def verify_backup(path: Path, min_ids: dict = None):
    """Проверить копию. Возвращает (счётчики строк, список предупреждений).

    Бросает BackupError только на жёстких дефектах — тех, при которых
    восстанавливать из файла нечего.
    """
    if not path.exists():
        raise BackupError(f"{path}: файла нет")
    if path.stat().st_size == 0:
        raise BackupError(f"{path}: файл пуст")

    warnings = []
    try:
        conn = _connect_ro(path)
    except sqlite3.Error as e:
        raise BackupError(f"{path}: не открывается как база SQLite ({e})") from e

    try:
        try:
            result = conn.execute("PRAGMA integrity_check").fetchall()
        except sqlite3.DatabaseError as e:
            raise BackupError(f"{path}: файл повреждён ({e})") from e
        if result != [("ok",)]:
            raise BackupError(f"{path}: integrity_check вернул {result[:5]}")

        tables = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
        missing = [t for t in CORE_TABLES if t not in tables]
        if missing:
            raise BackupError(f"{path}: в копии нет таблиц: {', '.join(missing)}")

        counts = _counts(conn)
        if counts["users"] < 1:
            raise BackupError(f"{path}: в копии ноль пользователей — это не рабочая база")

        # Мягко: это качество данных В ИСХОДНОЙ базе, а не дефект копии. Копия
        # побайтово верна и полностью восстановима. Жёсткий отказ здесь означал
        # бы, что одна осиротевшая строка в проде (её легко оставляет alembic и
        # manage.py — PRAGMA foreign_keys настраивается для каждого соединения)
        # каждую ночь удаляет исправную копию, и бэкапов нет вообще.
        broken_fk = conn.execute("PRAGMA foreign_key_check").fetchall()
        if broken_fk:
            warnings.append(
                f"в исходной базе {len(broken_fk)} нарушений внешних ключей "
                f"(например {broken_fk[:3]}) — копия снята, но данные стоит починить"
            )

        # Мягко: маркер не строгий. id — это rowid без AUTOINCREMENT, поэтому
        # после удаления максимальной строки SQLite отдаёт тот же id следующей
        # вставке, и «отставание» бывает мнимым. Терять из-за этого копию нельзя,
        # но и молчать нельзя — потеря хвоста WAL выглядит точно так же.
        if min_ids is not None:
            ids = _max_ids(conn)
            stale = {t: f"{ids[t]} < {min_ids[t]}" for t in min_ids if ids[t] < min_ids[t]}
            if stale:
                warnings.append(
                    f"маркеры копии отстают от источника ({stale}) — либо во время снятия "
                    "удаляли строки, либо потерян хвост WAL; копию стоит проверить вручную"
                )
        return counts, warnings
    finally:
        conn.close()


# --------------------------------------------------------------------------
# Снятие копии
# --------------------------------------------------------------------------

def create_backup(db_path: Path, dest_dir: Path, keep_days: int = DEFAULT_KEEP_DAYS,
                  keep_min: int = DEFAULT_KEEP_MIN):
    """Снять проверенную копию. Возвращает (файл, счётчики, предупреждения, удалённые)."""
    if not db_path.exists():
        raise BackupError(f"{db_path}: базы нет — нечего копировать")

    dest_dir.mkdir(parents=True, exist_ok=True)
    _chmod(dest_dir, 0o700)  # в базе лежат OAuth-токены и хэши паролей

    warnings = []

    # Недоделанные копии от убитого процесса: под retention они не попадают,
    # так что без уборки каталог растёт вечно.
    for stale in dest_dir.glob(f"data-*{TMP_SUFFIX}"):
        try:
            if time.time() - stale.stat().st_mtime > 3600:
                stale.unlink()
        except OSError as e:
            warnings.append(f"не удалось убрать обрывок {stale.name}: {e}")

    stamp = datetime.now(timezone.utc).strftime(NAME_FORMAT)
    final = dest_dir / f"data-{stamp}Z.db"
    tmp = dest_dir / f"data-{stamp}{TMP_SUFFIX}"
    tmp.unlink(missing_ok=True)

    src = _connect(db_path)
    try:
        try:
            before = _max_ids(src)
        except sqlite3.OperationalError as e:
            raise BackupError(f"{db_path}: не читается схема приложения ({e})") from e

        dst = sqlite3.connect(str(tmp))
        try:
            src.backup(dst)
            # Копия должна быть самодостаточной: в режиме DELETE рядом с ней не
            # появятся -wal/-shm, и восстановление сводится к подмене файла.
            dst.execute("PRAGMA journal_mode = DELETE")
            dst.commit()
        finally:
            dst.close()

        after = _max_ids(src)
    finally:
        src.close()

    _chmod(tmp, 0o600)
    _fsync_file(tmp)

    floor = {t: min(before[t], after[t]) for t in before}

    try:
        counts, verify_warnings = verify_backup(tmp, floor)
    except BackupError:
        tmp.unlink(missing_ok=True)  # негодный файл не должен выглядеть бэкапом
        raise
    warnings.extend(verify_warnings)

    os.replace(tmp, final)
    _fsync_dir(dest_dir)

    warnings.extend(_compare_with_previous(dest_dir, counts))

    removed, prune_warnings = prune(dest_dir, keep_days=keep_days, keep_min=keep_min)
    warnings.extend(prune_warnings)

    strays = foreign_files(dest_dir)
    if strays:
        warnings.append(
            f"в каталоге копий посторонние файлы ({', '.join(strays[:5])}) — "
            "они не считаются копиями и не ротируются"
        )
    return final, counts, warnings, removed


def _compare_with_previous(dest_dir: Path, counts: dict) -> list:
    """Табличка опустела по сравнению с прошлым разом — повод сказать вслух.

    Единственная защита от «копируем не тот файл»: если bind-mount или
    DATABASE_URL разъедутся, приложение начнёт писать в другую базу, а здесь
    будет сниматься исправная, но чужая и пустая.
    """
    status_path = dest_dir / STATUS_NAME
    if not status_path.exists():
        return []
    try:
        previous = json.loads(status_path.read_text(encoding="utf-8")).get("counts") or {}
    except (ValueError, OSError):
        return []

    emptied = [t for t, n in counts.items() if n == 0 and previous.get(t, 0) > 0]
    if emptied:
        return [
            f"таблицы опустели по сравнению с прошлой копией: "
            + ", ".join(f"{t} ({previous[t]} -> 0)" for t in emptied)
        ]
    return []


def prune(dest_dir: Path, keep_days: int = DEFAULT_KEEP_DAYS, keep_min: int = DEFAULT_KEEP_MIN):
    """Удалить копии старше keep_days, всегда оставив keep_min свежайших.

    Голое `find -mtime +30 -delete` (как в старом кроне) при простое сервиса
    дольше месяца вычищает каталог до нуля — ровно тогда, когда бэкап нужен.

    Возвращает (удалённые имена, предупреждения). Ошибка на отдельном файле не
    прерывает уборку и не отменяет уже снятую копию: prune вызывается ПОСЛЕ
    os.replace, и исключение отсюда пометило бы успешный бэкап как провал.
    """
    files = [path for path, _ in backup_files(dest_dir)]  # от старых к новым
    protected = set(files[-keep_min:]) if keep_min > 0 else set()
    cutoff = time.time() - keep_days * 86400

    removed, warnings = [], []
    for path in files:
        if path in protected:
            continue
        try:
            if path.stat().st_mtime < cutoff:
                path.unlink()
                removed.append(path.name)
        except OSError as e:
            warnings.append(f"не удалось удалить {path.name}: {e}")
    return removed, warnings


# --------------------------------------------------------------------------
# Сторож
# --------------------------------------------------------------------------

def check_backups(dest_dir: Path, max_age_hours: int = DEFAULT_MAX_AGE_HOURS, deep: bool = True):
    """Свежая копия есть, читается, и остальная глубина хранения тоже цела."""
    if not dest_dir.exists():
        raise BackupError(f"{dest_dir}: каталога бэкапов нет")

    files = backup_files(dest_dir)
    if not files:
        strays = foreign_files(dest_dir)
        hint = f" (посторонние файлы не считаются копиями: {', '.join(strays[:5])})" if strays else ""
        raise BackupError(f"{dest_dir}: ни одной копии{hint}")

    newest, taken_at = files[-1]
    age_hours = _age_hours(taken_at)
    if age_hours > max_age_hours:
        raise BackupError(
            f"{newest.name}: последней копии {age_hours:.1f} ч, допустимо {max_age_hours} ч — бэкап не отработал"
        )

    counts, warnings = verify_backup(newest)

    checked = 1
    if deep:
        # Копии на том же единственном SSD, ext4 без контрольных сумм данных и
        # без скраббинга. Если проверять только свежайшую, глубина хранения по
        # факту равна суткам: порча старых вскроется в момент восстановления.
        broken = []
        for path, _ in files[:-1]:
            try:
                verify_backup(path)
                checked += 1
            except BackupError as e:
                broken.append(str(e))
        if broken:
            raise BackupError(f"повреждены копии в глубине хранения: {'; '.join(broken[:3])}")

    strays = foreign_files(dest_dir)
    if strays:
        warnings.append(f"посторонние файлы в каталоге копий: {', '.join(strays[:5])}")
    return newest, age_hours, counts, warnings, checked


# --------------------------------------------------------------------------
# Восстановление
# --------------------------------------------------------------------------

# Спутники базы, которые обязаны уехать вместе с ней. "-journal" здесь не для
# симметрии: восстановленный файл ложится в режиме DELETE (копия переведена в
# него), а первым к нему обращается `alembic upgrade head` из entrypoint —
# alembic строит СВОЙ движок и PRAGMA journal_mode=WAL не выполняет. То есть
# сразу после restore возможен ровно data.db-journal, и именно он, оставшись
# рядом, накатывается SQLite на свежий файл и превращает его в мусор.
DB_COMPANIONS = ("", "-wal", "-shm", "-journal")


def restore(backup_path: Path, db_path: Path, force: bool = False):
    """Положить копию на место рабочей базы.

    Возвращает путь к отодвинутому оригиналу или None, если базы не было.
    """
    verify_backup(backup_path)  # негодный файл не восстанавливаем

    shm = Path(f"{db_path}-shm")
    if shm.exists() and not force:
        raise BackupError(
            f"{shm.name} на месте — похоже, база открыта приложением. Остановите сервис:\n"
            "    cd ~/report && docker compose stop report-backend\n"
            "Если сервис уже не запущен (сервер аварийно выключался, контейнер убит по SIGKILL),\n"
            "файл остался от прошлого запуска — убедитесь через `docker compose ps`, что\n"
            "report-backend не Up, и повторите команду с --force."
        )

    previous_owner = _owner_of(db_path)
    stamp = datetime.now(timezone.utc).strftime(NAME_FORMAT) + "Z"

    # Сначала полностью готовим новый файл и только потом трогаем боевой. Обрыв
    # копирования (кончилось место — самая обычная причина в разгар
    # восстановления) не должен оставлять систему без обоих сразу.
    incoming = Path(f"{db_path}.incoming-{stamp}")
    try:
        shutil.copy2(backup_path, incoming)
        _fsync_file(incoming)
        verify_backup(incoming)  # проверяем то, что реально записалось
    except (OSError, BackupError):
        incoming.unlink(missing_ok=True)
        raise

    moved = None
    undo = []
    try:
        for suffix in DB_COMPANIONS:
            path = Path(f"{db_path}{suffix}")
            if not path.exists():
                continue
            target = _free_name(Path(f"{db_path}.replaced-{stamp}{suffix}"))
            path.rename(target)
            undo.append((target, path))
            _chmod(target, 0o600)  # полный слепок токенов не должен лежать мирочитаемым
            if suffix == "":
                moved = target
        os.replace(incoming, db_path)
    except OSError:
        # Вернуть всё как было: половина отодвинутых спутников без базы — это
        # состояние, из которого оператор в разгар аварии уже не выберется.
        for target, original in reversed(undo):
            try:
                if not original.exists():
                    target.rename(original)
            except OSError:
                pass
        incoming.unlink(missing_ok=True)
        raise
    _fsync_dir(db_path.parent)

    # Вернуть базу в WAL — режим, в котором её ждёт приложение. Заодно это
    # закрывает окно, в котором рядом мог бы появиться data.db-journal.
    conn = _connect(db_path)
    try:
        conn.execute("PRAGMA journal_mode = WAL")
        conn.commit()
    finally:
        conn.close()

    _chmod(db_path, 0o600)
    _restore_owner(db_path, previous_owner)
    return moved


def _free_name(path: Path) -> Path:
    """Имя, которое точно никого не затрёт.

    Метка времени в имени — с точностью до секунды, а os.rename на Linux молча
    перезаписывает приёмник. Два восстановления подряд уложатся в одну секунду
    и уничтожили бы единственную точку отката.
    """
    if not path.exists():
        return path
    for n in range(1, 1000):
        candidate = Path(f"{path}.{n}")
        if not candidate.exists():
            return candidate
    raise BackupError(f"{path}: не удалось подобрать свободное имя")


def _owner_of(path: Path):
    if os.name == "nt" or not path.exists():
        return None
    info = path.stat()
    return (info.st_uid, info.st_gid)


def _restore_owner(path: Path, owner) -> None:
    """Сохранить прежнего владельца — иначе запуск под sudo даёт root:root.

    Контейнер прибит к user "1000:1000" (compose.yaml) и на чужом файле
    получает «attempt to write a readonly database» уже после того, как
    восстановление сочли успешным.
    """
    if owner is None or os.name == "nt":
        return
    if os.stat(path).st_uid == owner[0] and os.stat(path).st_gid == owner[1]:
        return
    try:
        os.chown(path, owner[0], owner[1])
    except (OSError, AttributeError):
        print(
            f"ВНИМАНИЕ: владелец {path} не совпадает с прежним ({owner[0]}:{owner[1]}). "
            f"Выполните: sudo chown {owner[0]}:{owner[1]} {path}",
            file=sys.stderr,
        )


# --------------------------------------------------------------------------
# Мелочи
# --------------------------------------------------------------------------

def _chmod(path: Path, mode: int) -> None:
    if os.name == "nt":  # права POSIX на Windows не работают; прод — Linux
        return
    os.chmod(path, mode)


def _fsync_file(path: Path) -> None:
    # O_RDWR, а не O_RDONLY: Windows отказывает сбрасывать буферы дескриптора,
    # открытого только на чтение, и локальный прогон тестов падал бы на fsync.
    fd = os.open(str(path), os.O_RDWR)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def _fsync_dir(path: Path) -> None:
    """Зафиксировать сам факт переименования, а не только содержимое файла."""
    if not hasattr(os, "O_DIRECTORY"):  # Windows — только для локальных тестов
        return
    fd = os.open(str(path), os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def write_status(dest_dir: Path, payload: dict) -> None:
    """Слить новое состояние с прошлым и записать атомарно.

    Прошлый успех не затирается провалом: «когда в последний раз получилось» —
    первое, что хочется знать при разборе.
    """
    status_path = dest_dir / STATUS_NAME
    status = {}
    if status_path.exists():
        try:
            status = json.loads(status_path.read_text(encoding="utf-8"))
        except (ValueError, OSError):
            status = {}
    status.update(payload)

    tmp = dest_dir / f"{STATUS_NAME}.tmp"
    tmp.write_text(json.dumps(status, ensure_ascii=False, indent=2), encoding="utf-8")
    _chmod(tmp, 0o600)
    os.replace(tmp, status_path)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class _Lock:
    """Не дать двум копиям идти одновременно (перекрытие таймера, ручной запуск).

    flock сам отпускается при смерти процесса — в отличие от файла-флага,
    который после падения заблокировал бы бэкап навсегда.
    """

    def __init__(self, path: Path):
        self.path = path
        self.fd = None

    def __enter__(self):
        try:
            import fcntl
        except ImportError:  # Windows — только локальные тесты
            return self
        try:
            self.fd = os.open(str(self.path), os.O_CREAT | os.O_RDWR, 0o600)
        except OSError as e:
            raise BackupError(f"нет доступа к {self.path}: {e}") from e
        try:
            fcntl.flock(self.fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as e:
            os.close(self.fd)
            self.fd = None
            raise BackupError(f"бэкап уже выполняется ({self.path})") from e
        return self

    def __exit__(self, *exc):
        if self.fd is not None:
            os.close(self.fd)
        return False


def _print_warnings(warnings: list) -> None:
    for text in warnings:
        print(f"   ВНИМАНИЕ: {text}", file=sys.stderr)


# --------------------------------------------------------------------------
# Команды
# --------------------------------------------------------------------------

def _cmd_backup(args) -> int:
    dest_dir = Path(args.dest)
    started = time.monotonic()
    try:
        dest_dir.mkdir(parents=True, exist_ok=True)
        with _Lock(dest_dir / LOCK_NAME):
            path, counts, warnings, removed = create_backup(
                Path(args.db), dest_dir, keep_days=args.keep_days, keep_min=args.keep_min
            )
    # OSError и sqlite3.Error ловим наравне с BackupError: кончившееся место и
    # запертая база — самые обычные причины отказа, и они обязаны попасть в
    # status.json, а не улететь трейсбеком мимо него.
    except (BackupError, OSError, sqlite3.Error) as e:
        # Сначала сообщение, потом запись состояния: если каталог недоступен,
        # упадёт как раз write_status, и причина иначе потерялась бы.
        print(f"БЭКАП НЕ СНЯТ: {e}", file=sys.stderr)
        try:
            write_status(dest_dir, {"last_failure": _now(), "last_error": str(e)})
        except OSError:
            pass
        return 1

    took_ms = int((time.monotonic() - started) * 1000)
    write_status(
        dest_dir,
        {
            "last_success": _now(),
            "last_file": path.name,
            "bytes": path.stat().st_size,
            "counts": counts,
            "duration_ms": took_ms,
            "removed": removed,
            "warnings": warnings,
            "last_error": None,
        },
    )
    print(f"OK {path} ({path.stat().st_size} байт, {took_ms} мс)")
    print("   строки: " + ", ".join(f"{t}={c}" for t, c in counts.items()))
    if removed:
        print(f"   удалено устаревших: {len(removed)}")
    _print_warnings(warnings)
    # Копия снята и годна, но о странностях надо узнать не в момент аварии.
    return 2 if warnings else 0


def _cmd_check(args) -> int:
    dest_dir = Path(args.dest)
    try:
        newest, age_hours, counts, warnings, checked = check_backups(
            dest_dir, max_age_hours=args.max_age_hours, deep=not args.shallow
        )
    except BackupError as e:
        print(f"ПРОВЕРКА НЕ ПРОШЛА: {e}", file=sys.stderr)
        return 1
    print(f"OK {newest.name} — возраст {age_hours:.1f} ч, проверено копий: {checked}")
    print("   строки: " + ", ".join(f"{t}={c}" for t, c in counts.items()))
    _print_warnings(warnings)
    return 2 if warnings else 0


def _cmd_restore(args) -> int:
    dest_dir = Path(args.dest)
    backup_path = Path(args.backup) if args.backup else latest_backup(dest_dir)
    if backup_path is None:
        print(f"ВОССТАНОВЛЕНИЕ НЕ ВЫПОЛНЕНО: в {dest_dir} нет копий", file=sys.stderr)
        return 1

    if not args.yes:
        print(f"Будет перезаписана база {args.db} копией {backup_path}.")
        print("Добавьте --yes, если это то, что нужно.", file=sys.stderr)
        return 1

    try:
        moved = restore(backup_path, Path(args.db), force=args.force)
    except (BackupError, OSError) as e:
        print(f"ВОССТАНОВЛЕНИЕ НЕ ВЫПОЛНЕНО: {e}", file=sys.stderr)
        return 1

    print(f"OK база восстановлена из {backup_path}")
    if moved is not None:
        print(f"   прежняя база сохранена как {moved} (удалите вручную, когда убедитесь)")
    else:
        print("   прежней базы на месте не было — откатывать нечего")
    print("   запустите сервис: cd ~/report && docker compose start report-backend")
    return 0


def main(argv: list = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--db", default="/home/admin101/report/data/data.db", help="путь к рабочей базе")
    parser.add_argument("--dest", default="/home/admin101/backups/report", help="каталог с копиями")
    sub = parser.add_subparsers(dest="command", required=True)

    p_backup = sub.add_parser("backup", help="снять и проверить копию")
    p_backup.add_argument("--keep-days", type=int, default=DEFAULT_KEEP_DAYS)
    p_backup.add_argument("--keep-min", type=int, default=DEFAULT_KEEP_MIN, help="сколько свежих копий беречь всегда")
    p_backup.set_defaults(func=_cmd_backup)

    p_check = sub.add_parser("check", help="проверить свежесть и целостность копий")
    p_check.add_argument("--max-age-hours", type=int, default=DEFAULT_MAX_AGE_HOURS)
    p_check.add_argument("--shallow", action="store_true", help="проверить только свежайшую копию")
    p_check.set_defaults(func=_cmd_check)

    p_restore = sub.add_parser("restore", help="восстановить базу из копии")
    p_restore.add_argument("--backup", help="файл копии (по умолчанию — свежайшая)")
    p_restore.add_argument("--yes", action="store_true", help="подтвердить перезапись базы")
    p_restore.add_argument("--force", action="store_true", help="не проверять, что сервис остановлен")
    p_restore.set_defaults(func=_cmd_restore)

    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
