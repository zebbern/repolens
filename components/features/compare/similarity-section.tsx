"use client"

import { useMemo, useState } from "react"
import {
  AlertTriangle,
  ChevronRight,
  GitFork,
  FileCode2,
} from "lucide-react"
import { Card, CardHeader } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { useComparison } from "@/providers/comparison-provider"
import { computeAllSimilarities } from "@/lib/compare/similarity-utils"
import type { SimilarityLabel, SimilarityResult } from "@/types/comparison"
import { cn } from "@/lib/utils"

const LABEL_STYLES: Record<SimilarityLabel, string> = {
  "likely-clone": "bg-red-500/15 text-red-600 border-red-500/30",
  "highly-similar": "bg-amber-500/15 text-amber-600 border-amber-500/30",
  "some-overlap": "bg-yellow-500/15 text-yellow-600 border-yellow-500/30",
  different: "bg-green-500/15 text-green-600 border-green-500/30",
}

const LABEL_TEXT: Record<SimilarityLabel, string> = {
  "likely-clone": "Likely Clone",
  "highly-similar": "Highly Similar",
  "some-overlap": "Some Overlap",
  different: "Different",
}

const SIGNAL_LABELS: { key: keyof SimilarityResult["signals"]; label: string }[] = [
  { key: "shaJaccard", label: "SHA Match" },
  { key: "shaContainment", label: "Content Containment" },
  { key: "pathJaccard", label: "Path Similarity" },
  { key: "dependencyOverlap", label: "Dependency Overlap" },
  { key: "languageCosine", label: "Language Similarity" },
]

const SIGNAL_COLORS = [
  "bg-blue-500",
  "bg-emerald-500",
  "bg-amber-500",
  "bg-red-500",
  "bg-violet-500",
]

const MAX_IDENTICAL_FILES = 20

export function SimilaritySection() {
  const { getRepoList } = useComparison()
  const repos = useMemo(() => getRepoList(), [getRepoList])

  const readyRepos = useMemo(
    () => repos.filter((r) => r.status === "ready" && r.treeItems),
    [repos]
  )

  const similarities = useMemo(
    () => (readyRepos.length >= 2 ? computeAllSimilarities(readyRepos) : []),
    [readyRepos]
  )

  if (readyRepos.length < 2) {
    return (
      <p className="text-sm text-text-secondary">
        Need at least 2 repos with file data to compute similarity.
      </p>
    )
  }

  return (
    <div className="space-y-4">
      {similarities.map((result) => (
        <SimilarityCard key={`${result.repoA}-${result.repoB}`} result={result} />
      ))}
    </div>
  )
}

function SimilarityCard({ result }: { result: SimilarityResult }) {
  const scorePercent = Math.round(result.score * 100)

  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex-row items-center justify-between gap-3 space-y-0 p-4">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-medium truncate">
            {result.repoA.split("/")[1]}
          </span>
          <span className="text-xs text-text-secondary">vs</span>
          <span className="text-sm font-medium truncate">
            {result.repoB.split("/")[1]}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-lg font-semibold tabular-nums">
            {scorePercent}%
          </span>
          <Badge
            variant="outline"
            className={cn("text-xs", LABEL_STYLES[result.label])}
          >
            {LABEL_TEXT[result.label]}
          </Badge>
        </div>
      </CardHeader>

      <div className="border-t border-foreground/10 px-4 py-3 space-y-3">
        {/* Fork banner */}
        {result.relationship.isForkPair && (
          <div className="flex items-center gap-2 rounded-md bg-blue-500/10 px-3 py-2 text-xs text-blue-600">
            <GitFork className="h-3.5 w-3.5 shrink-0" />
            <span>
              Fork relationship detected
              {result.relationship.commonParent &&
                ` (parent: ${result.relationship.commonParent})`}
            </span>
          </div>
        )}

        {/* Low confidence warning */}
        {result.isLowConfidence && (
          <div className="flex items-center gap-2 rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-600">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            <span>
              Low confidence — fewer than 10 comparable files
              ({result.totalComparedFiles} total)
            </span>
          </div>
        )}

        {/* Signal breakdown */}
        <SignalBreakdown signals={result.signals} />

        {/* Identical files */}
        {result.identicalFiles.length > 0 && (
          <IdenticalFilesList files={result.identicalFiles} />
        )}
      </div>
    </Card>
  )
}

function SignalBreakdown({
  signals,
}: {
  signals: SimilarityResult["signals"]
}) {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger className="flex w-full items-center gap-2 text-sm font-medium hover:text-text-primary transition-colors">
        <ChevronRight
          className={cn(
            "h-4 w-4 text-text-secondary transition-transform duration-200",
            isOpen && "rotate-90"
          )}
        />
        Signal Breakdown
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-3 space-y-2.5">
        {SIGNAL_LABELS.map(({ key, label }, i) => {
          const value = signals[key]
          const percent = Math.round(value * 100)
          return (
            <div key={key} className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-text-secondary">{label}</span>
                <span className="tabular-nums font-medium">{percent}%</span>
              </div>
              <div className="h-2 w-full rounded-full bg-foreground/10">
                <div
                  className={cn("h-full rounded-full transition-all", SIGNAL_COLORS[i])}
                  style={{ width: `${percent}%` }}
                />
              </div>
            </div>
          )
        })}
      </CollapsibleContent>
    </Collapsible>
  )
}

function IdenticalFilesList({ files }: { files: string[] }) {
  const [isOpen, setIsOpen] = useState(false)
  const [showAllFiles, setShowAllFiles] = useState(false)
  const displayFiles = files.slice(0, showAllFiles ? files.length : MAX_IDENTICAL_FILES)
  const remaining = files.length - MAX_IDENTICAL_FILES

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger className="flex w-full items-center gap-2 text-sm font-medium hover:text-text-primary transition-colors">
        <ChevronRight
          className={cn(
            "h-4 w-4 text-text-secondary transition-transform duration-200",
            isOpen && "rotate-90"
          )}
        />
        <FileCode2 className="h-3.5 w-3.5 text-text-secondary" />
        <span>Identical Files</span>
        <Badge variant="secondary" className="text-xs">
          {files.length}
        </Badge>
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-2 pl-6">
        <ul className="space-y-1">
          {displayFiles.map((path) => (
            <li key={path} className="text-xs font-mono text-text-secondary truncate">
              {path}
            </li>
          ))}
          {remaining > 0 && (
            <li>
              <button
                type="button"
                className="text-xs text-text-secondary italic hover:text-text-primary"
                aria-expanded={showAllFiles}
                aria-label={showAllFiles ? 'Show fewer identical files' : `View ${remaining} more identical files`}
                onClick={() => setShowAllFiles((shown) => !shown)}
              >
                {showAllFiles ? 'Show less' : `+${remaining} more`}
              </button>
            </li>
          )}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  )
}
