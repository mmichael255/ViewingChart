import asyncio
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan: start background tasks on startup, clean up on shutdown."""
    from app.services.websocket_manager import manager
    from app.services.binance_service import binance_service
    from app.services.stock_service import stock_service

    task = asyncio.create_task(manager.start_binance_stream())
    yield
    # Graceful shutdown (Fix #1.2)
    manager.running = False
    task.cancel()
    await binance_service.close()
    await stock_service.close()


app = FastAPI(title="ViewingChart Backend", lifespan=lifespan)

# Configure CORS for frontend access
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


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
