"""Регрессия на фиксы аудита 07.07.2026 — чтобы починенное поведение
не откатилось молча. Номера ссылаются на находки аудита."""
import time

import pytest
from fastapi import HTTPException
from sqlalchemy import text

from app.transformations import (
    JoinTransformation,
    FilterTransformation,
    SortTransformation,
    CalculateTransformation,
)
from app.google_sheets import _escape_formula_value
from app.schemas import UserCreate, UserLogin
from app.integrations import upsert_integration


# ---------- #5: join не склеивает по пустому ключу ----------

class TestJoinEmptyKeys:
    def test_empty_keys_do_not_cross_match(self):
        data = {
            "L": [
                {"campaignname": "Acme", "cost": 100},
                {"campaignname": "", "cost": 50},   # пустой ключ слева
            ],
            "R": [
                {"utmcampaign": "acme", "visits": 5},
                {"utmcampaign": "", "visits": 999},  # нетегированный трафик
                {"utmcampaign": "", "visits": 888},
            ],
        }
        config = {
            "left": "L", "right": "R",
            "left_on": "campaignname", "right_on": "utmcampaign",
            "how": "left", "output": "L",
        }
        result = JoinTransformation().transform(data, config)["L"]

        # Acme матчится один раз; пустой ключ НЕ склеивается с двумя пустыми
        # правыми строками -> остаётся одной unmatched-строкой (декартова
        # склейка дала бы 3 строки вместо 2).
        assert len(result) == 2
        acme = [r for r in result if r["campaignname"] == "Acme"]
        empty = [r for r in result if r["campaignname"] == ""]
        assert len(acme) == 1 and acme[0]["visits"] == 5
        assert len(empty) == 1 and "visits" not in empty[0]

    def test_empty_key_inner_join_drops_unmatched(self):
        data = {
            "L": [{"k": ""}, {"k": "x"}],
            "R": [{"k": ""}, {"k": "x"}],
        }
        config = {"left": "L", "right": "R", "on": "k", "how": "inner", "output": "L"}
        result = JoinTransformation().transform(data, config)["L"]
        # только "x"<->"x"; пустые ключи не матчатся
        assert len(result) == 1 and result[0]["k"] == "x"


# ---------- #16: filter на None/несравнимых типах не роняет отчёт ----------

class TestFilterRobustness:
    def test_gt_on_none_excludes_row(self):
        data = {"S": [{"cost": 100}, {"cost": None}, {"other": 1}]}
        config = {"source": "S", "column": "cost", "operator": "gt", "value": 50}
        result = FilterTransformation().transform(data, config)["S"]
        assert len(result) == 1 and result[0]["cost"] == 100

    def test_gt_on_incomparable_types_excludes_row(self):
        data = {"S": [{"c": "Campaign"}, {"c": 200}]}
        config = {"source": "S", "column": "c", "operator": "gt", "value": 100}
        result = FilterTransformation().transform(data, config)["S"]
        assert len(result) == 1 and result[0]["c"] == 200

    def test_string_string_comparison_still_works(self):
        # починка не должна ломать легитимное строковое сравнение
        data = {"S": [{"c": "2025-01-02"}, {"c": "2024-12-31"}]}
        config = {"source": "S", "column": "c", "operator": "gt", "value": "2025-01-01"}
        result = FilterTransformation().transform(data, config)["S"]
        assert len(result) == 1 and result[0]["c"] == "2025-01-02"


# ---------- #17: sort на смешанных типах не падает ----------

class TestSortMixedTypes:
    def test_mixed_types_no_crash_and_stable_order(self):
        data = {"S": [{"v": 3.0}, {"v": None}, {"v": "abc"}, {"v": 1.0}]}
        config = {"source": "S", "column": "v"}
        result = SortTransformation().transform(data, config)["S"]
        # None -> числа (по возрастанию) -> строки
        assert [r["v"] for r in result] == [None, 1.0, 3.0, "abc"]

    def test_missing_key_does_not_crash(self):
        data = {"S": [{"v": 5.0}, {"other": 1}, {"v": 2.0}]}
        config = {"source": "S", "column": "v", "descending": True}
        result = SortTransformation().transform(data, config)["S"]
        assert len(result) == 3  # не бросил TypeError


# ---------- #15: гард DoS по степени ловит левую вложенность ----------

class TestCalculatePowGuard:
    def test_nested_pow_is_guarded_and_fast(self):
        data = {"S": [{"x": 1}]}
        config = {
            "source": "S",
            "output_column": "r",
            "formula": "((((((10**90)**90)**90)**90)**90)**90)",
        }
        start = time.monotonic()
        result = CalculateTransformation().transform(data, config)["S"]
        elapsed = time.monotonic() - start
        assert elapsed < 2.0  # не зависло на вычислении гигантского int
        assert result[0]["r"] is None  # гард -> ValueError -> None

    def test_reasonable_pow_still_computes(self):
        data = {"S": [{"x": 2}]}
        config = {"source": "S", "output_column": "r", "formula": "x ** 10"}
        result = CalculateTransformation().transform(data, config)["S"]
        assert result[0]["r"] == 1024


# ---------- #3: экранирование формул Google Sheets ----------

class TestSheetsFormulaEscaping:
    @pytest.mark.parametrize("raw,expected", [
        ("=IMPORTXML(\"http://evil\")", "'=IMPORTXML(\"http://evil\")"),
        ("+1+1", "'+1+1"),
        ("-cmd", "'-cmd"),
        ("@ref", "'@ref"),
        ("\tTabbed", "'\tTabbed"),
        ("Acme Campaign", "Acme Campaign"),   # обычный текст не трогаем
        ("2025-01-01", "2025-01-01"),
        ("", ""),
    ])
    def test_escape(self, raw, expected):
        assert _escape_formula_value(raw) == expected


# ---------- #1: нормализация email ----------

class TestEmailNormalization:
    def test_usercreate_lowercases_email(self):
        assert UserCreate(email="Me@Example.COM", password="x").email == "me@example.com"

    def test_userlogin_lowercases_email(self):
        assert UserLogin(email="USER@Corp.com", password="x").email == "user@corp.com"


# ---------- #2: PRAGMA foreign_keys реально включён на движке приложения ----------

class TestForeignKeysEnforced:
    async def test_foreign_keys_pragma_on(self, db_session):
        result = await db_session.execute(text("PRAGMA foreign_keys"))
        assert result.scalar() == 1


# ---------- #7 + #2: upsert на удалённый проект -> чистый 404, не 500 ----------

class TestUpsertOnMissingProject:
    async def test_missing_project_raises_404_not_500(self, db_session):
        # foreign_keys=ON: вставка интеграции для несуществующего проекта даёт
        # FK-IntegrityError. upsert не должен принять её за гонку uniqueness и
        # упасть NoResultFound (500) — ожидаем осмысленный HTTPException 404.
        with pytest.raises(HTTPException) as exc:
            await upsert_integration(
                db_session,
                project_id=987654,
                integration_type="google_sheets",
                access_token="t",
                refresh_token="r",
                expires_in=3600,
                account_info={},
            )
        assert exc.value.status_code == 404
