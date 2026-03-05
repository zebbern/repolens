"use client"

import type { LucideIcon } from "lucide-react"
import { Lock, FileText, Network, History, Sparkles, ArrowRight } from "lucide-react"
import { Button } from "@/components/ui/button"

interface TabInfo {
  title: string
  description: string
  features: string[]
  icon: LucideIcon
}

const AI_TAB_INFO: Record<string, TabInfo> = {
  docs: {
    title: "AI Documentation Generator",
    description:
      "Generate professional documentation for any repository in seconds. Choose from 5 templates including README, API Reference, and Architecture Overview.",
    features: [
      "5 documentation templates with quality control",
      "Real-time streaming generation",
      "Markdown export and clipboard copy",
      "History of generated documents",
    ],
    icon: FileText,
  },
  diagram: {
    title: "AI Diagram Generator",
    description:
      "Create architecture diagrams, dependency graphs, and treemaps from your codebase. The AI analyzes your code structure and generates interactive visualizations.",
    features: [
      "6 diagram types including architecture, treemap, and entry points",
      "Interactive Mermaid rendering with zoom and pan",
      "Export to SVG and PNG",
      "Auto-generated from code analysis",
    ],
    icon: Network,
  },
  changelog: {
    title: "AI Changelog Generator",
    description:
      "Generate changelogs from Git history. Select a range of tags or branches, choose a preset format, and let the AI summarize what changed.",
    features: [
      "4 presets: Conventional, Release Notes, Keep a Changelog, Custom",
      "Tag and branch-based ref range selection",
      "Quality levels: Fast, Balanced, Thorough",
      "History with regenerate and export",
    ],
    icon: History,
  },
}

interface AIFeatureEmptyStateProps {
  tabId: string
  onOpenSettings: () => void
}

export function AIFeatureEmptyState({ tabId, onOpenSettings }: AIFeatureEmptyStateProps) {
  const info = AI_TAB_INFO[tabId]
  if (!info) return null

  const FeatureIcon = info.icon

  return (
    <div className="flex flex-col items-center justify-center h-full px-6 py-12 text-center max-w-lg mx-auto">
      {/* Icon with lock overlay */}
      <div className="relative mb-6">
        <div className="flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10">
          <FeatureIcon className="h-8 w-8 text-primary" />
        </div>
        <div className="absolute -bottom-1 -right-1 flex items-center justify-center w-6 h-6 rounded-full bg-muted border-2 border-background">
          <Lock className="h-3 w-3 text-destructive" />
        </div>
      </div>

      {/* Title */}
      <h3 className="text-lg font-semibold text-foreground mb-2">{info.title}</h3>

      {/* Description */}
      <p className="text-sm text-muted-foreground mb-6 leading-relaxed">{info.description}</p>

      {/* Feature list */}
      <ul className="text-left text-sm text-muted-foreground space-y-2 mb-8 w-full">
        {info.features.map((feature) => (
          <li key={feature} className="flex items-start gap-2">
            <Sparkles className="h-4 w-4 text-primary/60 mt-0.5 shrink-0" />
            <span>{feature}</span>
          </li>
        ))}
      </ul>

      {/* CTA */}
      <div className="flex flex-col items-center gap-3">
        <Button onClick={onOpenSettings} className="gap-2">
          Set up API key
          <ArrowRight className="h-4 w-4" />
        </Button>
        <p className="text-xs text-muted-foreground">
          Add your OpenAI, Anthropic, or Google API key in Settings to unlock AI features
        </p>
      </div>
    </div>
  )
}
