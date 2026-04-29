// background.js
console.log("🚀 Background Script Loaded (Optimized v2)");

// Simple cache systems
const translationCache = new Map();
const ttsCache = new Map();
const CACHE_MAX_SIZE = 50;

// Cleanup cache function
function addToCache(map, key, value) {
    if (map.size >= CACHE_MAX_SIZE) {
        const firstKey = map.keys().next().value;
        map.delete(firstKey);
    }
    map.set(key, value);
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {

    // ===============================
    // 1️⃣ FETCH TTS AUDIO (Parallel + Cached)
    // ===============================
    if (request.action === "FETCH_TTS_AUDIO") {
        const text = request.text;

        if (!text || text.length === 0) {
            sendResponse({ success: false, error: "Empty text" });
            return true;
        }

        // Check TTS cache first
        if (ttsCache.has(text)) {
            console.log("⚡ TTS Cache Hit");
            sendResponse({ success: true, audioData: ttsCache.get(text) });
            return true;
        }

        // Try Web Speech API synthesis first (faster), fallback to Google TTS
        handleTTS(text, sendResponse);
        return true;
    }

    // ===============================
    // 2️⃣ TEXT TRANSLATION (Direct API + Cached)
    // ===============================
    if (request.action === "TRANSLATE_TEXT" && request.urduText) {
        const urduText = request.urduText;

        // Check translation cache
        if (translationCache.has(urduText)) {
            console.log("⚡ Translation Cache Hit");
            sendResponse({ success: true, translatedText: translationCache.get(urduText) });
            return true;
        }

        translateTextDirect(urduText)
            .then(translatedText => {
                addToCache(translationCache, urduText, translatedText);
                sendResponse({ success: true, translatedText: translatedText });
            })
            .catch(err => {
                console.error("❌ Translation Error:", err);
                sendResponse({ success: false, error: err.message });
            });

        return true;
    }
});

// ======================================
// 🔹 SMART TTS HANDLER (Web Speech API + Google TTS Fallback)
// ======================================
async function handleTTS(text, sendResponse) {
    try {
        // Option 1: Try Google TTS with parallel fetching (better quality)
        const chunks = splitTextSmart(text, 180);
        const audioData = await fetchAllChunksParallel(chunks);

        // Cache the result
        addToCache(ttsCache, text, audioData);
        sendResponse({ success: true, audioData: audioData });

    } catch (error) {
        console.error("❌ TTS Error:", error);
        sendResponse({ success: false, error: error.message });
    }
}

// ======================================
// 🔹 SMART TEXT SPLITTER (Sentence boundary aware)
// ======================================
function splitTextSmart(text, maxLength = 180) {
    // Split by sentence boundaries first
    const sentences = text.match(/[^\.!\?]+[\.!\?]+|[^\.!\?]+$/g) || [text];
    let chunks = [];
    let current = "";

    for (let sentence of sentences) {
        sentence = sentence.trim();

        // If single sentence is too long, split by words
        if (sentence.length > maxLength) {
            if (current) {
                chunks.push(current.trim());
                current = "";
            }

            const words = sentence.split(" ");
            let temp = "";

            for (let word of words) {
                if ((temp + word).length > maxLength) {
                    chunks.push(temp.trim());
                    temp = word + " ";
                } else {
                    temp += word + " ";
                }
            }
            if (temp.trim()) current = temp;
        }
        // Normal case: try to add full sentence
        else if ((current + sentence).length > maxLength) {
            chunks.push(current.trim());
            current = sentence + " ";
        } else {
            current += sentence + " ";
        }
    }

    if (current.trim()) {
        chunks.push(current.trim());
    }

    return chunks.filter(c => c.length > 0);
}

// ======================================
// 🔹 PARALLEL AUDIO FETCHING (Much Faster)
// ======================================
async function fetchAllChunksParallel(chunks) {
    // Fetch all chunks in parallel instead of sequential
    const promises = chunks.map(chunk => fetchSingleChunk(chunk));
    const buffers = await Promise.all(promises);

    // Merge all buffers
    let totalLength = buffers.reduce((sum, arr) => sum + arr.length, 0);
    let merged = new Uint8Array(totalLength);

    let offset = 0;
    for (let arr of buffers) {
        merged.set(arr, offset);
        offset += arr.length;
    }

    // Convert to Base64 efficiently
    return arrayBufferToBase64(merged);
}

async function fetchSingleChunk(chunk) {
    const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(chunk)}&tl=en&client=tw-ob`;

    const response = await fetch(url, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
    });

    if (!response.ok) {
        throw new Error(`TTS chunk failed: ${response.status}`);
    }

    const buffer = await response.arrayBuffer();
    return new Uint8Array(buffer);
}

// Efficient base64 conversion
function arrayBufferToBase64(bytes) {
    let binary = '';
    const len = bytes.length;
    const chunkSize = 0x8000; // 32KB chunks

    for (let i = 0; i < len; i += chunkSize) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
    }

    return btoa(binary);
}

// ======================================
// 🔹 DIRECT TRANSLATION (No local server needed)
// ======================================
async function translateTextDirect(urduText) {
    // Using Google Translate free endpoint (unofficial but fast)
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=ur&tl=en&dt=t&q=${encodeURIComponent(urduText)}`;

    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error("Translation API failed");

        const data = await response.json();
        // Extract translated text from nested array
        let translatedText = "";
        if (data && data[0]) {
            translatedText = data[0].map(item => item[0]).join("");
        }

        if (!translatedText) throw new Error("Empty translation response");

        return translatedText;

    } catch (error) {
        console.error("Direct translation failed, trying backup:", error);

        // Backup: MyMemory API (free, no key needed for small usage)
        return await translateBackup(urduText);
    }
}

async function translateBackup(urduText) {
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(urduText)}&langpair=ur|en`;

    const response = await fetch(url);
    const data = await response.json();

    if (data.responseStatus === 200) {
        return data.responseData.translatedText;
    }

    throw new Error("Backup translation also failed");
}