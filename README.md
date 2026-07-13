# Autonomous Personal Knowledge Base

This project is an AI-driven knowledge management system designed to operate directly within an [Obsidian](https://obsidian.md/) vault. Powered by the Gemini API and Tavily for web research, the system acts as an autonomous maintainer that ingests raw documents, synthesizes complex concepts, and dynamically answers queries by generating fully cited Markdown output. The core design goal of this project is strict simplicity: no bloated features, just seamless and autonomous knowledge management.

## Architecture & Directory Structure

The repository acts as a self-contained Obsidian vault with specific directories dedicated to the AI's workflow:

- **`/raw`**: The staging area for immutable local source documents waiting to be processed.
- **`/archive`**: The storage location for processed local documents and raw HTML/text downloaded autonomously from web searches.
- **`/wiki`**: The compiled knowledge base. The AI extracts concepts and writes interconnected Markdown files here.
- **`/wiki/index.md`**: The Master Index. A lightweight table of contents containing one-line summaries of every synthesized concept.
- **`/output`**: The destination directory for synthesized answers when the user queries the knowledge base.

_The included `.obsidian` configuration automatically hides operational files to ensure a clean, distraction-free reading experience focused strictly on your knowledge directories._

## Core Operations

### 1. Ingestion

The system processes raw content, consolidating related concepts into comprehensive Markdown files rather than fragmenting them. It automatically generates concise summaries for the Master Index and extracts source links strictly into a structured metadata array.

### 2. Querying & Synthesis

When queried, the system acts as an Agent Router. It evaluates existing local data and the Master Index. If local knowledge is insufficient, it autonomously triggers a web search via Tavily to scrape and ingest missing context. The final output is synthesized purely from local and retrieved context, utilizing strict citations mapped to the archive.

### 3. Wiki Linting

The system can perform health checks on the wiki, scanning for broken or orphan links, identifying frequently mentioned concepts that lack dedicated pages, and detecting contradictory statements across different files.

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v16.x or higher)
- [Obsidian](https://obsidian.md/)
- A [Gemini API Key](https://aistudio.google.com/)
- A [Tavily API Key](https://tavily.com/)

### Installation

1. Clone the repository:

   ```bash
   git clone https://github.com/IzawaNanako/personal-knowledge-base.git
   cd personal-knowledge-base
   ```

2. Install Dependencies:

   ```bash
   npm install
   ```

3. Build the project:

   ```bash
   npm run build
   ```

4. Configure Environment Variables:
   Rename the `.env.example` file to `.env` and populate it with your API credentials:

   ```bash
   cp .env.example .env
   ```

   | Variable         | Description                                                  | Required |
   | ---------------- | ------------------------------------------------------------ | -------- |
   | `GEMINI_API_KEY` | Your Google Gemini API Key.                                  | Yes      |
   | `MODEL_NAME`     | The specific Gemini model to use (e.g., `gemini-3.5-flash`). | Yes      |
   | `TAVILY_API_KEY` | Your Tavily API Key for autonomous web searches.             | Yes      |

5. Obsidian Integration:

- Open the Obsidian application.
- Select **"Open folder as vault"** and select the cloned repository folder.
- Trust the workspace when prompted to ensure the pre-configured community plugins load correctly.
- The custom Terminal plugin will be available directly within Obsidian to execute your AI commands.

### Usage

Interact with the knowledge base using the terminal plugin inside Obsidian (or your standard system terminal).

#### Ingesting Documents

Place your raw text or Markdown files into the `/raw` directory, then run the ingest command. The system will process all files in the directory, synthesize the data into the `/wiki`, and move the originals to the `/archive`.

```bash
npm run ingest
```

#### Querying the Knowledge Base

Ask a question or request a synthesis. The AI will search the wiki, perform web research if necessary, and generate a highly detailed, cited response in the `/output` folder.

```bash
npm run query Your question or prompt here
```

#### Auto-Linking Unlinked Mentions

Run the maintenance script to perform a vault-wide scan. It finds natural language mentions of your wiki topics and automatically converts them into strict Obsidian `[[links]]` to enrich your graph view.

```bash
npm run mentions
```

## License

This project is licensed under the GPL-3.0 License - see [LICENSE](https://github.com/IzawaNanako/personal-knowledge-base/blob/main/LICENSE) for details.
