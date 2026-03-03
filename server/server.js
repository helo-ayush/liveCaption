// Imports Statement
require('dotenv').config();
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { createClient, LiveTranscriptionEvents } = require("@deepgram/sdk");
const { transliterate } = require("transliteration");
const commonHinglishMap = require("./hinglishMap");

const app = express();
const server = http.createServer(app);
const cors = require("cors");

const allowedOrigins = [process.env.FRONTEND_URL || "http://localhost:5173"];

const corsOptions = {
  origin: allowedOrigins,
  methods: ["GET", "POST"],
  credentials: true
};

app.use(cors(corsOptions));

const io = new Server(server, {
  cors: corsOptions,
});


//  Deepgram Client Created
const deepgram = createClient(process.env.DEEPGRAM_API_KEY);


//  Socket Connection Initiate
io.on("connection", async (socket) => {
  console.log("Client connected:", socket.id);

  // Variables
  let eng_transcript = "";
  let transcript = "";
  let eng_interim_results = "";
  let interim_results = "";

  // Create Deepgram live connection
 const dgConnection = deepgram.listen.live({
    model: "nova-3",
    language: "multi", 
    smart_format: true,
    // punctuate: true, // Note: nova-3 usually includes this in smart_format
    interim_results: true,
    utterance_end_ms: 1000, 
    vad_events: true,
    endpointing: 700, // Increased to give fast talkers more breathing room
    filler_words: true, // Helps ignore background "clicks" or "ums"
    no_delay: true // Decreases latency for real-time feel
});

  let keepAlive;

  //  When DeepGram Connection is Established
  dgConnection.on(LiveTranscriptionEvents.Open, () => {
    console.log("Deepgram connected");
    socket.emit("dg-ready");

    keepAlive = setInterval(() => {
      dgConnection.keepAlive();
    }, 8000);
  });



  //  When Deepgram Return Transcribed Result
  dgConnection.on(LiveTranscriptionEvents.Transcript, (data) => {
    const alt = data.channel?.alternatives?.[0];
    const originalText = alt?.transcript || ""; // Capture original before modification
    let hinglishText = originalText;

    if (originalText) {
      // Logic for Transliteration (Devanagari -> Hinglish)
      if (/[\u0900-\u097F]/.test(originalText)) {
        try {
          hinglishText = originalText.split(" ").map(word => {
            const match = word.match(/^([^\u0900-\u097F\w]*)([\u0900-\u097F\w]+)([^\u0900-\u097F\w]*)$/);
            if (!match) return word;

            const [_, prefix, core, suffix] = match;

            let translated = commonHinglishMap[core];
            if (!translated) {
              if (/[\u0900-\u097F]/.test(core)) {
                // Return lower case for transliterated words (e.g. "namaste")
                translated = transliterate(core).toLowerCase();
              } else {
                translated = core;
              }
            }
            return prefix + translated + suffix;
          }).join(" ");

          // Update the data object to send Hinglish to frontend
          if (data.channel && data.channel.alternatives && data.channel.alternatives[0]) {
            data.channel.alternatives[0].transcript = hinglishText;
          }
          console.log(data)
        } catch (e) {
          console.error("Transliteration error:", e);
        }
      }

      // Update Accumulators
      if (data.is_final) {
        // Append to the full session transcripts
        // Assuming 'transcript' tracks the Original (Devanagari/Mixed)
        // Assuming 'eng_transcript' tracks the Hinglish (English Script) 
        transcript += (" " + originalText);
        eng_transcript += (" " + hinglishText);

        // Reset interim
        interim_results = "";
        eng_interim_results = "";
      } else {
        // Update interim (live typing view)
        interim_results = originalText;
        eng_interim_results = hinglishText;
      }

      console.log("Original:", originalText);
      console.log("Hinglish:", hinglishText);
    }

    // Emit the modified data (containing Hinglish) to the frontend
    socket.emit("transcript", {
      transcript,
      eng_transcript,
      interim_results,
      eng_interim_results
    });
  });

  //  Returns Error from DeepGram Server Side
  dgConnection.on(LiveTranscriptionEvents.Error, (err) => {
    console.error("Deepgram error:", err);
  });

  //  Notify when the Deepgram Connection Gets Closed
  dgConnection.on(LiveTranscriptionEvents.Close, () => {
    console.log("Deepgram connection closed");
    clearInterval(keepAlive);
  });

  // Receive audio from frontend and forward to Deepgram
  socket.on("audio-chunk", (chunk) => {
    if (dgConnection.getReadyState() === 1 && chunk) {
      dgConnection.send(chunk);
    }
  });

  // When the Socket Disconnects
  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
    clearInterval(keepAlive);

    try {
      if (dgConnection.getReadyState() === 1) {
        dgConnection.finish();
      }
    } catch (e) {
      console.error("Error finishing Deepgram connection:", e);
    }
  });
});


const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

