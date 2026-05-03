import { GoogleGenAI, Type, Schema, FunctionDeclaration } from '@google/genai';
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
    description: "A list of wiki files to create or update. Prefer creating ONE comprehensive markdown file per broad topic. Do NOT fragment related concepts into multiple small files. Group them together under markdown headers.",
    items: {
        type: Type.OBJECT,
        properties: {
            filename: {
                type: Type.STRING,
                description: "The kebab-case.md filename.",
            },
            content: {
                type: Type.STRING,
                description: "The markdown content.",
            },
            action: {
                type: Type.STRING,
                description: "'create' if new, 'update' if appending.",
            },
            summary: {
                type: Type.STRING,
                description: "A one-line summary of the file for the Master Index.",
            }
        },
        required: ["filename", "content", "action", "summary"]
    }
};

async function getSystemInstruction(): Promise<string> {
    if (!await fs.pathExists(SYSTEM_PROMPT_PATH)) {
         throw new Error('system.md not found! Please create the rulebook.');
    }
    return fs.readFile(SYSTEM_PROMPT_PATH, 'utf8');
}

export const webSearchTool: FunctionDeclaration = {
    name: 'search_web',
    description: 'Search the internet for information if the local wiki context is insufficient or outdated.',
    parameters: {
        type: Type.OBJECT,
        properties: {
            searchQuery: { 
                type: Type.STRING, 
                description: 'The optimized search query to find the missing information.' ,
            }
        },
        required: ['searchQuery']
    }
};

const searchWebDeclaration: FunctionDeclaration = {
    name: 'search_web',
    description: 'Search the internet for information if the local wiki context is insufficient or outdated.',
    parameters: {
        type: Type.OBJECT,
        properties: {
            searchQuery: { type: Type.STRING, description: 'The optimized search query to find the missing information.' }
        },
        required: ['searchQuery']
    }
};

export async function checkNeedForSearch(prompt: string): Promise<string | null> {
    const systemInstruction = await getSystemInstruction();
    try {
        const response = await ai.models.generateContent({
            model: MODEL_NAME,
            contents: prompt,
            config: {
                systemInstruction: systemInstruction,
                tools: [{
                    functionDeclarations: [searchWebDeclaration],
                }],
                temperature: 0.1,
            }
        });
        
        if (response.functionCalls && response.functionCalls.length > 0) {
            // @ts-ignore
            return response.functionCalls[0].args.searchQuery as string;
        }
        return null;
    }
    catch (error) {
        console.error('Agent Router Error:', error);
        return null;
    }
}

export async function searchTavily(query: string): Promise<{url: string, title: string, content: string}[]> {
    console.log(`[Tavily] Scraping the web for: "${query}"...`);
    const response = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            api_key: process.env.TAVILY_API_KEY,
            query: query,
            include_answer: false,
            search_depth: "advanced",
        })
    });
    
    const data = await response.json();
    const results: PromiseLike<{ url: string; title: string; content: string; }[]> | { url: any; title: any; content: any; }[] = [];
    
    if (data.results) {
        data.results.forEach((r: any) => {
            results.push({
                url: r.url,
                title: r.title,
                content: r.content,
            });
        });
    }
    
    return results;
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
            description: "A 3-4 word kebab-case summary of the query."
        },
        answer: {
            type: Type.STRING,
            description: "The synthesized markdown answer. Do NOT include a sources section here.",
        },
        sources: { 
            type: Type.ARRAY, 
            description: "A list of exact source URLs or [[archive-links]] found in the context.",
            items: {
                type: Type.STRING,
            } 
        }
    },
    required: ["slug", "answer", "sources"]
};

export async function askGeminiForQuery(prompt: string): Promise<{slug: string, answer: string, sources: string[]} | null> {
    const systemInstruction = await getSystemInstruction();
    try {
        const response = await ai.models.generateContent({
            model: MODEL_NAME,
            contents: prompt,
            config: {
                systemInstruction: systemInstruction,
                temperature: 0.2,
                responseMimeType: 'application/json',
                responseSchema: querySchema,
            }
        });
        return JSON.parse(response.text || 'null');
    }
    catch (error) {
        console.error('Gemini API Error:', error);
        return null;
    }
}
