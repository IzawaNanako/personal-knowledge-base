import * as fs from 'fs-extra';
import * as path from 'path';
import { glob } from 'glob';
import { askGeminiForWikiOperations, logOperation } from './lib';

const RAW_DIR = path.join(process.cwd(), 'raw');
const WIKI_DIR = path.join(process.cwd(), 'wiki');
const ARCHIVE_DIR = path.join(process.cwd(), 'archive');

async function ingestFiles() {
    console.log('Starting ingestion process...');
    await fs.ensureDir(RAW_DIR);
    await fs.ensureDir(WIKI_DIR);
    await fs.ensureDir(ARCHIVE_DIR);

    const files = await glob('*.md', {
        cwd: RAW_DIR,
    });
    
    if (files.length === 0) {
        return console.log('No new files found in /raw.');
    }

    for (const file of files) {
        console.log(`\nProcessing: ${file}`);
        const rawPath = path.join(RAW_DIR, file);
        const rawContent = await fs.readFile(rawPath, 'utf8');
        
        const prompt = `
Please ingest the following raw content.
Extract key concepts and return the structured JSON operations to update the wiki.

<RawContent>
${rawContent}
</RawContent>
        `;

        const operations = await askGeminiForWikiOperations(prompt);

        if (operations.length === 0) {
            console.log(`No operations generated for ${file}. Skipping.`);
            continue;
        }

        for (const op of operations) {
            const targetPath = path.join(WIKI_DIR, op.filename);
            const fileExists = await fs.pathExists(targetPath);

            if (fileExists || op.action === 'update') {
                const appendContent = `\n\n## Additional Context\n${op.content}`;
                await fs.appendFile(targetPath, appendContent, 'utf8');
                console.log(`-> [APPENDED] ${op.filename}`);
            }
            else {
                await fs.writeFile(targetPath, op.content, 'utf8');
                console.log(`-> [CREATED] ${op.filename}`);
            }
        }
        
        const archivePath = path.join(ARCHIVE_DIR, file);
        await fs.move(rawPath, archivePath, {
            overwrite: true,
        });
        
        await logOperation('Ingestion', `Processed ${file}. Modified ${operations.length} wiki files.`);
        console.log(`Successfully archived ${file}`);
    }
}

ingestFiles();
