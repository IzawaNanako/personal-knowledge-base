import * as fs from 'fs-extra';
import * as path from 'path';
import { glob } from 'glob';
import { logOperation, getEmbedding, askGeminiForQuery } from './lib';

const WIKI_DIR = path.join(process.cwd(), 'wiki');
const OUTPUT_DIR = path.join(process.cwd(), 'output');

function cosineSimilarity(vecA: number[], vecB: number[]) {
    let dotProduct = 0, normA = 0, normB = 0;
    for (let i = 0; i < vecA.length; i++) {
        dotProduct += vecA[i] * vecB[i];
        normA += vecA[i] * vecA[i];
        normB += vecB[i] * vecB[i];
    }
    if (normA === 0 || normB === 0) {
        return 0;
    }
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

async function runQuery() {
    const question = process.argv.slice(2).join(' ');
    if (!question) {
        console.log('Please provide a question. Usage: npm run query "your question"');
        return;
    }

    console.log(`Querying Wiki for: '${question}'`);
    await fs.ensureDir(OUTPUT_DIR);

    const wikiFiles = await glob('**/*.md', { cwd: WIKI_DIR });
    if (wikiFiles.length === 0) {
        return console.log('Wiki is empty!');
    }

    console.log('Analyzing files...');
    const queryEmbedding = await getEmbedding(question);
    
    const scoredFiles = [];
    for (const file of wikiFiles) {
        const content = await fs.readFile(path.join(WIKI_DIR, file), 'utf8');
        const fileEmbedding = await getEmbedding(content);
        const score = cosineSimilarity(queryEmbedding, fileEmbedding);
        scoredFiles.push({ file, content, score });
    }

    scoredFiles.sort((a, b) => b.score - a.score);
    const topFiles = scoredFiles.slice(0, 3);

    let contextWindow = '';
    for (const { file, content, score } of topFiles) {
        console.log(`-> Injecting context: ${file} (Match Score: ${(score * 100).toFixed(1)}%)`);
        contextWindow += `\n\n--- Start of ${file} ---\n${content}\n--- End of ${file} ---`;
    }

const prompt = `
Please answer the user's query based ONLY on the provided Wiki content.
Synthesize the answer and include specific citations to the source files.
CRITICAL: Format all citations as Obsidian wikilinks without the .md extension. Example: [[okumura-hata-notes]]

<UserQuery>
${question}
</UserQuery>

<WikiDatabase>
${contextWindow}
</WikiDatabase>
    `;

    try {
        const result = await askGeminiForQuery(prompt);
        
        if (!result) {
            return console.log("Failed to generate an answer.");
        }

        const outputFilename = `${result.slug}_${Date.now()}.md`;
        
        const finalOutput = `# Query: ${question}\n\n${result.answer}`;

        await fs.writeFile(path.join(OUTPUT_DIR, outputFilename), finalOutput);
        
        await logOperation('Query', `Asked: "${question}". Result saved to ${outputFilename}`);
        console.log(`\nAnswer generated and saved to ${outputFilename}`);

    }
    catch (error) {
         console.error('Error generating answer:', error);
    }
}

runQuery();
