import logging
import sys
from app.config import settings


def setup_logging():
    """
    Configure application-wide logging.
    - Development: human-readable format with timestamps
    - Production: JSON-structured format for log aggregators
    """
    log_level = getattr(logging, settings.LOG_LEVEL, logging.INFO)

    if settings.ENVIRONMENT == "production":
        # JSON format for production (compatible with ELK, Datadog, etc.)
        fmt = '{"time":"%(asctime)s","level":"%(levelname)s","logger":"%(name)s","message":"%(message)s"}'
    else:
        # Human-readable format for development
        fmt = "%(asctime)s │ %(levelname)-7s │ %(name)-30s │ %(message)s"

    logging.basicConfig(
        level=log_level,
        format=fmt,
        datefmt="%Y-%m-%d %H:%M:%S",
        stream=sys.stdout,
        force=True,  # Override any existing config
    )

    # Reduce noise from third-party libraries
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)
    logging.getLogger("websockets").setLevel(logging.WARNING)
    logging.getLogger("urllib3").setLevel(logging.WARNING)
    logging.getLogger("yfinance").setLevel(logging.WARNING)
    logging.getLogger("sqlalchemy.engine").setLevel(logging.WARNING)

    logger = logging.getLogger(__name__)
    logger.info(f"Logging configured: level={settings.LOG_LEVEL}, env={settings.ENVIRONMENT}")
