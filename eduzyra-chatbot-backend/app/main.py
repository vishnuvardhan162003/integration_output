"""
FastAPI Application Entry Point for EduBot.

This is the main entry point of the EduBot backend.

Startup:
1. FastAPI application is created
2. CORS middleware is configured
3. API routes are registered
4. Database is initialized
5. Vector store is initialized
6. LLM service is initialized

IMPORTANT:
The embedding model is NOT loaded during application startup.
It will be loaded only when it is actually required.
This helps reduce memory usage on low-memory hosting services.
"""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.router import api_router
from app.config import get_settings
from app.db.init_db import init_database
from app.services.llm_service import llm_service
from app.services.vector_store import vector_store_service
from app.utils.logger import get_logger

logger = get_logger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Application lifespan manager.

    Code before `yield` runs when the application starts.
    Code after `yield` runs when the application shuts down.

    The embedding model is intentionally NOT initialized here.
    It will be loaded lazily only when required.
    """

    logger.info("=" * 60)
    logger.info("🚀 EduBot is starting up...")
    logger.info("=" * 60)

    settings = get_settings()

    # -------------------------------------------------
    # Step 1: Initialize the database
    # -------------------------------------------------
    await init_database()
    logger.info("✅ Database initialized")

    # -------------------------------------------------
    # Step 2: Initialize the FAISS vector store
    # -------------------------------------------------
    #
    # The vector store will load an existing FAISS index
    # if one exists.
    #
    # The embedding model is no longer loaded explicitly
    # during startup. It will be loaded only when needed.
    #
    await vector_store_service.initialize()
    logger.info("✅ Vector store initialized")

    # -------------------------------------------------
    # Step 3: Initialize the LLM service
    # -------------------------------------------------
    await llm_service.initialize()
    logger.info("✅ LLM service initialized")

    logger.info("=" * 60)
    logger.info(f"🤖 {settings.APP_NAME} is ready!")
    logger.info("📝 API docs: /docs")
    logger.info("🔗 Health: /api/health")
    logger.info("=" * 60)

    # -------------------------------------------------
    # Application is running
    # -------------------------------------------------
    yield

    # -------------------------------------------------
    # Application shutdown
    # -------------------------------------------------
    logger.info("👋 EduBot is shutting down...")


def create_app() -> FastAPI:
    """
    Create and configure the FastAPI application.
    """

    settings = get_settings()

    # -------------------------------------------------
    # Create FastAPI application
    # -------------------------------------------------
    application = FastAPI(
        title=settings.APP_NAME,
        description=(
            "🤖 An intelligent educational chatbot powered by RAG "
            "(Retrieval-Augmented Generation). Upload PDFs and ask "
            "questions about their content."
        ),
        version="1.0.0",
        lifespan=lifespan,
    )

    # -------------------------------------------------
    # CORS Middleware
    # -------------------------------------------------
    application.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # -------------------------------------------------
    # Register API Routes
    # -------------------------------------------------
    application.include_router(api_router)

    # -------------------------------------------------
    # Serve Frontend
    # -------------------------------------------------
    import os
    from fastapi.staticfiles import StaticFiles

    frontend_dist = os.path.abspath(
        os.path.join(
            os.path.dirname(__file__),
            "..",
            "..",
            "frontend",
            "dist",
        )
    )

    if os.path.exists(frontend_dist):
        application.mount(
            "/",
            StaticFiles(
                directory=frontend_dist,
                html=True,
            ),
            name="frontend",
        )

    return application


# -------------------------------------------------
# Create application instance
# -------------------------------------------------
# Uvicorn uses this:
#
# uvicorn app.main:app
# -------------------------------------------------

app = create_app()