/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    unoptimized: true,
    remotePatterns: [
      {
        protocol: "https",
        hostname: "avatars.githubusercontent.com",
      },
    ],
  },
  experimental: {
    optimizePackageImports: ["lucide-react", "@radix-ui/react-icons"],
  },
  turbopack: {
    // web-tree-sitter contains a Node.js code path that imports 'fs/promises'.
    // In the browser it uses fetch instead, so alias these to empty modules
    // on the client side.
    resolveAlias: {
      fs: { browser: './lib/stubs/empty.js' },
      'fs/promises': { browser: './lib/stubs/empty.js' },
      module: { browser: './lib/stubs/empty.js' },
      path: { browser: './lib/stubs/empty.js' },
      url: { browser: './lib/stubs/empty.js' },
    },
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              // 'unsafe-inline' is required for Next.js inline scripts and Mermaid's
              // style injection. 'unsafe-eval' is needed by Mermaid.js for diagram rendering.
              // 'wasm-unsafe-eval' is needed for Shiki's oniguruma WASM regex engine.
              // Content injected via dangerouslySetInnerHTML is safe:
              //   - Mermaid SVG: securityLevel:'strict' sanitizes output; source is pre-sanitized
              //   - Code blocks: Shiki produces escaped HTML from source text
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval'",
              "connect-src 'self' data: blob: https://api.github.com https://raw.githubusercontent.com https://github.com https://cdn.jsdelivr.net",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob: https:",
              "font-src 'self' data:",
              "frame-src 'self'",
              "object-src 'none'",
              "base-uri 'self'",
              "form-action 'self' https://github.com",
              "frame-ancestors 'none'",
              "upgrade-insecure-requests",
            ].join("; "),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
