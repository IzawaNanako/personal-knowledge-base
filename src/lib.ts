import { GoogleGenAI, Type, Schema } from '@google/genai';
import * as fs from 'fs-extra';
import * as path from 'path';
import 'dotenv/config';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const MODEL_NAME = process.env.MODEL_NAME as string;

if (!MODEL_NAME) {
    throw new Error('MODEL_NAME environment variable is not set. Please specify the Gemini model to use.');
}

const SYSTEM_PROMPT_PATH = path.join(process.cwd(), 'prompts', 'system.md');
const LOG_PATH = path.join(process.cwd(), 'logs', 'log.md');

const wikiOperationSchema: Schema = {
    type: Type.ARRAY,
    description: 'A list of wiki files to create or update based on the raw content.',
    items: {
        type: Type.OBJECT,
        properties: {
            filename: {
                type: Type.STRING,
                description: 'The kebab-case.md filename.',
            },
            content: {
                type: Type.STRING,
                description: 'The markdown content to write to the file.',
            },
            action: {
                type: Type.STRING,
                description: '"create" if new, "update" if appending/modifying.',
            }
        },
        required: ['filename', 'content', 'action']
    }
};

async function getSystemInstruction(): Promise<string> {
    if (!await fs.pathExists(SYSTEM_PROMPT_PATH)) {
         throw new Error('system.md not found! Please create the rulebook.');
    }
    return fs.readFile(SYSTEM_PROMPT_PATH, 'utf8');
}

export async function askGeminiForWikiOperations(prompt: string): Promise<any[]> {
    const systemInstruction = await getSystemInstruction();
    
    try {
        const response = await ai.models.generateContent({
            model: MODEL_NAME,
            contents: prompt,
            config: {
                systemInstruction: systemInstruction,
                temperature: 0.2,
                responseMimeType: 'application/json',
                responseSchema: wikiOperationSchema,
            }
        });

        return JSON.parse(response.text || '[]');
    }
    catch (error) {
        console.error('Gemini API Error:', error);
        return [];
    }
}

export async function logOperation(action: string, details: string) {
    const timestamp = new Date().toISOString();
    const logEntry = `\n## [${timestamp}] ${action}\n${details}\n`;
    await fs.appendFile(LOG_PATH, logEntry, 'utf8');
    console.log(`[Logged] ${action}`);
}

export async function getEmbedding(text: string): Promise<number[]> {
    try {
        const response = await ai.models.embedContent({
            model: 'gemini-embedding-001',
            contents: text,
        });
        // @ts-ignore
        return response.embeddings[0].values || [];
    }
    catch (error) {
        console.error('Embedding API Error:', error);
        return [];
    }
}

const querySchema: Schema = {
    type: Type.OBJECT,
    properties: {
        slug: {
            type: Type.STRING,
            description: "A 3-4 word kebab-case summary of the query for the filename. e.g., okumura-hata-frequency",

        },
        answer: {
            type: Type.STRING,
            description: "The synthesized markdown answer containing [[wikilinks]].",
        }
    },
    required: ["slug", "answer"]
};

export async function askGeminiForQuery(prompt: string): Promise<{slug: string, answer: string} | null> {
    const systemInstruction = await getSystemInstruction();
    try {
        const response = await ai.models.generateContent({
            model: MODEL_NAME,
            contents: prompt,
            config: {
                systemInstruction: systemInstruction,
                temperature: 0.2,
                responseMimeType: "application/json",
                responseSchema: querySchema,
            }
        });
        return JSON.parse(response.text || 'null');
    }
    catch (error) {
        console.error("Gemini API Error:", error);
        return null;
    }
}
