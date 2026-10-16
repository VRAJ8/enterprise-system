FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
WORKDIR /app

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY . .
RUN useradd --create-home --uid 10001 app && mkdir -p /app/uploads && chown -R app /app
USER app

EXPOSE 8000
# Apply migrations, optionally load the demo workspace into an empty database (SEED_DEMO=true), then serve
# on $PORT (set by hosts like Render). Use several workers only with an external realtime broker (docs/ARCHITECTURE.md §8).
CMD ["sh", "-c", "alembic upgrade head && if [ \"$SEED_DEMO\" = true ]; then python seed.py; fi; exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers --forwarded-allow-ips='*'"]
