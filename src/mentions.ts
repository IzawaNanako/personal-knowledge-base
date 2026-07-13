import fs from 'node:fs/promises';
import path from 'node:path';
import { glob } from 'glob';

const WIKI_DIR = path.join(process.cwd(), 'wiki');

async function linkUnlinkedMentions(): Promise<void> {
	console.log('Scanning for unlinked mentions...');

	const files = await glob('**/*.md', {
		cwd: WIKI_DIR,
		ignore: ['**/log.md', '**/index.md'],
	});

	const concepts = files.map(file => {
		const slug = file.replace('.md', '');
		const naturalName = slug.replace(/-/g, ' ');
		return {
			slug,
			regex: new RegExp(`(?<!\\[\\[)\\b(${naturalName})\\b(?!\\]\\]|\\|)`, 'gi'),
		};
	});

	let totalLinksAdded = 0;

	for (const file of files) {
		const filePath = path.join(WIKI_DIR, file);
		let content = await fs.readFile(filePath, 'utf8');
		let modified = false;

		for (const concept of concepts) {
			if (file.includes(concept.slug)) {
				continue;
			}

			const newContent = content.replace(concept.regex, (match) => {
				modified = true;
				totalLinksAdded++;
				return `[[${concept.slug}|${match}]]`;
			});

			content = newContent;
		}

		if (modified) {
			await fs.writeFile(filePath, content, 'utf8');
			console.log(`-> [LINKED] Updated mentions in ${file}`);
		}
	}

	console.log(`\nFinished! Added ${totalLinksAdded} new bi-directional links. ❤️`);
}

await linkUnlinkedMentions();
