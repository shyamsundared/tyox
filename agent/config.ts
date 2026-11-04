import { GoogleGenAI } from "@google/genai";
const geminiKey = process.env.GEMINI_API_KEY;

export const client = new GoogleGenAI({
    apiKey: geminiKey,
});
