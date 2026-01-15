from fastapi import APIRouter, Request, Response, HTTPException
from app.config import APP_LOGIN, APP_PASSWORD
from fastapi import Depends

router = APIRouter()

SESSION_COOKIE = "session"

@router.post("/login")
async def login(data: dict, response: Response):
    login = data.get("login")
    password = data.get("password")

    if login != APP_LOGIN or password != APP_PASSWORD:
        raise HTTPException(status_code=401, detail="Invalid credentials")

    response.set_cookie(
        key=SESSION_COOKIE,
        value="ok",
        httponly=True
    )

    return {"status": "ok"}


def require_auth(request: Request):
    if request.cookies.get(SESSION_COOKIE) != "ok":
        raise HTTPException(status_code=401, detail="Not authenticated")
    
    # заглушка для MVP — всегда возвращает фиктивного пользователя
def get_current_user():
    return {"login": "team"}