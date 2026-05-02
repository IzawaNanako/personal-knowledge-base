import { GoogleGenAI } from '@google/genai';
import * as fs from 'fs-extra';
import * as path from 'path';
import 'dotenv/config';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const MODEL_NAME = 'gemini-3.1-flash-lite-preview'; 

const SYSTEM_PROMPT_PATH = path.join(process.cwd(), 'system.md');
const LOG_PATH = path.join(process.cwd(), 'log.md');

async function getSystemInstruction(): Promise<string> {
    if (!await fs.pathExists(SYSTEM_PROMPT_PATH)) {
         throw new Error('system.md not found! Please create the rulebook.');
    }
    return fs.readFile(SYSTEM_PROMPT_PATH, 'utf8');
}

export async function askGemini(prompt: string): Promise<string> {
    const systemInstruction = await getSystemInstruction();
    
    const response = await ai.models.generateContent({
        model: MODEL_NAME,
        contents: prompt,
        config: {
            systemInstruction: systemInstruction,
            temperature: 0.2
        }
    });

    return response.text || 'No response generated.';
}

export async function logOperation(action: string, details: string) {
    const timestamp = new Date().toISOString();
    const logEntry = `\n## [${timestamp}] ${action}\n${details}\n`;
    await fs.appendFile(LOG_PATH, logEntry, 'utf8');
    console.log(`[Logged] ${action}`);
}
