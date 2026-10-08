import asyncio
import contextlib
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import APIRouter, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import auth, conversations, files, me, messages, search, users
from app.core.config import get_settings
from app.db.migrations import initialize_database
from app.ws import router as ws_router
from app.ws.background import run_sweeper

settings = get_settings()


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    settings.upload_dir.mkdir(parents=True, exist_ok=True)
    if settings.auto_migrate_on_startup:
        await initialize_database()
    if settings.seed_on_startup:
        from app.seed import seed_if_empty

        await seed_if_empty()
    sweeper = asyncio.create_task(run_sweeper())
    try:
        yield
    finally:
        sweeper.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await sweeper


def create_app() -> FastAPI:
    app = FastAPI(title=settings.app_name, lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    api = APIRouter(prefix="/api")
    for module in (auth, me, users, conversations, messages, files, search):
        api.include_router(module.router)
    app.include_router(api)
    app.include_router(ws_router.router)

    @app.get("/health", tags=["meta"])
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    return app


app = create_app()
