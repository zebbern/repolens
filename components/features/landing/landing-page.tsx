"use client"

import { useEffect, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Github, Loader2, ArrowRight } from "lucide-react"
import { useRepositoryData, useRepositoryProgress } from "@/providers"
import { LoadingProgress } from "@/components/features/loading/loading-progress"
import { RecentRepos } from "@/components/features/landing/recent-repos"

interface LandingPageProps {
  repoUrl: string
  onRepoUrlChange: (url: string) => void
  onConnect: () => void
  onConnectWithUrl: (url: string) => void
  isConnecting: boolean
  error: string | null
}

const EXAMPLE_REPOS = [
  { name: "pmndrs/zustand", url: "https://github.com/pmndrs/zustand" },
  { name: "shadcn-ui/ui", url: "https://github.com/shadcn-ui/ui" },
  { name: "t3-oss/create-t3-app", url: "https://github.com/t3-oss/create-t3-app" },
  { name: "tailwindlabs/heroicons", url: "https://github.com/tailwindlabs/heroicons" },
] as const

export function LandingPage({
  repoUrl,
  onRepoUrlChange,
  onConnect,
  onConnectWithUrl,
  isConnecting,
  error,
}: LandingPageProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const { loadingStage, indexingProgress } = useRepositoryProgress()
  const { isCacheHit } = useRepositoryData()

  useEffect(() => {
    const timer = setTimeout(() => inputRef.current?.focus(), 100)
    return () => clearTimeout(timer)
  }, [])

  const handleExampleClick = (url: string) => {
    onRepoUrlChange(url)
    onConnectWithUrl(url)
  }

  return (
    <div className="flex h-full flex-col overflow-auto">
      <div className="mx-auto flex w-full max-w-lg flex-1 flex-col items-center justify-center gap-10 px-6 py-16 sm:py-24">
        {/* ── Hero Section ── */}
        <section className="flex flex-col items-center gap-8 text-center">
          {/* Icon cluster */}
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 border border-primary/20">
              <Github className="h-5 w-5 text-primary" />
            </div>
          </div>

          <div className="flex flex-col items-center gap-4">
            <h1 className="text-2xl font-bold tracking-tight text-text-primary sm:text-3xl lg:text-4xl">
              Understand Any GitHub
              <br className="hidden sm:block" />
              {" "}Repository in Seconds
            </h1>
            <p className="text-sm text-text-secondary">
              Paste a GitHub URL. Get instant AI analysis, docs, and diagrams.
            </p>
          </div>

          {/* Search input */}
          <div className="w-full max-w-md space-y-3">
            <Input
              ref={inputRef}
              type="url"
              value={repoUrl}
              onChange={(e) => onRepoUrlChange(e.target.value)}
              placeholder="https://github.com/username/repo"
              className="h-11 bg-foreground/5 border-foreground/10 text-text-primary placeholder:text-text-muted focus:border-foreground/20 text-sm sm:text-base"
              onKeyDown={(e) => e.key === "Enter" && onConnect()}
            />
            {error && (
              <p className="text-sm text-status-error">{error}</p>
            )}
            <Button
              className="w-full h-11 bg-primary text-primary-foreground hover:bg-primary/90 font-medium"
              disabled={!repoUrl.trim() || isConnecting}
              onClick={onConnect}
            >
              {isConnecting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Connecting...
                </>
              ) : (
                <>
                  Connect Repository
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </Button>
            {/* Multi-stage progress below the button during connection */}
            {isConnecting && (
              <LoadingProgress
                stage={loadingStage}
                progress={indexingProgress}
                isCacheHit={isCacheHit}
                error={error}
                repoName={repoUrl}
              />
            )}
            <p className="text-xs text-text-muted text-center">
              Tip: Add{" "}
              <span className="font-medium text-text-secondary">m</span>{" "}
              before github.com — e.g.{" "}
              <span className="font-medium text-text-secondary">
                mgithub.com/owner/repo
              </span>
            </p>

            {/* Example repos */}
            <div className="flex flex-wrap justify-center gap-2 pt-2">
              {EXAMPLE_REPOS.map((repo) => (
                <button
                  key={repo.name}
                  onClick={() => handleExampleClick(repo.url)}
                  disabled={isConnecting}
                  className="flex items-center gap-1.5 rounded-full border border-foreground/8 bg-foreground/3 px-3.5 py-1.5 text-xs font-medium text-text-secondary transition-all hover:border-foreground/15 hover:bg-foreground/6 hover:text-text-primary disabled:opacity-50"
                >
                  <Github className="h-3 w-3" />
                  {repo.name}
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* ── Recently Analyzed Repos ── */}
        <RecentRepos onConnectWithUrl={onConnectWithUrl} />

      </div>
    </div>
  )
}
