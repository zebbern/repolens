// Entropy analysis — Shannon entropy computation and secret detection
// heuristics for reducing false positives on credential-pattern matches.

// ---------------------------------------------------------------------------
// Placeholder patterns that are never real secrets
// ---------------------------------------------------------------------------

const PLACEHOLDER_PATTERN = /\bexample\b|\bplaceholder\b|\bchangeme\b|\btest\b|\bxxx\b|your[_-]|\bTODO\b/i

/**
 * Compute Shannon entropy in bits per character.
 *
 * For each unique character, compute -p * log2(p) where p = count / total.
 * Empty string returns 0.
 */
export function shannonEntropy(str: string): number {
  if (str.length === 0) return 0

  const freq = new Map<string, number>()
  for (const ch of str) {
    freq.set(ch, (freq.get(ch) || 0) + 1)
  }

  let entropy = 0
  const total = str.length
  for (const count of freq.values()) {
    const p = count / total
    entropy -= p * Math.log2(p)
  }

  return entropy
}

/**
 * Heuristic check: is the given value likely a real secret (not a placeholder
 * or low-entropy example)?
 *
 * @param value     The candidate secret string
 * @param threshold Minimum entropy in bits/char (default 3.5)
 */
export function isLikelyRealSecret(value: string, threshold = 3.5): boolean {
  if (PLACEHOLDER_PATTERN.test(value)) return false
  return value.length >= 8 && shannonEntropy(value) >= threshold
}
