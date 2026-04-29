// pages/api/translate-text.js (Optional - only if using local server)
import { NextResponse } from "next/server";

// Simple in-memory cache
const cache = new Map();

export async function POST(req) {
    try {
        const { text } = await req.json();
        if (!text) return NextResponse.json({ success: false, error: "No text" });

        // Check cache
        if (cache.has(text)) {
            return NextResponse.json({
                success: true,
                translatedText: cache.get(text),
                cached: true
            });
        }

        // Use Google Translate free endpoint
        const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=ur&tl=en&dt=t&q=${encodeURIComponent(text)}`;

        const response = await fetch(url);
        const data = await response.json();

        let translatedText = "";
        if (data && data[0]) {
            translatedText = data[0].map(item => item[0]).join("");
        }

        if (!translatedText) throw new Error("Translation failed");

        // Cache result
        if (cache.size > 100) cache.delete(cache.keys().next().value);
        cache.set(text, translatedText);

        return NextResponse.json({
            success: true,
            translatedText: translatedText
        });

    } catch (error) {
        console.error("❌ Translation API Error:", error);
        return NextResponse.json({
            success: false,
            error: error.message
        });
    }
}