// ─────────────────────────────────────────────────────────────────────────────
// server.js — Live Caption Backend (Production)
// Configuration: saaras:v3 model, mode=translit, flush_signal=true
// ─────────────────────────────────────────────────────────────────────────────
// FLOW:
// 1. Browser captures audio using AudioWorklet → sends raw PCM chunks via Socket.IO.
// 2. Server wraps each PCM chunk in a WAV header (Sarvam requires encoding: "audio/wav").
// 3. Server forwards WAV-wrapped audio to Sarvam's WebSocket API.
// 4. Because flush_signal=true, we send {"type":"flush"} every 2s to force processing.
// 5. Sarvam returns transcript chunks → server emits to browser via Socket.IO.
// ─────────────────────────────────────────────────────────────────────────────

require('dotenv').config();

// ── ENV VALIDATION — fail fast at startup ────────────────────────────────────
const REQUIRED_ENV = ['SARVAM_API_KEY'];
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.error(`FATAL: Missing required env var: ${key}`);
    console.error('Copy .env.example to .env and fill in the values.');
    process.exit(1);
  }
}

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const helmet = require("helmet");
const WebSocket = require("ws");

const app = express();
const server = http.createServer(app);

// ── SECURITY — helmet sets standard HTTP security headers ────────────────────
app.use(helmet());

// ── CORS — support multiple origins via comma-separated FRONTEND_URL ─────────
// Example: FRONTEND_URL=http://localhost:5173,https://live-caption-eta.vercel.app
const allowedOrigins = (process.env.FRONTEND_URL || "http://localhost:5173")
  .split(",")
  .map(o => o.trim());

const corsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (e.g., server-to-server, curl)
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`CORS: origin ${origin} not allowed`));
    }
  },
  methods: ["GET", "POST"],
  credentials: true
};
app.use(cors(corsOptions));

// ── HEALTH CHECK — for Docker, load balancers, and uptime monitors ───────────
app.get("/health", (req, res) => {
  res.status(200).json({
    status: "ok",
    uptime: Math.floor(process.uptime()),
    connections: io.engine.clientsCount
  });
});

const io = new Server(server, { cors: corsOptions });

// Track active connections for monitoring
let activeConnections = 0;

// ─────────────────────────────────────────────────────────────────────────────
// Socket.IO — Handles individual frontend connections
// ─────────────────────────────────────────────────────────────────────────────
io.on("connection", (socket) => {
  activeConnections++;
  console.log(`Client connected: ${socket.id} (active: ${activeConnections})`);

  // STATE VARIABLES for this specific connection
  let transcript = "";        // Final committed black text
  let interim_results = "";   // Current partial gray text
  let flushInterval = null;   // Timer ID for periodic flush
  let hasReceivedAudio = false;

  // 1. CONSTRUCT WEBSOCKET URL
  const SARVAM_KEY = process.env.SARVAM_API_KEY;
  const sarvamUrl =
    "wss://api.sarvam.ai/speech-to-text/ws" +
    "?model=saaras:v3" +
    "&mode=translit" +
    "&language-code=hi-IN" +
    "&sample_rate=16000" +
    "&flush_signal=true";

  console.log("Connecting to Sarvam for client:", socket.id);

  // 2. CONNECT TO SARVAM
  // API key passed as WebSocket subprotocol (required by Sarvam's architecture)
  const sarvamWs = new WebSocket(sarvamUrl, [`api-subscription-key.${SARVAM_KEY}`]);

  // 3. HANDLE SUCCESSFUL CONNECTION
  sarvamWs.on("open", () => {
    console.log("Sarvam connected for client:", socket.id);
    socket.emit("stt-ready");

    // Periodic flush: force Sarvam to process buffered audio every 2 seconds
    flushInterval = setInterval(() => {
      if (sarvamWs.readyState === WebSocket.OPEN && hasReceivedAudio) {
        sarvamWs.send(JSON.stringify({ type: "flush" }));
      }
    }, 2000);
  });

  // 4. RECEIVE MESSAGES FROM SARVAM
  sarvamWs.on("message", (rawData) => {
    let data;
    try { data = JSON.parse(rawData.toString()); }
    catch (e) { return; }

    if (data.type === "error") {
      console.error("Sarvam error:", data.data?.message);
      return;
    }

    if (data.type === "end") {
      if (interim_results) {
        transcript += (transcript ? " " : "") + interim_results;
        interim_results = "";
        console.log("FINAL (end):", transcript);
      }
    } else if (data.type === "data") {
      const text = data.data?.transcript || "";
      if (!text) return;

      if (data.data.is_final) {
        transcript += (transcript ? " " : "") + text;
        interim_results = "";
        console.log("FINAL (flushed):", text);
      } else {
        interim_results = text;
        console.log("INTERIM:", text);
      }
    } else {
      return;
    }

    socket.emit("transcript", {
      transcript,
      eng_transcript: transcript,
      interim_results,
      eng_interim_results: interim_results
    });
  });

  sarvamWs.on("error", (err) => {
    console.error("Sarvam WS error for client", socket.id, ":", err.message);
  });

  sarvamWs.on("close", (code) => {
    console.log(`Sarvam closed for client ${socket.id} — code: ${code}`);
    if (flushInterval) clearInterval(flushInterval);
  });

  // 5. PROCESS INCOMING AUDIO FROM FRONTEND
  socket.on("audio-chunk", (chunk) => {
    if (sarvamWs.readyState === WebSocket.OPEN && chunk) {
      hasReceivedAudio = true;

      // Wrap raw PCM in WAV header (Sarvam requires encoding: "audio/wav")
      const wavBuffer = pcmToWav(Buffer.from(chunk));
      sarvamWs.send(JSON.stringify({
        audio: {
          data: wavBuffer.toString("base64"),
          encoding: "audio/wav",
          sample_rate: 16000
        }
      }));
    }
  });

  // 6. CLEANUP ON DISCONNECT
  socket.on("disconnect", () => {
    activeConnections--;
    console.log(`Client disconnected: ${socket.id} (active: ${activeConnections})`);
    if (flushInterval) clearInterval(flushInterval);
    if (sarvamWs.readyState === WebSocket.OPEN) sarvamWs.close();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AUDIO FORMATTER — Prepend 44-byte WAV header to raw PCM_S16LE data
// ─────────────────────────────────────────────────────────────────────────────
function pcmToWav(pcmBuffer, sampleRate = 16000, numChannels = 1, bitDepth = 16) {
  const dataLength = pcmBuffer.length;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataLength, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * numChannels * bitDepth / 8, 28);
  header.writeUInt16LE(numChannels * bitDepth / 8, 32);
  header.writeUInt16LE(bitDepth, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataLength, 40);
  return Buffer.concat([header, pcmBuffer]);
}

// ─────────────────────────────────────────────────────────────────────────────
// GRACEFUL SHUTDOWN — cleanly close all connections on SIGTERM/SIGINT
// Docker sends SIGTERM when stopping containers. Without this handler,
// active WebSocket sessions are killed abruptly.
// ─────────────────────────────────────────────────────────────────────────────
function gracefulShutdown(signal) {
  console.log(`\n${signal} received. Shutting down gracefully...`);

  // Stop accepting new connections
  server.close(() => {
    console.log("HTTP server closed.");
    process.exit(0);
  });

  // Close all Socket.IO connections
  io.close(() => {
    console.log("Socket.IO connections closed.");
  });

  // Force exit after 10 seconds if graceful shutdown stalls
  setTimeout(() => {
    console.error("Forced shutdown after timeout.");
    process.exit(1);
  }, 10000);
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

// ─────────────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Allowed origins: ${allowedOrigins.join(", ")}`);
});
