import { Bug, FileText, Network, Code2, Package, History, GitCommitHorizontal, Route, GitPullRequest } from "lucide-react"
import { Github } from "@/components/icons/github"
import type { LucideIcon } from "lucide-react"

export interface PreviewTab {
  id: string
  label: string
  icon: LucideIcon
  requiresAI?: boolean
}

export const PREVIEW_TABS: PreviewTab[] = [
  { id: "repo", label: "Repo", icon: Github },
  { id: "issues", label: "Issues", icon: Bug },
  { id: "diagram", label: "Diagram", icon: Network },
  { id: "code", label: "Code", icon: Code2 },
  { id: "deps", label: "Deps", icon: Package },
  { id: "docs", label: "Docs", icon: FileText, requiresAI: true },
  { id: "changelog", label: "Changelog", icon: History, requiresAI: true },
  { id: "git-history", label: "Git History", icon: GitCommitHorizontal },
  { id: "pr-review", label: "PR Review", icon: GitPullRequest },
  { id: "tours", label: "Tours", icon: Route },
]
