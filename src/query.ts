import * as fs from 'fs-extra';
import * as path from 'path';
import { glob } from 'glob';
import { askGeminiForQuery, logOperation, getEmbedding, checkNeedForSearch, searchTavily, askGeminiForWikiOperations } from './lib';

const WIKI_DIR = path.join(process.cwd(), 'wiki');
const OUTPUT_DIR = path.join(process.cwd(), 'output');

function cleanUrl(rawUrl: string): string {
    try {
        const url = new URL(rawUrl);
        
        const trackingParams = [
            'srsltid', 'gclid', 'fbclid', 'igshid', 'twclid', 'msclkid',
            'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
            'mc_cid', 'mc_eid', '_bta_tid', '_bta_c'
        ];

        trackingParams.forEach(param => url.searchParams.delete(param));

        return url.toString();
    }
    catch (e) {
        return rawUrl; 
    }
}

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

function sanitizeUrlToFilename(url: string) {
    return url.replace(/^https?:\/\//, '').replace(/[^a-z0-9]/gi, '-').substring(0, 50).toLowerCase() + '.md';
}

async function processQuery(question: string, hasSearched = false) {
    console.log(`\nQuerying Wiki for: "${question}"`);
    await fs.ensureDir(OUTPUT_DIR);

    const wikiFiles = await glob('**/*.md', { 
        cwd: WIKI_DIR, 
        ignore: ['**/log.md', '**/index.md'] 
    });
    
    let indexContent = "Index is currently empty.";
    try {
        indexContent = await fs.readFile(path.join(WIKI_DIR, 'index.md'), 'utf8');
    } 
    catch (e) {}
    
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

    let contextWindow = "";
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
            console.log(`\n🧠 AI decided local context is insufficient. Initiating Web Search...`);
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
            await fs.ensureDir(ARCHIVE_DIR);
            
            console.log(`\nArchiving and Ingesting new web knowledge...`);
            
            for (const page of webResults) {
                const safeFilename = sanitizeUrlToFilename(page.url);
                const archivePath = path.join(ARCHIVE_DIR, safeFilename);
                
                const rawContentToSave = `# ${page.title}\n**Original URL:** ${page.url}\n\n${page.content}`;
                await fs.writeFile(archivePath, rawContentToSave, 'utf8');
                console.log(`-> [ARCHIVED] Saved raw web data to ${safeFilename}`);

                const ingestPrompt = `
                Process the following raw content according to the "Ingest" rules in your Operating Manual.
                Ensure you return the JSON operations for any new or updated wiki pages.

                <RawContent>
                ${rawContentToSave}
                </RawContent>
                `;
                
                const operations = await askGeminiForWikiOperations(ingestPrompt);
                
                if (operations && operations.length > 0) {
                    for (const op of operations) {
                        const targetPath = path.join(WIKI_DIR, op.filename);
                        const fileExists = await fs.pathExists(targetPath);
                        const indexPath = path.join(WIKI_DIR, 'index.md');

                        const sourceFooter = `\n\n> **Source:** [[${safeFilename}]] (Web Archive) - ${page.url}`;

                        if (fileExists || op.action === 'update') {
                            await fs.appendFile(targetPath, `\n\n## Web Context (${new Date().toISOString()})\n${op.content}${sourceFooter}`, 'utf8');
                            console.log(`   -> [WEB-APPENDED] ${op.filename}`);
                        }
                        else {
                            await fs.writeFile(targetPath, op.content + sourceFooter, 'utf8');
                            console.log(`   -> [WEB-CREATED] ${op.filename}`);
                            
                            const indexEntry = `- [[${op.filename.replace('.md', '')}]] : ${op.summary}\n`;
                            await fs.appendFile(indexPath, indexEntry, 'utf8');
                        }
                    }
                }
            }
            
            console.log("\nKnowledge base updated! Restarting query...");
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
            return console.log("Failed to generate an answer.");
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

    }
    catch (error) {
         console.error('Error generating answer:', error);
    }
}

const userQuestion = process.argv.slice(2).join(' ');
if (!userQuestion) {
    console.log('Please provide a question. Usage: npm run query "your question"');
}
else {
    processQuery(userQuestion);
}
