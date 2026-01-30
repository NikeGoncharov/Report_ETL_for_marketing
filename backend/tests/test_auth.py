"""Tests for authentication API endpoints."""
import pytest
from httpx import AsyncClient

from app.auth import verify_password, get_password_hash, create_access_token, decode_token
from tests.conftest import assert_user_response


class TestPasswordHashing:
    """Unit tests for password hashing functions."""
    
    def test_password_hash_is_different_from_plain(self):
        """Hashed password should not equal the plain password."""
        plain = "mypassword123"
        hashed = get_password_hash(plain)
        assert hashed != plain
    
    def test_password_verification_correct(self):
        """Correct password should verify successfully."""
        plain = "mypassword123"
        hashed = get_password_hash(plain)
        assert verify_password(plain, hashed) is True
    
    def test_password_verification_incorrect(self):
        """Incorrect password should fail verification."""
        plain = "mypassword123"
        hashed = get_password_hash(plain)
        assert verify_password("wrongpassword", hashed) is False
    
    def test_same_password_different_hashes(self):
        """Same password should produce different hashes (due to salt)."""
        plain = "mypassword123"
        hash1 = get_password_hash(plain)
        hash2 = get_password_hash(plain)
        assert hash1 != hash2
        # But both should verify
        assert verify_password(plain, hash1) is True
        assert verify_password(plain, hash2) is True


class TestTokenGeneration:
    """Unit tests for JWT token functions."""
    
    def test_create_access_token(self):
        """Access token should be created and decodable."""
        data = {"sub": "123"}
        token = create_access_token(data)
        assert token is not None
        
        payload = decode_token(token)
        assert payload is not None
        assert payload["sub"] == "123"
        assert payload["type"] == "access"
    
    def test_decode_invalid_token(self):
        """Invalid token should return None."""
        payload = decode_token("invalid.token.here")
        assert payload is None
    
    def test_decode_empty_token(self):
        """Empty token should return None."""
        payload = decode_token("")
        assert payload is None


class TestRegisterEndpoint:
    """Tests for /register endpoint."""
    
    @pytest.mark.asyncio
    async def test_register_success(self, client: AsyncClient):
        """User should be able to register with valid data."""
        response = await client.post("/register", json={
            "email": "newuser@example.com",
            "password": "securepassword123"
        })
        
        assert response.status_code == 200
        data = response.json()
        assert_user_response(data)
        assert data["email"] == "newuser@example.com"
    
    @pytest.mark.asyncio
    async def test_register_duplicate_email(self, client: AsyncClient, test_user):
        """Registration should fail for duplicate email."""
        response = await client.post("/register", json={
            "email": "test@example.com",  # Same as test_user
            "password": "anotherpassword"
        })
        
        assert response.status_code == 400
        assert "already registered" in response.json()["detail"].lower()
    
    @pytest.mark.asyncio
    async def test_register_invalid_email(self, client: AsyncClient):
        """Registration should fail for invalid email format."""
        response = await client.post("/register", json={
            "email": "not-an-email",
            "password": "password123"
        })
        
        assert response.status_code == 422  # Validation error
    
    @pytest.mark.asyncio
    async def test_register_missing_password(self, client: AsyncClient):
        """Registration should fail without password."""
        response = await client.post("/register", json={
            "email": "test@example.com"
        })
        
        assert response.status_code == 422


class TestLoginEndpoint:
    """Tests for /login endpoint."""
    
    @pytest.mark.asyncio
    async def test_login_success(self, client: AsyncClient, test_user):
        """User should be able to login with correct credentials."""
        response = await client.post("/login", json={
            "email": "test@example.com",
            "password": "testpassword123"
        })
        
        assert response.status_code == 200
        data = response.json()
        assert "access_token" in data
        assert "refresh_token" in data
        assert data["token_type"] == "bearer"
    
    @pytest.mark.asyncio
    async def test_login_sets_cookies(self, client: AsyncClient, test_user):
        """Login should set authentication cookies."""
        response = await client.post("/login", json={
            "email": "test@example.com",
            "password": "testpassword123"
        })
        
        assert response.status_code == 200
        assert "access_token" in response.cookies or "set-cookie" in response.headers
    
    @pytest.mark.asyncio
    async def test_login_wrong_password(self, client: AsyncClient, test_user):
        """Login should fail with wrong password."""
        response = await client.post("/login", json={
            "email": "test@example.com",
            "password": "wrongpassword"
        })
        
        assert response.status_code == 401
        assert "invalid" in response.json()["detail"].lower()
    
    @pytest.mark.asyncio
    async def test_login_nonexistent_user(self, client: AsyncClient):
        """Login should fail for non-existent user."""
        response = await client.post("/login", json={
            "email": "nonexistent@example.com",
            "password": "password123"
        })
        
        assert response.status_code == 401
    
    @pytest.mark.asyncio
    async def test_login_invalid_email_format(self, client: AsyncClient):
        """Login should fail for invalid email format."""
        response = await client.post("/login", json={
            "email": "not-an-email",
            "password": "password123"
        })
        
        assert response.status_code == 422


class TestRefreshEndpoint:
    """Tests for /refresh endpoint."""
    
    @pytest.mark.asyncio
    async def test_refresh_success(self, client: AsyncClient, test_user_refresh_token):
        """Token refresh should work with valid refresh token."""
        response = await client.post("/refresh", json={
            "refresh_token": test_user_refresh_token
        })
        
        assert response.status_code == 200
        data = response.json()
        assert "access_token" in data
        assert "refresh_token" in data
    
    @pytest.mark.asyncio
    async def test_refresh_invalid_token(self, client: AsyncClient):
        """Refresh should fail with invalid token."""
        response = await client.post("/refresh", json={
            "refresh_token": "invalid.refresh.token"
        })
        
        assert response.status_code == 401
    
    @pytest.mark.asyncio
    async def test_refresh_with_access_token(self, client: AsyncClient, test_user_token):
        """Refresh should fail when using access token instead of refresh token."""
        response = await client.post("/refresh", json={
            "refresh_token": test_user_token  # This is an access token
        })
        
        assert response.status_code == 401


class TestMeEndpoint:
    """Tests for /me endpoint."""
    
    @pytest.mark.asyncio
    async def test_me_authenticated(self, client: AsyncClient, auth_headers, test_user):
        """Authenticated user should get their info."""
        response = await client.get("/me", headers=auth_headers)
        
        assert response.status_code == 200
        data = response.json()
        assert_user_response(data)
        assert data["email"] == test_user.email
        assert data["id"] == test_user.id
    
    @pytest.mark.asyncio
    async def test_me_unauthenticated(self, client: AsyncClient):
        """Unauthenticated request should fail."""
        response = await client.get("/me")
        
        assert response.status_code == 401
    
    @pytest.mark.asyncio
    async def test_me_invalid_token(self, client: AsyncClient):
        """Invalid token should fail."""
        response = await client.get("/me", headers={
            "Authorization": "Bearer invalid.token.here"
        })
        
        assert response.status_code == 401


class TestLogoutEndpoint:
    """Tests for /logout endpoint."""
    
    @pytest.mark.asyncio
    async def test_logout_success(self, client: AsyncClient):
        """Logout should succeed and clear cookies."""
        response = await client.post("/logout")
        
        assert response.status_code == 200
        assert response.json()["status"] == "ok"


class TestHealthEndpoint:
    """Tests for /health endpoint."""
    
    @pytest.mark.asyncio
    async def test_health_check(self, client: AsyncClient):
        """Health check should return ok status."""
        response = await client.get("/health")
        
        assert response.status_code == 200
        assert response.json()["status"] == "ok"
