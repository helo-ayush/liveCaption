// App.jsx
import React, { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";

const App = () => {
  const socketRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const [finalTranscript, setFinalTranscript] = useState("");
  const [interimTranscript, setInterimTranscript] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [status, setStatus] = useState("Disconnected");

  useEffect(() => {
    const socket = io("http://localhost:3000");
    socketRef.current = socket;

    socket.on("connect", () => {
      setStatus("Connected to Server");
      console.log("Connected to server");
    });

    socket.on("dg-ready", () => {
      setStatus("Deepgram Ready");
      console.log("Deepgram ready");
    });

    socket.on("transcript", (data) => {
      console.log("Transcript received:", data);
      const alt = data.channel?.alternatives?.[0];
      if (!alt?.transcript) return;

      if (data.is_final) {
        setFinalTranscript((prev) => prev + alt.transcript + " ");
        setInterimTranscript("");
      } else {
        setInterimTranscript(alt.transcript);
      }
    });

    socket.on("disconnect", () => {
      setStatus("Disconnected");
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: "audio/webm",
      });
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.start(250); // 250ms chunks

      setIsRecording(true);
      setStatus("Recording");

      mediaRecorder.ondataavailable = async (event) => {
        if (
          event.data &&
          event.data.size > 0 &&
          socketRef.current?.connected
        ) {
          // Convert Blob -> ArrayBuffer so server gets raw bytes
          const arrayBuffer = await event.data.arrayBuffer();
          socketRef.current.emit("audio-chunk", arrayBuffer);
        }
      };

      mediaRecorder.onstop = () => {
        setIsRecording(false);
        setStatus("Stopped");
      };
    } catch (err) {
      console.error("Mic error:", err);
      setStatus("Mic Error");
    }
  }

  function stopRecording() {
    if (
      mediaRecorderRef.current &&
      mediaRecorderRef.current.state !== "inactive"
    ) {
      mediaRecorderRef.current.stop();
    }
  }

  const toggleRecording = async () => {
    if (!isRecording) {
      await startRecording();
    } else {
      stopRecording();
    }
  };

  return (
    <div style={{ padding: 20, fontFamily: "sans-serif" }}>
      <h1>Live Caption</h1>
      <div style={{ marginBottom: 10 }}>
        Status: <strong>{status}</strong>
      </div>
      <button
        onClick={toggleRecording}
        style={{
          padding: "10px 20px",
          backgroundColor: isRecording ? "#ff4444" : "#44ff44",
          border: "none",
          borderRadius: 5,
          cursor: "pointer",
        }}
      >
        {isRecording ? "Stop Recording" : "Start Recording"}
      </button>
      <div
        style={{
          marginTop: 20,
          padding: 15,
          backgroundColor: "#f0f0f0",
          borderRadius: 5,
          minHeight: 60,
        }}
      >
        <span style={{ color: "#333" }}>{finalTranscript}</span>
        <span style={{ color: "#888" }}>{interimTranscript}</span>
      </div>
    </div>
  );
};

export default App;