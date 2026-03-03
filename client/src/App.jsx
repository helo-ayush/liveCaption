import React, { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";

const App = () => {
  // Variables Defining
  const socketRef = useRef(null);
  const audioContextRef = useRef(null);
  const workletNodeRef = useRef(null);
  const sourceNodeRef = useRef(null);
  const streamRef = useRef(null);

  const [isRecording, setIsRecording] = useState(false);
  const [status, setStatus] = useState("Disconnected");

  // State for toggling between Hinglish (translit) and Original Devanagari
  const [showOriginal, setShowOriginal] = useState(false);

  // Storage for the full data objects so we can switch views instantly
  const [transcriptData, setTranscriptData] = useState({
    transcript: "",
    eng_transcript: "",
    interim_results: "",
    eng_interim_results: ""
  });

  // Derived display values
  const finalTranscript = showOriginal ? transcriptData.transcript : transcriptData.eng_transcript;
  const interimTranscript = showOriginal ? transcriptData.interim_results : transcriptData.eng_interim_results;

  // Only Runs for the first time to establish the Socket Connection
  useEffect(() => {
    const socket = io(import.meta.env.VITE_BACKEND_URL || "http://localhost:3000", {
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      timeout: 10000,
    });

    socketRef.current = socket;

    socket.on("connect", () => {
      setStatus("Connected");
      console.log("Connected to server");
    });

    socket.on("stt-ready", () => {
      setStatus("Ready");
      console.log("STT ready");
    });

    socket.on("transcript", (data) => {
      setTranscriptData(data);
    });

    socket.on("disconnect", () => {
      setStatus("Disconnected");
    });

    return () => {
      socket.disconnect();
      cleanupAudio();
    };
  }, []); // Run only once on mount

  // Start Recording — sets up AudioContext + AudioWorklet for PCM capture
  async function startRecording() {
    try {
      // If already set up, just resume the AudioContext
      if (audioContextRef.current && audioContextRef.current.state === "suspended") {
        await audioContextRef.current.resume();
        setIsRecording(true);
        setStatus("Recording");
        return;
      }

      // Request mic access
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,       // Mono
          sampleRate: 16000,     // Request 16kHz if supported (browser may override)
          echoCancellation: true,
          noiseSuppression: true,
        }
      });
      streamRef.current = stream;

      // Create AudioContext — browser will use its native sample rate
      // The AudioWorklet processor downsamples to 16kHz internally
      const audioContext = new AudioContext();
      audioContextRef.current = audioContext;

      // Load the PCM processor worklet from /public
      await audioContext.audioWorklet.addModule("/pcm-processor.js");

      // Create mic source node
      const sourceNode = audioContext.createMediaStreamSource(stream);
      sourceNodeRef.current = sourceNode;

      // Create the AudioWorklet node
      const workletNode = new AudioWorkletNode(audioContext, "pcm-processor");
      workletNodeRef.current = workletNode;

      // Listen for PCM chunks sent from the worklet
      workletNode.port.onmessage = (event) => {
        const pcmBuffer = event.data; // ArrayBuffer of PCM_S16LE bytes
        if (socketRef.current?.connected) {
          socketRef.current.emit("audio-chunk", pcmBuffer);
        }
      };

      // Connect the pipeline: mic → worklet (no output — just processing)
      sourceNode.connect(workletNode);
      // NOTE: intentionally NOT connecting workletNode to audioContext.destination
      // to avoid audio feedback/echo to speakers

      setIsRecording(true);
      setStatus("Recording");
    } catch (err) {
      console.error("Mic / AudioContext error:", err);
      setStatus("Mic Error");
    }
  }

  // Stop / Pause — suspends AudioContext (keeps worklet alive, avoids re-setup cost)
  function stopRecording() {
    if (audioContextRef.current && audioContextRef.current.state === "running") {
      audioContextRef.current.suspend();
    }
    setIsRecording(false);
    setStatus("Paused");
  }

  // Full cleanup — called on component unmount
  function cleanupAudio() {
    if (workletNodeRef.current) {
      workletNodeRef.current.disconnect();
      workletNodeRef.current = null;
    }
    if (sourceNodeRef.current) {
      sourceNodeRef.current.disconnect();
      sourceNodeRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
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