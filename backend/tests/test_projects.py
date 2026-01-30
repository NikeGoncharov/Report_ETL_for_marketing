"""Tests for projects API endpoints."""
import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.models import Project, User
from tests.conftest import assert_project_response


class TestGetProjects:
    """Tests for GET /projects endpoint."""
    
    @pytest.mark.asyncio
    async def test_get_projects_empty(self, client: AsyncClient, auth_headers, test_user):
        """Should return empty list when user has no projects."""
        response = await client.get("/projects", headers=auth_headers)
        
        assert response.status_code == 200
        assert response.json() == []
    
    @pytest.mark.asyncio
    async def test_get_projects_with_project(
        self, client: AsyncClient, auth_headers, test_project
    ):
        """Should return list of user's projects."""
        response = await client.get("/projects", headers=auth_headers)
        
        assert response.status_code == 200
        data = response.json()
        assert len(data) == 1
        assert_project_response(data[0])
        assert data[0]["name"] == test_project.name
    
    @pytest.mark.asyncio
    async def test_get_projects_unauthenticated(self, client: AsyncClient):
        """Should fail without authentication."""
        response = await client.get("/projects")
        
        assert response.status_code == 401
    
    @pytest.mark.asyncio
    async def test_get_projects_isolation(
        self, client: AsyncClient, auth_headers, db_session: AsyncSession, test_user
    ):
        """User should only see their own projects."""
        # Create another user with a project
        from app.auth import get_password_hash
        
        other_user = User(
            email="other@example.com",
            password_hash=get_password_hash("password")
        )
        db_session.add(other_user)
        await db_session.commit()
        await db_session.refresh(other_user)
        
        other_project = Project(name="Other's Project", user_id=other_user.id)
        my_project = Project(name="My Project", user_id=test_user.id)
        db_session.add_all([other_project, my_project])
        await db_session.commit()
        
        response = await client.get("/projects", headers=auth_headers)
        
        assert response.status_code == 200
        data = response.json()
        assert len(data) == 1
        assert data[0]["name"] == "My Project"


class TestCreateProject:
    """Tests for POST /projects endpoint."""
    
    @pytest.mark.asyncio
    async def test_create_project_success(self, client: AsyncClient, auth_headers):
        """Should create a new project."""
        response = await client.post(
            "/projects",
            headers=auth_headers,
            json={"name": "New Project"}
        )
        
        assert response.status_code == 201
        data = response.json()
        assert_project_response(data)
        assert data["name"] == "New Project"
    
    @pytest.mark.asyncio
    async def test_create_project_unauthenticated(self, client: AsyncClient):
        """Should fail without authentication."""
        response = await client.post(
            "/projects",
            json={"name": "New Project"}
        )
        
        assert response.status_code == 401
    
    @pytest.mark.asyncio
    async def test_create_project_missing_name(self, client: AsyncClient, auth_headers):
        """Should fail without project name."""
        response = await client.post(
            "/projects",
            headers=auth_headers,
            json={}
        )
        
        assert response.status_code == 422
    
    @pytest.mark.asyncio
    async def test_create_multiple_projects(self, client: AsyncClient, auth_headers):
        """Should be able to create multiple projects."""
        await client.post("/projects", headers=auth_headers, json={"name": "Project 1"})
        await client.post("/projects", headers=auth_headers, json={"name": "Project 2"})
        await client.post("/projects", headers=auth_headers, json={"name": "Project 3"})
        
        response = await client.get("/projects", headers=auth_headers)
        
        assert response.status_code == 200
        assert len(response.json()) == 3


class TestGetProject:
    """Tests for GET /projects/{project_id} endpoint."""
    
    @pytest.mark.asyncio
    async def test_get_project_success(
        self, client: AsyncClient, auth_headers, test_project
    ):
        """Should return project details."""
        response = await client.get(
            f"/projects/{test_project.id}",
            headers=auth_headers
        )
        
        assert response.status_code == 200
        data = response.json()
        assert_project_response(data)
        assert data["id"] == test_project.id
        assert data["name"] == test_project.name
    
    @pytest.mark.asyncio
    async def test_get_project_not_found(self, client: AsyncClient, auth_headers):
        """Should return 404 for non-existent project."""
        response = await client.get("/projects/99999", headers=auth_headers)
        
        assert response.status_code == 404
    
    @pytest.mark.asyncio
    async def test_get_project_unauthenticated(
        self, client: AsyncClient, test_project
    ):
        """Should fail without authentication."""
        response = await client.get(f"/projects/{test_project.id}")
        
        assert response.status_code == 401
    
    @pytest.mark.asyncio
    async def test_get_project_other_user(
        self, client: AsyncClient, auth_headers, db_session: AsyncSession
    ):
        """Should not access other user's project."""
        from app.auth import get_password_hash
        
        other_user = User(
            email="other@example.com",
            password_hash=get_password_hash("password")
        )
        db_session.add(other_user)
        await db_session.commit()
        await db_session.refresh(other_user)
        
        other_project = Project(name="Other's Project", user_id=other_user.id)
        db_session.add(other_project)
        await db_session.commit()
        await db_session.refresh(other_project)
        
        response = await client.get(
            f"/projects/{other_project.id}",
            headers=auth_headers
        )
        
        assert response.status_code == 404


class TestUpdateProject:
    """Tests for PUT /projects/{project_id} endpoint."""
    
    @pytest.mark.asyncio
    async def test_update_project_success(
        self, client: AsyncClient, auth_headers, test_project
    ):
        """Should update project name."""
        response = await client.put(
            f"/projects/{test_project.id}",
            headers=auth_headers,
            json={"name": "Updated Name"}
        )
        
        assert response.status_code == 200
        data = response.json()
        assert data["name"] == "Updated Name"
        assert data["id"] == test_project.id
    
    @pytest.mark.asyncio
    async def test_update_project_partial(
        self, client: AsyncClient, auth_headers, test_project
    ):
        """Should work with partial update (empty body)."""
        original_name = test_project.name
        
        response = await client.put(
            f"/projects/{test_project.id}",
            headers=auth_headers,
            json={}
        )
        
        assert response.status_code == 200
        assert response.json()["name"] == original_name
    
    @pytest.mark.asyncio
    async def test_update_project_not_found(self, client: AsyncClient, auth_headers):
        """Should return 404 for non-existent project."""
        response = await client.put(
            "/projects/99999",
            headers=auth_headers,
            json={"name": "New Name"}
        )
        
        assert response.status_code == 404
    
    @pytest.mark.asyncio
    async def test_update_project_unauthenticated(
        self, client: AsyncClient, test_project
    ):
        """Should fail without authentication."""
        response = await client.put(
            f"/projects/{test_project.id}",
            json={"name": "New Name"}
        )
        
        assert response.status_code == 401


class TestDeleteProject:
    """Tests for DELETE /projects/{project_id} endpoint."""
    
    @pytest.mark.asyncio
    async def test_delete_project_success(
        self, client: AsyncClient, auth_headers, test_project, db_session: AsyncSession
    ):
        """Should delete the project."""
        response = await client.delete(
            f"/projects/{test_project.id}",
            headers=auth_headers
        )
        
        assert response.status_code == 204
        
        # Verify it's deleted
        result = await db_session.execute(
            select(Project).where(Project.id == test_project.id)
        )
        assert result.scalar_one_or_none() is None
    
    @pytest.mark.asyncio
    async def test_delete_project_not_found(self, client: AsyncClient, auth_headers):
        """Should return 404 for non-existent project."""
        response = await client.delete("/projects/99999", headers=auth_headers)
        
        assert response.status_code == 404
    
    @pytest.mark.asyncio
    async def test_delete_project_unauthenticated(
        self, client: AsyncClient, test_project
    ):
        """Should fail without authentication."""
        response = await client.delete(f"/projects/{test_project.id}")
        
        assert response.status_code == 401
    
    @pytest.mark.asyncio
    async def test_delete_project_other_user(
        self, client: AsyncClient, auth_headers, db_session: AsyncSession
    ):
        """Should not delete other user's project."""
        from app.auth import get_password_hash
        
        other_user = User(
            email="other@example.com",
            password_hash=get_password_hash("password")
        )
        db_session.add(other_user)
        await db_session.commit()
        await db_session.refresh(other_user)
        
        other_project = Project(name="Other's Project", user_id=other_user.id)
        db_session.add(other_project)
        await db_session.commit()
        await db_session.refresh(other_project)
        
        response = await client.delete(
            f"/projects/{other_project.id}",
            headers=auth_headers
        )
        
        assert response.status_code == 404
        
        # Verify it's not deleted
        result = await db_session.execute(
            select(Project).where(Project.id == other_project.id)
        )
        assert result.scalar_one_or_none() is not None
