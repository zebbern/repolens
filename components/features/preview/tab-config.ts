import { Github, Bug, FileText, Network, Code2, Package, History, GitCommitHorizontal } from "lucide-react"
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
  { id: "docs", label: "Docs", icon: FileText, requiresAI: true },
  { id: "diagram", label: "Diagram", icon: Network },
  { id: "code", label: "Code", icon: Code2 },
  { id: "deps", label: "Deps", icon: Package },
  { id: "changelog", label: "Changelog", icon: History, requiresAI: true },
  { id: "git-history", label: "Git History", icon: GitCommitHorizontal },
]
