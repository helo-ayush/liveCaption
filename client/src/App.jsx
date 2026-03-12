import React, { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";

const App = () => {
  // Variables Defining
  const socketRef = useRef(null);
  const audioContextRef = useRef(null);
  const workletNodeRef = useRef(null);
  const streamRef = useRef(null);

  const [finalTranscript, setFinalTranscript] = useState("");
  const [interimTranscript, setInterimTranscript] = useState("");
  const [vadProcessing, setVadProcessing] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [status, setStatus] = useState("Disconnected");

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

    socket.on("sarvam-ready", () => {
      setStatus("Ready");
      console.log("Sarvam ready");
    });

    // When the socket Returns transcript
    socket.on("transcript", (data) => {
      setFinalTranscript(data.transcript || "");
      setInterimTranscript(data.interim || "");
    });

    // When the VAD status changes
    socket.on("vad-status", (data) => {
      setVadProcessing(data.isProcessing);
    });

    // Error from transcription service
    socket.on("error", (msg) => {
      console.error("Server error:", msg);
      setStatus("Error");
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

  // Start Recoding function — captures raw 16kHz PCM from the mic via AudioWorklet
  async function startRecording() {
    try {

      // Signal server to create Sarvam connection
      socketRef.current.emit("start-recording");
      setStatus("Connecting...");

      // Wait for Sarvam to be ready before capturing audio
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("Sarvam connection timeout")), 15000);
        socketRef.current.once("sarvam-ready", () => {
          clearTimeout(timeout);
          resolve();
        });
        socketRef.current.once("error", (msg) => {
          clearTimeout(timeout);
          reject(new Error(msg));
        });
      });

      // If AudioContext already exists (paused state), just resume
      if (audioContextRef.current && audioContextRef.current.state === "suspended") {
        await audioContextRef.current.resume();
        setIsRecording(true);
        setStatus("Recording");
        return;
      }

      //  Creating new recording stream input from mic
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true
        }
      });
      streamRef.current = stream;

      // Create AudioContext at 16kHz for Sarvam compatibility
      const audioContext = new AudioContext({ sampleRate: 16000 });
      audioContextRef.current = audioContext;

      // Register the PCM processor worklet
      const workletCode = `
        class PCMProcessor extends AudioWorkletProcessor {
          process(inputs) {
            const input = inputs[0];
            if (input && input[0]) {
              // Convert float32 [-1, 1] samples to int16 PCM
              const float32 = input[0];
              const int16 = new Int16Array(float32.length);
              for (let i = 0; i < float32.length; i++) {
                const s = Math.max(-1, Math.min(1, float32[i]));
                int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
              }
              this.port.postMessage(int16.buffer, [int16.buffer]);
            }
            return true;
          }
        }
        registerProcessor('pcm-processor', PCMProcessor);
      `;
      const blob = new Blob([workletCode], { type: "application/javascript" });
      const workletUrl = URL.createObjectURL(blob);
      await audioContext.audioWorklet.addModule(workletUrl);
      URL.revokeObjectURL(workletUrl);

      // Create the worklet node to process and send audio chunks
      const workletNode = new AudioWorkletNode(audioContext, "pcm-processor");
      workletNodeRef.current = workletNode;

      const source = audioContext.createMediaStreamSource(stream);

      // --- NEW: Add an amplifier (GainNode) to boost low volume audio ---
      // This happens directly on the client's CPU, costing zero server bandwidth/compute
      const gainNode = audioContext.createGain();
      gainNode.gain.value = 2.5; // Multiply volume by 2.5x (adjust as needed)

      // Connect pipeline: Microphone -> Amplifier -> PCM Processor
      source.connect(gainNode);
      gainNode.connect(workletNode);

      workletNode.connect(audioContext.destination); // Required to keep processing alive

      // Send PCM chunks to server via socket
      workletNode.port.onmessage = (event) => {
        if (socketRef.current?.connected) {
          socketRef.current.emit("audio-chunk", event.data);
        }
      };

      setIsRecording(true);
      setStatus("Recording");

    } catch (err) {
      console.error("Mic error:", err);
      setStatus("Mic Error");
    }
  }

  // Pause recording by suspending AudioContext and closing Sarvam connection
  function stopRecording() {
    if (audioContextRef.current && audioContextRef.current.state === "running") {
      audioContextRef.current.suspend();
      setIsRecording(false);
      setStatus("Paused");
      // Signal server to close Sarvam connection
      socketRef.current?.emit("stop-recording");
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
            <span style={{ fontSize: '14px', color: '#666', fontWeight: '500', marginRight: '10px' }}>{status}</span>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              padding: '4px 10px',
              backgroundColor: vadProcessing ? '#dcfce7' : '#f3f4f6',
              borderRadius: '16px',
              fontSize: '12px',
              fontWeight: '600',
              color: vadProcessing ? '#166534' : '#6b7280',
              transition: 'all 0.2s',
              border: vadProcessing ? '1px solid #bbf7d0' : '1px solid #e5e7eb'
            }}>
              VAD: {vadProcessing ? 'Processing (1)' : 'Idle (0)'}
            </div>
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
          <span style={{ color: '#9ca3af', fontStyle: 'italic' }}>{interimTranscript ? ` ${interimTranscript}` : ""}</span>
        </div>

        <div style={{ display: 'flex', justifyContent: 'center' }}>
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