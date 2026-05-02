import * as fs from 'fs-extra';
import * as path from 'path';
import { glob } from 'glob';
import { askGemini, logOperation } from './lib';

const RAW_DIR = path.join(process.cwd(), 'raw');
const WIKI_DIR = path.join(process.cwd(), 'wiki');

async function ingestFiles() {
    console.log('Starting ingestion process...');
    await fs.ensureDir(RAW_DIR);
    await fs.ensureDir(WIKI_DIR);

    const files = await glob('**/*.md', { cwd: RAW_DIR });
    
    if (files.length === 0) {
        console.log('No new files found in /raw.');
        return;
    }

    const targetFile = files[0];
    const rawContent = await fs.readFile(path.join(RAW_DIR, targetFile), 'utf8');
    
    console.log(`Processing: ${targetFile}`);

    const prompt = `
Please ingest the following raw content according to the Ingestion rules in your system instructions.
Extract key concepts, create a structured markdown response that I can save to the wiki.

<RawContent>
${rawContent}
</RawContent>
    `;

    try {
        const result = await askGemini(prompt);
        const outputFilename = `ingested_${Date.now()}.md`;
        await fs.writeFile(path.join(WIKI_DIR, outputFilename), result);
        
        await logOperation('Ingestion', `Processed ${targetFile}. Created Wiki entry: ${outputFilename}`);
        console.log(`Successfully ingested into ${outputFilename}`);
    }
    catch (error) {
        console.error('Error during ingestion:', error);
    }
}

ingestFiles();
