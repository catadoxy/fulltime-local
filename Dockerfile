# ---- Stage 1: build the React SPA ----
FROM node:22-alpine AS frontend
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# ---- Stage 2: Python API + built frontend ----
FROM python:3.12-slim AS runtime
WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    FTL_DATA_DIR=/data \
    FTL_FRONTEND_DIR=/frontend/dist

COPY backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ ./
COPY --from=frontend /app/dist /frontend/dist

VOLUME ["/data"]
EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
