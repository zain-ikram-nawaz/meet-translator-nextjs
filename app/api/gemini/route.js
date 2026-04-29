import { NextResponse } from "next/server";

export async function POST(req) {
    try {
        const { text } = await req.json();
        const apiKey = "AIzaSyDfPfEDLdmgZv2bY1z0fo6P8aI_mNZUDH0";

        // Aapki list ke mutabiq exact model name ye hai (v1beta ke sath)
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${apiKey}`;

        const payload = {
            "contents": [{
                "parts": [{
                    // Instruction ko mazeed chota kiya taake "sentence khana" band ho jaye
                    "text": `Translate Urdu to English. Fix: shfiff->Shopify, wins->Vans. Input: ${text}`
                }]
            }],
            "generationConfig": {
                "temperature": 0.1, // Thoda sa temperature taake sentence natural lage
                "maxOutputTokens": 200, // Tokens barha diye taake sentence pura aaye
            }
        };

        const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });

        const data = await response.json();

        if (data.error) {
            return NextResponse.json({ success: false, error: data.error.message }, { status: 400 });
        }

        // Response extraction logic
        if (data.candidates && data.candidates[0].content) {
            const translatedText = data.candidates[0].content.parts[0].text.trim();
            return NextResponse.json({ success: true, translatedText });
        } else {
            return NextResponse.json({ success: false, error: "Empty response from Gemini" });
        }

    } catch (error) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}