"""Tests for reports API endpoints."""
import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.models import Report, Project, User
from tests.conftest import assert_report_response


def get_valid_report_config():
    """Return a valid report configuration for tests."""
    return {
        "sources": [
            {
                "id": "direct",
                "type": "direct",
                "campaign_ids": []
            }
        ],
        "period": {
            "type": "last_7_days"
        },
        "transformations": [],
        "export": {
            "type": "google_sheets"
        }
    }


class TestGetReports:
    """Tests for GET /projects/{project_id}/reports endpoint."""
    
    @pytest.mark.asyncio
    async def test_get_reports_empty(
        self, client: AsyncClient, auth_headers, test_project
    ):
        """Should return empty list when project has no reports."""
        response = await client.get(
            f"/projects/{test_project.id}/reports",
            headers=auth_headers
        )
        
        assert response.status_code == 200
        assert response.json() == []
    
    @pytest.mark.asyncio
    async def test_get_reports_with_report(
        self, client: AsyncClient, auth_headers, test_report, test_project
    ):
        """Should return list of project's reports."""
        response = await client.get(
            f"/projects/{test_project.id}/reports",
            headers=auth_headers
        )
        
        assert response.status_code == 200
        data = response.json()
        assert len(data) == 1
        assert_report_response(data[0])
        assert data[0]["name"] == test_report.name
    
    @pytest.mark.asyncio
    async def test_get_reports_unauthenticated(
        self, client: AsyncClient, test_project
    ):
        """Should fail without authentication."""
        response = await client.get(f"/projects/{test_project.id}/reports")
        
        assert response.status_code == 401
    
    @pytest.mark.asyncio
    async def test_get_reports_not_found_project(
        self, client: AsyncClient, auth_headers
    ):
        """Should return 404 for non-existent project."""
        response = await client.get(
            "/projects/99999/reports",
            headers=auth_headers
        )
        
        assert response.status_code == 404


class TestCreateReport:
    """Tests for POST /projects/{project_id}/reports endpoint."""
    
    @pytest.mark.asyncio
    async def test_create_report_success(
        self, client: AsyncClient, auth_headers, test_project
    ):
        """Should create a new report."""
        response = await client.post(
            f"/projects/{test_project.id}/reports",
            headers=auth_headers,
            json={
                "name": "New Report",
                "config": get_valid_report_config()
            }
        )
        
        assert response.status_code == 201
        data = response.json()
        assert_report_response(data)
        assert data["name"] == "New Report"
        assert data["project_id"] == test_project.id
    
    @pytest.mark.asyncio
    async def test_create_report_with_metrika_source(
        self, client: AsyncClient, auth_headers, test_project
    ):
        """Should create report with Metrika source."""
        config = {
            "sources": [
                {
                    "id": "metrika",
                    "type": "metrika",
                    "counter_id": 12345678,
                    "goals": [1, 2, 3]
                }
            ],
            "period": {
                "type": "last_30_days"
            },
            "transformations": [],
            "export": {
                "type": "google_sheets",
                "spreadsheet_id": "test_sheet_id"
            }
        }
        
        response = await client.post(
            f"/projects/{test_project.id}/reports",
            headers=auth_headers,
            json={"name": "Metrika Report", "config": config}
        )
        
        assert response.status_code == 201
        data = response.json()
        assert data["config"]["sources"][0]["type"] == "metrika"
    
    @pytest.mark.asyncio
    async def test_create_report_with_transformations(
        self, client: AsyncClient, auth_headers, test_project
    ):
        """Should create report with transformations."""
        config = {
            "sources": [{"id": "direct", "type": "direct"}],
            "period": {"type": "last_7_days"},
            "transformations": [
                {
                    "type": "rename",
                    "source": "direct",
                    "mapping": {"campaign_id": "ID кампании"}
                },
                {
                    "type": "filter",
                    "source": "direct",
                    "column": "status",
                    "operator": "eq",
                    "value": "ACTIVE"
                }
            ],
            "export": {"type": "google_sheets"}
        }
        
        response = await client.post(
            f"/projects/{test_project.id}/reports",
            headers=auth_headers,
            json={"name": "Report with Transforms", "config": config}
        )
        
        assert response.status_code == 201
        data = response.json()
        assert len(data["config"]["transformations"]) == 2
    
    @pytest.mark.asyncio
    async def test_create_report_unauthenticated(
        self, client: AsyncClient, test_project
    ):
        """Should fail without authentication."""
        response = await client.post(
            f"/projects/{test_project.id}/reports",
            json={"name": "New Report", "config": get_valid_report_config()}
        )
        
        assert response.status_code == 401
    
    @pytest.mark.asyncio
    async def test_create_report_missing_name(
        self, client: AsyncClient, auth_headers, test_project
    ):
        """Should fail without report name."""
        response = await client.post(
            f"/projects/{test_project.id}/reports",
            headers=auth_headers,
            json={"config": get_valid_report_config()}
        )
        
        assert response.status_code == 422
    
    @pytest.mark.asyncio
    async def test_create_report_missing_config(
        self, client: AsyncClient, auth_headers, test_project
    ):
        """Should fail without report config."""
        response = await client.post(
            f"/projects/{test_project.id}/reports",
            headers=auth_headers,
            json={"name": "New Report"}
        )
        
        assert response.status_code == 422


class TestGetReport:
    """Tests for GET /projects/{project_id}/reports/{report_id} endpoint."""
    
    @pytest.mark.asyncio
    async def test_get_report_success(
        self, client: AsyncClient, auth_headers, test_project, test_report
    ):
        """Should return report details."""
        response = await client.get(
            f"/projects/{test_project.id}/reports/{test_report.id}",
            headers=auth_headers
        )
        
        assert response.status_code == 200
        data = response.json()
        assert_report_response(data)
        assert data["id"] == test_report.id
        assert data["name"] == test_report.name
    
    @pytest.mark.asyncio
    async def test_get_report_not_found(
        self, client: AsyncClient, auth_headers, test_project
    ):
        """Should return 404 for non-existent report."""
        response = await client.get(
            f"/projects/{test_project.id}/reports/99999",
            headers=auth_headers
        )
        
        assert response.status_code == 404
    
    @pytest.mark.asyncio
    async def test_get_report_wrong_project(
        self, client: AsyncClient, auth_headers, db_session: AsyncSession, test_user
    ):
        """Should return 404 for report in another project."""
        # Create another project with a report
        other_project = Project(name="Other Project", user_id=test_user.id)
        db_session.add(other_project)
        await db_session.commit()
        await db_session.refresh(other_project)
        
        other_report = Report(
            project_id=other_project.id,
            name="Other Report",
            config=get_valid_report_config()
        )
        db_session.add(other_report)
        await db_session.commit()
        await db_session.refresh(other_report)
        
        # Create the test project
        test_project = Project(name="Test Project", user_id=test_user.id)
        db_session.add(test_project)
        await db_session.commit()
        await db_session.refresh(test_project)
        
        # Try to access other report through wrong project
        response = await client.get(
            f"/projects/{test_project.id}/reports/{other_report.id}",
            headers=auth_headers
        )
        
        assert response.status_code == 404


class TestUpdateReport:
    """Tests for PUT /projects/{project_id}/reports/{report_id} endpoint."""
    
    @pytest.mark.asyncio
    async def test_update_report_name(
        self, client: AsyncClient, auth_headers, test_project, test_report
    ):
        """Should update report name."""
        response = await client.put(
            f"/projects/{test_project.id}/reports/{test_report.id}",
            headers=auth_headers,
            json={"name": "Updated Report Name"}
        )
        
        assert response.status_code == 200
        data = response.json()
        assert data["name"] == "Updated Report Name"
    
    @pytest.mark.asyncio
    async def test_update_report_config(
        self, client: AsyncClient, auth_headers, test_project, test_report
    ):
        """Should update report config."""
        new_config = {
            "sources": [{"id": "metrika", "type": "metrika", "counter_id": 99999}],
            "period": {"type": "last_30_days"},
            "transformations": [],
            "export": {"type": "google_sheets"}
        }
        
        response = await client.put(
            f"/projects/{test_project.id}/reports/{test_report.id}",
            headers=auth_headers,
            json={"config": new_config}
        )
        
        assert response.status_code == 200
        data = response.json()
        assert data["config"]["period"]["type"] == "last_30_days"
    
    @pytest.mark.asyncio
    async def test_update_report_not_found(
        self, client: AsyncClient, auth_headers, test_project
    ):
        """Should return 404 for non-existent report."""
        response = await client.put(
            f"/projects/{test_project.id}/reports/99999",
            headers=auth_headers,
            json={"name": "New Name"}
        )
        
        assert response.status_code == 404


class TestDeleteReport:
    """Tests for DELETE /projects/{project_id}/reports/{report_id} endpoint."""
    
    @pytest.mark.asyncio
    async def test_delete_report_success(
        self, client: AsyncClient, auth_headers, test_project, test_report,
        db_session: AsyncSession
    ):
        """Should delete the report."""
        response = await client.delete(
            f"/projects/{test_project.id}/reports/{test_report.id}",
            headers=auth_headers
        )
        
        assert response.status_code == 204
        
        # Verify it's deleted
        result = await db_session.execute(
            select(Report).where(Report.id == test_report.id)
        )
        assert result.scalar_one_or_none() is None
    
    @pytest.mark.asyncio
    async def test_delete_report_not_found(
        self, client: AsyncClient, auth_headers, test_project
    ):
        """Should return 404 for non-existent report."""
        response = await client.delete(
            f"/projects/{test_project.id}/reports/99999",
            headers=auth_headers
        )
        
        assert response.status_code == 404


class TestReportPeriodConfig:
    """Tests for various period configurations."""
    
    @pytest.mark.asyncio
    async def test_create_report_last_7_days(
        self, client: AsyncClient, auth_headers, test_project
    ):
        """Should create report with last_7_days period."""
        config = get_valid_report_config()
        config["period"] = {"type": "last_7_days"}
        
        response = await client.post(
            f"/projects/{test_project.id}/reports",
            headers=auth_headers,
            json={"name": "7 Days Report", "config": config}
        )
        
        assert response.status_code == 201
    
    @pytest.mark.asyncio
    async def test_create_report_last_30_days(
        self, client: AsyncClient, auth_headers, test_project
    ):
        """Should create report with last_30_days period."""
        config = get_valid_report_config()
        config["period"] = {"type": "last_30_days"}
        
        response = await client.post(
            f"/projects/{test_project.id}/reports",
            headers=auth_headers,
            json={"name": "30 Days Report", "config": config}
        )
        
        assert response.status_code == 201
    
    @pytest.mark.asyncio
    async def test_create_report_custom_period(
        self, client: AsyncClient, auth_headers, test_project
    ):
        """Should create report with custom period."""
        config = get_valid_report_config()
        config["period"] = {
            "type": "custom",
            "date_from": "2025-01-01",
            "date_to": "2025-01-31"
        }
        
        response = await client.post(
            f"/projects/{test_project.id}/reports",
            headers=auth_headers,
            json={"name": "Custom Period Report", "config": config}
        )
        
        assert response.status_code == 201
        data = response.json()
        assert data["config"]["period"]["date_from"] == "2025-01-01"
        assert data["config"]["period"]["date_to"] == "2025-01-31"
