# syntax=docker/dockerfile:1
FROM python:3.12-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

FROM base AS builder
RUN python -m pip install --no-cache-dir uv==0.11.7

ENV UV_PYTHON_DOWNLOADS=never \
    UV_LINK_MODE=copy \
    UV_COMPILE_BYTECODE=1

WORKDIR /app
COPY pyproject.toml uv.lock README.md ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --locked --no-dev --no-install-project --python /usr/local/bin/python

FROM base AS runtime
WORKDIR /app

RUN groupadd --gid 10001 app \
    && useradd --uid 10001 --gid app --create-home --shell /usr/sbin/nologin app \
    && mkdir -p /app/data/uploads \
    && chown -R app:app /app/data

COPY --from=builder /app/.venv /app/.venv
COPY app ./app
COPY alembic ./alembic
COPY alembic.ini pyproject.toml uv.lock README.md docker_entrypoint.py ./

ENV PATH="/app/.venv/bin:$PATH" \
    DATABASE_URL=sqlite+aiosqlite:////app/data/signal.db \
    UPLOAD_DIR=/app/data/uploads

USER 10001:10001
EXPOSE 8000
ENTRYPOINT ["python", "/app/docker_entrypoint.py"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
