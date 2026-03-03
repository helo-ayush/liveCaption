// ─────────────────────────────────────────────────────────────────────────────
// pcm-processor.js — AudioWorklet Processor for Raw PCM Audio Capture
// ─────────────────────────────────────────────────────────────────────────────
// This file runs INSIDE the browser's dedicated audio processing thread
// (separate from the main JS thread), so it never blocks the UI.
//
// What it does:
//   1. Receives raw mic audio from the browser (Float32, at native sample rate)
//   2. Downsamples it to 16kHz (what Sarvam AI expects)
//   3. Converts it to 16-bit signed PCM little-endian (PCM_S16LE format)
//   4. Sends ~250ms chunks back to App.jsx via port.postMessage()
// ─────────────────────────────────────────────────────────────────────────────


// AudioWorkletProcessor is a browser built-in base class.
// Every custom audio processor must extend it.
class PCMProcessor extends AudioWorkletProcessor {

    constructor() {
        super(); // Required — calls the parent AudioWorkletProcessor constructor

        this._buffer = []; // Holds accumulated audio samples between process() calls

        // How many 16kHz samples make ~250ms of audio?
        // 16000 samples/sec × 0.25 sec = 4000 samples
        // We batch samples until we hit this count, then send one chunk.
        this._targetSamples = 4000;
    }


    // ─── METHOD 1: Downsampler ───────────────────────────────────────────────
    // Browsers capture audio at their native sample rate (usually 44100 Hz or
    // 48000 Hz). Sarvam AI only accepts 16000 Hz (16kHz). This method shrinks
    // the audio down by picking evenly-spaced samples from the original array.
    //
    // inputBuffer      → Float32Array of audio samples at original sample rate
    // inputSampleRate  → e.g. 44100 (browser's rate)
    // outputSampleRate → 16000 (what we want)
    _downsample(inputBuffer, inputSampleRate, outputSampleRate) {

        // If rates already match, no work needed — return as-is
        if (inputSampleRate === outputSampleRate) {
            return inputBuffer;
        }

        // ratio = how many input samples correspond to 1 output sample
        // e.g. 44100 / 16000 ≈ 2.75 → for every output sample, skip ~2.75 input samples
        const ratio = inputSampleRate / outputSampleRate;

        // Calculate how many output samples we'll have after downsampling
        const outputLength = Math.floor(inputBuffer.length / ratio);

        // Create a new Float32Array to hold the downsampled audio
        const output = new Float32Array(outputLength);

        for (let i = 0; i < outputLength; i++) {
            // For each output sample, pick the corresponding input sample
            // Math.floor rounds down to the nearest whole index
            output[i] = inputBuffer[Math.floor(i * ratio)];
        }

        return output; // Return the downsampled audio
    }


    // ─── METHOD 2: Float32 → Int16 PCM Converter ────────────────────────────
    // Audio in the Web Audio API uses float values between -1.0 and +1.0.
    // Sarvam AI expects raw bytes in PCM_S16LE format:
    //   - S16  = Signed 16-bit integers (range: -32768 to +32767)
    //   - LE   = Little-Endian (least significant byte first)
    //
    // This method converts each float sample to a 16-bit integer and packs
    // them all into a binary ArrayBuffer.
    _floatTo16BitPCM(float32Array) {

        // Each sample needs 2 bytes (16 bits), so total bytes = length × 2
        const buffer = new ArrayBuffer(float32Array.length * 2);

        // DataView lets us write raw bytes at specific offsets in the buffer
        const view = new DataView(buffer);

        for (let i = 0; i < float32Array.length; i++) {

            // Clamp the float to [-1, 1] to prevent overflow during conversion
            let s = Math.max(-1, Math.min(1, float32Array[i]));

            // Scale the float to the 16-bit integer range:
            //   negative floats → multiply by 32768 (0x8000)
            //   positive floats → multiply by 32767 (0x7FFF)
            // (32767 for positive to avoid overflow at exactly +1.0)
            s = s < 0 ? s * 0x8000 : s * 0x7FFF;

            // Write the 16-bit integer at byte position (i * 2)
            // The third argument `true` means Little-Endian byte order
            view.setInt16(i * 2, s, true);
        }

        return buffer; // Return the raw binary PCM data (ArrayBuffer)
    }


    // ─── METHOD 3: process() — Called by the browser ~every 128 samples ─────
    // This is the CORE method of any AudioWorkletProcessor.
    // The browser calls this automatically at a very high rate (~344 times/sec
    // at 44.1kHz) with fresh audio data from the microphone.
    //
    // inputs  → array of input channels. inputs[0][0] = mono mic channel
    // outputs → array of output channels (we don't use this — not playing audio)
    process(inputs) {

        const input = inputs[0]; // Get the first (and only) input source = mic

        // Guard: if no mic data arrived, do nothing but keep the processor alive
        if (!input || !input[0]) return true;

        // Get channel 0 = mono audio (Float32Array of 128 samples typically)
        const channelData = input[0];

        // Downsample from browser's native rate → 16kHz
        // `sampleRate` is a global variable automatically available inside
        // AudioWorkletProcessor — it equals the AudioContext's sample rate
        const downsampled = this._downsample(channelData, sampleRate, 16000);

        // Append the downsampled samples into our accumulation buffer
        for (let i = 0; i < downsampled.length; i++) {
            this._buffer.push(downsampled[i]);
        }

        // Once we've accumulated ~250ms worth of samples (4000 at 16kHz),
        // convert them to PCM and send the chunk to App.jsx
        if (this._buffer.length >= this._targetSamples) {

            // Convert the accumulated buffer array → Float32Array (typed array)
            const float32Array = new Float32Array(this._buffer);

            // Convert Float32 → raw PCM_S16LE binary (ArrayBuffer)
            const pcmBuffer = this._floatTo16BitPCM(float32Array);

            // Send the PCM binary data to the main thread (App.jsx)
            // The second argument `[pcmBuffer]` is the "transfer list" —
            // it transfers ownership of the buffer to avoid copying memory
            this.port.postMessage(pcmBuffer, [pcmBuffer]);

            // Clear the accumulation buffer for the next chunk
            this._buffer = [];
        }

        // Returning `true` tells the browser to keep this processor alive.
        // Returning `false` would destroy it.
        return true;
    }
}


// Register this processor with the name 'pcm-processor'.
// This name must match the string used in App.jsx:
//   new AudioWorkletNode(audioContext, 'pcm-processor')
registerProcessor('pcm-processor', PCMProcessor);
