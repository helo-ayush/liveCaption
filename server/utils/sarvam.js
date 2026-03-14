const WebSocket = require("ws");

/**
 * Attaches Sarvam AI WebSocket streaming logic to a client socket connection.
 * Acts as a bridge between the frontend Socket.IO client and backend Sarvam WS API.
 * 
 * @param {import("socket.io").Socket} clientSocket - The active Socket.IO connection object
 */
function handleSarvamConnection(clientSocket) {
    let transcript = ""; // Accumulator for the final paragraph
    let sarvamSocket = null;
    let isReady = false;

    const SARVAM_API_KEY = process.env.SARVAM_API_KEY;

    if (!SARVAM_API_KEY) {
        console.warn("[Sarvam] WARNING: SARVAM_API_KEY is not set in environment variables.");
    }

    /**
     * Initializes the connection to Sarvam AI's Real-time STT WebSocket endpoint.
     */
    async function connectToSarvam() {
        const sarvamUrl = new URL("wss://api.sarvam.ai/speech-to-text/ws");

        // Configuration Parameters mapped as URL Query strings
        sarvamUrl.searchParams.set("model", "saaras:v3"); // Highest accuracy model
        sarvamUrl.searchParams.set("mode", "translit"); // Enforce Romanized Indic text (e.g., Hinglish)
        sarvamUrl.searchParams.set("language-code", "hi-IN"); // Expected input language
        sarvamUrl.searchParams.set("vad_signals", "true"); // Receive START_SPEECH / END_SPEECH events
        sarvamUrl.searchParams.set("high_vad_sensitivity", "true"); // Drop background noise/silence
        sarvamUrl.searchParams.set("sample_rate", "16000"); // 16kHz audio sample rate constraint
        sarvamUrl.searchParams.set("input_audio_codec", "pcm_s16le"); // Raw PCM Int16 audio format constraint

        console.info(`[Sarvam] Establishing streaming connection to model: saaras:v3...`);

        try {
            sarvamSocket = new WebSocket(sarvamUrl.toString(), [
                `api-subscription-key.${SARVAM_API_KEY}`
            ], {
                headers: {
                    "api-subscription-key": SARVAM_API_KEY
                }
            });

            sarvamSocket.on("unexpected-response", (req, res) => {
                console.error(`[Sarvam] Connection rejected. HTTP Status: ${res.statusCode}`);
                let body = "";
                res.on("data", (chunk) => body += chunk);
                res.on("end", () => {
                    console.error(`[Sarvam] Rejection Details:`, body);
                    isReady = false;
                    clientSocket.emit("error", "Transcription connection rejected by Sarvam AI");
                });
            });

            sarvamSocket.on("open", () => {
                console.info("[Sarvam] WebSocket connection successfully opened and ready.");
                isReady = true;
                clientSocket.emit("sarvam-ready");
            });

            sarvamSocket.on("message", (rawMessage) => {
                try {
                    const message = JSON.parse(rawMessage.toString());
                    
                    // Note: Removing excessively verbose logs of unparsed payload for production optimization.

                    if (message.type === "events") {
                        const signal = message.data?.signal_type;
                        if (signal === "START_SPEECH") {
                            clientSocket.emit("vad-status", { isProcessing: true });
                            clientSocket.emit("transcript", {
                                transcript,
                                interim: "Listening..."
                            });
                        } else if (signal === "END_SPEECH") {
                            clientSocket.emit("vad-status", { isProcessing: false });
                            console.log("Speech ended");
                        }
                    } else if (message.type === "data") {
                        // "data" signifies a finalized, transcribed text boundary from the utterance
                        const text = message.data?.transcript || "";
                        if (text.trim()) {
                            transcript += (transcript ? " " : "") + text.trim();
                        }
                        
                        // Push finalized text blob to the frontend
                        clientSocket.emit("transcript", {
                            transcript,
                            interim: ""
                        });
                    }
                } catch (err) {
                    console.error("[Sarvam] Error parsing incoming WS message:", err.message);
                }
            });

            sarvamSocket.on("error", (err) => {
                console.error("[Sarvam] Socket Error:", err.message);
                isReady = false;
                clientSocket.emit("error", "Sarvam AI Socket Error occurred.");
            });

            sarvamSocket.on("close", (code, reason) => {
                console.info(`[Sarvam] Socket closed. Code: ${code}, Reason: ${reason || "Normal"}`);
                isReady = false;
            });

        } catch (err) {
            console.error("[Sarvam] Failed to instantiate WebSocket:", err.stack);
            clientSocket.emit("error", "Failed to connect to transcription service infrastructure");
        }
    }

    /**
     * Safely closes the active Sarvam Socket connection and nullifies scope variables
     */

    function closeSarvam() {
        isReady = false;
        clientSocket.emit("vad-status", { isProcessing: false });
        try {
            if (sarvamSocket) {
                sarvamSocket.close();
                sarvamSocket = null;
            }
        } catch (e) {
            console.error("[Sarvam] Error while explicitly closing connection:", e.stack);
        }
    }

    /* -------------------------------------------------------------------------- */
    /*                         Socket.IO Event Listeners                          */
    /* -------------------------------------------------------------------------- */

    // Actively begins recording stream lifecycle
    clientSocket.on("start-recording", async () => {
        transcript = ""; // Clear existing utterance logs for new session
        console.info(`[API] Start recording requested by client ${clientSocket.id}. Initializing stream...`);
        await connectToSarvam();
    });

    // Ingests buffered audio blob events from client worklet
    clientSocket.on("audio-chunk", (chunk) => {
        try {
            if (sarvamSocket && isReady && chunk) {
                const base64Audio = Buffer.from(chunk).toString("base64");

                // Construct Standardized JSON structure strictly required by Sarvam `vad_signals` mode
                const payload = JSON.stringify({
                    audio: {
                        data: base64Audio,
                        sample_rate: 16000,
                        encoding: "audio/wav"
                    }
                });

                sarvamSocket.send(payload);
            }
        } catch (err) {
            console.error("[Sarvam] Buffer parsing error sending audio chunk:", err.stack);
        }
    });

    // Manually stops recording cleanly lifecycle
    clientSocket.on("stop-recording", () => {
        console.info(`[API] Stop recording requested by client ${clientSocket.id}.`);
        closeSarvam();
    });

    // Handle unexpected client teardowns gracefully
    clientSocket.on("disconnect", () => {
        console.info(`[API] Client ${clientSocket.id} disconnected. Terminating associated Sarvam bridges.`);
        closeSarvam();
    });
}

module.exports = { handleSarvamConnection };
