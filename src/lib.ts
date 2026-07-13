import fs from 'node:fs/promises';
import path from 'node:path';
import type { FunctionDeclaration, Schema } from '@google/genai';
import { GoogleGenAI, Type } from '@google/genai';
import fse from 'fs-extra';
import 'dotenv/config.js';

interface WikiOperation {
	filename: string;
	frontmatter: {
		type?: string;
		tags?: string[];
		aliases?: string[];
	};
	content: string;
	action: string;
	summary: string;
	sources: string[];
}

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const MODEL_NAME = process.env.MODEL_NAME;

if (!MODEL_NAME) {
	throw new Error('MODEL_NAME environment variable is not set. Please specify the Gemini model to use.');
}

const SYSTEM_PROMPT_PATH = path.join(process.cwd(), 'prompts', 'system.md');
const LOG_PATH = path.join(process.cwd(), 'logs', 'log.md');
const TEMPLATES_DIR = path.join(process.cwd(), 'templates');

export async function getAvailableTemplates(): Promise<string[]> {
	try {
		const files = await fs.readdir(TEMPLATES_DIR);
		return files.filter(f => f.endsWith('.md')).map(f => f.replace('.md', ''));
	} catch {
		return [];
	}
}

export function buildYamlFrontmatter(frontmatter: { type?: string; tags?: string[]; aliases?: string[] }): string {
	if (!frontmatter) {
		return '';
	}

	let yaml = '---\n';
	if (frontmatter.type) {
		yaml += `type: ${frontmatter.type}\n`;
	}

	if (frontmatter.aliases && frontmatter.aliases.length > 0) {
		yaml += `aliases:\n${frontmatter.aliases.map(a => `  - ${a}`).join('\n')}\n`;
	}

	if (frontmatter.tags && frontmatter.tags.length > 0) {
		yaml += `tags:\n${frontmatter.tags.map(t => `  - ${t}`).join('\n')}\n`;
	}

	yaml += '---\n\n';
	return yaml;
}

export async function buildContentWithTemplate(op: WikiOperation): Promise<string> {
	const type = op.frontmatter?.type?.toLowerCase();
	if (!type) {
		return buildYamlFrontmatter(op.frontmatter) + op.content;
	}

	const templatePath = path.join(TEMPLATES_DIR, `${type}.md`);
	const templateExists = await fse.pathExists(templatePath);

	if (!templateExists) {
		return buildYamlFrontmatter(op.frontmatter) + op.content;
	}

	let template = await fs.readFile(templatePath, 'utf8');

	const formatYamlArray = (arr?: string[]) => arr && arr.length > 0 ? `\n${arr.map((i: string) => `  - ${i}`).join('\n')}` : ' []';

	const title = op.filename.replace('.md', '').split('-').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

	template = template.replace(/\{\{title\}\}/g, title);
	template = template.replace(/\{\{content\}\}/g, op.content);
	template = template.replace(/\{\{aliases\}\}/g, formatYamlArray(op.frontmatter.aliases));
	template = template.replace(/\{\{tags\}\}/g, formatYamlArray(op.frontmatter.tags));

	return template;
}

async function getWikiOperationSchema(): Promise<Schema> {
	const templates = await getAvailableTemplates();
	const allowedTypes = templates.length > 0 ? [...templates, 'none'] : ['none'];

	return {
		type: Type.ARRAY,
		description: 'A list of wiki files to create or update.',
		items: {
			type: Type.OBJECT,
			properties: {
				filename: {
					type: Type.STRING,
				},
				frontmatter: {
					type: Type.OBJECT,
					properties: {
						type: {
							type: Type.STRING,
							description: `The category of the note. Must be one of the available templates or 'none'.`,
							enum: allowedTypes,
						},
						tags: {
							type: Type.ARRAY,
							items: {
								type: Type.STRING,
							},
						},
						aliases: {
							type: Type.ARRAY,
							items: {
								type: Type.STRING,
							},
						},
					},
				},
				content: {
					type: Type.STRING,
				},
				action: {
					type: Type.STRING,
				},
				summary: {
					type: Type.STRING,
				},
				sources: {
					type: Type.ARRAY,
					items: {
						type: Type.STRING,
					},
				},
			},
			required: ['filename', 'frontmatter', 'content', 'action', 'summary', 'sources'],
		},
	};
}

async function getSystemInstruction(): Promise<string> {
	if (!await fse.pathExists(SYSTEM_PROMPT_PATH)) {
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
				description: 'The optimized search query to find the missing information.',
			},
		},
		required: ['searchQuery'],
	},
};

const searchWebDeclaration: FunctionDeclaration = {
	name: 'search_web',
	description: 'Search the internet for information if the local wiki context is insufficient or outdated.',
	parameters: {
		type: Type.OBJECT,
		properties: {
			searchQuery: {
				type: Type.STRING,
				description: 'The optimized search query to find the missing information.',
			},
		},
		required: ['searchQuery'],
	},
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
			},
		});

		if (response.functionCalls && response.functionCalls.length > 0) {
			// @ts-expect-error
			return response.functionCalls[0].args.searchQuery as string;
		}
		return null;
	} catch (error) {
		console.error('Agent Router Error:', error);
		return null;
	}
}

export async function searchTavily(query: string): Promise<{ url: string; title: string; content: string }[]> {
	const response = await fetch('https://api.tavily.com/search', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({
			api_key: process.env.TAVILY_API_KEY,
			query: query,
			search_depth: 'advanced',
		}),
	});

	const data = await response.json();
	if (!data.results) {
		return [];
	}

	return data.results.map((r: { url: string; title: string; content: string }) => ({
		url: r.url,
		title: r.title,
		content: r.content,
	}));
}

export async function askGeminiForWikiOperations(prompt: string): Promise<{ filename: string; frontmatter: { type?: string; tags?: string[]; aliases?: string[] }; content: string; action: string; summary: string; sources: string[] }[]> {
	const systemInstruction = await getSystemInstruction();
	const dynamicSchema = await getWikiOperationSchema();

	try {
		const response = await ai.models.generateContent({
			model: MODEL_NAME,
			contents: prompt,
			config: {
				systemInstruction: systemInstruction,
				temperature: 0.2,
				responseMimeType: 'application/json',
				responseSchema: dynamicSchema,
			},
		});

		return JSON.parse(response.text || '[]');
	} catch (error) {
		console.error('Gemini API Error:', error);
		return [];
	}
}

export async function logOperation(action: string, details: string): Promise<void> {
	fs.mkdir(path.dirname(LOG_PATH), {
		recursive: true,
	}).catch(console.error);
	const timestamp = new Date().toISOString();
	const logEntry = `\n## [${timestamp}] ${action}\n${details}\n`;
	await fse.appendFile(LOG_PATH, logEntry, 'utf8');
	console.log(`[Logged] ${action}`);
}

export async function getEmbedding(text: string): Promise<number[]> {
	try {
		const response = await ai.models.embedContent({
			model: 'gemini-embedding-001',
			contents: text,
		});
		// @ts-expect-error
		return response.embeddings[0].values || [];
	} catch (error) {
		console.error('Embedding API Error:', error);
		return [];
	}
}

const querySchema: Schema = {
	type: Type.OBJECT,
	properties: {
		slug: {
			type: Type.STRING,
			description: 'A 3-4 word kebab-case summary of the query.',
		},
		answer: {
			type: Type.STRING,
			description: 'The synthesized markdown answer. Do not include a sources section here. Headers should start at level two.',
		},
		sources: {
			type: Type.ARRAY,
			description: 'A list of exact source URLs or [[archive-links]] found in the context.',
			items: {
				type: Type.STRING,
			},
		},
	},
	required: ['slug', 'answer', 'sources'],
};

export async function askGeminiForQuery(prompt: string): Promise<{ slug: string; answer: string; sources: string[] } | null> {
	const systemInstruction = await getSystemInstruction();
	try {
		const response = await ai.models.generateContent({
			model: MODEL_NAME,
			contents: prompt,
			config: {
				systemInstruction: systemInstruction,
				temperature: 0.3,
				responseMimeType: 'application/json',
				responseSchema: querySchema,
			},
		});
		return JSON.parse(response.text || 'null');
	} catch (error) {
		console.error('Gemini API Error:', error);
		return null;
	}
}
