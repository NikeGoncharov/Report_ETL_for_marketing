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
    TransformationError,
)
from app.google_sheets import _escape_formula_value
from app.schemas import UserCreate, UserLogin
from app.integrations import (
    upsert_integration,
    build_oauth_state,
    parse_oauth_state,
)


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


# ---------- H1: составной ключ сшивки (кампания + дата) ----------

class TestCompositeJoinKey:
    def test_single_key_on_daily_data_inflates(self):
        """Фиксирует ПРИЧИНУ бага: по одному ключу дневные данные множатся."""
        data = {
            "L": [
                {"date": "2026-08-01", "campaignname": "Brand", "cost": 10},
                {"date": "2026-08-02", "campaignname": "Brand", "cost": 20},
            ],
            "R": [
                {"date": "2026-08-01", "utmcampaign": "brand", "visits": 5},
                {"date": "2026-08-02", "utmcampaign": "brand", "visits": 7},
            ],
        }
        config = {"left": "L", "right": "R", "left_on": "campaignname",
                  "right_on": "utmcampaign", "how": "left", "output": "L"}
        result = JoinTransformation().transform(data, config)["L"]
        assert len(result) == 4  # декартово произведение 2×2

    def test_composite_key_matches_day_to_day(self):
        data = {
            "L": [
                {"date": "2026-08-01", "campaignname": "Brand", "cost": 10},
                {"date": "2026-08-02", "campaignname": "Brand", "cost": 20},
            ],
            "R": [
                {"date": "2026-08-01", "utmcampaign": "brand", "visits": 5},
                {"date": "2026-08-02", "utmcampaign": "brand", "visits": 7},
            ],
        }
        config = {
            "left": "L", "right": "R",
            "left_on": ["campaignname", "date"],
            "right_on": ["utmcampaign", "date"],
            "how": "left", "output": "L",
        }
        result = JoinTransformation().transform(data, config)["L"]
        assert len(result) == 2
        assert sum(r["cost"] for r in result) == 30      # не 60
        assert sum(r["visits"] for r in result) == 12    # не 24
        # день к своему дню, а не вперемешку
        by_date = {r["date"]: r for r in result}
        assert by_date["2026-08-01"]["visits"] == 5
        assert by_date["2026-08-02"]["visits"] == 7

    def test_symmetrically_empty_pair_does_not_narrow_key(self):
        """Ревью-регресс: ["", "date"] / ["", "date"] раньше схлопывалось в
        ["date"]/["date"] и возвращало декартов взрыв. Теперь пустая пара просто
        не учитывается, а оставшаяся пара работает как есть."""
        data = {
            "L": [
                {"date": "2026-08-01", "campaignname": "A", "cost": 10},
                {"date": "2026-08-01", "campaignname": "B", "cost": 20},
            ],
            "R": [
                {"date": "2026-08-01", "utmcampaign": "a", "visits": 1},
                {"date": "2026-08-01", "utmcampaign": "b", "visits": 2},
            ],
        }
        config = {
            "left": "L", "right": "R",
            "left_on": ["campaignname", "date"],
            "right_on": ["utmcampaign", "date"],
            "how": "left", "output": "L",
        }
        result = JoinTransformation().transform(data, config)["L"]
        assert len(result) == 2                       # не 4
        assert sum(r["cost"] for r in result) == 30   # не 60

    def test_half_filled_pair_raises_instead_of_narrowing(self):
        data = {"L": [{"a": 1, "d": "x"}], "R": [{"b": 2, "d": "x"}]}
        config = {"left": "L", "right": "R",
                  "left_on": ["", "d"], "right_on": ["b", "d"],
                  "how": "left", "output": "L"}
        with pytest.raises(TransformationError) as exc:
            JoinTransformation().transform(data, config)
        assert "паре ключей" in str(exc.value)

    def test_missing_key_column_raises_not_silently_empty(self):
        """Опечатка/отсутствующая колонка раньше давала пустой результат,
        который затирал клиентскую таблицу. Теперь — понятная ошибка."""
        data = {
            "L": [{"campaignname": "A", "cost": 10}],   # нет колонки date
            "R": [{"utmcampaign": "a", "date": "2026-08-01", "visits": 1}],
        }
        config = {"left": "L", "right": "R",
                  "left_on": ["campaignname", "date"],
                  "right_on": ["utmcampaign", "date"],
                  "how": "inner", "output": "L"}
        with pytest.raises(TransformationError) as exc:
            JoinTransformation().transform(data, config)
        assert "date" in str(exc.value)

    def test_unmatched_right_row_keeps_colliding_column(self):
        """Одноимённая колонка правого датасета не затирается ключом, а
        сохраняется как right_<name> — как в ветке сматченных строк."""
        data = {
            "L": [{"campaignname": "Brand", "cost": 10}],
            "R": [{"utmcampaign": "Other", "campaignname": "RightOwn", "visits": 3}],
        }
        config = {"left": "L", "right": "R", "left_on": "campaignname",
                  "right_on": "utmcampaign", "how": "outer", "output": "L"}
        result = JoinTransformation().transform(data, config)["L"]
        unmatched = [r for r in result if r.get("visits") == 3][0]
        assert unmatched["campaignname"] == "Other"          # ключ
        assert unmatched["right_campaignname"] == "RightOwn"  # исходное не потеряно

    def test_mismatched_key_count_raises(self):
        data = {"L": [{"a": 1}], "R": [{"b": 2}]}
        config = {"left": "L", "right": "R", "left_on": ["a", "x"],
                  "right_on": ["b"], "how": "left", "output": "L"}
        with pytest.raises(TransformationError):
            JoinTransformation().transform(data, config)

    def test_unmatched_right_rows_carry_left_key_name(self):
        """medium-находка: в right/outer ключ должен лежать в ЛЕВОЙ колонке,
        иначе последующая группировка теряет несматченные строки."""
        data = {
            "L": [{"campaignname": "Brand", "cost": 10}],
            "R": [{"utmcampaign": "Other", "visits": 3}],
        }
        config = {"left": "L", "right": "R", "left_on": "campaignname",
                  "right_on": "utmcampaign", "how": "outer", "output": "L"}
        result = JoinTransformation().transform(data, config)["L"]
        unmatched = [r for r in result if r.get("visits") == 3]
        assert len(unmatched) == 1
        assert unmatched[0]["campaignname"] == "Other"   # ключ под левым именем
        assert "utmcampaign" not in unmatched[0]


# ---------- H2: лимиты пользовательского regex ----------

class TestRegexLimits:
    def test_overlong_pattern_rejected(self):
        from app.transformations import ExtractTransformation
        data = {"S": [{"c": "x"}]}
        config = {"source": "S", "column": "c", "pattern": "a" * 500,
                  "output_column": "out"}
        with pytest.raises(TransformationError):
            ExtractTransformation().transform(data, config)

    def test_input_value_is_truncated_for_regex(self):
        """Длина входа ограничена — экспоненциальный бэктрекинг не разгоняется."""
        from app.transformations import ExtractTransformation
        data = {"S": [{"c": "y" * 5000}]}
        config = {"source": "S", "column": "c", "pattern": r"(\d+)",
                  "output_column": "out"}
        start = time.monotonic()
        result = ExtractTransformation().transform(data, config)["S"]
        assert time.monotonic() - start < 2.0
        # совпадения нет -> вернулось усечённое значение, а не исходные 5000
        assert len(result[0]["out"]) <= 512


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


# ---------- H3/H4: OAuth state привязан к пользователю и одноразов ----------

class TestOAuthStateBinding:
    def test_state_carries_initiator_and_roundtrips(self):
        state = build_oauth_state(user_id=7, project_id=42, integration_type="yandex_direct")
        user_id, project_id, itype = parse_oauth_state(state, ("yandex_direct", "yandex_metrika"))
        assert (user_id, project_id, itype) == (7, 42, "yandex_direct")

    def test_state_is_single_use(self):
        # Повторное предъявление (state из логов/истории браузера) отклоняется
        state = build_oauth_state(user_id=7, project_id=42, integration_type="google_sheets")
        parse_oauth_state(state, ("google_sheets",))
        with pytest.raises(HTTPException) as exc:
            parse_oauth_state(state, ("google_sheets",))
        assert exc.value.status_code == 400

    def test_wrong_integration_type_rejected(self):
        state = build_oauth_state(user_id=7, project_id=42, integration_type="google_sheets")
        with pytest.raises(HTTPException) as exc:
            parse_oauth_state(state, ("yandex_direct", "yandex_metrika"))
        assert exc.value.status_code == 400

    def test_tampered_user_id_rejected(self):
        # Подмена user_id ломает HMAC-подпись
        state = build_oauth_state(user_id=7, project_id=42, integration_type="yandex_direct")
        payload, expires, signature = state.rsplit("|", 2)
        forged = f"{payload.replace('7:', '8:', 1)}|{expires}|{signature}"
        with pytest.raises(HTTPException) as exc:
            parse_oauth_state(forged, ("yandex_direct",))
        assert exc.value.status_code == 400


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
