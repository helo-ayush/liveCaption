# Live Caption STT API Documentation

This directory contains the backend infrastructure for the Real-Time live captioning service. It acts as a resilient Socket.IO bridge between any frontend client and the Sarvam AI streaming Speech-To-Text WebSocket API.

---

## High-Level Architecture
- **Protocol**: `Socket.IO`
- **Port**: `3000` (configurable via `.env`)
- **AI Model**: `saaras:v3` (via Sarvam AI)
- **Feature**: `mode=translit` (Native Hinglish Transliteration)

---

## 🚀 How to Build a Frontend Client (Full Guide)

To integrate a Web, Mobile, or Desktop app with this server, you must connect via Socket.IO and follow this exact sequence of events.

### 1. Establish the Connection
First, connect to the Socket.IO server.
```javascript
import { io } from "socket.io-client";

// Connect to the backend
const socket = io("http://localhost:3000", {
  reconnection: true
});

socket.on("connect", () => {
    console.log("Successfully connected to the backend API");
});
```

---

### 2. Begin a Recording Session
You cannot send audio immediately. You must ask the server to initialize the connection to Sarvam first.

```javascript
// Tell the server you want to start transcribing
socket.emit("start-recording");

// Wait for the server to reply that Sarvam is ready
socket.on("sarvam-ready", () => {
    console.log("Sarvam AI connection established! Ready to send audio.");
    // NOW you can start capturing the microphone
});
```
**`sarvam-ready` Returns**: `None`

---

### 3. Capture & Send the Audio (The Hard Part)
> **⚠️ CRITICAL Constraint:** The backend **DOES NOT** accept compressed audio files like `.mp3`, `.wav` files with headers, or `.webm` blobs from `MediaRecorder`. It strictly requires **raw 16kHz Int16 PCM arrays**.

If you are building a Web App, you must use an `AudioContext` and an `AudioWorklet` to chop the microphone stream into raw PCM numbers.

**Example of capturing and emitting raw PCM:**
```javascript
// 1. Get Microphone at exactly 16000 Hz
const stream = await navigator.mediaDevices.getUserMedia({
    audio: { sampleRate: 16000, channelCount: 1 }
});

// 2. Setup Audio Processing
const audioContext = new AudioContext({ sampleRate: 16000 });
const source = audioContext.createMediaStreamSource(stream);

// 3. (Optional but Recommended) Amplify the audio
// Sarvam strict VAD might ignore low volume speech. Boost it first!
const gainNode = audioContext.createGain();
gainNode.gain.value = 2.5; // 250% volume

// 4. Create an AudioWorkletProcessor to convert Float32 to Int16 PCM
await audioContext.audioWorklet.addModule('pcm-processor.js');
const workletNode = new AudioWorkletNode(audioContext, "pcm-processor");

// Pipeline: Mic -> Amplifier -> Chopper
source.connect(gainNode);
gainNode.connect(workletNode);
workletNode.connect(audioContext.destination);

// 5. Send the chunks to the backend
workletNode.port.onmessage = (event) => {
    // event.data MUST BE an Int16Array or ArrayBuffer
    socket.emit("audio-chunk", event.data);
};
```

---

### 4. Listen for Voice Activity (VAD)
While you send audio, the server will tell you exactly when the AI detects human speech versus silence. Use this to power a UI indicator!

```javascript
socket.on("vad-status", (data) => {
    if (data.isProcessing) {
        console.log("🟢 The user is currently speaking...");
    } else {
        console.log("⚪ The user is silent.");
    }
});
```
**`vad-status` Returns**:
```json
{
  "isProcessing": true  // true = START_SPEECH, false = END_SPEECH
}
```

---

### 5. Display the Transcripts
Because Sarvam operates on silence boundaries, it **does not** provide word-by-word streaming drafts. It processes entire sentences when the user pauses.

```javascript
socket.on("transcript", (data) => {
    // If the user pauses, 'transcript' contains the final translated sentence
    document.getElementById("text-box").innerText = data.transcript;

    // 'interim' is a placeholder letting the user know the AI is listening
    if (data.interim) {
         document.getElementById("status-box").innerText = data.interim;
    }
});
```
**`transcript` Returns**:
```json
{
  "transcript": "Hello main theek hu.", // The accumulated, finalized translated text
  "interim": "Listening..."            // Placeholder status indicator
}
```

---

### 6. Stop and Cleanup
When the user is done, gracefully close the connection to save server resources.

```javascript
// Tell server to close the Sarvam connection and reset transcripts
socket.emit("stop-recording");
```

---

### Error Handling
Always listen for errors, as Sarvam authentication or format checks might fail.

```javascript
socket.on("error", (msg) => {
    alert("Transcription failed: " + msg);
});
```
**`error` Returns**: `String` // The error message description.
