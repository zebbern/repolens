"use client"

import type { ReactNode } from "react"
import { SessionProvider } from "next-auth/react"
import { ThemeProvider } from "next-themes"
import { AppProvider, useApp } from "./app-provider"
import { APIKeysProvider, useAPIKeys } from "./api-keys-provider"
import { GitHubTokenProvider, useGitHubToken } from "./github-token-provider"
import { RepositoryProvider, useRepository, type LoadingStage } from "./repository-provider"
import { DocsProvider, useDocs, useDocsChat } from "./docs-provider"
import { ChangelogProvider, useChangelog, useChangelogChat } from "./changelog-provider"
import { ToursProvider, useTours } from "./tours-provider"

interface ProvidersProps {
  children: ReactNode
}

export function Providers({ children }: ProvidersProps) {
  return (
    <SessionProvider>
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
        <APIKeysProvider>
          <GitHubTokenProvider>
            <RepositoryProvider>
              <ToursProvider>
                <DocsProvider>
                  <ChangelogProvider>
                    <AppProvider>
                      {children}
                    </AppProvider>
                  </ChangelogProvider>
                </DocsProvider>
              </ToursProvider>
            </RepositoryProvider>
          </GitHubTokenProvider>
        </APIKeysProvider>
      </ThemeProvider>
    </SessionProvider>
  )
}

export { useApp, useAPIKeys, useGitHubToken, useRepository, useDocs, useDocsChat, useChangelog, useChangelogChat, useTours }
export type { LoadingStage }
export type { PinnedFile, PinnedContentsResult } from '@/types/types'
