"use client"

import {
  ChevronRight,
  FileText,
  Search,
  FolderOpen,
  Code2,
  BarChart3,
  GitBranch,
  Shield,
  Shapes,
  Info,
  Loader2,
  AlertCircle,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { MarkdownRenderer } from "@/components/ui/markdown-renderer"
import { Badge } from "@/components/ui/badge"
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible"
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion"
import { memo, useState, useMemo, Suspense } from "react"
import type { UIMessage, ToolUIPart as AiToolUIPart, DynamicToolUIPart } from "ai"
import { isToolUIPart, isFileUIPart, getToolName } from "ai"
import { formatTokenCount, formatModelName, estimateCost, formatCost } from "@/lib/ai/token-cost"
import { TOOL_RENDERERS } from "./tool-renderers"

// ---------------------------------------------------------------------------
// Tool call indicator
// ---------------------------------------------------------------------------

const TOOL_ICONS: Record<string, typeof FileText> = {
  readFile: FileText,
  searchFiles: Search,
  listDirectory: FolderOpen,
  findSymbol: Code2,
  getFileStats: BarChart3,
  analyzeImports: GitBranch,
  scanIssues: Shield,
  generateDiagram: Shapes,
  getProjectOverview: Info,
}

function buildToolLabel(
  toolName: string,
  args: Record<string, unknown>,
): string {
  switch (toolName) {
    case "readFile":
      return `Reading ${args.path ?? "file"}`
    case "searchFiles":
      return `Searching for "${args.query ?? "…"}"`
    case "listDirectory":
      return `Listing ${args.path ?? "(root)"}`
    case "findSymbol":
      return `Finding symbol ${args.name ?? "…"}`
    case "getFileStats":
      return `Analyzing ${args.path ?? "file"}`
    case "analyzeImports":
      return `Checking imports of ${args.path ?? "file"}`
    case "scanIssues":
      return `Scanning ${args.path ?? "files"}`
    case "generateDiagram":
      return `Generating ${args.type ?? "diagram"}`
    case "getProjectOverview":
      return "Getting project overview"
    default:
      return toolName
  }
}

/** Strip control-character escape sequences like `<ctrl46>` from display text */
function cleanControlChars(text: string): string {
  return text.replace(/<ctrl\d+>/gi, "")
}

/** Render a tool result in a readable, contained format */
function ToolResultContent({ result }: { result: unknown }) {
  if (typeof result === "string") {
    const cleaned = cleanControlChars(result)
    // Try parsing as JSON for better formatting
    try {
      const parsed: unknown = JSON.parse(cleaned)
      if (typeof parsed === "object" && parsed !== null) {
        return <FormattedObject value={parsed} />
      }
    } catch {
      // Not JSON — render as plain text
    }
    return (
      <div className="whitespace-pre-wrap wrap-break-word text-[11px] font-mono text-text-secondary">
        {cleaned}
      </div>
    )
  }

  if (typeof result === "object") {
    return <FormattedObject value={result as Record<string, unknown>} />
  }

  return (
    <div className="text-[11px] font-mono text-text-secondary">
      {String(result)}
    </div>
  )
}

/** Compact key-value display for objects/arrays */
function FormattedObject({ value }: { value: unknown }) {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return (
        <span className="text-[11px] font-mono text-text-muted italic">
          Empty list
        </span>
      )
    }

    const allStrings = value.every((v) => typeof v === "string")
    if (allStrings) {
      return (
        <ul className="list-none space-y-0.5 text-[11px] font-mono text-text-secondary">
          {value.map((item, i) => (
            <li key={i} className="break-all">
              {cleanControlChars(String(item))}
            </li>
          ))}
        </ul>
      )
    }

    return (
      <pre className="whitespace-pre-wrap wrap-break-word text-[11px] font-mono text-text-secondary">
        {cleanControlChars(JSON.stringify(value, null, 2))}
      </pre>
    )
  }

  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
    if (entries.length === 0) {
      return (
        <span className="text-[11px] font-mono text-text-muted italic">
          No data
        </span>
      )
    }

    // For objects with few keys, render as key-value pairs
    if (entries.length <= 8) {
      return (
        <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-[11px] font-mono">
          {entries.map(([key, val]) => (
            <div key={key} className="contents">
              <dt className="text-text-muted truncate">{key}:</dt>
              <dd className="text-text-secondary break-all min-w-0">
                {typeof val === "object" && val !== null
                  ? cleanControlChars(JSON.stringify(val))
                  : cleanControlChars(String(val ?? ""))}
              </dd>
            </div>
          ))}
        </dl>
      )
    }

    // Larger objects: formatted JSON
    return (
      <pre className="whitespace-pre-wrap wrap-break-word text-[11px] font-mono text-text-secondary">
        {cleanControlChars(JSON.stringify(value, null, 2))}
      </pre>
    )
  }

  return (
    <span className="text-[11px] font-mono text-text-secondary">
      {cleanControlChars(String(value))}
    </span>
  )
}

/** Build a compact summary string from a tool result for inline display */
function buildToolSummary(toolName: string, result: unknown): string | null {
  if (result === null || result === undefined) return null

  // Try to parse string results as JSON
  let value = result
  if (typeof value === "string") {
    try {
      value = JSON.parse(value)
    } catch {
      // Not JSON — use string directly
      const trimmed = (result as string).trim()
      if (trimmed.length === 0) return null
      return trimmed.length > 30 ? `${trimmed.slice(0, 30)}…` : trimmed
    }
  }

  if (typeof value === "object" && value !== null) {
    const obj = value as Record<string, unknown>
    if ("path" in obj && typeof obj.path === "string") {
      const segments = obj.path.split("/")
      return segments[segments.length - 1] || obj.path
    }
    if ("totalFiles" in obj && typeof obj.totalFiles === "number") {
      return `${obj.totalFiles} files`
    }
    if (Array.isArray(value)) {
      return `${value.length} items`
    }
  }

  // Fallback: byte length
  const str = typeof result === "string" ? result : JSON.stringify(result)
  const bytes = new Blob([str]).size
  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`
  }
  return `${bytes} B`
}

type ToolStatus = "running" | "complete" | "error"

function getToolStatus(state: string): ToolStatus {
  if (state === "output-available") return "complete"
  if (state === "output-error" || state === "output-denied") return "error"
  return "running"
}

function StatusIcon({ status }: { status: ToolStatus }) {
  switch (status) {
    case "running":
      return <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500" />
    case "complete":
      return null
    case "error":
      return <AlertCircle className="h-3.5 w-3.5 text-red-500" />
  }
}

function ToolCallIndicator({
  toolName,
  args,
  result,
  status,
}: {
  toolName: string
  args: Record<string, unknown>
  result?: unknown
  status: ToolStatus
}) {
  const [isExpanded, setIsExpanded] = useState(false)
  const Icon = TOOL_ICONS[toolName] || Code2
  const label = buildToolLabel(toolName, args)
  const hasResult = result !== undefined && result !== null
  const RichRenderer = TOOL_RENDERERS[toolName] ?? null

  const summary = hasResult ? buildToolSummary(toolName, result) : null

  return (
    <Collapsible open={isExpanded} onOpenChange={setIsExpanded} className="my-0.5">
      <div
        className={cn(
          "py-1",
          status === "running" && "animate-pulse",
        )}
      >
        <CollapsibleTrigger asChild>
          <button className="flex items-center gap-1.5 text-xs text-text-muted hover:text-text-secondary transition-colors w-full text-left">
            <ChevronRight
              className={cn(
                "h-3 w-3 shrink-0 transition-transform duration-200",
                isExpanded && "rotate-90",
              )}
            />
            <StatusIcon status={status} />
            <Icon className="h-3 w-3 shrink-0" />
            <span className="truncate">{label}</span>
            {summary && (
              <Badge variant="outline" className="text-[10px] ml-1.5 px-1.5 py-0 shrink-0">
                {summary}
              </Badge>
            )}
          </button>
        </CollapsibleTrigger>
      </div>

      <CollapsibleContent>
        {hasResult && (
          RichRenderer ? (
            <div className="mt-1 ml-6">
              <Suspense fallback={<div className="animate-pulse h-8 bg-surface-elevated rounded" />}>
                <RichRenderer result={result} args={args} toolName={toolName} />
              </Suspense>
            </div>
          ) : (
            <div className="mt-1 ml-6 max-h-60 overflow-y-auto overflow-x-auto rounded bg-surface-elevated p-2 border border-foreground/6">
              <ToolResultContent result={result} />
            </div>
          )
        )}
      </CollapsibleContent>
    </Collapsible>
  )
}

// ---------------------------------------------------------------------------
// Grouped tool call accordion (3+ consecutive tool calls)
// ---------------------------------------------------------------------------

type ToolUIPart = AiToolUIPart | DynamicToolUIPart

/** Aggregate status for a group of tool calls */
function getGroupStatus(parts: ToolUIPart[]): ToolStatus {
  if (parts.some((p) => getToolStatus(p.state) === "error")) return "error"
  if (parts.some((p) => getToolStatus(p.state) === "running")) return "running"
  return "complete"
}

function ToolCallGroup({ parts }: { parts: ToolUIPart[] }) {
  const groupStatus = getGroupStatus(parts)

  return (
    <Accordion type="single" collapsible className="my-0.5">
      <AccordionItem value="tool-group" className="border-b-0">
        <AccordionTrigger
          className={cn(
            "py-1 text-xs text-text-muted hover:text-text-secondary hover:no-underline",
            groupStatus === "running" && "animate-pulse",
          )}
        >
          <span className="flex items-center gap-1.5">
            <StatusIcon status={groupStatus} />
            <span>
              {groupStatus === "running" ? "Running tools…" : `Used ${parts.length} tools`}
            </span>
            <Badge variant="outline" className="text-[10px] px-1.5 py-0">
              {parts.length}
            </Badge>
          </span>
        </AccordionTrigger>
        <AccordionContent className="pb-0 pt-0">
          <div className="space-y-0.5 pt-1">
            {parts.map((part, i) => {
              const toolName = getToolName(part)
              const args = (part.input ?? {}) as Record<string, unknown>
              const status = getToolStatus(part.state)
              const result =
                part.state === "output-available"
                  ? part.output
                  : part.state === "output-error"
                    ? part.errorText
                    : undefined

              return (
                <ToolCallIndicator
                  key={part.toolCallId}
                  toolName={toolName}
                  args={args}
                  result={result}
                  status={status}
                />
              )
            })}
          </div>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  )
}

// ---------------------------------------------------------------------------
// Part grouping helper
// ---------------------------------------------------------------------------

type MessagePart = UIMessage["parts"][number]
type PartGroup =
  | { kind: "single"; part: MessagePart; index: number }
  | { kind: "tool-group"; parts: ToolUIPart[] }

/** Group consecutive tool UI parts — groups of 3+ become a ToolCallGroup */
function groupMessageParts(parts: MessagePart[]): PartGroup[] {
  const groups: PartGroup[] = []
  let toolBuffer: ToolUIPart[] = []

  function flushToolBuffer() {
    if (toolBuffer.length === 0) return
    if (toolBuffer.length >= 3) {
      groups.push({ kind: "tool-group", parts: [...toolBuffer] })
    } else {
      for (const part of toolBuffer) {
        groups.push({ kind: "single", part, index: -1 })
      }
    }
    toolBuffer = []
  }

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]
    if (isToolUIPart(part)) {
      toolBuffer.push(part as ToolUIPart)
    } else {
      flushToolBuffer()
      groups.push({ kind: "single", part, index: i })
    }
  }
  flushToolBuffer()

  return groups
}

// ---------------------------------------------------------------------------
// Per-message token usage badge
// ---------------------------------------------------------------------------

interface MessageUsageMetadata {
  usage?: { inputTokens: number; outputTokens: number; totalTokens: number }
  model?: string
}

function MessageTokenBadge({ metadata }: { metadata: MessageUsageMetadata }) {
  const { usage, model } = metadata
  if (!usage || (usage.inputTokens === 0 && usage.outputTokens === 0)) return null

  const total = usage.inputTokens + usage.outputTokens
  const cost = model ? estimateCost(model, usage.inputTokens, usage.outputTokens) : null

  return (
    <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-muted-foreground select-none">
      {model && <span>{formatModelName(model)}</span>}
      {model && <span className="opacity-40">·</span>}
      <span title={`In: ${formatTokenCount(usage.inputTokens)} · Out: ${formatTokenCount(usage.outputTokens)}`}>
        {formatTokenCount(total)} tokens
      </span>
      {cost !== null && (
        <>
          <span className="opacity-40">·</span>
          <span title="Estimated cost">~{formatCost(cost)}</span>
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Chat message
// ---------------------------------------------------------------------------

interface ChatMessageProps {
  message: UIMessage
  className?: string
}

export const ChatMessage = memo(function ChatMessage({ message, className }: ChatMessageProps) {
  const isUser = message.role === "user"

  // Check if there's any renderable content
  const parts = message.parts ?? []
  const hasContent = parts.some(
    (p) =>
      (p.type === "text" && p.text.trim().length > 0) ||
      isToolUIPart(p) ||
      isFileUIPart(p),
  )

  const groupedParts = useMemo(() => groupMessageParts(parts), [parts])

  if (!hasContent) return null

  return (
    <div
      className={cn(
        "flex gap-3",
        isUser ? "justify-end" : "justify-start",
        className,
      )}
    >
      <div
        className={cn(
          "max-w-[85%] rounded-lg px-3 py-2",
          isUser
            ? "bg-foreground/10 text-text-primary"
            : "bg-transparent text-text-primary",
        )}
      >
        {groupedParts.map((group, gi) => {
          if (group.kind === "tool-group") {
            return <ToolCallGroup key={`tg-${gi}`} parts={group.parts} />
          }

          const part = group.part

          if (part.type === "text" && part.text.trim()) {
            return isUser ? (
              <p
                key={gi}
                className="whitespace-pre-wrap text-sm leading-relaxed"
              >
                {part.text}
              </p>
            ) : (
              <MarkdownRenderer key={gi} content={part.text} />
            )
          }

          if (isFileUIPart(part) && part.mediaType?.startsWith("image/")) {
            return (
              <img
                key={gi}
                src={part.url}
                alt={part.filename || "Attached image"}
                className="max-w-full max-h-64 rounded-md border border-foreground/10 my-1"
              />
            )
          }

          if (isToolUIPart(part)) {
            const toolName = getToolName(part)
            const args = (part.input ?? {}) as Record<string, unknown>
            const status = getToolStatus(part.state)
            const result =
              part.state === "output-available"
                ? part.output
                : part.state === "output-error"
                  ? part.errorText
                  : undefined

            return (
              <ToolCallIndicator
                key={gi}
                toolName={toolName}
                args={args}
                result={result}
                status={status}
              />
            )
          }

          return null
        })}

        {!isUser && (message as { metadata?: MessageUsageMetadata }).metadata?.usage && (
          <MessageTokenBadge metadata={(message as { metadata?: MessageUsageMetadata }).metadata!} />
        )}
      </div>
    </div>
  )
})
