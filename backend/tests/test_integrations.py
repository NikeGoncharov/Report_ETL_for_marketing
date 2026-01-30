"""Tests for integrations API endpoints with mocked external APIs."""
import pytest
from unittest.mock import patch, AsyncMock, MagicMock
from datetime import datetime, timedelta
from httpx import AsyncClient, Response
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.models import Integration, Project


class TestGetProjectIntegrations:
    """Tests for GET /integrations/projects/{project_id} endpoint."""
    
    @pytest.mark.asyncio
    async def test_get_integrations_empty(
        self, client: AsyncClient, auth_headers, test_project
    ):
        """Should return empty list when project has no integrations."""
        response = await client.get(
            f"/integrations/projects/{test_project.id}",
            headers=auth_headers
        )
        
        assert response.status_code == 200
        assert response.json() == []
    
    @pytest.mark.asyncio
    async def test_get_integrations_with_data(
        self, client: AsyncClient, auth_headers, test_project,
        test_integration_direct, test_integration_metrika
    ):
        """Should return list of integrations."""
        response = await client.get(
            f"/integrations/projects/{test_project.id}",
            headers=auth_headers
        )
        
        assert response.status_code == 200
        data = response.json()
        assert len(data) == 2
        
        types = {i["type"] for i in data}
        assert "yandex_direct" in types
        assert "yandex_metrika" in types
    
    @pytest.mark.asyncio
    async def test_get_integrations_unauthenticated(
        self, client: AsyncClient, test_project
    ):
        """Should fail without authentication."""
        response = await client.get(f"/integrations/projects/{test_project.id}")
        
        assert response.status_code == 401
    
    @pytest.mark.asyncio
    async def test_get_integrations_not_found_project(
        self, client: AsyncClient, auth_headers
    ):
        """Should return 404 for non-existent project."""
        response = await client.get(
            "/integrations/projects/99999",
            headers=auth_headers
        )
        
        assert response.status_code == 404


class TestDeleteIntegration:
    """Tests for DELETE /integrations/{integration_id} endpoint."""
    
    @pytest.mark.asyncio
    async def test_delete_integration_success(
        self, client: AsyncClient, auth_headers, test_integration_direct,
        db_session: AsyncSession
    ):
        """Should delete an integration."""
        response = await client.delete(
            f"/integrations/{test_integration_direct.id}",
            headers=auth_headers
        )
        
        assert response.status_code == 204
        
        # Verify it's deleted
        result = await db_session.execute(
            select(Integration).where(Integration.id == test_integration_direct.id)
        )
        assert result.scalar_one_or_none() is None
    
    @pytest.mark.asyncio
    async def test_delete_integration_not_found(
        self, client: AsyncClient, auth_headers
    ):
        """Should return 404 for non-existent integration."""
        response = await client.delete(
            "/integrations/99999",
            headers=auth_headers
        )
        
        assert response.status_code == 404
    
    @pytest.mark.asyncio
    async def test_delete_integration_unauthenticated(
        self, client: AsyncClient, test_integration_direct
    ):
        """Should fail without authentication."""
        response = await client.delete(
            f"/integrations/{test_integration_direct.id}"
        )
        
        assert response.status_code == 401


class TestYandexAuthUrl:
    """Tests for GET /integrations/yandex/auth-url endpoint."""
    
    @pytest.mark.asyncio
    @patch("app.integrations.YANDEX_CLIENT_ID", "test_client_id")
    async def test_get_auth_url_direct(
        self, client: AsyncClient, auth_headers, test_project
    ):
        """Should return auth URL for Direct."""
        response = await client.get(
            "/integrations/yandex/auth-url",
            params={
                "project_id": test_project.id,
                "integration_type": "yandex_direct"
            },
            headers=auth_headers
        )
        
        assert response.status_code == 200
        data = response.json()
        assert "auth_url" in data
        assert "oauth.yandex.ru" in data["auth_url"]
        assert "direct:api" in data["auth_url"]
    
    @pytest.mark.asyncio
    @patch("app.integrations.YANDEX_CLIENT_ID", "test_client_id")
    async def test_get_auth_url_metrika(
        self, client: AsyncClient, auth_headers, test_project
    ):
        """Should return auth URL for Metrika."""
        response = await client.get(
            "/integrations/yandex/auth-url",
            params={
                "project_id": test_project.id,
                "integration_type": "yandex_metrika"
            },
            headers=auth_headers
        )
        
        assert response.status_code == 200
        data = response.json()
        assert "auth_url" in data
        assert "metrika:read" in data["auth_url"]
    
    @pytest.mark.asyncio
    @patch("app.integrations.YANDEX_CLIENT_ID", None)
    async def test_get_auth_url_not_configured(
        self, client: AsyncClient, auth_headers, test_project
    ):
        """Should return 500 if Yandex OAuth not configured."""
        response = await client.get(
            "/integrations/yandex/auth-url",
            params={
                "project_id": test_project.id,
                "integration_type": "yandex_direct"
            },
            headers=auth_headers
        )
        
        assert response.status_code == 500
        assert "not configured" in response.json()["detail"].lower()
    
    @pytest.mark.asyncio
    @patch("app.integrations.YANDEX_CLIENT_ID", "test_client_id")
    async def test_get_auth_url_invalid_type(
        self, client: AsyncClient, auth_headers, test_project
    ):
        """Should reject invalid integration type."""
        response = await client.get(
            "/integrations/yandex/auth-url",
            params={
                "project_id": test_project.id,
                "integration_type": "invalid_type"
            },
            headers=auth_headers
        )
        
        assert response.status_code == 422


class TestGoogleAuthUrl:
    """Tests for GET /integrations/google/auth-url endpoint."""
    
    @pytest.mark.asyncio
    @patch("app.integrations.GOOGLE_CLIENT_ID", "test_client_id")
    async def test_get_auth_url(
        self, client: AsyncClient, auth_headers, test_project
    ):
        """Should return Google auth URL."""
        response = await client.get(
            "/integrations/google/auth-url",
            params={"project_id": test_project.id},
            headers=auth_headers
        )
        
        assert response.status_code == 200
        data = response.json()
        assert "auth_url" in data
        assert "accounts.google.com" in data["auth_url"]
        assert "spreadsheets" in data["auth_url"]
    
    @pytest.mark.asyncio
    @patch("app.integrations.GOOGLE_CLIENT_ID", None)
    async def test_get_auth_url_not_configured(
        self, client: AsyncClient, auth_headers, test_project
    ):
        """Should return 500 if Google OAuth not configured."""
        response = await client.get(
            "/integrations/google/auth-url",
            params={"project_id": test_project.id},
            headers=auth_headers
        )
        
        assert response.status_code == 500
        assert "not configured" in response.json()["detail"].lower()


class TestYandexDirectAPI:
    """Tests for Yandex.Direct API endpoints with mocked responses."""
    
    @pytest.mark.asyncio
    async def test_get_campaigns_success(
        self, client: AsyncClient, auth_headers, test_project,
        test_integration_direct
    ):
        """Should return campaigns list."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "result": {
                "Campaigns": [
                    {
                        "Id": 123,
                        "Name": "Test Campaign",
                        "Status": "ACCEPTED",
                        "State": "ON",
                        "Type": "TEXT_CAMPAIGN",
                        "StartDate": "2025-01-01",
                        "DailyBudget": {"Amount": 1000000}
                    }
                ]
            }
        }
        
        mock_client = MagicMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)
        mock_client.post = AsyncMock(return_value=mock_response)
        
        with patch("app.direct.httpx.AsyncClient", return_value=mock_client):
            response = await client.get(
                "/direct/campaigns",
                params={"project_id": test_project.id},
                headers=auth_headers
            )
        
        assert response.status_code == 200
        data = response.json()
        assert len(data) == 1
        assert data[0]["id"] == 123
        assert data[0]["name"] == "Test Campaign"
    
    @pytest.mark.asyncio
    async def test_get_campaigns_no_integration(
        self, client: AsyncClient, auth_headers, test_project
    ):
        """Should return error if no Direct integration."""
        response = await client.get(
            "/direct/campaigns",
            params={"project_id": test_project.id},
            headers=auth_headers
        )
        
        assert response.status_code == 400
        assert "not connected" in response.json()["detail"].lower()


class TestYandexMetrikaAPI:
    """Tests for Yandex.Metrika API endpoints with mocked responses."""
    
    @pytest.mark.asyncio
    async def test_get_counters_success(
        self, client: AsyncClient, auth_headers, test_project,
        test_integration_metrika
    ):
        """Should return counters list."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "counters": [
                {
                    "id": 12345678,
                    "name": "Test Counter",
                    "site": "example.com",
                    "status": "Active"
                }
            ]
        }
        
        mock_client = MagicMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)
        mock_client.get = AsyncMock(return_value=mock_response)
        
        with patch("app.metrika.httpx.AsyncClient", return_value=mock_client):
            response = await client.get(
                "/metrika/counters",
                params={"project_id": test_project.id},
                headers=auth_headers
            )
        
        assert response.status_code == 200
        data = response.json()
        assert len(data) == 1
        assert data[0]["id"] == 12345678
        assert data[0]["name"] == "Test Counter"
    
    @pytest.mark.asyncio
    async def test_get_counters_no_integration(
        self, client: AsyncClient, auth_headers, test_project
    ):
        """Should return error if no Metrika integration."""
        response = await client.get(
            "/metrika/counters",
            params={"project_id": test_project.id},
            headers=auth_headers
        )
        
        assert response.status_code == 400
        assert "not connected" in response.json()["detail"].lower()
    
    @pytest.mark.asyncio
    async def test_get_goals_success(
        self, client: AsyncClient, auth_headers, test_project,
        test_integration_metrika
    ):
        """Should return goals list."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "goals": [
                {"id": 1, "name": "Purchase", "type": "url"},
                {"id": 2, "name": "Lead Form", "type": "action"}
            ]
        }
        
        mock_client = MagicMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)
        mock_client.get = AsyncMock(return_value=mock_response)
        
        with patch("app.metrika.httpx.AsyncClient", return_value=mock_client):
            response = await client.get(
                "/metrika/goals",
                params={
                    "project_id": test_project.id,
                    "counter_id": 12345678
                },
                headers=auth_headers
            )
        
        assert response.status_code == 200
        data = response.json()
        assert len(data) == 2
    
    @pytest.mark.asyncio
    async def test_get_stats_success(
        self, client: AsyncClient, auth_headers, test_project,
        test_integration_metrika
    ):
        """Should return statistics."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "query": {
                "metrics": ["ym:s:visits", "ym:s:users"],
                "dimensions": ["ym:s:date"]
            },
            "data": [
                {
                    "dimensions": [{"name": "2025-01-01"}],
                    "metrics": [100, 80]
                }
            ],
            "totals": [100, 80]
        }
        
        mock_client = MagicMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)
        mock_client.get = AsyncMock(return_value=mock_response)
        
        with patch("app.metrika.httpx.AsyncClient", return_value=mock_client):
            response = await client.get(
                "/metrika/stats",
                params={
                    "project_id": test_project.id,
                    "counter_id": 12345678,
                    "date_from": "2025-01-01",
                    "date_to": "2025-01-31"
                },
                headers=auth_headers
            )
        
        assert response.status_code == 200
        data = response.json()
        assert "columns" in data
        assert "data" in data
        assert data["row_count"] == 1


class TestGoogleSheetsAPI:
    """Tests for Google Sheets API endpoints with mocked responses."""
    
    @pytest.mark.asyncio
    async def test_list_spreadsheets_success(
        self, client: AsyncClient, auth_headers, test_project,
        test_integration_sheets
    ):
        """Should return spreadsheets list."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "files": [
                {
                    "id": "sheet_id_123",
                    "name": "My Spreadsheet",
                    "createdTime": "2025-01-01T00:00:00Z",
                    "modifiedTime": "2025-01-15T00:00:00Z",
                    "webViewLink": "https://docs.google.com/spreadsheets/d/sheet_id_123"
                }
            ]
        }
        
        mock_client = MagicMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)
        mock_client.get = AsyncMock(return_value=mock_response)
        
        with patch("app.google_sheets.httpx.AsyncClient", return_value=mock_client):
            response = await client.get(
                "/sheets/list",
                params={"project_id": test_project.id},
                headers=auth_headers
            )
        
        assert response.status_code == 200
        data = response.json()
        assert len(data) == 1
        assert data[0]["id"] == "sheet_id_123"
        assert data[0]["name"] == "My Spreadsheet"
    
    @pytest.mark.asyncio
    async def test_list_spreadsheets_no_integration(
        self, client: AsyncClient, auth_headers, test_project
    ):
        """Should return error if no Sheets integration."""
        response = await client.get(
            "/sheets/list",
            params={"project_id": test_project.id},
            headers=auth_headers
        )
        
        assert response.status_code == 400
        assert "not connected" in response.json()["detail"].lower()
    
    @pytest.mark.asyncio
    async def test_create_spreadsheet_success(
        self, client: AsyncClient, auth_headers, test_project,
        test_integration_sheets
    ):
        """Should create a new spreadsheet."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "spreadsheetId": "new_sheet_id",
            "spreadsheetUrl": "https://docs.google.com/spreadsheets/d/new_sheet_id",
            "properties": {"title": "Test Spreadsheet"}
        }
        
        mock_client = MagicMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)
        mock_client.post = AsyncMock(return_value=mock_response)
        
        with patch("app.google_sheets.httpx.AsyncClient", return_value=mock_client):
            response = await client.post(
                "/sheets/create",
                params={"project_id": test_project.id},
                headers=auth_headers,
                json={"title": "Test Spreadsheet"}
            )
        
        assert response.status_code == 200
        data = response.json()
        assert data["id"] == "new_sheet_id"
        assert data["title"] == "Test Spreadsheet"


class TestTokenRefresh:
    """Tests for token refresh functionality."""
    
    @pytest.mark.asyncio
    async def test_token_refresh_when_expired(
        self, client: AsyncClient, auth_headers, test_project,
        db_session: AsyncSession
    ):
        """Should refresh expired token."""
        # Create integration with expired token
        integration = Integration(
            project_id=test_project.id,
            type="yandex_direct",
            access_token="expired_token",
            refresh_token="valid_refresh_token",
            expires_at=datetime.utcnow() - timedelta(hours=1),  # Expired
            account_info={"login": "test"}
        )
        db_session.add(integration)
        await db_session.commit()
        
        # Mock token refresh response
        mock_token_response = MagicMock()
        mock_token_response.status_code = 200
        mock_token_response.json.return_value = {
            "access_token": "new_access_token",
            "refresh_token": "new_refresh_token",
            "expires_in": 3600
        }
        
        # Mock campaigns API response
        mock_campaigns_response = MagicMock()
        mock_campaigns_response.status_code = 200
        mock_campaigns_response.json.return_value = {"result": {"Campaigns": []}}
        
        mock_client = MagicMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)
        mock_client.post = AsyncMock(side_effect=[mock_token_response, mock_campaigns_response])
        
        with patch("app.integrations.httpx.AsyncClient", return_value=mock_client):
            with patch("app.direct.httpx.AsyncClient", return_value=mock_client):
                response = await client.get(
                    "/direct/campaigns",
                    params={"project_id": test_project.id},
                    headers=auth_headers
                )
        
        # Should succeed after refresh
        assert response.status_code == 200
    
    @pytest.mark.asyncio
    async def test_token_not_refreshed_when_valid(
        self, client: AsyncClient, auth_headers, test_project,
        test_integration_direct
    ):
        """Should use existing token if not expired."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"result": {"Campaigns": []}}
        
        mock_client = MagicMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)
        mock_client.post = AsyncMock(return_value=mock_response)
        
        with patch("app.direct.httpx.AsyncClient", return_value=mock_client):
            response = await client.get(
                "/direct/campaigns",
                params={"project_id": test_project.id},
                headers=auth_headers
            )
        
        assert response.status_code == 200
        # Should only call API once (no refresh needed)
        assert mock_client.post.call_count == 1


class TestIntegrationSecurity:
    """Security tests for integrations."""
    
    @pytest.mark.asyncio
    async def test_cannot_access_other_user_integration(
        self, client: AsyncClient, auth_headers, db_session: AsyncSession
    ):
        """Should not access integrations of other user's project."""
        from app.auth import get_password_hash
        
        # Create another user and their project with integration
        other_user = MagicMock(id=999)
        other_project = Project(name="Other's Project", user_id=999)
        db_session.add(other_project)
        await db_session.commit()
        await db_session.refresh(other_project)
        
        other_integration = Integration(
            project_id=other_project.id,
            type="yandex_direct",
            access_token="other_token"
        )
        db_session.add(other_integration)
        await db_session.commit()
        await db_session.refresh(other_integration)
        
        # Try to access other user's integration
        response = await client.get(
            f"/integrations/projects/{other_project.id}",
            headers=auth_headers
        )
        
        assert response.status_code == 404
    
    @pytest.mark.asyncio
    async def test_integration_response_hides_tokens(
        self, client: AsyncClient, auth_headers, test_project,
        test_integration_direct
    ):
        """Integration response should not expose tokens."""
        response = await client.get(
            f"/integrations/projects/{test_project.id}",
            headers=auth_headers
        )
        
        assert response.status_code == 200
        data = response.json()
        
        for integration in data:
            assert "access_token" not in integration
            assert "refresh_token" not in integration
