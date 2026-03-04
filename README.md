<h1 align="center">RepoLens</h1>
<p align="center"><strong>AI-powered GitHub repository analysis — just add <code>m</code> before any github.com URL</strong></p>

<p align="center">
  <a href="https://github.com/zebbern/repolens/stargazers"><img src="https://img.shields.io/github/stars/zebbern/repolens?style=flat&color=f5a623" alt="GitHub Stars" /></a>
  <a href="https://github.com/zebbern/repolens/releases/latest"><img src="https://img.shields.io/github/v/release/zebbern/repolens" alt="Latest Release" /></a>
  <a href="https://github.com/zebbern/repolens"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="MIT License" /></a>
</p>

<p align="center">
  <a href="https://mgithub.com">Website</a> · <a href="#quick-start">Quick Start</a> · <a href="#features">Features</a> ·  <a href="#supported-ai-providers">AI Providers</a>
</p>

https://github.com/user-attachments/assets/b8e775c1-0b64-4c0d-a58f-0a66b784496c


> **Pro tip:** Turn any GitHub URL into a RepoLens analysis by adding **`m`** before `github.com`.
> For example: `github.com/facebook/react` → [`mgithub.com/VrianCao/Uptimer`](https://mgithub.com/VrianCao/Uptimer)

---

<video src="repolens-show.mp4" controls width="100%"></video>


## Features

- **Repository Overview** — Instant project summary, tech stack detection, and interactive file tree visualization
- **Code Browser** — Syntax-highlighted source viewer powered by Shiki, with file outline and breadcrumb navigation
- **Issues Scanner** — Automated code quality analysis that detects security vulnerabilities, performance problems, and best practice violations
- **Diagrams** — Auto-generated architecture diagrams using Mermaid.js — dependency graphs, component relationships, and more
- **Documentation Generator** — AI-powered docs generation including README, Architecture Overview, API Reference, and Contributing Guide
- **AI Chat** — Ask questions about any codebase with full context awareness and 9 specialized AI tools for deep analysis
- **Compare** — Side-by-side repository comparison to evaluate alternatives

---

## How It Works

1. Navigate to `mgithub.com/owner/repo` (or paste any GitHub URL on the homepage)
2. RepoLens fetches the entire repo via GitHub's Zipball API in a single download
3. Files are indexed and cached in IndexedDB for instant repeat visits
4. All tabs become available — browse code, scan issues, generate docs, chat with AI

---

## Supported AI Providers

RepoLens works with multiple AI providers. You configure API keys directly in the app — no environment variables needed.

| Provider | Example Models |
|---|---|
| **OpenAI** | Latest Models |
| **Google** | Latest Models |
| **Anthropic** | Latest Models |
| **OpenRouter** | Latest Models |

---

## Quick Start

### Prerequisites

| Requirement | Install | Verify |
|---|---|---|
| **Node.js 18+** | [nodejs.org](https://nodejs.org) | `node -v` |
| **pnpm** | [pnpm.io](https://pnpm.io/installation) | `pnpm -v` |
| **AI API key** | At least one: [OpenAI](https://platform.openai.com/api-keys), [Google AI](https://aistudio.google.com/apikey), [Anthropic](https://console.anthropic.com/settings/keys), or [OpenRouter](https://openrouter.ai/keys) | — |

### Setup

```bash
git clone https://github.com/zebbern/repolens.git
cd repolens/workproject
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000), click the **gear icon** (Settings), and enter your API key(s).

### Environment Variables (Optional)

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_AUTH_ENABLED=true` | Enable authentication (requires NextAuth setup) |

AI keys are configured in the UI — no environment variables required for basic usage.

---

## Usage

| Action | How |
|---|---|
| Analyze a repo | Add `m` before any `github.com` URL → `mgithub.com/owner/repo` |
| Paste a URL | Enter any GitHub repo URL on the [homepage](https://mgithub.com) |
| Browse code | Open the **Code** tab to view syntax-highlighted files with outline navigation |
| Scan for issues | Open the **Issues** tab for automated security and quality analysis |
| Generate docs | Open the **Docs** tab and select a document type |
| Chat with AI | Open the **Chat** tab and ask questions about the codebase |
| Compare repos | Navigate to the **Compare** tab to evaluate repositories side-by-side |

---

## Tech Stack

| Category | Technology |
|---|---|
| Framework | [Next.js 15](https://nextjs.org) (App Router) |
| UI | [React 19](https://react.dev), [Tailwind CSS](https://tailwindcss.com), [shadcn/ui](https://ui.shadcn.com) |
| Language | [TypeScript 5](https://www.typescriptlang.org) |
| AI | [Vercel AI SDK v6](https://sdk.vercel.ai) |
| Diagrams | [Mermaid.js](https://mermaid.js.org) |
| Syntax highlighting | [Shiki](https://shiki.style) |
| Repo extraction | [JSZip](https://stuk.github.io/jszip/) |
| Testing | [Vitest](https://vitest.dev), [Playwright](https://playwright.dev) |
| Deployment | [Vercel](https://vercel.com) |

---

## Contributing

1. Fork the repo and create a branch.
2. Make your changes.
3. Run `pnpm test` to verify.
4. Open a pull request.

