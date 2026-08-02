"""Резервное копирование базы: WAL-безопасность, проверка копии, восстановление.

Крон в deploy/setup.sh делал `cp data.db backup.db`. База работает в режиме WAL:
свежезафиксированные транзакции лежат в data.db-wal, и такая копия молча теряет
их. Первый тест воспроизводит ровно эту потерю и показывает, что онлайн-бэкап
её не допускает.

Многие тесты здесь сформулированы как «мутация не должна пройти незамеченной» —
адверсариальное ревью показало, что без них выключение целых защит (флока, прав
0600, сверки маркеров, выбора свежайшей копии) не роняло ни одного теста.
"""
import ast
import importlib.util
import json
import os
import shutil
import sqlite3
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from sqlalchemy import create_engine

from app.database import Base
from app import models  # noqa: F401 — регистрирует таблицы в метаданных Base

# Скрипт лежит вне пакета app и не имеет сторонних зависимостей: грузим по пути,
# чтобы тест не зависел от того, как настроен sys.path.
_SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "backup_db.py"
_spec = importlib.util.spec_from_file_location("backup_db", _SCRIPT)
backup_db = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(backup_db)


def _make_schema(path: Path) -> None:
    """Настоящая схема приложения, а не её копия в тесте."""
    engine = create_engine(f"sqlite:///{path}")
    Base.metadata.create_all(engine)
    engine.dispose()


def _open_wal(path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(str(path))
    conn.execute("PRAGMA journal_mode = WAL")
    return conn


def _add_user(conn: sqlite3.Connection, email: str = "user@example.com") -> None:
    conn.execute("INSERT INTO users (email, password_hash) VALUES (?, ?)", (email, "bcrypt-hash"))
    conn.commit()


def _live_db(tmp_path: Path, email: str = "user@example.com"):
    """База со схемой и одной строкой, лежащей ТОЛЬКО в WAL (соединение открыто)."""
    db = tmp_path / "data.db"
    _make_schema(db)
    conn = _open_wal(db)
    _add_user(conn, email)
    return db, conn


def _closed_db(tmp_path: Path, name: str = "data.db", email: str = "user@example.com") -> Path:
    """Обычная база без открытых соединений."""
    db = tmp_path / name
    _make_schema(db)
    conn = sqlite3.connect(str(db))
    _add_user(conn, email)
    conn.close()
    return db


def _emails(db: Path) -> list:
    conn = sqlite3.connect(str(db))
    try:
        return [row[0] for row in conn.execute("SELECT email FROM users ORDER BY id")]
    finally:
        conn.close()


def _stamp(days_ago: float) -> str:
    moment = datetime.now(timezone.utc) - timedelta(days=days_ago)
    return moment.strftime("%Y%m%d-%H%M%S") + "Z"


def _plant_copies(dest: Path, source: Path, ages_days: list) -> list:
    """Настоящие копии с заданным возрастом (возраст задаётся ИМЕНЕМ)."""
    dest.mkdir(parents=True, exist_ok=True)
    made = []
    for age in ages_days:
        path = dest / f"data-{_stamp(age)}.db"
        shutil.copyfile(source, path)
        moment = time.time() - age * 86400
        os.utime(path, (moment, moment))
        made.append(path)
    return made


def _corrupt_pages(path: Path) -> None:
    """Испортить страницы так, что база вовсе перестаёт открываться."""
    data = bytearray(path.read_bytes())
    for offset in range(4096, len(data)):
        data[offset] ^= 0xFF
    path.write_bytes(bytes(data))


def _break_freelist(path: Path) -> None:
    """Испортить заголовок так, что база ОТКРЫВАЕТСЯ, но integrity_check ругается.

    Отдельная ветка от «файл вообще не база»: сравнение результата с ('ok',) —
    единственная защита от медленной порчи (bit rot на единственном диске, без
    контрольных сумм ext4 и без скраббинга), и без такого теста её отключение
    не роняло ни одной проверки.
    """
    data = bytearray(path.read_bytes())
    data[36:40] = (7).to_bytes(4, "big")  # число страниц во freelist — заведомо ложное
    path.write_bytes(bytes(data))


class TestWalSafety:
    def test_naive_copy_loses_wal_tail_but_backup_keeps_it(self, tmp_path: Path):
        """Главный регресс: `cp data.db` теряет уже сохранённые данные."""
        db, live = _live_db(tmp_path, "wal@example.com")
        try:
            # Чекпоинта не было — строка существует только в журнале
            assert Path(f"{db}-wal").stat().st_size > 0

            naive = tmp_path / "naive.db"
            shutil.copyfile(db, naive)  # ровно то, что делал старый крон
            probe = sqlite3.connect(str(naive))
            try:
                lost = probe.execute("SELECT COUNT(*) FROM users").fetchone()[0]
            finally:
                probe.close()
            assert lost == 0, "тест бессмыслен: наивная копия почему-то не потеряла строку"

            _, counts, warnings, _ = backup_db.create_backup(db, tmp_path / "backups")
            assert counts["users"] == 1
            assert warnings == []
        finally:
            live.close()

    def test_backup_copy_is_self_contained(self, tmp_path: Path):
        """Копия должна быть в режиме DELETE — восстановление это подмена файла."""
        db, live = _live_db(tmp_path)
        try:
            path, _, _, _ = backup_db.create_backup(db, tmp_path / "backups")
        finally:
            live.close()

        probe = sqlite3.connect(str(path))
        try:
            mode = probe.execute("PRAGMA journal_mode").fetchone()[0]
        finally:
            probe.close()
        assert mode == "delete"

    def test_no_leftovers_after_success(self, tmp_path: Path):
        """После успеха в каталоге только сама копия и status.json."""
        db, live = _live_db(tmp_path)
        dest = tmp_path / "backups"
        try:
            backup_db.main(["--db", str(db), "--dest", str(dest), "backup"])
        finally:
            live.close()

        leftovers = sorted(p.name for p in dest.iterdir() if p.name.endswith(".tmp"))
        assert leftovers == []
        assert len(backup_db.backup_files(dest)) == 1

    def test_backup_runs_while_service_writes(self, tmp_path: Path):
        """Копия снимается на работающей базе — останавливать сервис не требуется."""
        db, live = _live_db(tmp_path)
        try:
            path, counts, _, _ = backup_db.create_backup(db, tmp_path / "backups")
            _add_user(live, "second@example.com")
            assert live.execute("SELECT COUNT(*) FROM users").fetchone()[0] == 2
        finally:
            live.close()

        assert counts["users"] == 1  # снимок на момент копирования
        assert path.exists()

    def test_source_markers_are_actually_passed_to_verification(self, tmp_path: Path, monkeypatch):
        """Сверка с источником должна быть подключена, а не только существовать."""
        db, live = _live_db(tmp_path)
        seen = {}

        real_verify = backup_db.verify_backup

        def spy(path, min_ids=None):
            seen["min_ids"] = min_ids
            return real_verify(path, min_ids)

        monkeypatch.setattr(backup_db, "verify_backup", spy)
        try:
            backup_db.create_backup(db, tmp_path / "backups")
        finally:
            live.close()

        assert seen["min_ids"], "create_backup обязан передавать маркеры источника"
        assert seen["min_ids"]["users"] == 1


class TestVerification:
    def test_core_tables_match_models(self):
        """Сторожит оба направления: и переименование, и новую таблицу.

        Односторонняя проверка пропускала бы добавленную модель — она молча
        выпала бы и из проверки наличия таблиц, и из сверки маркеров.
        """
        assert set(backup_db.CORE_TABLES) == set(Base.metadata.tables)

    def test_rejects_garbage_file(self, tmp_path: Path):
        broken = tmp_path / f"data-{_stamp(0)}.db"
        broken.write_bytes(b"\x00 not a database at all")
        with pytest.raises(backup_db.BackupError):
            backup_db.verify_backup(broken)

    def test_rejects_structurally_damaged_database(self, tmp_path: Path):
        """Файл открывается, но integrity_check возвращает ошибки — своя ветка."""
        db = _closed_db(tmp_path)
        _break_freelist(db)
        with pytest.raises(backup_db.BackupError, match="integrity_check"):
            backup_db.verify_backup(db)

    def test_rejects_empty_file(self, tmp_path: Path):
        empty = tmp_path / f"data-{_stamp(0)}.db"
        empty.touch()
        with pytest.raises(backup_db.BackupError, match="пуст"):
            backup_db.verify_backup(empty)

    def test_rejects_missing_table(self, tmp_path: Path):
        db = _closed_db(tmp_path, "partial.db")
        conn = sqlite3.connect(str(db))
        conn.execute("DROP TABLE report_runs")
        conn.commit()
        conn.close()

        with pytest.raises(backup_db.BackupError, match="report_runs"):
            backup_db.verify_backup(db)

    def test_rejects_database_without_users(self, tmp_path: Path):
        """Пустая база проходит integrity_check, но восстанавливать из неё нечего."""
        db = tmp_path / "empty.db"
        _make_schema(db)
        with pytest.raises(backup_db.BackupError, match="ноль пользователей"):
            backup_db.verify_backup(db)

    def test_orphan_row_warns_but_keeps_the_backup(self, tmp_path: Path):
        """Битые внешние ключи — качество данных В ИСХОДНИКЕ, а не негодность копии.

        Жёсткий отказ здесь означал бы, что одна осиротевшая строка в проде
        каждую ночь удаляет исправную копию и система остаётся без бэкапов.
        """
        db = _closed_db(tmp_path)
        conn = sqlite3.connect(str(db))
        # foreign_keys по умолчанию выключены — ровно как в alembic/env.py
        conn.execute("INSERT INTO projects (name, user_id) VALUES ('Осиротевший', 4242)")
        conn.commit()
        conn.close()

        dest = tmp_path / "backups"
        path, counts, warnings, _ = backup_db.create_backup(db, dest)

        assert path.exists(), "копия должна остаться"
        assert counts["projects"] == 1
        assert any("внешних ключей" in w for w in warnings)

    def test_lagging_markers_warn_but_keep_the_backup(self, tmp_path: Path):
        """id — это rowid без AUTOINCREMENT, поэтому «отставание» бывает мнимым."""
        db = _closed_db(tmp_path)
        dest = tmp_path / "backups"
        path, _, _, _ = backup_db.create_backup(db, dest)

        _, warnings = backup_db.verify_backup(path, {"users": 99})
        assert any("отстают" in w for w in warnings)
        assert path.exists()

    def test_failed_verification_leaves_no_backup(self, tmp_path: Path):
        """Файл с финальным именем — всегда годный файл."""
        db = tmp_path / "data.db"
        _make_schema(db)  # схема есть, пользователей нет -> проверка не пройдёт
        dest = tmp_path / "backups"

        with pytest.raises(backup_db.BackupError, match="ноль пользователей"):
            backup_db.create_backup(db, dest)

        assert backup_db.backup_files(dest) == []
        assert list(dest.glob("*.tmp")) == []

    def test_emptied_table_is_reported(self, tmp_path: Path):
        """Единственная защита от «копируем не тот файл»."""
        db = _closed_db(tmp_path)
        conn = sqlite3.connect(str(db))
        conn.execute("INSERT INTO projects (name, user_id) VALUES ('Живой', 1)")
        conn.commit()
        conn.close()

        dest = tmp_path / "backups"
        backup_db.main(["--db", str(db), "--dest", str(dest), "backup"])

        conn = sqlite3.connect(str(db))
        conn.execute("DELETE FROM projects")
        conn.commit()
        conn.close()

        _, _, warnings, _ = backup_db.create_backup(db, dest)
        assert any("опустели" in w for w in warnings)

    def test_stale_temp_files_are_cleaned_up(self, tmp_path: Path):
        """Обрывки от убитого процесса не попадают под retention — убираем отдельно."""
        db = _closed_db(tmp_path)
        dest = tmp_path / "backups"
        dest.mkdir()

        old_tmp = dest / "data-20260101-000000.db.tmp"
        old_tmp.write_bytes("обрывок".encode("utf-8"))
        ancient = time.time() - 2 * 3600
        os.utime(old_tmp, (ancient, ancient))
        fresh_tmp = dest / "data-20260102-000000.db.tmp"
        fresh_tmp.write_bytes("чужой запуск прямо сейчас".encode("utf-8"))

        backup_db.create_backup(db, dest)

        assert not old_tmp.exists()
        assert fresh_tmp.exists(), "свежий tmp может принадлежать параллельному запуску"


class TestBackupSelection:
    def test_picks_the_newest_of_several(self, tmp_path: Path):
        """Без этого теста мутация `reverse=True` -> сортировка по возрастанию
        молча заставляла restore откатывать на САМУЮ СТАРУЮ копию."""
        db = _closed_db(tmp_path)
        dest = tmp_path / "backups"
        planted = _plant_copies(dest, db, [5, 1, 3])

        newest = backup_db.latest_backup(dest)
        expected = max(planted, key=lambda p: p.name)
        assert newest == expected

    def test_foreign_file_is_not_a_backup(self, tmp_path: Path):
        """`data-manual.db` сортируется выше любой даты — буква больше цифры.

        Пока имя не проверялось форматом, такой файл навсегда становился
        «свежайшей копией»: check ежедневно врал про возраст, а restore --yes
        откатывал прод именно на него.
        """
        db = _closed_db(tmp_path)
        dest = tmp_path / "backups"
        real = _plant_copies(dest, db, [0])[0]
        stray = dest / "data-manual-before-upgrade.db"
        shutil.copyfile(db, stray)

        assert backup_db.latest_backup(dest) == real
        assert [p for p, _ in backup_db.backup_files(dest)] == [real]
        assert "data-manual-before-upgrade.db" in backup_db.foreign_files(dest)

    def test_age_comes_from_the_name_not_mtime(self, tmp_path: Path):
        """mtime переписывает любое копирование каталога — а ранбук его предлагает."""
        db = _closed_db(tmp_path)
        dest = tmp_path / "backups"
        old = _plant_copies(dest, db, [10])[0]
        os.utime(old, None)  # «скопировали каталог» — mtime стал свежим

        with pytest.raises(backup_db.BackupError, match="бэкап не отработал"):
            backup_db.check_backups(dest, max_age_hours=48)


class TestRetention:
    def test_keeps_minimum_even_when_everything_is_old(self, tmp_path: Path):
        """`find -mtime +30 -delete` при простое сервиса вычищал каталог до нуля."""
        db = _closed_db(tmp_path)
        dest = tmp_path / "backups"
        _plant_copies(dest, db, [100, 99, 98, 97, 96])

        removed, warnings = backup_db.prune(dest, keep_days=30, keep_min=3)

        assert len(removed) == 2
        assert len(backup_db.backup_files(dest)) == 3
        assert warnings == []

    def test_removes_old_beyond_minimum(self, tmp_path: Path):
        db = _closed_db(tmp_path)
        dest = tmp_path / "backups"
        _plant_copies(dest, db, [100, 99, 98, 1, 0.5])

        removed, _ = backup_db.prune(dest, keep_days=30, keep_min=2)

        assert len(removed) == 3
        assert len(backup_db.backup_files(dest)) == 2

    def test_foreign_files_do_not_eat_the_safety_slots(self, tmp_path: Path):
        """Три посторонних файла раньше выключали гарантию «оставить N последних»
        целиком — prune удалял ВСЕ настоящие копии."""
        db = _closed_db(tmp_path)
        dest = tmp_path / "backups"
        _plant_copies(dest, db, [100, 99, 98, 97, 96])
        for name in ("data-manual-1.db", "data-manual-2.db", "data-zzz.db"):
            shutil.copyfile(db, dest / name)

        backup_db.prune(dest, keep_days=30, keep_min=3)

        assert len(backup_db.backup_files(dest)) == 3

    def test_survives_a_file_that_cannot_be_removed(self, tmp_path: Path, monkeypatch):
        """prune вызывается ПОСЛЕ os.replace: исключение отсюда пометило бы уже
        снятую копию как провал."""
        db = _closed_db(tmp_path)
        dest = tmp_path / "backups"
        _plant_copies(dest, db, [100, 99, 98])

        real_unlink = Path.unlink
        calls = {"n": 0}

        def flaky(self, *args, **kwargs):
            calls["n"] += 1
            if calls["n"] == 1:
                raise OSError(13, "Permission denied")
            return real_unlink(self, *args, **kwargs)

        monkeypatch.setattr(Path, "unlink", flaky)
        removed, warnings = backup_db.prune(dest, keep_days=30, keep_min=1)

        assert any("не удалось удалить" in w for w in warnings)
        assert removed, "уборка должна продолжиться после сбоя на одном файле"

    def test_keeps_fresh_backups(self, tmp_path: Path):
        db = _closed_db(tmp_path)
        dest = tmp_path / "backups"
        _plant_copies(dest, db, [2, 1.5, 1, 0.5, 0.1])

        removed, _ = backup_db.prune(dest, keep_days=30, keep_min=1)
        assert removed == []
        assert len(backup_db.backup_files(dest)) == 5


class TestCheck:
    def test_fails_when_there_are_no_backups(self, tmp_path: Path):
        dest = tmp_path / "backups"
        dest.mkdir()
        with pytest.raises(backup_db.BackupError, match="ни одной копии"):
            backup_db.check_backups(dest)

    def test_fails_when_directory_is_absent(self, tmp_path: Path):
        with pytest.raises(backup_db.BackupError, match="каталога бэкапов нет"):
            backup_db.check_backups(tmp_path / "nope")

    def test_fails_when_newest_backup_is_stale(self, tmp_path: Path):
        db = _closed_db(tmp_path)
        dest = tmp_path / "backups"
        _plant_copies(dest, db, [5])

        with pytest.raises(backup_db.BackupError, match="бэкап не отработал"):
            backup_db.check_backups(dest, max_age_hours=48)

    def test_fails_when_newest_backup_is_corrupt(self, tmp_path: Path):
        """Сторож существует ровно затем, чтобы поймать нечитаемую копию."""
        db = _closed_db(tmp_path)
        dest = tmp_path / "backups"
        fresh = _plant_copies(dest, db, [0])[0]
        _break_freelist(fresh)

        with pytest.raises(backup_db.BackupError, match="integrity_check"):
            backup_db.check_backups(dest, max_age_hours=48)

    def test_finds_rot_deeper_in_the_retention_window(self, tmp_path: Path):
        """Проверять только свежайшую = глубина восстановления равна суткам."""
        db = _closed_db(tmp_path)
        dest = tmp_path / "backups"
        old, _, _ = _plant_copies(dest, db, [20, 1, 0])
        _corrupt_pages(old)

        with pytest.raises(backup_db.BackupError, match="в глубине хранения"):
            backup_db.check_backups(dest, max_age_hours=48)

        # поверхностный режим о старой порче не знает — это его цена
        newest, _, _, _, checked = backup_db.check_backups(dest, max_age_hours=48, deep=False)
        assert checked == 1

    def test_passes_on_fresh_backup(self, tmp_path: Path):
        db, live = _live_db(tmp_path)
        dest = tmp_path / "backups"
        try:
            backup_db.create_backup(db, dest)
        finally:
            live.close()

        newest, age_hours, counts, warnings, checked = backup_db.check_backups(dest, max_age_hours=48)
        assert newest.exists()
        assert age_hours < 1
        assert counts["users"] == 1
        assert warnings == []
        assert checked == 1


class TestRestore:
    def test_refuses_while_service_holds_the_database(self, tmp_path: Path):
        db, live = _live_db(tmp_path)
        dest = tmp_path / "backups"
        try:
            path, _, _, _ = backup_db.create_backup(db, dest)
            with pytest.raises(backup_db.BackupError, match="остановите сервис|docker compose stop"):
                backup_db.restore(path, db)
        finally:
            live.close()

    def test_refuses_unverified_backup_without_touching_the_database(self, tmp_path: Path):
        """Смысл проверки в начале restore — не тронуть боевую базу.

        Без утверждений о файловой системе перенос verify_backup в конец
        функции не ронял ни одного теста, а боевая база к тому моменту уже
        уезжала под .replaced-.
        """
        db = _closed_db(tmp_path, email="alive@example.com")
        junk = tmp_path / f"data-{_stamp(0)}.db"
        junk.write_bytes(b"\x00 not a database")

        with pytest.raises(backup_db.BackupError):
            backup_db.restore(junk, db)

        assert db.exists()
        assert _emails(db) == ["alive@example.com"]
        assert list(tmp_path.glob("*.replaced-*")) == []

    def test_moves_stale_rollback_journal_aside(self, tmp_path: Path):
        """data.db-journal рядом с восстановленным файлом = порча базы.

        Именно этот суффикс и возможен сразу после restore: копия ложится в
        режиме DELETE, а первым к ней обращается alembic, который WAL не
        включает.
        """
        db = _closed_db(tmp_path, email="restored@example.com")
        dest = tmp_path / "backups"
        path, _, _, _ = backup_db.create_backup(db, dest)

        Path(f"{db}-journal").write_bytes(b"stale rollback journal")

        moved = backup_db.restore(path, db)

        assert not Path(f"{db}-journal").exists()
        assert moved is not None and moved.exists()
        assert Path(f"{moved}-journal").exists(), "журнал должен уехать вместе с базой"
        assert _emails(db) == ["restored@example.com"]

    def test_moves_stale_wal_aside(self, tmp_path: Path):
        db = _closed_db(tmp_path, email="restored@example.com")
        dest = tmp_path / "backups"
        path, _, _, _ = backup_db.create_backup(db, dest)

        conn = _open_wal(db)
        _add_user(conn, "later@example.com")
        conn.close()
        Path(f"{db}-wal").write_bytes(b"stale journal")

        moved = backup_db.restore(path, db)

        assert not Path(f"{db}-wal").exists()
        assert not Path(f"{db}-shm").exists()
        assert moved.exists(), "прежняя база должна быть отодвинута, а не удалена"
        assert _emails(db) == ["restored@example.com"]

    def test_restored_database_is_back_in_wal_mode(self, tmp_path: Path):
        """Приложение ждёт WAL; заодно закрывается окно, где возможен -journal."""
        db = _closed_db(tmp_path)
        dest = tmp_path / "backups"
        path, _, _, _ = backup_db.create_backup(db, dest)

        backup_db.restore(path, db)

        conn = sqlite3.connect(str(db))
        try:
            assert conn.execute("PRAGMA journal_mode").fetchone()[0] == "wal"
        finally:
            conn.close()

    def test_interrupted_copy_leaves_the_original_in_place(self, tmp_path: Path, monkeypatch):
        """Кончилось место — самая обычная причина в разгар восстановления.

        Раньше оригинал уже был переименован, копия лилась прямо на боевой путь,
        и обрыв оставлял обрубок вместо базы.
        """
        db = _closed_db(tmp_path, email="alive@example.com")
        dest = tmp_path / "backups"
        path, _, _, _ = backup_db.create_backup(db, dest)

        def no_space(*args, **kwargs):
            raise OSError(28, "No space left on device")

        monkeypatch.setattr(backup_db.shutil, "copy2", no_space)
        with pytest.raises(OSError):
            backup_db.restore(path, db)

        assert db.exists()
        assert _emails(db) == ["alive@example.com"]
        assert list(tmp_path.glob("*.replaced-*")) == []
        assert list(tmp_path.glob("*.incoming-*")) == []

    def test_silently_bad_copy_does_not_replace_the_database(self, tmp_path: Path, monkeypatch):
        """Проверяется то, что реально ЛЕГЛО, а не то, что мы собирались положить.

        Копирование способно завершиться без ошибки и оставить негодный файл;
        проверять только исходную копию — значит узнать об этом от контейнера,
        когда откатываться уже не на что.
        """
        db = _closed_db(tmp_path, email="alive@example.com")
        dest = tmp_path / "backups"
        path, _, _, _ = backup_db.create_backup(db, dest)

        def bad_copy(src, dst, **kwargs):
            Path(dst).write_bytes(b"\x00 truncated garbage")

        monkeypatch.setattr(backup_db.shutil, "copy2", bad_copy)
        with pytest.raises(backup_db.BackupError):
            backup_db.restore(path, db)

        assert _emails(db) == ["alive@example.com"]
        assert list(tmp_path.glob("*.incoming-*")) == []
        assert list(tmp_path.glob("*.replaced-*")) == []

    def test_failed_swap_puts_the_original_back(self, tmp_path: Path, monkeypatch):
        """Половина отодвинутых спутников без базы — состояние, из которого
        оператор в разгар аварии уже не выберется."""
        db = _closed_db(tmp_path, email="alive@example.com")
        dest = tmp_path / "backups"
        path, _, _, _ = backup_db.create_backup(db, dest)

        # спутники подкладываем ПОСЛЕ снятия копии: их должен подхватить цикл
        # переименований, а откат — вернуть на место вместе с базой
        Path(f"{db}-wal").write_bytes(b"journal tail")

        def boom(src, dst):
            raise OSError(28, "No space left on device")

        monkeypatch.setattr(backup_db.os, "replace", boom)
        with pytest.raises(OSError):
            backup_db.restore(path, db)

        assert db.exists()
        # проверяем спутник ДО первого открытия базы: sqlite при открытии сам
        # выбрасывает журнал с негодным заголовком, и порядок утверждений
        # уничтожил бы то, что мы проверяем
        assert Path(f"{db}-wal").exists(), "спутники обязаны вернуться вместе с базой"
        assert list(tmp_path.glob("*.replaced-*")) == []
        assert list(tmp_path.glob("*.incoming-*")) == []
        assert _emails(db) == ["alive@example.com"]

    def test_second_restore_in_the_same_second_keeps_both_rollbacks(self, tmp_path: Path):
        """os.rename на Linux молча перезаписывает приёмник, а метка времени —
        с точностью до секунды: два отката подряд уничтожали точку отката."""
        db = _closed_db(tmp_path)
        dest = tmp_path / "backups"
        path, _, _, _ = backup_db.create_backup(db, dest)

        first = backup_db.restore(path, db)
        second = backup_db.restore(path, db)

        assert first != second
        assert first.exists() and second.exists()

    def test_restore_onto_a_machine_without_a_database(self, tmp_path: Path):
        """Главный сценарий ранбука: диск умер, базы нет вовсе."""
        db = _closed_db(tmp_path, email="fromscratch@example.com")
        dest = tmp_path / "backups"
        path, _, _, _ = backup_db.create_backup(db, dest)

        fresh = tmp_path / "fresh"
        fresh.mkdir()
        target = fresh / "data.db"

        moved = backup_db.restore(path, target)

        assert moved is None, "откатывать нечего — обещать точку отката нельзя"
        assert _emails(target) == ["fromscratch@example.com"]

    def test_cli_reports_absence_of_rollback_point(self, tmp_path: Path, capsys):
        db = _closed_db(tmp_path)
        dest = tmp_path / "backups"
        backup_db.create_backup(db, dest)

        fresh = tmp_path / "fresh"
        fresh.mkdir()
        rc = backup_db.main(["--db", str(fresh / "data.db"), "--dest", str(dest), "restore", "--yes"])

        assert rc == 0
        assert "откатывать нечего" in capsys.readouterr().out


class TestCli:
    def test_backup_then_check(self, tmp_path: Path):
        db, live = _live_db(tmp_path)
        dest = tmp_path / "backups"
        try:
            assert backup_db.main(["--db", str(db), "--dest", str(dest), "backup"]) == 0
            assert backup_db.main(["--db", str(db), "--dest", str(dest), "check"]) == 0
        finally:
            live.close()

        status = json.loads((dest / "status.json").read_text(encoding="utf-8"))
        assert status["counts"]["users"] == 1
        assert status["last_error"] is None
        assert status["warnings"] == []
        assert status["last_success"]

    def test_warnings_change_the_exit_code(self, tmp_path: Path):
        """Копия снята и годна, но о странностях надо узнать не в момент аварии."""
        db = _closed_db(tmp_path)
        conn = sqlite3.connect(str(db))
        conn.execute("INSERT INTO projects (name, user_id) VALUES ('Осиротевший', 4242)")
        conn.commit()
        conn.close()

        dest = tmp_path / "backups"
        rc = backup_db.main(["--db", str(db), "--dest", str(dest), "backup"])

        assert rc == 2
        status = json.loads((dest / "status.json").read_text(encoding="utf-8"))
        assert status["warnings"]
        assert len(backup_db.backup_files(dest)) == 1

    def test_check_without_backups_exits_nonzero(self, tmp_path: Path):
        dest = tmp_path / "backups"
        dest.mkdir()
        assert backup_db.main(["--db", str(tmp_path / "x.db"), "--dest", str(dest), "check"]) == 1

    def test_backup_of_missing_database_exits_nonzero(self, tmp_path: Path):
        dest = tmp_path / "backups"
        rc = backup_db.main(["--db", str(tmp_path / "nope.db"), "--dest", str(dest), "backup"])

        assert rc == 1
        status = json.loads((dest / "status.json").read_text(encoding="utf-8"))
        assert "нечего копировать" in status["last_error"]

    def test_disk_error_is_recorded_in_status(self, tmp_path: Path, monkeypatch):
        """Кончившееся место — не трейсбек мимо status.json, а записанный отказ."""
        db = _closed_db(tmp_path)
        dest = tmp_path / "backups"

        def full_disk(*args, **kwargs):
            raise OSError(28, "No space left on device")

        monkeypatch.setattr(backup_db, "create_backup", full_disk)
        rc = backup_db.main(["--db", str(db), "--dest", str(dest), "backup"])

        assert rc == 1
        status = json.loads((dest / "status.json").read_text(encoding="utf-8"))
        assert "No space left" in status["last_error"]

    def test_restore_requires_confirmation(self, tmp_path: Path):
        db = _closed_db(tmp_path)
        dest = tmp_path / "backups"
        backup_db.create_backup(db, dest)

        assert backup_db.main(["--db", str(db), "--dest", str(dest), "restore"]) == 1
        assert list(tmp_path.glob("*.replaced-*")) == []


class TestStatusFile:
    def test_failure_does_not_erase_last_success(self, tmp_path: Path):
        dest = tmp_path / "backups"
        dest.mkdir()

        backup_db.write_status(dest, {"last_success": "2026-08-01T03:00:00+00:00"})
        backup_db.write_status(dest, {"last_failure": "2026-08-02T03:00:00+00:00", "last_error": "диск"})

        status = json.loads((dest / "status.json").read_text(encoding="utf-8"))
        assert status["last_success"] == "2026-08-01T03:00:00+00:00"
        assert status["last_error"] == "диск"

    def test_survives_corrupted_status_file(self, tmp_path: Path):
        dest = tmp_path / "backups"
        dest.mkdir()
        (dest / "status.json").write_text("{ это не json", encoding="utf-8")

        backup_db.write_status(dest, {"last_success": "2026-08-02T03:00:00+00:00"})

        status = json.loads((dest / "status.json").read_text(encoding="utf-8"))
        assert status["last_success"] == "2026-08-02T03:00:00+00:00"


class TestNoDependencies:
    """Скрипт запускается системным python3 хоста, вне venv и вне контейнера.

    Тесты грузят его внутри venv, где доступен весь requirements.txt, поэтому
    сторонний импорт здесь прошёл бы незамеченным, а на сервере ронял бы
    ночной бэкап с ModuleNotFoundError.
    """

    def test_imports_are_stdlib_only(self):
        tree = ast.parse(_SCRIPT.read_text(encoding="utf-8"))
        imported = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                imported.update(alias.name.split(".")[0] for alias in node.names)
            elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
                imported.add(node.module.split(".")[0])

        assert imported <= set(sys.stdlib_module_names), (
            f"скрипт обязан обходиться стандартной библиотекой, а импортирует: "
            f"{sorted(imported - set(sys.stdlib_module_names))}"
        )


class TestPermissions:
    """Права проверяем и на Windows тоже — через сам факт вызова _chmod.

    Прямая проверка битов режима возможна только на POSIX, а тесты гоняют на
    Windows; без спая удаление _chmod не роняло ни одного теста, и копии с
    OAuth-токенами молча становились мирочитаемыми.
    """

    def test_backup_and_directory_are_locked_down(self, tmp_path: Path, monkeypatch):
        applied = {}
        real_chmod = backup_db._chmod

        def spy(path, mode):
            applied[Path(path).name] = mode
            return real_chmod(path, mode)

        monkeypatch.setattr(backup_db, "_chmod", spy)

        db = _closed_db(tmp_path)
        dest = tmp_path / "backups"
        path, _, _, _ = backup_db.create_backup(db, dest)

        assert path.exists()
        assert applied["backups"] == 0o700
        # права ставятся временному файлу — под финальным именем он появляется
        # уже проверенным и защищённым
        tmp_modes = [mode for name, mode in applied.items() if name.endswith(".db.tmp")]
        assert tmp_modes == [0o600]

    def test_restore_does_not_widen_access_to_the_database(self, tmp_path: Path, monkeypatch):
        """В базе живые refresh-токены Яндекса и Google открытым текстом."""
        applied = {}
        real_chmod = backup_db._chmod

        def spy(path, mode):
            applied[Path(path).name] = mode
            return real_chmod(path, mode)

        db = _closed_db(tmp_path)
        dest = tmp_path / "backups"
        path, _, _, _ = backup_db.create_backup(db, dest)

        monkeypatch.setattr(backup_db, "_chmod", spy)
        moved = backup_db.restore(path, db)

        assert applied["data.db"] == 0o600
        assert applied[moved.name] == 0o600, "отодвинутый слепок тоже нельзя оставлять открытым"

    @pytest.mark.skipif(os.name == "nt", reason="биты режима проверяем на Linux, где работает прод")
    def test_real_mode_bits_on_posix(self, tmp_path: Path):
        db = _closed_db(tmp_path)
        dest = tmp_path / "backups"
        path, _, _, _ = backup_db.create_backup(db, dest)

        assert path.stat().st_mode & 0o777 == 0o600
        assert dest.stat().st_mode & 0o777 == 0o700

    @pytest.mark.skipif(os.name == "nt", reason="flock есть только на POSIX")
    def test_concurrent_backup_is_rejected(self, tmp_path: Path):
        """Перекрытие таймера не должно давать две копии одновременно."""
        dest = tmp_path / "backups"
        dest.mkdir()
        lock_path = dest / backup_db.LOCK_NAME

        with backup_db._Lock(lock_path):
            with pytest.raises(backup_db.BackupError, match="уже выполняется"):
                with backup_db._Lock(lock_path):
                    pass
