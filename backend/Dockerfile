ARG PYTHON_IMAGE=python:3.13-slim
FROM ${PYTHON_IMAGE}
WORKDIR /app
COPY requirements.lock /app/
RUN pip install --no-cache-dir -r requirements.lock
COPY pyproject.toml /app/
COPY rewind /app/rewind
RUN pip install --no-cache-dir --no-deps .
EXPOSE 8000
CMD ["uvicorn", "rewind.app:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
