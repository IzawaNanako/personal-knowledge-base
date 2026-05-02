import * as fs from 'fs-extra';
import * as path from 'path';
import { glob } from 'glob';
import { askGemini, logOperation } from './lib';

const WIKI_DIR = path.join(process.cwd(), 'wiki');
const OUTPUT_DIR = path.join(process.cwd(), 'output');

async function runQuery() {
    const question = process.argv.slice(2).join(" ");
    if (!question) {
        console.log("Please provide a question. Usage: npx tsx src/query.ts 'your question'");
        return;
    }

    console.log(`Querying Wiki for: "${question}"`);
    await fs.ensureDir(OUTPUT_DIR);

    let wikiContent = "";
    const wikiFiles = await glob('**/*.md', { cwd: WIKI_DIR });
    
    for (const file of wikiFiles) {
        const content = await fs.readFile(path.join(WIKI_DIR, file), 'utf8');
        wikiContent += `\n\n--- Start of ${file} ---\n${content}\n--- End of ${file} ---`;
    }

    const prompt = `
Please answer the user's query based ONLY on the provided Wiki content.
Follow your Query rules: Synthesize the answer and include specific citations to the source files.

<UserQuery>
${question}
</UserQuery>

<WikiDatabase>
${wikiContent}
</WikiDatabase>
    `;

    try {
        const answer = await askGemini(prompt);
        const outputFilename = `query_${Date.now()}.md`;

        await fs.writeFile(path.join(OUTPUT_DIR, outputFilename), answer);
        
        await logOperation('Query', `Asked: "${question}". Result saved to ${outputFilename}`);
        console.log(`Answer generated and saved to ${outputFilename}!`);

    } catch (error) {
         console.error('Error generating answer:', error);
    }
}

runQuery();
