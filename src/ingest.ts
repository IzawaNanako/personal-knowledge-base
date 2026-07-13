import fs from 'node:fs/promises';
import path from 'node:path';
import fse from 'fs-extra';
import { glob } from 'glob';
import { askGeminiForWikiOperations, buildContentWithTemplate, buildYamlFrontmatter, logOperation } from './lib.js';

const RAW_DIR = path.join(process.cwd(), 'raw');
const WIKI_DIR = path.join(process.cwd(), 'wiki');
const ARCHIVE_DIR = path.join(process.cwd(), 'archive');
const TEMPLATES_DIR = path.join(process.cwd(), 'templates');

async function autoLinkNewConcepts(newSlugs: string[]) {
	if (newSlugs.length === 0) {
		return;
	}
	console.log('\nAuto-linking new concepts across the vault...');

	const files = await glob('**/*.md', { cwd: WIKI_DIR, ignore: ['**/log.md', '**/index.md'] });

	const matchers = newSlugs.map(slug => ({
		slug,
		regex: new RegExp(`(?<!\\[\\[)\\b(${slug.replace(/-/g, ' ')})\\b(?!\\]\\]|\\|)`, 'gi'),
	}));

	for (const file of files) {
		const filePath = path.join(WIKI_DIR, file);
		let content = await fs.readFile(filePath, 'utf8');
		let modified = false;

		for (const m of matchers) {
			if (file.includes(m.slug)) {
				continue;
			}
			content = content.replace(m.regex, (match) => {
				modified = true;
				return `[[${m.slug}|${match}]]`;
			});
		}

		if (modified) {
			await fs.writeFile(filePath, content, 'utf8');
		}
	}
}

/**
 * Ingests files from the raw directory and updates the wiki.
 */
async function ingestFiles(): Promise<void> {
	console.log('Starting ingestion process...');
	await fse.ensureDir(RAW_DIR);
	await fse.ensureDir(WIKI_DIR);
	await fse.ensureDir(ARCHIVE_DIR);
	await fse.ensureDir(TEMPLATES_DIR);

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
			const typeFolder = op.frontmatter?.type && op.frontmatter.type !== 'none' ? op.frontmatter.type.toLowerCase() : '';
			const targetDir = path.join(WIKI_DIR, typeFolder);
			await fse.ensureDir(targetDir);

			const targetPath = path.join(targetDir, op.filename);
			const fileExists = await fse.pathExists(targetPath);
			const indexPath = path.join(WIKI_DIR, 'index.md');

			const sourceFooter = `\n\n> **Source:** [[${file}]] (Archived)`;

			if (fileExists || op.action === 'update') {
				const appendContent = `\n\n## Additional Context\n${op.content}${sourceFooter}`;
				await fse.appendFile(targetPath, appendContent, 'utf8');
				console.log(`-> [APPENDED] ${op.filename}`);
				continue;
			}

			const finalContent = await buildContentWithTemplate(op);
			await fs.writeFile(targetPath, finalContent + sourceFooter, 'utf8');
			console.log(`-> [CREATED] ${op.filename}`);

			const yamlBlock = buildYamlFrontmatter(op.frontmatter);
			await fs.writeFile(targetPath, yamlBlock + op.content + sourceFooter, 'utf8');
			console.log(`-> [CREATED] ${op.filename}`);

			const indexEntry = `- [[${op.filename.replace('.md', '')}]] : ${op.summary}\n`;
			await fse.appendFile(indexPath, indexEntry, 'utf8');
			console.log(`-> [INDEXED] Added to Master Index`);
		}

		const archivePath = path.join(ARCHIVE_DIR, file);
		await fse.move(rawPath, archivePath, {
			overwrite: true,
		});

		await logOperation('Ingestion', `Processed ${file}. Modified ${operations.length} wiki files.`);
		console.log(`Successfully archived ${file}`);

		await autoLinkNewConcepts(operations.map(op => op.filename.replace('.md', '')));
	}
}

await ingestFiles();
