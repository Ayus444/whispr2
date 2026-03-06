# 💌 whispr — Anonymous Messaging App

A retro Windows XP-styled anonymous messaging app with real-time Telegram bot integration.

---

## 📁 File Structure

```
/project
├── server.py              ← Flask backend
├── requirements.txt       ← Python dependencies
├── database.db            ← Auto-created on first run
├── templates/
│   └── index.html         ← Main HTML page
└── static/
    ├── style.css           ← Retro XP styling
    └── script.js           ← Chat logic + particles
```

---

## ⚡ Quick Start

### 1. Install dependencies

```bash
pip install -r requirements.txt
```

### 2. Create your Telegram bot

1. Open Telegram and message **@BotFather**
2. Send `/newbot` and follow the prompts
3. Copy the **Bot Token** (looks like `1234567890:ABCDefgh...`)
4. Get your **Admin Chat ID**:
   - Message **@userinfobot** in Telegram
   - It will reply with your chat/user ID

### 3. Configure the app

**Option A — Environment variables (recommended):**
```bash
export TELEGRAM_BOT_TOKEN="1234567890:ABCDefghijklmno"
export TELEGRAM_ADMIN_CHAT_ID="987654321"
export WEBHOOK_SECRET="my_super_secret_path_123"
```

**Option B — Edit server.py directly:**
Open `server.py` and replace the defaults:
```python
TELEGRAM_BOT_TOKEN    = "1234567890:ABCDefghijklmno"
TELEGRAM_ADMIN_CHAT_ID = "987654321"
SECRET_WEBHOOK_PATH   = "my_super_secret_path_123"
```

### 4. Run the server

```bash
python server.py
```

Visit **http://localhost:5000** in your browser.

---

## 🔗 Setting up the Telegram Webhook

For the bot to receive `/reply` commands from Telegram, it needs a **publicly accessible HTTPS URL**.

### Option A — ngrok (local development)

```bash
# Install ngrok: https://ngrok.com/download
ngrok http 5000
```

Copy the HTTPS URL (e.g. `https://abc123.ngrok.io`) and register the webhook:

```
http://localhost:5000/api/setup_webhook
```

Or manually:
```
https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://abc123.ngrok.io/telegram/<YOUR_WEBHOOK_SECRET>
```

### Option B — Deploy to a server (production)

Deploy the app to any server with a public IP (e.g. Railway, Render, DigitalOcean, VPS).
Then visit:
```
https://yourdomain.com/api/setup_webhook
```

---

## 💬 How to Reply from Telegram

When a user sends a message, the bot will send you a notification like:

```
📨 New Anonymous Message

🆔 Chat ID: A1B2C3D4
💬 Message: Hello, I have a question!

↩️ Reply with:
/reply A1B2C3D4 Your reply here
```

To reply, simply send:
```
/reply A1B2C3D4 Hey there! Happy to help.
```

The reply will appear instantly in the user's chat window.

---

## 🔒 Security Features

| Feature | Details |
|---|---|
| Rate limiting | Max 5 messages per IP per 60 seconds |
| Message length | Capped at 1000 characters |
| Input sanitisation | HTML entities escaped on save |
| Session isolation | Each browser session gets a unique 8-char ID |
| Webhook secret | Hidden URL path prevents unauthorised POSTs |

---

## 🌐 Environment Variables Reference

| Variable | Default | Description |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | `YOUR_BOT_TOKEN_HERE` | BotFather token |
| `TELEGRAM_ADMIN_CHAT_ID` | `YOUR_ADMIN_CHAT_ID` | Your Telegram user ID |
| `WEBHOOK_SECRET` | `webhook_secret_path_change_me` | Hidden path for webhook |
| `PORT` | `5000` | Server port |

---

## 🛠 API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| GET | `/` | Main chat page |
| POST | `/api/session` | Create new session → returns `chat_id` |
| POST | `/api/send` | Send a message `{chat_id, message}` |
| GET | `/api/messages/<chat_id>?since_id=N` | Poll for new messages |
| POST | `/telegram/<secret>` | Telegram webhook receiver |
| GET | `/api/setup_webhook` | Register webhook with Telegram |

---

## ✨ Features

- **Retro Windows XP aesthetic** — title bar, bevelled buttons, silver chrome
- **Floating pixel hearts & particles** — animated canvas background
- **CRT scanline overlay** — authentic retro feel  
- **Real-time polling** — new replies appear every 2.5 seconds
- **Typing indicator** — animated dots when admin reply arrives
- **Session isolation** — each visitor has a unique chat ID
- **Mobile responsive** — works on phones and tablets
- **Character counter** — live count with warning at 900 chars
- **Keyboard shortcut** — Enter to send (Shift+Enter for newline)

---

## 📋 Troubleshooting

**Bot not receiving messages?**
- Check that `TELEGRAM_BOT_TOKEN` is correct
- Make sure the webhook URL is public HTTPS (not HTTP)
- Re-run `/api/setup_webhook`

**Replies not appearing on website?**
- Check that `/reply <CHAT_ID> <text>` format is correct (exact Chat ID, uppercase)
- Verify `TELEGRAM_ADMIN_CHAT_ID` matches the account you're replying from

**Rate limit errors?**
- Wait 60 seconds, then try again
- Adjust `RATE_LIMIT_MAX` and `RATE_LIMIT_WINDOW` in `server.py`
