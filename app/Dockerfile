FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py .

RUN useradd --system --uid 10001 appuser
USER 10001

EXPOSE 8080

CMD ["gunicorn", "--bind=0.0.0.0:8080", "--workers=2", "app:app"]
