"use client"

import type { ReactNode } from "react"
import { SessionProvider } from "next-auth/react"
import { ThemeProvider } from "next-themes"
import { AppProvider, useApp } from "./app-provider"
import { APIKeysProvider, useAPIKeys } from "./api-keys-provider"
import { GitHubTokenProvider, useGitHubToken } from "./github-token-provider"
import { CommandPalette } from "@/components/features/command-palette/command-palette"
import { RepositoryProvider, useRepository, useRepositoryData, useRepositoryActions, useRepositoryProgress, type LoadingStage, type RepositoryDataContextType, type RepositoryActionsContextType, type RepositoryProgressContextType } from "./repository-provider"
import { DocsProvider, useDocs, useDocsChat } from "./docs-provider"
import { ChangelogProvider, useChangelog, useChangelogChat } from "./changelog-provider"
import { ToursProvider, useTours } from "./tours-provider"

interface ProvidersProps {
  children: ReactNode
}

function RepositoryScopedToursProvider({ children }: ProvidersProps) {
  const { repo } = useRepositoryData()
  const repoKey = repo?.fullName
  const repoVisibility = repo ? (repo.isPrivate ? 'private' : 'public') : undefined

  // Remounting on repository changes prevents any previous repository's tour
  // state from appearing during the next render.
  return (
    <ToursProvider key={repoKey ?? 'no-repository'} repoKey={repoKey} repoVisibility={repoVisibility}>
      {children}
    </ToursProvider>
  )
}

export function Providers({ children }: ProvidersProps) {
  return (
    <SessionProvider refetchOnWindowFocus={false}>
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
        <APIKeysProvider>
          <GitHubTokenProvider>
            <RepositoryProvider>
              <RepositoryScopedToursProvider>
                <DocsProvider>
                  <ChangelogProvider>
                    <AppProvider>
                      {children}
                      <CommandPalette />
                    </AppProvider>
                  </ChangelogProvider>
                </DocsProvider>
              </RepositoryScopedToursProvider>
            </RepositoryProvider>
          </GitHubTokenProvider>
        </APIKeysProvider>
      </ThemeProvider>
    </SessionProvider>
  )
}

export { useApp, useAPIKeys, useGitHubToken, useRepository, useRepositoryData, useRepositoryActions, useRepositoryProgress, useDocs, useDocsChat, useChangelog, useChangelogChat, useTours }
export type { LoadingStage, RepositoryDataContextType, RepositoryActionsContextType, RepositoryProgressContextType }
export type { PinnedFile, PinnedContentsResult } from '@/types/types'
