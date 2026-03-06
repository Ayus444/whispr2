/* ─────────────────────────────────────────────
   WHISPR — Frontend JavaScript
   ───────────────────────────────────────────── */

"use strict";

// ── State ─────────────────────────────────────
let chatId      = null;
let lastMsgId   = 0;
let pollTimer   = null;
let isSending   = false;
const POLL_MS   = 2500;   // polling interval
const MAX_LEN   = 1000;

// ── DOM refs ──────────────────────────────────
const chatMessages    = document.getElementById("chatMessages");
const messageInput    = document.getElementById("messageInput");
const sendBtn         = document.getElementById("sendBtn");
const chatIdDisplay   = document.getElementById("chatIdDisplay");
const newSessionBtn   = document.getElementById("newSessionBtn");
const statusDot       = document.getElementById("statusDot");
const statusText      = document.getElementById("statusText");
const statusBar       = document.getElementById("statusBar");
const charCount       = document.getElementById("charCount");
const msgCount        = document.getElementById("msgCount");
const typingIndicator = document.getElementById("typingIndicator");

// ─────────────────────────────────────────────
//  Session management
// ─────────────────────────────────────────────
async function createSession() {
  try {
    const r = await fetch("/api/session", { method: "POST" });
    const d = await r.json();
    chatId = d.chat_id;
    chatIdDisplay.textContent = chatId;
    setStatus("online", "Online");
    setStatusBar("Session active — " + chatId);
    startPolling();
  } catch (e) {
    setStatus("offline", "Offline");
    setStatusBar("Error connecting to server");
  }
}

function newSession() {
  if (!confirm("Start a fresh session? Your current chat will be lost.")) return;
  stopPolling();
  lastMsgId = 0;
  chatMessages.innerHTML = "";
  addSysMsg("New session started.");
  createSession();
}

// ─────────────────────────────────────────────
//  Sending messages
// ─────────────────────────────────────────────
async function sendMessage() {
  const text = messageInput.value.trim();
  if (!text || !chatId || isSending) return;
  if (text.length > MAX_LEN) { setStatusBar("Message too long!"); return; }

  isSending = true;
  sendBtn.disabled = true;
  setStatusBar("Sending…");

  try {
    const r = await fetch("/api/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, message: text })
    });
    const d = await r.json();

    if (!r.ok) {
      addSysMsg("⚠ " + (d.error || "Failed to send."), true);
      setStatusBar(d.error || "Error sending message");
    } else {
      messageInput.value = "";
      charCount.textContent = "0";
      charCount.parentElement.classList.remove("warn");
      appendBubble(d.message);
      lastMsgId = Math.max(lastMsgId, d.message.id);
      updateMsgCount();
      setStatusBar("Message sent — waiting for reply…");
    }
  } catch (e) {
    addSysMsg("⚠ Network error. Please try again.", true);
    setStatusBar("Network error");
  } finally {
    isSending = false;
    sendBtn.disabled = false;
    messageInput.focus();
  }
}

// ─────────────────────────────────────────────
//  Polling for new messages
// ─────────────────────────────────────────────
function startPolling() {
  stopPolling();
  pollTimer = setInterval(pollMessages, POLL_MS);
}

function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

async function pollMessages() {
  if (!chatId) return;
  try {
    const r = await fetch(`/api/messages/${chatId}?since_id=${lastMsgId}`);
    const d = await r.json();

    if (d.messages && d.messages.length) {
      d.messages.forEach(msg => {
        // Skip user messages we already rendered
        if (msg.sender === "user" && msg.id <= lastMsgId) return;
        appendBubble(msg);
        lastMsgId = Math.max(lastMsgId, msg.id);
      });
      updateMsgCount();
      // Show typing indicator briefly when admin message arrives
      const adminMsgs = d.messages.filter(m => m.sender === "admin");
      if (adminMsgs.length) showTypingThenClear();
    }
    setStatus("online", "Online");
  } catch (e) {
    setStatus("offline", "Connection lost");
  }
}

// ─────────────────────────────────────────────
//  UI helpers
// ─────────────────────────────────────────────
function appendBubble(msg) {
  // Remove welcome message if present
  const welcome = chatMessages.querySelector(".welcome-msg");
  if (welcome) welcome.remove();

  const wrap = document.createElement("div");
  wrap.className = `message-bubble ${msg.sender}`;

  const label = msg.sender === "user" ? "▶ YOU" : "◀ ADMIN";
  const time   = formatTime(msg.timestamp);

  wrap.innerHTML = `
    <div class="bubble-label">${label}</div>
    <div class="bubble-body">${escapeHtml(msg.content)}</div>
    <div class="bubble-time">${time}</div>
  `;
  chatMessages.appendChild(wrap);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function addSysMsg(text, isError = false) {
  const el = document.createElement("div");
  el.className = "sys-msg" + (isError ? " error" : "");
  el.textContent = text;
  chatMessages.appendChild(el);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function setStatus(state, text) {
  statusDot.className  = "status-dot " + state;
  statusText.textContent = text;
}

function setStatusBar(text) {
  statusBar.textContent = text;
}

function updateMsgCount() {
  const count = chatMessages.querySelectorAll(".message-bubble").length;
  msgCount.textContent = count + (count === 1 ? " message" : " messages");
}

function showTypingThenClear() {
  typingIndicator.classList.remove("hidden");
  setStatus("typing", "Admin is typing…");
  setTimeout(() => {
    typingIndicator.classList.add("hidden");
    setStatus("online", "Online");
  }, 2000);
}

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;")
    .replace(/\n/g, "<br/>");
}

function formatTime(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch { return ""; }
}

// ─────────────────────────────────────────────
//  Character counter
// ─────────────────────────────────────────────
messageInput.addEventListener("input", () => {
  const len = messageInput.value.length;
  charCount.textContent = len;
  charCount.parentElement.classList.toggle("warn", len > 900);
});

messageInput.addEventListener("keydown", e => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

sendBtn.addEventListener("click", sendMessage);
newSessionBtn.addEventListener("click", newSession);

// Title bar buttons (cosmetic)
document.querySelector(".tb-min")?.addEventListener("click", () => {
  const body = document.querySelector(".window-body");
  body.style.display = body.style.display === "none" ? "" : "none";
});

// ─────────────────────────────────────────────
//  Particle canvas — floating hearts & pixels
// ─────────────────────────────────────────────
const canvas  = document.getElementById("particles");
const ctx     = canvas.getContext("2d");
let particles = [];

function resizeCanvas() {
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;
}

class Particle {
  constructor() { this.reset(true); }

  reset(initial = false) {
    this.x    = Math.random() * canvas.width;
    this.y    = initial ? Math.random() * canvas.height : canvas.height + 20;
    this.size = 8 + Math.random() * 14;
    this.speed= 0.3 + Math.random() * 0.7;
    this.drift= (Math.random() - 0.5) * 0.4;
    this.rot  = Math.random() * Math.PI * 2;
    this.rotSpeed = (Math.random() - 0.5) * 0.02;
    this.alpha= 0.15 + Math.random() * 0.35;
    this.type = Math.random() < 0.6 ? "heart" : "pixel";
    this.hue  = Math.random() < 0.5 ? "#ff6b6b" : "#4a90d9";
  }

  update() {
    this.y   -= this.speed;
    this.x   += this.drift;
    this.rot += this.rotSpeed;
    if (this.y < -30) this.reset();
  }

  draw() {
    ctx.save();
    ctx.globalAlpha = this.alpha;
    ctx.translate(this.x, this.y);
    ctx.rotate(this.rot);
    ctx.fillStyle = this.hue;

    if (this.type === "heart") {
      // Pixel-art heart
      const s = this.size / 8;
      const px = [
        [0,1,0,1,0],
        [1,1,1,1,1],
        [1,1,1,1,1],
        [0,1,1,1,0],
        [0,0,1,0,0],
      ];
      px.forEach((row, ry) =>
        row.forEach((cell, rx) => {
          if (cell) ctx.fillRect((rx - 2) * s, (ry - 2) * s, s, s);
        })
      );
    } else {
      // Pixel square
      ctx.fillRect(-this.size / 4, -this.size / 4, this.size / 2, this.size / 2);
    }
    ctx.restore();
  }
}

function initParticles() {
  particles = Array.from({ length: 40 }, () => new Particle());
}

function animateParticles() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  particles.forEach(p => { p.update(); p.draw(); });
  requestAnimationFrame(animateParticles);
}

resizeCanvas();
initParticles();
animateParticles();
window.addEventListener("resize", () => { resizeCanvas(); initParticles(); });

// ─────────────────────────────────────────────
//  Boot sequence
// ─────────────────────────────────────────────
(async () => {
  setStatus("offline", "Connecting…");
  setStatusBar("Initialising whispr…");
  await new Promise(r => setTimeout(r, 400));
  await createSession();
})();
