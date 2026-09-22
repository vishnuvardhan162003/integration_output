"""
Embedding Service for EduBot.

The embedding model is loaded lazily — only when it is actually needed.
This helps reduce startup memory usage on low-memory hosting services.
"""

from typing import List, Optional

from langchain_huggingface import HuggingFaceEmbeddings

from app.config import get_settings
from app.utils.exceptions import VectorStoreError
from app.utils.logger import get_logger


logger = get_logger(__name__)


class EmbeddingService:
    """
    Service for generating text embeddings using a local model.

    The model is NOT loaded during application startup.
    It is loaded automatically the first time it is requested.
    """

    def __init__(self) -> None:
        """Initialize the service without loading the model."""
        self._model: Optional[HuggingFaceEmbeddings] = None
        self._settings = get_settings()

    @property
    def is_initialized(self) -> bool:
        """Check whether the embedding model is loaded."""
        return self._model is not None

    async def initialize(self) -> None:
        """
        Load the embedding model if it has not already been loaded.

        This method is kept for compatibility with existing code,
        but main.py no longer calls it during startup.
        """

        if self._model is not None:
            logger.debug("Embedding model already initialized.")
            return

        self._load_model()

    def _load_model(self) -> None:
        """
        Load the HuggingFace embedding model.

        This is called only when an embedding operation actually
        requires the model.
        """

        if self._model is not None:
            return

        try:
            logger.info(
                f"Loading embedding model: "
                f"{self._settings.EMBEDDING_MODEL_NAME}"
            )

            self._model = HuggingFaceEmbeddings(
                model_name=self._settings.EMBEDDING_MODEL_NAME,
                model_kwargs={
                    "device": "cpu",
                },
                encode_kwargs={
                    "normalize_embeddings": True,
                },
            )

            logger.info("Embedding model loaded successfully.")

        except Exception as e:
            logger.error(f"Failed to load embedding model: {e}")

            raise VectorStoreError(
                f"Failed to initialize embedding model: {e}"
            ) from e

    def get_embeddings_model(self) -> HuggingFaceEmbeddings:
        """
        Get the embedding model.

        If the model has not been loaded yet, it is loaded now.
        """

        if self._model is None:
            self._load_model()

        return self._model

    async def embed_text(self, text: str) -> List[float]:
        """
        Convert a single text string into an embedding vector.
        """

        try:
            model = self.get_embeddings_model()

            vector = model.embed_query(text)

            return vector

        except VectorStoreError:
            raise

        except Exception as e:
            logger.error(f"Failed to embed text: {e}")

            raise VectorStoreError(
                f"Embedding failed: {e}"
            ) from e

    async def embed_texts(
        self,
        texts: List[str],
    ) -> List[List[float]]:
        """
        Convert multiple text strings into embedding vectors.
        """

        if not texts:
            return []

        try:
            model = self.get_embeddings_model()

            logger.debug(
                f"Embedding {len(texts)} texts..."
            )

            vectors = model.embed_documents(texts)

            logger.debug(
                f"Successfully embedded {len(vectors)} texts."
            )

            return vectors

        except VectorStoreError:
            raise

        except Exception as e:
            logger.error(
                f"Failed to embed texts: {e}"
            )

            raise VectorStoreError(
                f"Batch embedding failed: {e}"
            ) from e


# ============================================
# SINGLETON INSTANCE
# ============================================

# Only one service instance is shared by the application.
# The actual embedding model is loaded lazily when required.

embedding_service = EmbeddingService()