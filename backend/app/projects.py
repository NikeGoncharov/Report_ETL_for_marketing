from fastapi import APIRouter, Depends
from .auth import get_current_user

router = APIRouter()

projects = [
    {"id": 1, "name": "Клиент A"},
    {"id": 2, "name": "Клиент B"},
]

@router.get("/projects")
async def get_projects(user=Depends(get_current_user)):
    return projects

@router.post("/projects")
async def create_project(payload: dict, user=Depends(get_current_user)):
    new_id = max(p["id"] for p in projects) + 1 if projects else 1
    project = {"id": new_id, "name": payload["name"]}
    projects.append(project)
    return project
