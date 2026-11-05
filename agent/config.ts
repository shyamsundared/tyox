import { GoogleGenAI } from "@google/genai";

export const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export const MODEL = process.env.GEMINI_MODEL || "gemini-3.1-flash-lite";

// folder inside the e2b sandbox where the generated app lives
export const PROJECT_ROOT = "/tmp/tyox-project";

export const RUN_TIMEOUT_MS = 5 * 60 * 1000;
