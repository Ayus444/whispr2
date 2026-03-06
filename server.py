import os
import json
import uuid
import sqlite3
import threading
import time
import logging
from datetime import datetime, timedelta
from functools import wraps
from flask import Flask, request, jsonify, render_template, g
from flask_cors import CORS
import requests
import re
from collections import defaultdict

# ─────────────────────────────────────────────
#  Configuration  — edit these before running
# ─────────────────────────────────────────────
TELEGRAM_BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "YOUR_BOT_TOKEN_HERE")
TELEGRAM_ADMIN_CHAT_ID = os.environ.get("TELEGRAM_ADMIN_CHAT_ID", "YOUR_ADMIN_CHAT_ID")
SECRET_WEBHOOK_PATH = os.environ.get("WEBHOOK_SECRET", "webhook_secret_path_change_me")
DATABASE_PATH = os.path.join(os.path.dirname(__file__), "database.db")

# ─────────────────────────────────────────────
#  Flask app setup
# ─────────────────────────────────────────────
app = Flask(__name__, template_folder="templates", static_folder="static")
CORS(app)
init_db()
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ─────────────────────────────────────────────
#  Rate limiting (in-memory)
# ─────────────────────────────────────────────
rate_limit_store = defaultdict(list)
RATE_LIMIT_MAX = 5          # messages per window
RATE_LIMIT_WINDOW = 60      # seconds

def is_rate_limited(identifier: str) -> bool:
    now = time.time()
    window_start = now - RATE_LIMIT_WINDOW
    rate_limit_store[identifier] = [
        t for t in rate_limit_store[identifier] if t > window_start
    ]
    if len(rate_limit_store[identifier]) >= RATE_LIMIT_MAX:
        return True
    rate_limit_store[identifier].append(now)
    return False

# ─────────────────────────────────────────────
#  Database
# ─────────────────────────────────────────────
def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(DATABASE_PATH, detect_types=sqlite3.PARSE_DECLTYPES)
        g.db.row_factory = sqlite3.Row
    return g.db

@app.teardown_appcontext
def close_db(error):
    db = g.pop("db", None)
    if db is not None:
        db.close()

def init_db():
    conn = sqlite3.connect(DATABASE_PATH)
    cursor = conn.cursor()
    cursor.executescript("""
        CREATE TABLE IF NOT EXISTS messages (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            chat_id     TEXT    NOT NULL,
            sender      TEXT    NOT NULL CHECK(sender IN ('user','admin')),
            content     TEXT    NOT NULL,
            timestamp   TEXT    NOT NULL,
            delivered   INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_chat_id ON messages(chat_id);
        CREATE INDEX IF NOT EXISTS idx_timestamp ON messages(timestamp);
    """)
    conn.commit()
    conn.close()
    logger.info("Database initialised at %s", DATABASE_PATH)

# ─────────────────────────────────────────────
#  Helpers
# ─────────────────────────────────────────────
def sanitize(text: str, max_len: int = 1000) -> str:
    text = text.strip()
    text = re.sub(r"[<>&\"']", lambda m: {
        "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#x27;"
    }[m.group()], text)
    return text[:max_len]

def now_iso() -> str:
    return datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")

def send_telegram(text: str, parse_mode: str = "HTML") -> bool:
    if TELEGRAM_BOT_TOKEN == "YOUR_BOT_TOKEN_HERE":
        logger.warning("Telegram token not configured — message not sent")
        return False
    url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
    payload = {"chat_id": TELEGRAM_ADMIN_CHAT_ID, "text": text, "parse_mode": parse_mode}
    try:
        r = requests.post(url, json=payload, timeout=10)
        r.raise_for_status()
        return True
    except Exception as exc:
        logger.error("Telegram send failed: %s", exc)
        return False

def save_message(chat_id: str, sender: str, content: str) -> dict:
    ts = now_iso()
    conn = sqlite3.connect(DATABASE_PATH)
    cursor = conn.cursor()
    cursor.execute(
        "INSERT INTO messages (chat_id, sender, content, timestamp) VALUES (?,?,?,?)",
        (chat_id, sender, content, ts)
    )
    msg_id = cursor.lastrowid
    conn.commit()
    conn.close()
    return {"id": msg_id, "chat_id": chat_id, "sender": sender, "content": content, "timestamp": ts}

def get_messages(chat_id: str, since_id: int = 0) -> list:
    conn = sqlite3.connect(DATABASE_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute(
        "SELECT * FROM messages WHERE chat_id=? AND id>? ORDER BY id ASC",
        (chat_id, since_id)
    )
    rows = [dict(r) for r in cursor.fetchall()]
    conn.close()
    return rows

# ─────────────────────────────────────────────
#  Routes
# ─────────────────────────────────────────────
@app.route("/")
def index():
    return render_template("index.html")

@app.route("/api/session", methods=["POST"])
def create_session():
    """Generate a unique chat session ID."""
    chat_id = str(uuid.uuid4())[:8].upper()
    return jsonify({"chat_id": chat_id})

@app.route("/api/send", methods=["POST"])
def send_message():
    """User sends an anonymous message."""
    ip = request.headers.get("X-Forwarded-For", request.remote_addr).split(",")[0].strip()
    if is_rate_limited(ip):
        return jsonify({"error": "Slow down — too many messages."}), 429

    data = request.get_json(silent=True) or {}
    chat_id = sanitize(data.get("chat_id", ""), 16)
    content = sanitize(data.get("message", ""), 1000)

    if not chat_id or not content:
        return jsonify({"error": "chat_id and message are required."}), 400

    if len(content) < 1:
        return jsonify({"error": "Message cannot be empty."}), 400

    msg = save_message(chat_id, "user", content)

    # Forward to Telegram
    tg_text = (
        f"📨 <b>New Anonymous Message</b>\n\n"
        f"🆔 Chat ID: <code>{chat_id}</code>\n"
        f"💬 Message: {content}\n\n"
        f"↩️ Reply with:\n<code>/reply {chat_id} Your reply here</code>"
    )
    send_telegram(tg_text)

    return jsonify({"ok": True, "message": msg}), 201

@app.route("/api/messages/<chat_id>", methods=["GET"])
def poll_messages(chat_id):
    """Long-poll endpoint — returns messages newer than ?since_id=N."""
    chat_id = sanitize(chat_id, 16)
    since_id = int(request.args.get("since_id", 0))
    messages = get_messages(chat_id, since_id)
    return jsonify({"messages": messages})

@app.route(f"/telegram/{SECRET_WEBHOOK_PATH}", methods=["POST"])
def telegram_webhook():
    """Receive updates from Telegram."""
    update = request.get_json(silent=True)
    if not update:
        return "ok"

    message = update.get("message") or update.get("channel_post")
    if not message:
        return "ok"

    text = message.get("text", "").strip()
    # Only process /reply commands
    match = re.match(r"^/reply\s+(\S+)\s+(.+)$", text, re.DOTALL)
    if match:
        chat_id = match.group(1).upper()
        reply_text = sanitize(match.group(2), 1000)
        save_message(chat_id, "admin", reply_text)
        logger.info("Admin replied to chat %s", chat_id)

        # Confirm to admin
        confirm = f"✅ Reply sent to <code>{chat_id}</code>"
        requests.post(
            f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage",
            json={"chat_id": message["chat"]["id"], "text": confirm, "parse_mode": "HTML"},
            timeout=10
        )

    return "ok"

@app.route("/api/setup_webhook", methods=["GET"])
def setup_webhook():
    """Helper route to register the webhook with Telegram."""
    host = request.host_url.rstrip("/")
    webhook_url = f"{host}/telegram/{SECRET_WEBHOOK_PATH}"
    r = requests.post(
        f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/setWebhook",
        json={"url": webhook_url},
        timeout=10
    )
    return jsonify(r.json())

# ─────────────────────────────────────────────
#  Entry point
# ─────────────────────────────────────────────
if __name__ == "__main__":
    init_db()
    port = int(os.environ.get("PORT", 5000))
    logger.info("Starting server on port %d", port)
    app.run(host="0.0.0.0", port=port, debug=False)
