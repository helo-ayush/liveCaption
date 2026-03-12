// Imports
require('dotenv').config();
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const { handleSarvamConnection } = require("./utils/sarvam");

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

// Socket Initialization
io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);

  // Delegate all Sarvam STT WebSocket logic to the utility module
  handleSarvamConnection(socket);
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
