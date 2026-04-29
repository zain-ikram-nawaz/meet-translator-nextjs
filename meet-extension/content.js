if (typeof window.meetTranslatorInjected === 'undefined') {
    window.meetTranslatorInjected = true;
    console.log("🟢 Meet Translator Content Script Loaded (Production Fixed)");

    // Inject the main injector script if not already present
    if (!document.getElementById('meet-translator-injector')) {
        const script = document.createElement('script');
        script.id = 'meet-translator-injector';
        script.src = chrome.runtime.getURL('inject.js');
        script.onload = function() { this.remove(); };
        (document.head || document.documentElement).appendChild(script);
    }

    // Speech Recognition Setup
    let recognition = null;
    let isRecording = false;
    let isProcessing = false;

    // CRITICAL: Track processed final transcripts to prevent duplicates
    let processedTranscripts = new Set();
    let lastProcessedTime = 0;
    const DUPLICATE_COOLDOWN = 2000; // 2 seconds ignore same text

    // Debounce timer for rapid changes
    let debounceTimer = null;
    const DEBOUNCE_DELAY = 500; // Wait 500ms after speech stops

    // Listen to popup messages
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === "START_TRANSLATION") {
            startRecognition();
            window.postMessage({ type: "START_TRANSLATION_MODE" }, "*");
            sendResponse({ success: true });
        }
        else if (request.action === "STOP_TRANSLATION") {
            stopRecognition();
            window.postMessage({ type: "STOP_TRANSLATION_MODE" }, "*");
            sendResponse({ success: true });
        }
        return true;
    });

    // Start Speech Recognition
    function startRecognition() {
        if (isRecording) return;
        isRecording = true;
        processedTranscripts.clear(); // Reset on new session

        try {
            recognition = new (window.SpeechRecognition || window.webkitSpeechRecognition)();
            recognition.lang = 'ur-PK';

            // KEY FIX 1: Disable interim results completely for production stability
            // Yeh temporary/jhoothe results band kar deta hai
            recognition.interimResults = false;

            recognition.continuous = true;
            recognition.maxAlternatives = 1;

            // Buffer for collecting speech
            let speechBuffer = "";
            let silenceTimer = null;
            const SILENCE_TIMEOUT = 800; // 800ms silence = sentence complete

            recognition.onresult = (event) => {
                const last = event.results.length - 1;
                const result = event.results[last];

                // KEY FIX 2: Sirf FINAL results process karo (isFinal === true)
                if (!result.isFinal) {
                    // Ignore interim results completely
                    return;
                }

                const transcript = result[0].transcript.trim();

                if (!transcript) return;

                console.log("📝 FINAL Urdu Detected:", transcript);

                // KEY FIX 3: Smart duplicate detection
                const now = Date.now();
                const transcriptKey = transcript.toLowerCase().trim();

                // Check if exact same text was processed recently
                if (processedTranscripts.has(transcriptKey)) {
                    const timeDiff = now - lastProcessedTime;
                    if (timeDiff < DUPLICATE_COOLDOWN) {
                        console.log("⚠️ Duplicate ignored (cooldown):", transcript);
                        return;
                    }
                }

                // Check for partial duplicates (e.g., "میری" vs "میری اواز")
                for (let processed of processedTranscripts) {
                    // Agar naya text purane ka subset hai ya vice versa
                    if (transcriptKey.includes(processed) || processed.includes(transcriptKey)) {
                        const timeDiff = now - lastProcessedTime;
                        if (timeDiff < DUPLICATE_COOLDOWN) {
                            console.log("⚠️ Partial duplicate ignored:", transcript);
                            return;
                        }
                    }
                }

                // Add to processed set
                processedTranscripts.add(transcriptKey);
                lastProcessedTime = now;

                // Cleanup old entries to prevent memory bloat
                if (processedTranscripts.size > 20) {
                    const firstKey = processedTranscripts.values().next().value;
                    processedTranscripts.delete(firstKey);
                }

                // Debounce: Wait for speech to actually stop
                clearTimeout(debounceTimer);
                speechBuffer = transcript; // Replace buffer with latest complete sentence

                debounceTimer = setTimeout(() => {
                    if (speechBuffer) {
                        processTranslation(speechBuffer);
                        speechBuffer = ""; // Clear buffer after processing
                    }
                }, DEBOUNCE_DELAY);
            };

            recognition.onerror = (e) => {
                console.error("❌ SpeechRecognition Error:", e.error);
                // Auto-restart on error unless manually stopped
                if (isRecording && e.error !== 'aborted' && e.error !== 'no-speech') {
                    setTimeout(() => {
                        if (isRecording && recognition) {
                            try {
                                recognition.stop();
                                recognition.start();
                            } catch (err) {
                                console.log("Restart failed, creating new instance");
                                recognition = null;
                                startRecognition();
                            }
                        }
                    }, 1000);
                }
            };

            recognition.onend = () => {
                // In continuous mode, manually restart if still recording
                if (isRecording) {
                    console.log("🔄 Recognition ended, restarting...");
                    setTimeout(() => {
                        if (isRecording) {
                            try {
                                recognition.start();
                            } catch (e) {
                                console.error("Restart failed:", e);
                                // Create fresh instance
                                recognition = null;
                                startRecognition();
                            }
                        }
                    }, 100);
                }
            };

            recognition.start();
            console.log("🎤 Speech Recognition Started (Production Mode)");

        } catch (err) {
            console.error("❌ Mic / SpeechRecognition failed:", err);
            isRecording = false;
        }
    }

    // Stop Speech Recognition
    function stopRecognition() {
        isRecording = false;
        clearTimeout(debounceTimer);
        if (recognition) {
            try {
                recognition.stop();
            } catch (e) {
                // Ignore stop errors
            }
            recognition = null;
        }
        processedTranscripts.clear();
        console.log("⏹️ Speech Recognition Stopped");
    }

    // Process translation with queue management
    async function processTranslation(urduText) {
        // Prevent concurrent processing
        if (isProcessing) {
            console.log("⏳ Queueing:", urduText);
            // Simple queue: wait and retry
            setTimeout(() => processTranslation(urduText), 1000);
            return;
        }

        isProcessing = true;
        console.log("🔄 Processing:", urduText);

        try {
            // Send to background for translation
            const response = await sendMessagePromise({
                action: "TRANSLATE_TEXT",
                urduText: urduText
            });

            if (response && response.success) {
                console.log("🇬🇧 English:", response.translatedText);

                // Request audio playback
                await playTranslation(response.translatedText);

                // Cooldown between translations to prevent overlap
                await delay(800);
            } else {
                console.error("❌ Translation failed:", response?.error);
            }
        } catch (error) {
            console.error("❌ Processing error:", error);
        } finally {
            isProcessing = false;
        }
    }

    // Promise wrapper for chrome.runtime.sendMessage
    function sendMessagePromise(message) {
        return new Promise((resolve, reject) => {
            chrome.runtime.sendMessage(message, (response) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                } else {
                    resolve(response);
                }
            });
        });
    }

    // Delay helper
    function delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // Request audio playback
    async function playTranslation(englishText) {
        console.log("✉️ Requesting audio for:", englishText);

        try {
            const response = await sendMessagePromise({
                action: "FETCH_TTS_AUDIO",
                text: englishText
            });

            if (response && response.success) {
                window.postMessage({
                    type: "INJECT_AUDIO_TO_STREAM",
                    audioData: response.audioData
                }, "*");
                console.log("✉️ Sent audio data to injector.");
            } else {
                console.error("❌ Audio fetch failed:", response?.error);
            }
        } catch (error) {
            console.error("❌ Audio request error:", error);
        }
    }
}