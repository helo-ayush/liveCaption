const WebSocket = require("ws");

function handleSarvamConnection(clientSocket) {
    let transcript = "";
    let sarvamSocket = null;
    let isReady = false;

    const SARVAM_API_KEY = process.env.SARVAM_API_KEY;

    async function connectToSarvam() {
        const sarvamUrl = new URL("wss://api.sarvam.ai/speech-to-text/ws");

        sarvamUrl.searchParams.set("model", "saaras:v3");
        sarvamUrl.searchParams.set("mode", "translit");
        sarvamUrl.searchParams.set("language-code", "hi-IN");
        sarvamUrl.searchParams.set("vad_signals", "true");
        sarvamUrl.searchParams.set("high_vad_sensitivity", "true");
        sarvamUrl.searchParams.set("sample_rate", "16000");
        sarvamUrl.searchParams.set("input_audio_codec", "pcm_s16le");

        console.log("Connecting to Sarvam WebSocket...");

        try {
            sarvamSocket = new WebSocket(sarvamUrl.toString(), [
                `api-subscription-key.${SARVAM_API_KEY}`
            ], {
                headers: {
                    "api-subscription-key": SARVAM_API_KEY
                }
            });

            sarvamSocket.on("unexpected-response", (req, res) => {
                console.error(`Sarvam rejected connection: ${res.statusCode}`);
                let body = "";
                res.on("data", (chunk) => body += chunk);
                res.on("end", () => {
                    console.error("Response body:", body);
                    isReady = false;
                    clientSocket.emit("error", "Transcription connection rejected");
                });
            });

            sarvamSocket.on("open", () => {
                console.log("Sarvam WebSocket open and ready!");
                isReady = true;
                clientSocket.emit("sarvam-ready");
            });

            sarvamSocket.on("message", (rawMessage) => {
                try {
                    const message = JSON.parse(rawMessage.toString());
                    console.log("Sarvam message:", rawMessage.toString());

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
                        const text = message.data?.transcript || "";
                        if (text.trim()) {
                            transcript += (transcript ? " " : "") + text.trim();
                        }
                        clientSocket.emit("transcript", {
                            transcript,
                            interim: ""
                        });
                    }
                } catch (err) {
                    console.error("Error parsing Sarvam message:", err);
                }
            });

            sarvamSocket.on("error", (err) => {
                console.error("Sarvam socket error:", err);
                isReady = false;
            });

            sarvamSocket.on("close", (code) => {
                console.log("Sarvam socket closed:", code);
                isReady = false;
            });

        } catch (err) {
            console.error("Failed to connect to Sarvam:", err);
            clientSocket.emit("error", "Failed to connect to transcription service");
        }
    }

    function closeSarvam() {
        isReady = false;
        clientSocket.emit("vad-status", { isProcessing: false });
        try {
            if (sarvamSocket) {
                sarvamSocket.close();
                sarvamSocket = null;
            }
        } catch (e) {
            console.error("Error closing Sarvam connection:", e);
        }
    }

    // Socket event listeners from the frontend
    clientSocket.on("start-recording", async () => {
        transcript = ""; // Clear transcript on new recording chunk
        console.log("Start recording requested, connecting to Sarvam...");
        await connectToSarvam();
    });

    clientSocket.on("audio-chunk", (chunk) => {
        try {
            if (sarvamSocket && isReady && chunk) {
                const base64Audio = Buffer.from(chunk).toString("base64");

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
            console.error("Error sending audio to Sarvam:", err);
        }
    });

    clientSocket.on("stop-recording", () => {
        console.log("Stop recording requested");
        closeSarvam();
    });

    clientSocket.on("disconnect", () => {
        console.log("Client disconnected:", clientSocket.id);
        closeSarvam();
    });
}

module.exports = { handleSarvamConnection };
