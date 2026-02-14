import React, { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";

const App = () => {
  // Variables Defining
  const socketRef = useRef(null);                                      
  const mediaRecorderRef = useRef(null);
  const [finalTranscript, setFinalTranscript] = useState("");
  const [interimTranscript, setInterimTranscript] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [status, setStatus] = useState("Disconnected");

  // Only Runs for the first time to establish the Socket Connection
  useEffect(() => {

    // Initializing the socket Connection with retryconnection upto infinite time
    const socket = io("http://localhost:3000", {
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      timeout: 10000,
    });

    // Saved the Socket in SocketRef useRef var so it will not keep reinitiallizing
    socketRef.current = socket;
    
    // Socket quick notifications
    socket.on("connect", () => {
      setStatus("Connected");
      console.log("Connected to server");
    });

    socket.on("dg-ready", () => {
      setStatus("Deepgram Ready");
      console.log("Deepgram ready");
    });

    // When the socket Returns transcript
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

    // Notifing the user when socket gets disconnected
    socket.on("disconnect", () => {
      setStatus("Disconnected");
    });

    // Cleaner funtion that will close the socket connection at the end
    return () => {
      socket.disconnect();
      setIsRecording(false);
    };
  }, []);

  // Start Recoding function which records 250ms chunks of the audio from mic input
  async function startRecording() {
    try {

      // Checking if the Recording has already started then instead of create new recording, resume it and return
      if (mediaRecorderRef.current) {
        mediaRecorderRef.current.resume();
        setIsRecording(true);
        setStatus("Recording");
        return;
      }

      //  Creating new recoding Streams input from mic
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      // The variable which will actually does the recording, it will be stored inside the useRef so that it wont reinitialize
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: "audio/webm",
      });
      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.start(250);  // 250ms audio chunk

      setIsRecording(true);
      setStatus("Recording");

      // Builtin ondataavailable function that will run every 250ms
      mediaRecorder.ondataavailable = async (event) => {
        if (
          event.data &&
          event.data.size > 0 &&
          socketRef.current?.connected
        ) {
          // Convert Blob(250ms Chunk) -> ArrayBuffer so server gets raw bytes
          const arrayBuffer = await event.data.arrayBuffer();
          socketRef.current.emit("audio-chunk", arrayBuffer);
        }
      };

      // Updates variables when recording stop
      mediaRecorder.onstop = () => {
        setIsRecording(false);
        setStatus("Stopped");
      };
    } catch (err) {
      console.error("Mic error:", err);
      setStatus("Mic Error");
    }
  }

  // A function that will pause the mediaRecorder
  function stopRecording() {
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.pause();
      setIsRecording(false);
      setStatus("Paused");
    }
  }

  // Switch between Resume and Pause Recording
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