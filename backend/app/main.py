from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="ViewingChart Backend")

# Configure CORS for frontend access
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

from app.routers import market_data

from app.routers import market_data, chat, news
from app.database.connection import engine
from app.database import models

# Create tables
models.Base.metadata.create_all(bind=engine)

app.include_router(market_data.router)
app.include_router(chat.router)
app.include_router(news.router)

@app.get("/")
def read_root():
    return {"message": "ViewingChart API is running"}
