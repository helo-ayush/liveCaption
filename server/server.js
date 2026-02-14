<<<<<<< HEAD
require('dotenv').config()
=======
// Imports Statement
require('dotenv').config();
>>>>>>> 49937048576d591307ce373e511792fb06c5ffb5
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { createClient, LiveTranscriptionEvents } = require("@deepgram/sdk");
<<<<<<< HEAD
const { transliterate } = require("transliteration");
const commonHinglishMap = require("./hinglishMap");

=======

// Initializing the Imports
>>>>>>> 49937048576d591307ce373e511792fb06c5ffb5
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
});

<<<<<<< HEAD
// Initialize Deepgram
=======

//  Deepgram Client Created
>>>>>>> 49937048576d591307ce373e511792fb06c5ffb5
const deepgram = createClient(process.env.DEEPGRAM_API_KEY);


//  Socket Connection Initiate
io.on("connection", async (socket) => {
  console.log("Client connected:", socket.id);

  // Create Deepgram live connection
  const dgConnection = deepgram.listen.live({
    model: "nova-3",
    language: "multi", // Detects Hindi/English automatically
    smart_format: true,
    punctuate: true,
    interim_results: true,
    numerals: true,
    vad_events: true,
    endpointing: 400,
    interim_results: true,
    utterance_end_ms: 1000,
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
    let text = alt?.transcript || "";

    if (text) {
      if (/[\u0900-\u097F]/.test(text)) {
        try {
          text = text.split(" ").map(word => {
            const match = word.match(/^([^\u0900-\u097F\w]*)([\u0900-\u097F\w]+)([^\u0900-\u097F\w]*)$/);
            if (!match) return word;

            const [_, prefix, core, suffix] = match;

            let translated = commonHinglishMap[core];
            if (!translated) {
              if (/[\u0900-\u097F]/.test(core)) {
                translated = transliterate(core).toLowerCase();
              } else {
                translated = core;
              }
            }
            return prefix + translated + suffix;
          }).join(" ");

          if (data.channel && data.channel.alternatives && data.channel.alternatives[0]) {
            data.channel.alternatives[0].transcript = text;
          }
        } catch (e) {
          console.error("Transliteration error:", e);
        }
      }
      console.log("Transcript:", text);
    }
    socket.emit("transcript", data);
  });

  //  Returns Error from DeepGram Server Side
  dgConnection.on(LiveTranscriptionEvents.Error, (err) => {
    console.error("Deepgram error:", err);
  });

  //  Notify when the Deepgram Connection Gets Closed
  dgConnection.on(LiveTranscriptionEvents.Close, () => {
    console.log("Deepgram connection closed");
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
    try {
      if (dgConnection.getReadyState() === 1) {
        dgConnection.finish();
      }
    } catch (e) {
      console.error("Error finishing Deepgram connection:", e);
    }
  });
});


server.listen(3000, () => {
  console.log("Server running on http://localhost:3000");
});

