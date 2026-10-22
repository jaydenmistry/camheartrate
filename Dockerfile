# Deployable server: every visitor's browser uses its own camera (RPPG_SOURCE=browser).
# The page does capture, face/hand tracking and skin averaging; this container runs
# the rPPG DSP for each connection. Serve it over HTTPS: browsers only allow camera
# access on secure pages.
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    RPPG_SOURCE=browser \
    WEB_CONCURRENCY=2
# WEB_CONCURRENCY: uvicorn worker processes. Each visitor's connection stays on
# one worker, so set it to the server's CPU cores for a large class.

WORKDIR /app
COPY requirements-web.txt .
RUN pip install -r requirements-web.txt

COPY app.py rppg_class.py rppg_dsp.py rppg_session.py rppg_synthetic.py ./
COPY static ./static

RUN useradd --create-home --uid 10001 app
USER app

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/healthz', timeout=3)"

# Behind a reverse proxy (Dokploy's Traefik): trust its forwarded headers.
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000", \
     "--proxy-headers", "--forwarded-allow-ips", "*", "--ws-max-size", "262144"]
