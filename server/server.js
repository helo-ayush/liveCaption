// Core Node modules
const http = require("http");

// Third-party dependencies
require('dotenv').config();
const express = require("express");
const { Server } = require("socket.io");
const cors = require("cors");

// Internal utilities
const { handleSarvamConnection } = require("./utils/sarvam");

// Initialize Express app & HTTP Server
const app = express();
const server = http.createServer(app);

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

/**
 * Socket.IO Initialization
 * Handles real-time bi-directional communication with the frontend clients.
 */
io.on("connection", (socket) => {
  console.info(`[Socket.IO] New client connected. Socket ID: ${socket.id}`);

  // Delegate all Sarvam STT WebSocket logic to the isolated utility module
  handleSarvamConnection(socket);
  
  socket.on("disconnect", (reason) => {
    console.info(`[Socket.IO] Client disconnected. Socket ID: ${socket.id} | Reason: ${reason}`);
  });
});

// Start the server
const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.info(`[Server] Live Caption API running on port ${PORT}`);
  console.info(`[Server] Accepting connections from: ${allowedOrigins.join(", ")}`);
});
