// ─────────────────────────────────────────────────────────────────────────────
// server.js — Live Caption Backend
// Configuration: saaras:v3 model, mode=translit, flush_signal=true
// ─────────────────────────────────────────────────────────────────────────────
// HIGHLlGHT FLOW EXPLANATION:
// 1. Browser captures audio using AudioWorklet and sends raw PCM chunks via Socket.IO.
// 2. The Node.js server receives these chunks and wraps them in a WAV header.
// 3. The server sends this WAV-wrapped audio to Sarvam's WebSocket API.
// 4. Because `flush_signal=true` is set, Sarvam waits for us to tell it when to process the audio.
// 5. We use a `setInterval` to send a `{"type": "flush"}` command every 2 seconds.
// 6. When Sarvam receives the flush command, it instantly processes the audio buffer,
//    generates a transcript, and marks it with `is_final: true`.
// 7. This gives us highly accurate, complete sentences (Hinglish/translit) every 2 seconds.
// ─────────────────────────────────────────────────────────────────────────────

require('dotenv').config();

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const WebSocket = require("ws");

const app = express();
const server = http.createServer(app);

// Allow frontend URL to connect via CORS
const allowedOrigins = [process.env.FRONTEND_URL || "http://localhost:5173"];
const corsOptions = { origin: allowedOrigins, methods: ["GET", "POST"], credentials: true };
app.use(cors(corsOptions));

const io = new Server(server, { cors: corsOptions });

// ─────────────────────────────────────────────────────────────────────────────
// Socket.IO — Handles individual frontend connections
// ─────────────────────────────────────────────────────────────────────────────
io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);

  // STATE VARIABLES for this specific connection
  // `transcript`: Holds the final, committed black text blocks that won't change.
  // `interim_results`: Holds the current fast/partial gray text (if any).
  let transcript = "";
  let interim_results = "";

  // `flushInterval`: The timer ID that triggers the 2-second processing cycle.
  let flushInterval = null;

  // `hasReceivedAudio`: Prevents us from sending a flush command before the user starts speaking.
  let hasReceivedAudio = false;

  // 1. CONSTRUCT WEBSOCKET URL
  // We manually build the URL to pass specific query parameters to Sarvam.
  // Crucially, `flush_signal=true` puts us in manual control of when transcripts are locked in.
  const SARVAM_KEY = process.env.SARVAM_API_KEY;
  const sarvamUrl =
    "wss://api.sarvam.ai/speech-to-text/ws" +
    "?model=saaras:v3" +     // High accuracy model
    "&mode=translit" +       // Output in Romanized Hindi (Hinglish) instead of Devanagari script
    "&language-code=hi-IN" + // Hint that the speaker is speaking Indian languages
    "&sample_rate=16000" +   // Standard sample rate used by our frontend audio processor
    "&flush_signal=true";    // Tell Sarvam we will manually trigger processing via "flush" messages

  console.log("Connecting to:", sarvamUrl);

  // 2. CONNECT TO SARVAM
  // We pass the API key as a "subprotocol" in the WebSocket array header.
  // This is required by Sarvam's streaming API architecture instead of standard HTTP Auth headers.
  const sarvamWs = new WebSocket(sarvamUrl, [`api-subscription-key.${SARVAM_KEY}`]);

  // 3. HANDLE SUCCESSFUL CONNECTION
  sarvamWs.on("open", () => {
    console.log("Sarvam connected for client:", socket.id);
    // Tell the frontend that we are ready to receive audio!
    socket.emit("stt-ready");

    // ── PERIODIC FLUSH LOGIC ──────────────────────────────────────────────────
    // Because we set `flush_signal=true`, Sarvam just buffers the audio forever.
    // Every 2 seconds (2000ms), we ping Sarvam with a "flush" message.
    // This tells Sarvam: "Process the audio you have buffered RIGHT NOW and give me the transcript."
    // 2000ms gives the AI enough context (a few words) to accurately transcribe the Hinglish text.
    flushInterval = setInterval(() => {
      // We only flush if the connection is active AND the frontend actually sent some audio bytes.
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

    console.log("Sarvam:", JSON.stringify(data));

    // Handle authentication or internal Sarvam errors
    if (data.type === "error") {
      console.error("Sarvam error:", data.data?.message);
      return;
    }

    // `type: "end"` normally indicates a natural pause, but with flush_signal we mainly rely on "data"
    if (data.type === "end") {
      if (interim_results) {
        transcript += (transcript ? " " : "") + interim_results;
        interim_results = "";
        console.log("FINAL (end):", transcript);
      }
    }
    // `type: "data"` contains actual transcript blobs
    else if (data.type === "data") {
      const text = data.data?.transcript || "";
      if (!text) return;

      // When we trigger a manual `flush`, Sarvam returns the chunk of text with `is_final: true`.
      // This means this block of text is highly confident and won't change anymore, so we lock it in.
      if (data.data.is_final) {
        transcript += (transcript ? " " : "") + text; // Append to main black text
        interim_results = "";                         // Clear any gray pending text
        console.log("FINAL (flushed):", text);
      }
      // If `is_final` is false, this is a very fast partial guess (interim).
      // We keep it as gray text until the next flush confirms it.
      else {
        interim_results = text;
        console.log("INTERIM:", text);
      }
    } else {
      return;
    }

    // 5. SEND UPDATES TO FRONTEND
    // Both `transcript` (black) and `interim_results` (gray) are sent.
    // Because we use `mode=translit`, there is no difference between native and english translation,
    // so we duplicate the values into the `eng_` variables to keep the UI happy.
    socket.emit("transcript", {
      transcript,
      eng_transcript: transcript,
      interim_results,
      eng_interim_results: interim_results
    });
  });

  sarvamWs.on("error", (err) => {
    console.error("Sarvam error for client", socket.id, ":", err.message);
  });

  sarvamWs.on("close", (code) => {
    console.log(`Sarvam closed for client ${socket.id} — code: ${code}`);
    // Stop the 2-second timer to prevent memory leaks when the connection ends.
    if (flushInterval) clearInterval(flushInterval);
  });

  // 6. PROCESS INCOMING AUDIO FROM FRONTEND
  socket.on("audio-chunk", (chunk) => {
    // Make sure the outward Sarvam socket is open
    if (sarvamWs.readyState === WebSocket.OPEN && chunk) {

      // Mark that audio has started so our flush timer is allowed to fire
      hasReceivedAudio = true;

      // Even though the URL says &input_audio_codec=pcm_s16le, the Sarvam WebSocket
      // pipeline strictly validates the JSON payload property `encoding` to be "audio/wav".
      // We must wrap the raw PCM chunk in a WAV header to satisfy their backend.
      const wavBuffer = pcmToWav(Buffer.from(chunk));

      // Send the wrapped payload
      sarvamWs.send(JSON.stringify({
        audio: {
          data: wavBuffer.toString("base64"),
          encoding: "audio/wav",
          sample_rate: 16000
        }
      }));
    }
  });

  // 7. HANDLE CLEANUP ON DISCONNECT
  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
    if (flushInterval) clearInterval(flushInterval);      // Clean up timer
    if (sarvamWs.readyState === WebSocket.OPEN) sarvamWs.close(); // Clean up socket connecting to Sarvam
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AUDIO FORMATTER UTILITY
// Prepend a standard 44-byte WAV specific header to the raw audio buffer
// This is required because Sarvam's API requires valid WAV files, not raw streams.
// ─────────────────────────────────────────────────────────────────────────────
function pcmToWav(pcmBuffer, sampleRate = 16000, numChannels = 1, bitDepth = 16) {
  const dataLength = pcmBuffer.length;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);                               // ChunkID
  header.writeUInt32LE(36 + dataLength, 4);              // ChunkSize
  header.write("WAVE", 8);                               // Format
  header.write("fmt ", 12);                              // Subchunk1ID
  header.writeUInt32LE(16, 16);                          // Subchunk1Size
  header.writeUInt16LE(1, 20);                           // AudioFormat (1 = PCM)
  header.writeUInt16LE(numChannels, 22);                 // NumChannels
  header.writeUInt32LE(sampleRate, 24);                  // SampleRate
  header.writeUInt32LE(sampleRate * numChannels * bitDepth / 8, 28); // ByteRate
  header.writeUInt16LE(numChannels * bitDepth / 8, 32);  // BlockAlign
  header.writeUInt16LE(bitDepth, 34);                    // BitsPerSample
  header.write("data", 36);                              // Subchunk2ID
  header.writeUInt32LE(dataLength, 40);                  // Subchunk2Size
  return Buffer.concat([header, pcmBuffer]);
}

// ─────────────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
