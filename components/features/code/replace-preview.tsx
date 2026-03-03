import { buildSearchRegex } from "@/lib/code/code-index"
import type { SearchOptions } from "./types"

interface ReplacePreviewProps {
  text: string
  query: string
  replaceQuery: string
  searchOptions: SearchOptions
}

/** Shows old (strikethrough/red) vs new (green) replacement preview. */
export function ReplacePreview({ text, query, replaceQuery, searchOptions }: ReplacePreviewProps) {
  const pattern = buildSearchRegex(query, searchOptions)
  if (!pattern) return null

  pattern.lastIndex = 0
  const replaced = text.replace(pattern, replaceQuery)
  if (replaced === text) return null

  return (
    <div className="ml-10 mt-0.5 mb-0.5 flex flex-col gap-px text-[11px] font-mono leading-4">
      <span className="text-red-400/80 line-through truncate">{text}</span>
      <span className="text-emerald-400/80 truncate">{replaced}</span>
    </div>
  )
}
