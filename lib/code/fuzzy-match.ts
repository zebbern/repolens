/**
 * Fuzzy matching utility for file path search.
 * Scores based on consecutive matches, start-of-word bonuses, case matches,
 * and path length penalty.
 */
export function fuzzyMatch(query: string, text: string): { score: number; indices: number[] } | null {
  if (!query) return null

  const lowerQuery = query.toLowerCase()
  const lowerText = text.toLowerCase()
  const indices: number[] = []
  let score = 0
  let queryIdx = 0
  let lastMatchIdx = -1

  for (let i = 0; i < lowerText.length && queryIdx < lowerQuery.length; i++) {
    if (lowerText[i] === lowerQuery[queryIdx]) {
      indices.push(i)
      score += (lastMatchIdx === i - 1) ? 10 : 1
      if (i === 0 || '/.-_'.includes(text[i - 1])) score += 5
      if (text[i] === query[queryIdx]) score += 1
      lastMatchIdx = i
      queryIdx++
    }
  }

  if (queryIdx < lowerQuery.length) return null
  score -= Math.floor(text.length / 20)
  return { score, indices }
}
