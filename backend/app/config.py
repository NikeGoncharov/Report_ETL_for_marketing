from dotenv import load_dotenv
import os
from pathlib import Path

load_dotenv(".env")

# Base paths
BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
DATA_DIR.mkdir(exist_ok=True)

# Environment
IS_PRODUCTION = os.getenv("ENVIRONMENT", "development") == "production"

# Database
DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite+aiosqlite:///{DATA_DIR}/data.db")
DATABASE_URL_SYNC = os.getenv("DATABASE_URL_SYNC", f"sqlite:///{DATA_DIR}/data.db")

# JWT Settings
SECRET_KEY = os.getenv("SECRET_KEY", "your-secret-key-change-in-production")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 30
REFRESH_TOKEN_EXPIRE_DAYS = 7

# Cookie settings (set COOKIE_SECURE=true only when HTTPS is configured)
COOKIE_SECURE = os.getenv("COOKIE_SECURE", "false").lower() == "true"

# OAuth - Yandex
YANDEX_CLIENT_ID = os.getenv("YANDEX_CLIENT_ID", "")
YANDEX_CLIENT_SECRET = os.getenv("YANDEX_CLIENT_SECRET", "")
YANDEX_REDIRECT_URI = os.getenv("YANDEX_REDIRECT_URI", "http://localhost:8000/integrations/yandex/callback")

# OAuth - Google
GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET", "")
GOOGLE_REDIRECT_URI = os.getenv("GOOGLE_REDIRECT_URI", "http://localhost:8000/integrations/google/callback")

# Frontend URL (for redirects)
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:3000")

# Registration: comma-separated list of allowed emails (e.g. team@company.com).
# If set and non-empty, only these emails can register. If not set or empty, anyone can register.
def get_allowed_registration_emails() -> set[str]:
    raw = os.getenv("ALLOWED_REGISTRATION_EMAILS", "").strip()
    if not raw:
        return set()
    return {e.strip().lower() for e in raw.split(",") if e.strip()}
