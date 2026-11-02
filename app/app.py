
from flask import Flask, jsonify, request
import hashlib
import os
import socket
import time

app = Flask(__name__)

APP_NAME = os.getenv("APP_NAME", "platform-demo")
APP_VERSION = os.getenv("APP_VERSION", "1.0.0")


@app.get("/")
def home():
    return jsonify({
        "message": "Production Kubernetes Platform Demo",
        "application": APP_NAME,
        "version": APP_VERSION,
        "hostname": socket.gethostname()
    })


@app.get("/health")
def health():
    return jsonify({"status": "healthy"}), 200


@app.get("/ready")
def ready():
    return jsonify({"status": "ready"}), 200


@app.get("/info")
def info():
    return jsonify({
        "application": APP_NAME,
        "version": APP_VERSION,
        "hostname": socket.gethostname()
    })


@app.get("/work")
def work():
    try:
        seconds = float(request.args.get("seconds", "1"))
    except ValueError:
        return jsonify({"error": "seconds must be a number"}), 400

    if not 0.1 <= seconds <= 2.0:
        return jsonify({"error": "seconds must be between 0.1 and 2"}), 400

    deadline = time.perf_counter() + seconds
    data = b"platform-demo-hpa-load-test"
    iterations = 0

    while time.perf_counter() < deadline:
        data = hashlib.sha256(data).digest()
        iterations += 1

    return jsonify({
        "status": "completed",
        "duration_seconds": seconds,
        "iterations": iterations,
        "hostname": socket.gethostname()
    })


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=8080)
