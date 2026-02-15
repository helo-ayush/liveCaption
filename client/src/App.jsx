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

  // State for toggling between Hinglish and Original script
  const [showOriginal, setShowOriginal] = useState(false);

  // Storage for the full data objects so we can switch views instantly
  const [transcriptData, setTranscriptData] = useState({
    transcript: "",
    eng_transcript: "",
    interim_results: "",
    eng_interim_results: ""
  });

  // Only Runs for the first time to establish the Socket Connection
  useEffect(() => {

    // Initializing the socket Connection with retryconnection upto infinite time
    const socket = io(import.meta.env.VITE_BACKEND_URL || "http://localhost:3000", {
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
      setStatus("Ready");
      console.log("Deepgram ready");
    });

    // When the socket Returns transcript
    socket.on("transcript", (data) => {
      // Store the raw data object so we can use it for toggling
      setTranscriptData(data);
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
  }, []); // Run only once on mount

  // Effect to update view when toggle changes
  useEffect(() => {
    if (showOriginal) {
      setFinalTranscript(transcriptData.transcript);
      setInterimTranscript(transcriptData.interim_results);
    } else {
      setFinalTranscript(transcriptData.eng_transcript);
      setInterimTranscript(transcriptData.eng_interim_results);
    }
  }, [showOriginal, transcriptData]);

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

      if (!MediaRecorder.isTypeSupported("audio/webm")) {
        alert("Browser not supported. Please use Chrome or Firefox.");
        return;
      }

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
    <div style={{
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      minHeight: '95vh',
      backgroundColor: '#ffffff',
      fontFamily: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif"
    }}>
      <div style={{
        width: '100%',
        maxWidth: '600px',
        padding: '30px',
        borderRadius: '12px',
        boxShadow: '0 4px 20px rgba(0,0,0,0.08)',
        backgroundColor: '#ffffff',
        border: '1px solid #e0e0e0'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h1 style={{ margin: 0, fontSize: '24px', fontWeight: '600', color: '#333' }}>Live Caption</h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              backgroundColor: status === 'Recording' ? '#ef4444' : (status === 'Ready' || status === 'Connected') ? '#22c55e' : '#9ca3af',
              animation: status === 'Recording' ? 'pulse 1.5s infinite' : 'none'
            }}></div>
            <span style={{ fontSize: '14px', color: '#666', fontWeight: '500' }}>{status}</span>
          </div>
        </div>

        <div style={{
          height: '300px',
          overflowY: 'auto',
          marginBottom: '20px',
          padding: '15px',
          backgroundColor: '#f9fafb',
          borderRadius: '8px',
          border: '1px solid #f3f4f6',
          fontSize: '16px',
          lineHeight: '1.6',
          color: '#1f2937'
        }}>
          <span>{finalTranscript}</span>
          <span style={{ color: '#9ca3af' }}>{interimTranscript}</span>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <button
            onClick={toggleRecording}
            style={{
              padding: '10px 24px',
              backgroundColor: isRecording ? '#ef4444' : '#2563eb',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              fontSize: '14px',
              fontWeight: '500',
              cursor: 'pointer',
              transition: 'background-color 0.2s'
            }}
          >
            {isRecording ? "Pause Recording" : "Start Recording"}
          </button>

          <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', gap: '10px', fontSize: '14px', color: '#4b5563' }}>
            <input
              type="checkbox"
              checked={showOriginal}
              onChange={(e) => setShowOriginal(e.target.checked)}
              style={{ width: '16px', height: '16px', cursor: 'pointer' }}
            />
            Show Original Script
          </label>
        </div>

        <style>{`
          @keyframes pulse {
            0% { opacity: 1; }
            50% { opacity: 0.5; }
            100% { opacity: 1; }
          }
        `}</style>
      </div>
    </div>
  );
};

export default App;