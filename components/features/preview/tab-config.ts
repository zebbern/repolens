import { Github, Bug, FileText, Network, Code2 } from "lucide-react"
import type { LucideIcon } from "lucide-react"

export interface PreviewTab {
  id: string
  label: string
  icon: LucideIcon
}

export const PREVIEW_TABS: PreviewTab[] = [
  { id: "repo", label: "Repo", icon: Github },
  { id: "issues", label: "Issues", icon: Bug },
  { id: "docs", label: "Docs", icon: FileText },
  { id: "diagram", label: "Diagram", icon: Network },
  { id: "code", label: "Code", icon: Code2 },
]
