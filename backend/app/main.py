from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.auth import router as auth_router
from app.projects import router as projects_router
from app.integrations import router as integrations_router
from app.direct import router as direct_router
from app.metrika import router as metrika_router
from app.google_sheets import router as sheets_router
from app.reports import router as reports_router
from app.database import init_db
from app.config import FRONTEND_URL


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialize database and scheduler on startup."""
    await init_db()
    
    # Start scheduler
    from app.scheduler import start_scheduler
    start_scheduler()
    
    yield
    
    # Stop scheduler on shutdown
    from app.scheduler import stop_scheduler
    stop_scheduler()


app = FastAPI(
    title="RePort API",
    description="Marketing analytics service for Yandex.Direct, Metrika and Google Sheets",
    version="0.1.0",
    lifespan=lifespan
)

# CORS configuration
origins = [
    "http://localhost:3000",
    FRONTEND_URL,
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(auth_router, tags=["Authentication"])
app.include_router(projects_router, tags=["Projects"])
app.include_router(integrations_router, tags=["Integrations"])
app.include_router(direct_router, tags=["Yandex.Direct"])
app.include_router(metrika_router, tags=["Yandex.Metrika"])
app.include_router(sheets_router, tags=["Google Sheets"])
app.include_router(reports_router, tags=["Reports"])


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "ok"}
