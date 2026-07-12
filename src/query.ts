import fs from 'node:fs/promises';
import path from 'node:path';
import fse from 'fs-extra';
import { glob } from 'glob';
import { askGeminiForQuery, askGeminiForWikiOperations, checkNeedForSearch, getEmbedding, logOperation, searchTavily } from './lib.js';

const WIKI_DIR = path.join(process.cwd(), 'wiki');
const OUTPUT_DIR = path.join(process.cwd(), 'output');

function cleanUrl(rawUrl: string): string {
	try {
		const url = new URL(rawUrl);

		const trackingParams = [
			'srsltid',
			'gclid',
			'fbclid',
			'igshid',
			'twclid',
			'msclkid',
			'utm_source',
			'utm_medium',
			'utm_campaign',
			'utm_term',
			'utm_content',
			'mc_cid',
			'mc_eid',
			'_bta_tid',
			'_bta_c',
		];

		trackingParams.forEach(param => {
			url.searchParams.delete(param);
		});

		return url.toString();
	} catch (error) {
		console.error('Error occurred while cleaning URL:', error);
		return rawUrl;
	}
}

function cosineSimilarity(vecA: number[], vecB: number[]): number {
	let dotProduct = 0, normA = 0, normB = 0;
	for (let i = 0; i < vecA.length; i++) {
		const a = vecA[i] ?? 0;
		const b = vecB[i] ?? 0;
		dotProduct += a * b;
		normA += a * a;
		normB += b * b;
	}
	if (normA === 0 || normB === 0) {
		return 0;
	}
	return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

function sanitizeUrlToFilename(url: string): string {
	return `${url.replace(/^https?:\/\//, '').replace(/[^a-z0-9]/gi, '-').substring(0, 50).toLowerCase()}.md`;
}

/**
 * Processes a user query and retrieves relevant information from the wiki into an output file.
 * @param { boolean } hasSearched Indicates if a web search has already been performed.
 */
async function processQuery(question: string, hasSearched: boolean = false): Promise<void> {
	console.log(`\nQuerying Wiki for: "${question}"`);
	await fse.ensureDir(WIKI_DIR);
	await fse.ensureDir(OUTPUT_DIR);

	const wikiFiles = await glob('**/*.md', {
		cwd: WIKI_DIR,
		ignore: ['**/log.md', '**/index.md'],
	});

	let indexContent = 'Index is currently empty.';
	try {
		indexContent = await fse.readFile(path.join(WIKI_DIR, 'index.md'), 'utf8');
	} catch (error) {
		console.error('Error reading index.md:', error);
	}

	const queryEmbedding = await getEmbedding(question);
	const scoredFiles = [];

	for (const file of wikiFiles) {
		const content = await fse.readFile(path.join(WIKI_DIR, file), 'utf8');
		const fileEmbedding = await getEmbedding(content);
		const score = cosineSimilarity(queryEmbedding, fileEmbedding);
		scoredFiles.push({ file, content, score });
	}

	scoredFiles.sort((a, b) => b.score - a.score);
	const topFiles = scoredFiles.slice(0, 3);

	let contextWindow = '';
	for (const { file, content, score } of topFiles) {
		console.log(`-> Found local context: ${file} (Match: ${(score * 100).toFixed(1)}%)`);
		contextWindow += `\n\n--- Start of ${file} ---\n${content}\n--- End of ${file} ---`;
	}

	if (!hasSearched) {
		const routerPrompt = `
        Evaluate the current user query against the provided local context and Master Index. 
        Determine if a 'search_web' tool call is required based on your "Query" operating rules.

        User Query: ${question}

        <MasterIndex>
        ${indexContent}
        </MasterIndex>

        <RelevantDeepContext>
        ${contextWindow}
        </RelevantDeepContext>
        `;

		const searchNeeded = await checkNeedForSearch(routerPrompt);

		if (searchNeeded) {
			console.log(`\nAI decided local context is insufficient. Initiating Web Search...`);
			const webResultsRaw = await searchTavily(searchNeeded);
			const uniqueResults = new Map();
			for (const page of webResultsRaw) {
				const cleanAndSafeUrl = cleanUrl(page.url);

				if (!uniqueResults.has(cleanAndSafeUrl)) {
					uniqueResults.set(cleanAndSafeUrl, {
						...page,
						url: cleanAndSafeUrl,
					});
				}
			}
			const webResults = Array.from(uniqueResults.values());
			const ARCHIVE_DIR = path.join(process.cwd(), 'archive');
			await fse.ensureDir(ARCHIVE_DIR);

			console.log(`\nArchiving and Ingesting new web knowledge...`);

			for (const page of webResults) {
				const safeFilename = sanitizeUrlToFilename(page.url);
				const archivePath = path.join(process.cwd(), 'archive', safeFilename);
				const rawContentToSave = `# ${page.title}\n**Original URL:** ${page.url}\n\n${page.content}`;
				await fs.writeFile(archivePath, rawContentToSave, 'utf8');
				console.log(`-> [ARCHIVED] ${safeFilename}`);
			}

			const batchFeed = webResults.map(p => `Source: [[${sanitizeUrlToFilename(p.url)}]]\nContent: ${p.content}`).join('\n\n---\n\n');

			const batchPrompt = `
            Please ingest the following web research results. 
            Extract key concepts and return the structured JSON operations to update the wiki.

            <ResearchFeed>
            ${batchFeed}
            </ResearchFeed>
            `;

			const operations = await askGeminiForWikiOperations(batchPrompt);

			if (operations && operations.length > 0) {
				for (const op of operations) {
					const targetPath = path.join(WIKI_DIR, op.filename);
					const fileExists = await fse.pathExists(targetPath);

					const footerLinks = op.sources.map((s: string) => `\n- ${s.trim()}`).join('');
					const sourceFooter = `\n\n## Sources${footerLinks}\n(Web Archive)`;

					if (fileExists || op.action === 'update') {
						const timestamp = new Date().toISOString();
						const appendContent = `\n\n## Web Context (${timestamp})\n${op.content}${sourceFooter}`;
						await fse.appendFile(targetPath, appendContent, 'utf8');
						console.log(`   -> [WEB-APPENDED] ${op.filename}`);
					} else {
						await fs.writeFile(targetPath, op.content + sourceFooter, 'utf8');
						console.log(`   -> [WEB-CREATED] ${op.filename}`);

						const indexPath = path.join(WIKI_DIR, 'index.md');
						const indexEntry = `- [[${op.filename.replace('.md', '')}]] : ${op.summary}\n`;
						await fse.appendFile(indexPath, indexEntry, 'utf8');
					}
				}
			}

			console.log('\nKnowledge base updated! Restarting query...');
			return processQuery(question, true);
		}
	}

	console.log(`\nSynthesizing final answer...`);
	const finalPrompt = `
    Synthesize the final answer for the user based on the provided context. 
    Remember to populate the 'sources' array with relevant [[Archive-Links]] as per your Operating Manual.

    <UserQuery>${question}</UserQuery>

    <MasterIndex>
    ${indexContent}
    </MasterIndex>

    <RelevantDeepContext>
    ${contextWindow}
    </RelevantDeepContext>
    `;

	try {
		const result = await askGeminiForQuery(finalPrompt);
		if (!result) {
			return console.log('Failed to generate an answer.');
		}

		const outputFilename = `${result.slug}_${Date.now()}.md`;

		let finalOutput = `# Query: ${question}\n\n${result.answer}`;

		if (result.sources && result.sources.length > 0) {
			finalOutput += `\n\n## Sources\n`;
			result.sources.forEach(source => {
				finalOutput += `- ${source.trim()}\n`;
			});
		}

		await fs.writeFile(path.join(OUTPUT_DIR, outputFilename), finalOutput);
		await logOperation('Query', `Asked: "${question}". Result saved to ${outputFilename}`);
		console.log(`\nAnswer generated and saved to ${outputFilename}`);
	} catch (error) {
		console.error('Error generating answer:', error);
	}
}

function isQuestionValid(question: string): boolean {
	if (!question) {
		console.log('Please provide a question. Usage: npm run query "your question"');
		return false;
	}
	return true;
}

const userQuestion = process.argv.slice(2).join(' ');

if (isQuestionValid(userQuestion)) {
	await processQuery(userQuestion);
}
