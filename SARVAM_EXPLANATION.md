# Comprehensive Guide: How Your Live Caption App Works 🎙️➡️💻

This guide is designed to explain **exactly** how your application takes your voice and turns it into text on your screen, line by line.

We will break down the two main parts of this process:
1. **The Frontend (`client/src/App.jsx`)**: How we capture your voice.
2. **The Backend (`server/utils/sarvam.js`)**: How we send your voice to the Sarvam AI Robot and get text back.

Let's dive deep into the code!

---

## 1. The Frontend (Your Web Browser)
*File: `client/src/App.jsx`*

The frontend is what runs in Google Chrome or Safari. Its job is to listen to your microphone, make the sound louder if needed, format it correctly, and send it to your server.

### A. The Setup Variables
```javascript
const [finalTranscript, setFinalTranscript] = useState("");
const [interimTranscript, setInterimTranscript] = useState("");
const [vadProcessing, setVadProcessing] = useState(false);
```
- Imagine these as boxes on your screen.
- `finalTranscript` holds the finished, confirmed sentences (like "Hello how are you.").
- `interimTranscript` holds words the robot is still thinking about (like "Listening...").
- `vadProcessing` is a light bulb that turns green (1) when the robot hears you talking, and gray (0) when you stop.

### B. Listening to the Server
```javascript
socket.on("transcript", (data) => {
  setFinalTranscript(data.transcript || "");
  setInterimTranscript(data.interim || "");
});

socket.on("vad-status", (data) => {
  setVadProcessing(data.isProcessing);
});
```
- Your browser is always listening to the backend server over a "Socket" (a two-way walkie-talkie connection).
- If the server says "transcript!", the browser updates the text on your screen.
- If the server says "vad-status!", the browser updates the light bulb (Processing/Idle).

### C. Capturing Your Voice (The Important Part!)
When you click **Start Recording**:
```javascript
socketRef.current.emit("start-recording");
```
- **Input to backend:** We send a message `start-recording` across the walkie-talkie. This wakes up the backend.

```javascript
const stream = await navigator.mediaDevices.getUserMedia({
  audio: { sampleRate: 16000, channelCount: 1 }
});
```
- We ask the browser for permission to use the microphone.
- We specifically ask for `16000` (16kHz) audio, because that is the exact format the Sarvam AI robot demands.

```javascript
const gainNode = audioContext.createGain();
gainNode.gain.value = 2.5; 
```
- **The Amplifier:** This is the magic trick we added! The microphone audio naturally comes in a bit quiet.
- We create a `GainNode` (an amplifier) and multiply exactly what you say by `2.5`. 
- This makes your voice louder *before* it leaves your computer, ensuring Sarvam actually listens to you even if you whisper.

```javascript
const workletCode = `...` // PCM Processor
```
- **The Chopper:** Microphones capture sound as smooth waves (Float32). But Sarvam only understands numbers (Int16 PCM).
- This little piece of code chops your voice wave into tiny blocks of numbers and translates them into the format Sarvam needs.

```javascript
workletNode.port.onmessage = (event) => {
  if (socketRef.current && isRecordingRef.current) {
    socketRef.current.emit("audio-chunk", event.data);
  }
};
```
- **Input to backend:** Every fraction of a second, the chopper spits out a small piece of processed audio (`event.data`).
- We immediately mail this `audio-chunk` piece over the walkie-talkie to the backend.

---

## 2. The Backend Server
*File: `server/utils/sarvam.js`*

The backend is running safely on your computer (or a cloud server). It receives the pieces of audio from your browser and talks directly to the Sarvam AI company.

Let's look at `handleSarvamConnection` line by line:

### A. The Setup
```javascript
let transcript = "";
let sarvamSocket = null;
let isReady = false;
const SARVAM_API_KEY = process.env.SARVAM_API_KEY;
```
- `transcript`: A completely empty notebook page where we will write down the Hindi/Hinglish words.
- `sarvamSocket`: The phone line to Sarvam. (Starts disconnected/null).
- `SARVAM_API_KEY`: Your secret password to use Sarvam's servers.

### B. Dialing Sarvam's Number (`connectToSarvam`)
```javascript
const sarvamUrl = new URL("wss://api.sarvam.ai/speech-to-text/ws");
```
- This is Sarvam's actual phone number for Real-Time (Streaming) transcription.

```javascript
sarvamUrl.searchParams.set("model", "saaras:v3");
sarvamUrl.searchParams.set("mode", "translit");       
sarvamUrl.searchParams.set("language-code", "hi-IN");
sarvamUrl.searchParams.set("vad_signals", "true");
sarvamUrl.searchParams.set("high_vad_sensitivity", "true");
sarvamUrl.searchParams.set("sample_rate", "16000");     
sarvamUrl.searchParams.set("input_audio_codec", "pcm_s16le");
```
Here we tell Sarvam the rules of our game:
- **`saaras:v3`**: Use your smartest AI brain.
- **`mode: translit`**: Listen to my Hindi, but type it out in English letters (Hinglish)!
- **`vad_signals: true`**: Please tell me EXACTLY when I start speaking and when I stop.
- **`high_vad_sensitivity: true`**: Ignore background fans and static noise. Only listen to my real voice. *(Remember, we amplified our voice 2.5x on the frontend so we don't accidentally get ignored!)*
- **`pcm_s16le` & `16000`**: This is the exact chopped-up number format our frontend created.

```javascript
sarvamSocket = new WebSocket(sarvamUrl.toString(), [
  `api-subscription-key.${SARVAM_API_KEY}`
], {
  headers: { "api-subscription-key": SARVAM_API_KEY }
});
```
- We officially create the connection! To prove who we are, we literally tape your API key to both the HTTP Headers *and* the WebSocket Subprotocol (this is how the Sarvam server verifies you aren't a hacker).

### C. Listening to Sarvam
When Sarvam sends us a message, the `sarvamSocket.on("message", ...)` code runs. Sarvam sends two totally different types of messages: `events` and `data`.

#### Scenario 1: Sarvam hears noise (`events`)
```javascript
if (message.type === "events") {
  const signal = message.data?.signal_type;
  
  if (signal === "START_SPEECH") {
    clientSocket.emit("vad-status", { isProcessing: true });
    clientSocket.emit("transcript", {
      transcript,
      interim: "Listening..."
    });
  } 
  
  else if (signal === "END_SPEECH") {
    clientSocket.emit("vad-status", { isProcessing: false });
  }
}
```
- Sarvam's AI analyzed the audio chunk and decided "A human just started speaking!". It sends `START_SPEECH`.
- **Output to frontend:** We immediately tell the frontend `vad-status: true`. Your screen's light bulb turns green! We also show "Listening..." so you know it's working.
- When you pause for a second, Sarvam sends `END_SPEECH`. We turn the frontend light bulb gray (`vad-status: false`).

#### Scenario 2: Sarvam figured out a word (`data`)
```javascript
} else if (message.type === "data") {
  const text = message.data?.transcript || "";
  
  if (text.trim()) {
    transcript += (transcript ? " " : "") + text.trim();
  }
  
  clientSocket.emit("transcript", {
    transcript,
    interim: ""
  });
}
```
- Sarvam analyzed the audio and successfully converted it to text!
- Let's say Sarvam sends the word "Kaise ho".
- We take our empty notebook page (`transcript`), and we write " Kaise ho" onto it.
- **Output to frontend:** We send the whole notebook page across the walkie-talkie to the frontend. The frontend updates your screen!

### D. Sending Audio to Sarvam
```javascript
clientSocket.on("audio-chunk", (chunk) => {
  if (sarvamSocket && isReady && chunk) {
    const base64Audio = Buffer.from(chunk).toString("base64");
    
    const payload = JSON.stringify({
      audio: {
        data: base64Audio,
        sample_rate: 16000,
        encoding: "audio/wav" 
      }
    });

    sarvamSocket.send(payload);
  }
});
```
- **Input from frontend:** The backend receives those tiny chunks of numbers from the browser over the walkie talkie.
- The Internet doesn't like sending raw numbers, so we convert them into text letters (called `Base64`).
- We wrap this Base64 text in a nice JSON box.
- Finally, we throw that box over the phone line (`sarvamSocket.send`) to the Sarvam Robot for it to analyze!

## 🎉 Summary
1. You say "Hello!" into the mic.
2. The browser makes it louder (2.5x) and chops it up.
3. The browser mails it to your server.
4. Your server translates it to Base64 and throws it to Sarvam.
5. Sarvam replies: "START_SPEECH!" ➡️ Your server tells your browser ➡️ VAD turns Green.
6. Sarvam replies: "Hello" (Data text) ➡️ Your server writes it down and tells your browser ➡️ Text appears on your screen!
