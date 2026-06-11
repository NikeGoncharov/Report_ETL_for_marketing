"""Tests for the staged report pipeline (config v2)."""
import pytest
from unittest.mock import patch, AsyncMock
from httpx import AsyncClient

from app.reports import _fetch_cache


DIRECT_ROWS = [
    {"campaignname": "Brand Search", "adnetworktype": "SEARCH", "impressions": 1000, "clicks": 100, "cost": 500.0},
    {"campaignname": "Brand RSYA", "adnetworktype": "AD_NETWORK", "impressions": 5000, "clicks": 50, "cost": 300.0},
    {"campaignname": "Promo RSYA", "adnetworktype": "AD_NETWORK", "impressions": 7000, "clicks": 70, "cost": 400.0},
]

METRIKA_RESPONSE = {
    "query": {
        "metrics": ["ym:s:visits", "ym:s:bounceRate"],
        "dimensions": ["ym:s:UTMCampaign"],
    },
    "data": [
        {"dimensions": [{"name": "brand search"}], "metrics": [90, 12.5]},
        {"dimensions": [{"name": "brand rsya"}], "metrics": [45, 30.0]},
    ],
}


def v2_config(**overrides):
    config = {
        "version": 2,
        "datasets": [
            {
                "id": "direct",
                "type": "direct",
                "campaign_ids": [],
                "fields": ["CampaignName", "AdNetworkType", "Impressions", "Clicks", "Cost"],
                "include_vat": False,
                "steps": [],
            },
            {
                "id": "metrika",
                "type": "metrika",
                "counter_id": 123,
                "metrics": ["ym:s:visits", "ym:s:bounceRate"],
                "dimensions": ["ym:s:UTMCampaign"],
                "steps": [],
            },
        ],
        "period": {"type": "last_7_days"},
        "merge": {"enabled": False},
        "grouping": {"enabled": False},
        "export": {"type": "google_sheets", "create_new": True},
    }
    config.update(overrides)
    return config


@pytest.fixture(autouse=True)
def clear_fetch_cache():
    """Кэш выгрузок глобален для процесса — изолируем тесты."""
    _fetch_cache.clear()
    yield
    _fetch_cache.clear()


class TestV2ConfigValidation:
    """Validation of v2 configs on create/update."""

    @pytest.mark.asyncio
    async def test_create_report_with_v2_config(
        self, client: AsyncClient, auth_headers, test_project
    ):
        response = await client.post(
            f"/projects/{test_project.id}/reports",
            json={"name": "V2 report", "config": v2_config()},
            headers=auth_headers,
        )

        assert response.status_code == 201
        saved = response.json()["config"]
        assert saved["version"] == 2
        assert saved["datasets"][0]["include_vat"] is False
        assert saved["export"]["create_new"] is True

    @pytest.mark.asyncio
    async def test_unknown_field_rejected_not_stripped(
        self, client: AsyncClient, auth_headers, test_project
    ):
        """Лишнее поле в v2-конфиге — это 422, а не молчаливая потеря."""
        config = v2_config()
        config["datasets"][0]["unknown_field"] = "oops"

        response = await client.post(
            f"/projects/{test_project.id}/reports",
            json={"name": "Bad", "config": config},
            headers=auth_headers,
        )

        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_legacy_v1_config_still_accepted(
        self, client: AsyncClient, auth_headers, test_project
    ):
        response = await client.post(
            f"/projects/{test_project.id}/reports",
            json={
                "name": "Legacy",
                "config": {
                    "sources": [{"id": "direct", "type": "direct", "campaign_ids": []}],
                    "period": {"type": "last_7_days"},
                    "transformations": [],
                    "export": {"type": "google_sheets"},
                },
            },
            headers=auth_headers,
        )

        assert response.status_code == 201
        assert "version" not in response.json()["config"]


class TestV2PreviewStages:
    """Staged preview: fetched -> transformed -> merged -> final."""

    @pytest.mark.asyncio
    @patch("app.reports.fetch_direct_stats", new_callable=AsyncMock, return_value=DIRECT_ROWS)
    async def test_fetched_stage_single_dataset(
        self, mock_fetch, client: AsyncClient, auth_headers, test_project, test_integration_direct
    ):
        response = await client.post(
            f"/projects/{test_project.id}/reports/preview",
            json={"config": v2_config(), "stage": "fetched", "dataset_id": "direct"},
            headers=auth_headers,
        )

        assert response.status_code == 200
        data = response.json()
        assert data["row_count"] == 3
        assert "campaignname" in data["columns"]
        # Метрику не трогали: запрошен только direct
        mock_fetch.assert_awaited_once()
        # include_vat из конфига дошёл до выгрузки
        assert mock_fetch.call_args.kwargs["include_vat"] is False

    @pytest.mark.asyncio
    @patch("app.reports.fetch_direct_stats", new_callable=AsyncMock, return_value=DIRECT_ROWS)
    async def test_transformed_stage_applies_steps(
        self, mock_fetch, client: AsyncClient, auth_headers, test_project, test_integration_direct
    ):
        config = v2_config()
        config["datasets"][0]["steps"] = [
            {"type": "filter", "column": "adnetworktype", "operator": "eq", "value": "AD_NETWORK"},
            {"type": "sort", "column": "cost", "descending": True},
        ]

        response = await client.post(
            f"/projects/{test_project.id}/reports/preview",
            json={"config": config, "stage": "transformed", "dataset_id": "direct"},
            headers=auth_headers,
        )

        assert response.status_code == 200
        data = response.json()
        assert data["row_count"] == 2
        assert data["data"][0]["cost"] == 400.0  # сортировка по убыванию пережила превью

    @pytest.mark.asyncio
    @patch("app.reports.call_metrika_api", new_callable=AsyncMock, return_value=METRIKA_RESPONSE)
    @patch("app.reports.fetch_direct_stats", new_callable=AsyncMock, return_value=DIRECT_ROWS)
    async def test_merged_stage_joins_campaign_to_utm(
        self, mock_direct, mock_metrika, client: AsyncClient, auth_headers,
        test_project, test_integration_direct, test_integration_metrika
    ):
        """Сшивка кампаний Директа с UTM-метками Метрики (без учёта регистра)."""
        config = v2_config(merge={
            "enabled": True,
            "left": "direct",
            "right": "metrika",
            "left_key": "campaignname",
            "right_key": "UTMCampaign",
            "how": "left",
        })

        response = await client.post(
            f"/projects/{test_project.id}/reports/preview",
            json={"config": config, "stage": "merged"},
            headers=auth_headers,
        )

        assert response.status_code == 200
        data = response.json()
        assert data["row_count"] == 3
        by_name = {row["campaignname"]: row for row in data["data"]}
        # "Brand Search" сматчилась с "brand search" из UTM
        assert by_name["Brand Search"]["visits"] == 90
        assert by_name["Brand RSYA"]["visits"] == 45
        # Несматченная кампания осталась (left join), визитов нет
        assert "visits" not in by_name["Promo RSYA"]
        # Колонка visits есть в общем списке колонок, хотя её нет в первой строке
        assert "visits" in data["columns"]

    @pytest.mark.asyncio
    @patch("app.reports.call_metrika_api", new_callable=AsyncMock, return_value=METRIKA_RESPONSE)
    @patch("app.reports.fetch_direct_stats", new_callable=AsyncMock, return_value=DIRECT_ROWS)
    async def test_final_stage_groups_by_network_type(
        self, mock_direct, mock_metrika, client: AsyncClient, auth_headers,
        test_project, test_integration_direct, test_integration_metrika
    ):
        """Группировка: из 3 кампаний — 2 строки (Поиск и РСЯ)."""
        config = v2_config(
            merge={"enabled": False},
            grouping={
                "enabled": True,
                "columns": ["adnetworktype"],
                "aggregations": {"impressions": "sum", "clicks": "sum", "cost": "sum"},
            },
        )

        response = await client.post(
            f"/projects/{test_project.id}/reports/preview",
            json={"config": config, "stage": "final"},
            headers=auth_headers,
        )

        assert response.status_code == 200
        data = response.json()
        assert data["row_count"] == 2
        by_type = {row["adnetworktype"]: row for row in data["data"]}
        assert by_type["AD_NETWORK"]["cost"] == 700.0
        assert by_type["AD_NETWORK"]["clicks"] == 120
        assert by_type["SEARCH"]["cost"] == 500.0


class TestV2FetchCache:
    """Server-side cache of fetched data (state 1)."""

    @pytest.mark.asyncio
    @patch("app.reports.fetch_direct_stats", new_callable=AsyncMock, return_value=DIRECT_ROWS)
    async def test_second_preview_uses_cache(
        self, mock_fetch, client: AsyncClient, auth_headers, test_project, test_integration_direct
    ):
        body = {"config": v2_config(), "stage": "fetched", "dataset_id": "direct"}

        for _ in range(2):
            response = await client.post(
                f"/projects/{test_project.id}/reports/preview",
                json=body, headers=auth_headers,
            )
            assert response.status_code == 200

        assert mock_fetch.await_count == 1

    @pytest.mark.asyncio
    @patch("app.reports.fetch_direct_stats", new_callable=AsyncMock, return_value=DIRECT_ROWS)
    async def test_refresh_bypasses_cache(
        self, mock_fetch, client: AsyncClient, auth_headers, test_project, test_integration_direct
    ):
        body = {"config": v2_config(), "stage": "fetched", "dataset_id": "direct"}
        await client.post(
            f"/projects/{test_project.id}/reports/preview", json=body, headers=auth_headers
        )

        body["refresh"] = True
        response = await client.post(
            f"/projects/{test_project.id}/reports/preview", json=body, headers=auth_headers
        )

        assert response.status_code == 200
        assert mock_fetch.await_count == 2

    @pytest.mark.asyncio
    @patch("app.reports.fetch_direct_stats", new_callable=AsyncMock, return_value=DIRECT_ROWS)
    async def test_changed_source_params_refetch(
        self, mock_fetch, client: AsyncClient, auth_headers, test_project, test_integration_direct
    ):
        """Изменение параметров выгрузки (НДС) инвалидирует кэш, шаги — нет."""
        config = v2_config()
        body = {"config": config, "stage": "fetched", "dataset_id": "direct"}
        await client.post(
            f"/projects/{test_project.id}/reports/preview", json=body, headers=auth_headers
        )

        # Шаги трансформаций не входят в ключ кэша
        config["datasets"][0]["steps"] = [
            {"type": "sort", "column": "cost", "descending": True}
        ]
        await client.post(
            f"/projects/{test_project.id}/reports/preview",
            json={"config": config, "stage": "transformed", "dataset_id": "direct"},
            headers=auth_headers,
        )
        assert mock_fetch.await_count == 1

        # А параметры источника — входят
        config["datasets"][0]["include_vat"] = True
        await client.post(
            f"/projects/{test_project.id}/reports/preview",
            json={"config": config, "stage": "fetched", "dataset_id": "direct"},
            headers=auth_headers,
        )
        assert mock_fetch.await_count == 2


class TestCatalog:
    """Catalog endpoint for UI pickers."""

    @pytest.mark.asyncio
    async def test_catalog_returns_lists(self, client: AsyncClient, auth_headers):
        response = await client.get("/reports/catalog", headers=auth_headers)

        assert response.status_code == 200
        data = response.json()
        for key in ("direct_fields", "metrika_metrics", "metrika_dimensions",
                    "periods", "aggregations", "filter_operators", "step_types"):
            assert key in data and len(data[key]) > 0

        field_ids = {f["id"] for f in data["direct_fields"]}
        assert "AdNetworkType" in field_ids  # срез Поиск/РСЯ для группировки
        period_ids = {p["id"] for p in data["periods"]}
        assert {"today", "yesterday", "last_15_days", "this_month", "last_month"} <= period_ids

    @pytest.mark.asyncio
    async def test_catalog_requires_auth(self, client: AsyncClient):
        response = await client.get("/reports/catalog")
        assert response.status_code == 401
