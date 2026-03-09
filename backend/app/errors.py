import logging
import time
from fastapi import Request
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException as StarletteHTTPException

logger = logging.getLogger(__name__)


def error_response(status_code: int, code: str, message: str, detail=None) -> JSONResponse:
    """Build a standardized error JSON response."""
    body = {
        "error": {
            "code": code,
            "message": message,
        }
    }
    if detail is not None:
        body["error"]["detail"] = detail
    return JSONResponse(status_code=status_code, content=body)


async def validation_exception_handler(request: Request, exc: RequestValidationError):
    """Format Pydantic/FastAPI validation errors into the standard error shape."""
    errors = []
    for err in exc.errors():
        loc = " → ".join(str(l) for l in err["loc"])
        errors.append({"field": loc, "message": err["msg"]})

    logger.warning(f"Validation error on {request.method} {request.url.path}: {errors}")
    return error_response(
        status_code=422,
        code="VALIDATION_ERROR",
        message="Request validation failed",
        detail=errors,
    )


async def http_exception_handler(request: Request, exc: StarletteHTTPException):
    """Format standard HTTP exceptions into the standard error shape."""
    return error_response(
        status_code=exc.status_code,
        code=f"HTTP_{exc.status_code}",
        message=str(exc.detail),
    )


async def unhandled_exception_handler(request: Request, exc: Exception):
    """Catch-all for unhandled exceptions — log full traceback, return generic 500."""
    logger.exception(f"Unhandled error on {request.method} {request.url.path}: {exc}")
    return error_response(
        status_code=500,
        code="INTERNAL_ERROR",
        message="An unexpected error occurred. Please try again later.",
    )
