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
    const DUPLICATE_COOLDOWN = 800; // Reduced from 2000ms

    // Pre-warm timer for interim results
    let prewarmTimer = null;
    let lastInterimText = '';

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
            recognition.interimResults = true; // Enable for pre-warming translation cache
            recognition.continuous = true;
            recognition.maxAlternatives = 1;

            recognition.onresult = (event) => {
                let finalTranscript = '';
                let interimTranscript = '';

                for (let i = event.resultIndex; i < event.results.length; i++) {
                    const text = event.results[i][0].transcript.trim();
                    if (event.results[i].isFinal) {
                        finalTranscript += text;
                    } else {
                        interimTranscript += text;
                    }
                }

                // Pre-warm translation cache while user is still speaking
                if (!finalTranscript && interimTranscript && interimTranscript !== lastInterimText) {
                    lastInterimText = interimTranscript;
                    clearTimeout(prewarmTimer);
                    prewarmTimer = setTimeout(() => {
                        if (interimTranscript.length > 4) {
                            chrome.runtime.sendMessage({
                                action: "PREWARM_TRANSLATION",
                                urduText: interimTranscript
                            });
                        }
                    }, 350);
                }

                if (!finalTranscript) return;

                // Final result arrived - cancel pre-warm, process immediately (no debounce!)
                clearTimeout(prewarmTimer);
                lastInterimText = '';

                const transcript = finalTranscript.trim();
                if (!transcript) return;

                console.log("📝 FINAL Urdu Detected:", transcript);

                const now = Date.now();
                const transcriptKey = transcript.toLowerCase().trim();

                if (processedTranscripts.has(transcriptKey) && (now - lastProcessedTime) < DUPLICATE_COOLDOWN) {
                    console.log("⚠️ Duplicate ignored:", transcript);
                    return;
                }

                for (let processed of processedTranscripts) {
                    if (transcriptKey.includes(processed) || processed.includes(transcriptKey)) {
                        if ((now - lastProcessedTime) < DUPLICATE_COOLDOWN) {
                            console.log("⚠️ Partial duplicate ignored:", transcript);
                            return;
                        }
                    }
                }

                processedTranscripts.add(transcriptKey);
                lastProcessedTime = now;

                if (processedTranscripts.size > 20) {
                    processedTranscripts.delete(processedTranscripts.values().next().value);
                }

                // Process immediately - no debounce delay
                processTranslation(transcript);
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
        clearTimeout(prewarmTimer);
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
            setTimeout(() => processTranslation(urduText), 200); // Reduced from 1000ms
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

                // Minimal gap before allowing next translation
                await delay(100);
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