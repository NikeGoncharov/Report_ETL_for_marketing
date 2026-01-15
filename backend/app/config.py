from dotenv import load_dotenv
import os

load_dotenv(".env")  # теперь именно так

APP_LOGIN = os.getenv("APP_LOGIN")
APP_PASSWORD = os.getenv("APP_PASSWORD")