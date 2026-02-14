// Imports Statement
require('dotenv').config();
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { createClient, LiveTranscriptionEvents } = require("@deepgram/sdk");

// Initializing the Imports
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
});


//  Deepgram Client Created
const deepgram = createClient(process.env.DEEPGRAM_API_KEY);


//  Socket Connection Initiate
io.on("connection", async (socket) => {
  console.log("Client connected:", socket.id);

  // Create Deepgram live connection
  const dgConnection = deepgram.listen.live({
    model: "nova-3",
    language: "multi",
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
    const text = alt?.transcript || "";
    if (text) {
      console.log("DG transcript:", text);
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