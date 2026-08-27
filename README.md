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
- **Documentation Generator** — AI-powered docs generation with 6 presets, including Architecture, Setup, API Reference, File Explanation, Onboarding, and Custom
- **AI Chat** — Ask questions about a selected codebase with 15 progressively available analysis and skill tools
- **Pull Requests** — Browse pull requests, changed files, and diffs without requiring indexed source content
- **Code Tours** — Build deterministic local walkthroughs from repository paths and symbols; use Chat for AI-authored walkthroughs
- **Compare** — Side-by-side repository comparison with similarity/clone detection scoring to evaluate alternatives
- **Git Insights** — Coding hours estimation, activity punchcard, and per-author contribution charts derived from commit history

---

## How It Works

1. Navigate to `mgithub.com/owner/repo` (or paste any GitHub URL on the homepage)
2. RepoLens resolves the Git tree adaptively and reports when GitHub returns a truncated or partial result
3. Supported content is loaded through a ZIP or per-file fallback; very large repositories load content on demand
4. Complete, failure-free indexes can be cached in IndexedDB for repeat visits; the coverage banner reports what was discovered and loaded

---

## Supported AI Providers

RepoLens supports 4 AI providers. You configure API keys directly in the app — no environment variables needed.

| Provider | Example Models |
|---|---|
| **OpenAI** | Latest Models |
| **Google** | Latest Models |
| **Anthropic** | Latest Models |
| **OpenRouter** | Latest Models |

---

## GitHub Personal Access Token

Add a GitHub Personal Access Token (PAT) to access **private repositories** and raise GitHub's account-level API limit from 60 to **5,000 requests/hour**. RepoLens applies separate endpoint-specific proxy limits. The PAT is stored in your browser. RepoLens may send it through its server for validation, ZIP downloads, and some GitHub requests; other supported requests may go directly from the browser to GitHub.

### How to Configure

1. [Create a fine-grained PAT](https://github.com/settings/tokens?type=beta) on GitHub.
2. Grant **Contents: Read-only** and **Metadata: Read-only** permissions (select only the repositories you need, or choose *All repositories*).
3. In RepoLens, click the **gear icon** (Settings) → **GitHub** tab → paste your token → **Test Connection**.

### Recommended Scopes

| Goal | Scope |
|---|---|
| Private repository access | `Contents: Read-only` + `Metadata: Read-only` |
| Public repos (higher rate limit only) | No additional permissions needed |

### Security

- The token is stored in your browser's `localStorage` — same as AI API keys.
- Depending on the operation, authenticated GitHub traffic may go directly from the browser to GitHub or through RepoLens server routes.
- OAuth sign-in continues to work through server-side proxy routes. GitHub OAuth Apps require the broad `repo` scope for private code because they do not offer a read-only private-code scope; use a fine-grained PAT when you need repository-specific read-only access.

---

## Quick Start

### Prerequisites

| Requirement | Install | Verify |
|---|---|---|
| **Node.js 22.12+** | [nodejs.org](https://nodejs.org) | `node -v` |
| **pnpm 10.28.1** | [pnpm.io](https://pnpm.io/installation) | `pnpm -v` |
| **AI API key** | At least one: [OpenAI](https://platform.openai.com/api-keys), [Google AI](https://aistudio.google.com/apikey), [Anthropic](https://console.anthropic.com/settings/keys), or [OpenRouter](https://openrouter.ai/keys) | — |

### Setup

```bash
git clone https://github.com/zebbern/repolens.git
cd repolens/workproject
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000), click the **gear icon** (Settings), and enter your API key(s).

AI API keys are stored in your browser. When you use an AI feature, the selected key, your prompt, selected repository context, and local tool results are sent through the RepoLens server to the selected provider.

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
| View git insights | Open the **Git History** tab → **Insights** sub-tab for coding hours, activity heatmaps, and author charts |

---

## Tech Stack

| Category | Technology |
|---|---|
| Framework | [Next.js 16](https://nextjs.org) (App Router) |
| UI | [React 19](https://react.dev), [Tailwind CSS](https://tailwindcss.com), [shadcn/ui](https://ui.shadcn.com) |
| Language | [TypeScript 5](https://www.typescriptlang.org) |
| AI | [Vercel AI SDK v6](https://sdk.vercel.ai) |
| Diagrams | [Mermaid.js](https://mermaid.js.org) |
| Syntax highlighting | [Shiki](https://shiki.style) |
| Repo extraction | [fflate](https://github.com/101arrowz/fflate) |
| Testing | [Vitest](https://vitest.dev), [Playwright](https://playwright.dev) |
| Deployment | [Vercel](https://vercel.com) |

---

## Contributing

1. Fork the repo and create a branch.
2. Make your changes.
3. Run `pnpm test` to verify.
4. Open a pull request.

