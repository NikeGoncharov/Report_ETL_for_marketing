from fastapi import FastAPI
from app.auth import router as auth_router
from app.projects import router as projects_router
from fastapi.middleware.cors import CORSMiddleware
from .projects import router as projects_router

app = FastAPI()

# разрешаем фронтенду обращаться к backend
origins = [
    "http://localhost:3000",  # адрес твоего фронтенда
]

app.include_router(auth_router)
app.include_router(projects_router)

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,       # с каких источников можно
    allow_credentials=True,      # нужны для cookies
    allow_methods=["*"],         # POST, GET, OPTIONS и др.
    allow_headers=["*"],         # все заголовки
)