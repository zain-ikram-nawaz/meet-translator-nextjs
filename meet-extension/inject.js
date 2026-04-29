// inject.js
console.log("💉 Audio Injector Loaded (Optimized V6)");

const AudioContext = window.AudioContext || window.webkitAudioContext;
let audioContext = null;
let mediaStreamDestination = null;
let originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);

// Mode Control
window.translationMode = false;

// Gains
let micGain = null;
let translationGain = null;
let micStream = null;
let isInitialized = false;

// Initialize audio context on first user interaction (browser policy)
function initAudio() {
    if (isInitialized) return;

    audioContext = new AudioContext();
    mediaStreamDestination = audioContext.createMediaStreamDestination();

    micGain = audioContext.createGain();
    translationGain = audioContext.createGain();

    micGain.gain.value = 1.0;
    translationGain.gain.value = 2.5; // Slightly reduced to prevent clipping

    micGain.connect(mediaStreamDestination);
    translationGain.connect(mediaStreamDestination);

    isInitialized = true;
    console.log("🔊 Audio Context Initialized");
}

// Pre-warm audio context on any click
document.addEventListener('click', () => {
    if (!isInitialized) initAudio();
    if (audioContext && audioContext.state === 'suspended') {
        audioContext.resume();
    }
}, { once: true });

// 1️⃣ Hijack Microphone
navigator.mediaDevices.getUserMedia = async function (constraints) {

    if (constraints && constraints.audio) {
        console.log("🎤 Meet requesting mic...");

        try {
            // Initialize if not already
            if (!isInitialized) initAudio();

            const stream = await originalGetUserMedia(constraints);
            micStream = stream;

            if (audioContext.state === 'suspended') {
                await audioContext.resume();
            }

            const micSource = audioContext.createMediaStreamSource(stream);
            micSource.connect(micGain);

            const mixedStream = mediaStreamDestination.stream;

            // Copy video tracks
            stream.getVideoTracks().forEach(track => {
                mixedStream.addTrack(track);
            });

            return mixedStream;

        } catch (err) {
            console.error("❌ Hijack Failed:", err);
            return originalGetUserMedia(constraints);
        }
    }

    return originalGetUserMedia(constraints);
};

// 2️⃣ Listen for START / STOP
window.addEventListener("message", (event) => {
    if (!isInitialized) initAudio();

    if (event.data.type === "START_TRANSLATION_MODE") {
        window.translationMode = true;
        if (micGain) {
            micGain.gain.setTargetAtTime(0.001, audioContext.currentTime, 0.01);
        }
        console.log("🟢 Translation Mode ON (Mic Muted)");
    }

    if (event.data.type === "STOP_TRANSLATION_MODE") {
        window.translationMode = false;
        if (micGain) {
            micGain.gain.setTargetAtTime(1.0, audioContext.currentTime, 0.01);
        }
        console.log("🔴 Translation Mode OFF (Mic Normal)");
    }
});

// 3️⃣ Inject English Translation
let currentSource = null;
let audioQueue = [];
let isPlaying = false;

window.addEventListener("message", async (event) => {
    if (event.data.type !== "INJECT_AUDIO_TO_STREAM") return;
    if (!window.translationMode) return;

    console.log("🌍 Queueing English Translation...");

    audioQueue.push(event.data.audioData);

    if (!isPlaying) {
        playNextAudio();
    }
});

async function playNextAudio() {
    if (audioQueue.length === 0) {
        isPlaying = false;
        return;
    }

    isPlaying = true;
    const base64Data = audioQueue.shift();

    try {
        if (audioContext.state === 'suspended') {
            await audioContext.resume();
        }

        // Stop previous audio if playing
        if (currentSource) {
            try { currentSource.stop(); } catch (e) { }
            currentSource.disconnect();
            currentSource = null;
        }

        const binaryString = atob(base64Data);
        const bytes = new Uint8Array(binaryString.length);

        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }

        const audioBuffer = await audioContext.decodeAudioData(bytes.buffer);

        const source = audioContext.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(translationGain);

        source.onended = () => {
            source.disconnect();
            currentSource = null;
            // Play next in queue
            setTimeout(playNextAudio, 100);
        };

        source.start(0);
        currentSource = source;

        console.log("✅ English audio playing.");

    } catch (e) {
        console.error("❌ Translation Injection Error:", e);
        isPlaying = false;
    }
}