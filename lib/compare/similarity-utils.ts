import type { RepoTreeItem } from "@/types/repository"
import type {
  ComparisonRepo,
  SimilarityLabel,
  SimilarityResult,
  SimilaritySignals,
  RepoRelationship,
} from "@/types/comparison"

// ── Weight constants ────────────────────────────────────────────────

export const WEIGHT_SHA_JACCARD = 0.40
export const WEIGHT_SHA_CONTAINMENT = 0.10
export const WEIGHT_PATH_JACCARD = 0.25
export const WEIGHT_DEPENDENCY_OVERLAP = 0.15
export const WEIGHT_LANGUAGE_COSINE = 0.10

// ── Boilerplate patterns ────────────────────────────────────────────

export const BOILERPLATE_PATTERNS: string[] = [
  ".gitignore",
  ".gitattributes",
  ".editorconfig",
  "license",
  "license.md",
  "license.txt",
  ".prettierrc",
  ".prettierrc.json",
  ".prettierrc.js",
  ".prettierrc.yaml",
  ".eslintrc",
  ".eslintrc.json",
  ".eslintrc.js",
  ".eslintrc.yaml",
  "eslint.config.js",
  "eslint.config.mjs",
  "tsconfig.json",
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
]

const BOILERPLATE_DIR_PREFIXES = [".github/", ".vscode/"]

const BOILERPLATE_CONFIG_PREFIXES = [
  "tsconfig.",
  "postcss.config.",
  "tailwind.config.",
  "next.config.",
  "vite.config.",
  "vitest.config.",
]

/**
 * Test whether a file path matches a known boilerplate pattern.
 */
export function isBoilerplate(path: string): boolean {
  const lower = path.toLowerCase()
  const fileName = lower.split("/").pop() ?? lower

  // Exact filename matches
  if (BOILERPLATE_PATTERNS.includes(fileName)) return true

  // Directory prefixes
  for (const prefix of BOILERPLATE_DIR_PREFIXES) {
    if (lower.startsWith(prefix)) return true
  }

  // Config file prefixes (e.g. tsconfig.build.json)
  for (const prefix of BOILERPLATE_CONFIG_PREFIXES) {
    if (fileName.startsWith(prefix)) return true
  }

  return false
}

// ── SHA helpers ─────────────────────────────────────────────────────

/**
 * Build a map from SHA → path for blob-type tree items, excluding boilerplate.
 */
export function buildShaMap(
  treeItems: RepoTreeItem[]
): Map<string, string> {
  const map = new Map<string, string>()
  for (const item of treeItems) {
    if (item.type === "blob" && !isBoilerplate(item.path)) {
      map.set(item.sha, item.path)
    }
  }
  return map
}

// ── Signal computations ─────────────────────────────────────────────

/**
 * Jaccard similarity: |A ∩ B| / |A ∪ B|
 */
export function computeShaJaccard(
  shaSetA: Set<string>,
  shaSetB: Set<string>
): number {
  let intersection = 0
  for (const sha of shaSetA) {
    if (shaSetB.has(sha)) intersection++
  }
  const union = shaSetA.size + shaSetB.size - intersection
  return union === 0 ? 0 : intersection / union
}

/**
 * Containment: |A ∩ B| / min(|A|, |B|)
 */
export function computeShaContainment(
  shaSetA: Set<string>,
  shaSetB: Set<string>
): number {
  const minSize = Math.min(shaSetA.size, shaSetB.size)
  if (minSize === 0) return 0

  let intersection = 0
  const smaller = shaSetA.size <= shaSetB.size ? shaSetA : shaSetB
  const larger = shaSetA.size <= shaSetB.size ? shaSetB : shaSetA
  for (const sha of smaller) {
    if (larger.has(sha)) intersection++
  }
  return intersection / minSize
}

/**
 * Jaccard similarity on file paths (after boilerplate filtering).
 */
export function computePathJaccard(
  pathsA: Set<string>,
  pathsB: Set<string>
): number {
  let intersection = 0
  for (const p of pathsA) {
    if (pathsB.has(p)) intersection++
  }
  const union = pathsA.size + pathsB.size - intersection
  return union === 0 ? 0 : intersection / union
}

/**
 * Jaccard on merged dependency + devDependency package-name sets.
 * Returns 0 if either repo has no dependencies at all.
 */
export function computeDependencyOverlap(
  depsA: Record<string, string> | undefined,
  depsB: Record<string, string> | undefined
): number {
  if (!depsA || !depsB) return 0

  const setA = new Set(Object.keys(depsA))
  const setB = new Set(Object.keys(depsB))

  if (setA.size === 0 || setB.size === 0) return 0

  let intersection = 0
  for (const d of setA) {
    if (setB.has(d)) intersection++
  }
  const union = setA.size + setB.size - intersection
  return union === 0 ? 0 : intersection / union
}

/**
 * Cosine similarity on language-count vectors.
 */
export function computeLanguageCosine(
  langA: Record<string, number>,
  langB: Record<string, number>
): number {
  const allLangs = new Set([...Object.keys(langA), ...Object.keys(langB)])
  if (allLangs.size === 0) return 0

  let dotProduct = 0
  let magA = 0
  let magB = 0

  for (const lang of allLangs) {
    const a = langA[lang] ?? 0
    const b = langB[lang] ?? 0
    dotProduct += a * b
    magA += a * a
    magB += b * b
  }

  const magnitude = Math.sqrt(magA) * Math.sqrt(magB)
  return magnitude === 0 ? 0 : dotProduct / magnitude
}

/**
 * Return paths from A whose SHA appears in B's SHA set.
 */
export function findIdenticalFiles(
  shaMapA: Map<string, string>,
  shaMapB: Map<string, string>
): string[] {
  const shaSetB = new Set(shaMapB.keys())
  const identical: string[] = []
  for (const [sha, path] of shaMapA) {
    if (shaSetB.has(sha)) {
      identical.push(path)
    }
  }
  return identical.sort()
}

// ── Merge helpers ───────────────────────────────────────────────────

function mergeDeps(
  deps: ComparisonRepo["dependencies"]
): Record<string, string> | undefined {
  if (!deps) return undefined
  return { ...deps.deps, ...deps.devDeps }
}

function extractPaths(treeItems: RepoTreeItem[]): Set<string> {
  const paths = new Set<string>()
  for (const item of treeItems) {
    if (item.type === "blob" && !isBoilerplate(item.path)) {
      paths.add(item.path)
    }
  }
  return paths
}

function labelFromScore(score: number): SimilarityLabel {
  if (score >= 0.80) return "likely-clone"
  if (score >= 0.50) return "highly-similar"
  if (score >= 0.20) return "some-overlap"
  return "different"
}

function detectRelationship(
  repoA: ComparisonRepo,
  repoB: ComparisonRepo
): RepoRelationship {
  const a = repoA.repo
  const b = repoB.repo

  // Direct fork: A is fork of B or B is fork of A
  if (a.isFork && a.parentFullName === b.fullName) {
    return { isForkPair: true, commonParent: b.fullName }
  }
  if (b.isFork && b.parentFullName === a.fullName) {
    return { isForkPair: true, commonParent: a.fullName }
  }

  // Both forked from the same parent
  if (
    a.isFork &&
    b.isFork &&
    a.parentFullName &&
    a.parentFullName === b.parentFullName
  ) {
    return { isForkPair: true, commonParent: a.parentFullName }
  }

  return { isForkPair: false }
}

// ── Public orchestrators ────────────────────────────────────────────

/**
 * Compute pairwise similarity between two repos using a multi-signal approach.
 */
export function computePairwiseSimilarity(
  repoA: ComparisonRepo,
  repoB: ComparisonRepo
): SimilarityResult {
  const treeA = repoA.treeItems ?? []
  const treeB = repoB.treeItems ?? []

  const shaMapA = buildShaMap(treeA)
  const shaMapB = buildShaMap(treeB)
  const shaSetA = new Set(shaMapA.keys())
  const shaSetB = new Set(shaMapB.keys())

  const pathsA = extractPaths(treeA)
  const pathsB = extractPaths(treeB)

  const mergedDepsA = mergeDeps(repoA.dependencies)
  const mergedDepsB = mergeDeps(repoB.dependencies)

  const langA = repoA.metrics.languageBreakdown
  const langB = repoB.metrics.languageBreakdown

  const signals: SimilaritySignals = {
    shaJaccard: computeShaJaccard(shaSetA, shaSetB),
    shaContainment: computeShaContainment(shaSetA, shaSetB),
    pathJaccard: computePathJaccard(pathsA, pathsB),
    dependencyOverlap: computeDependencyOverlap(mergedDepsA, mergedDepsB),
    languageCosine: computeLanguageCosine(langA, langB),
  }

  const score =
    signals.shaJaccard * WEIGHT_SHA_JACCARD +
    signals.shaContainment * WEIGHT_SHA_CONTAINMENT +
    signals.pathJaccard * WEIGHT_PATH_JACCARD +
    signals.dependencyOverlap * WEIGHT_DEPENDENCY_OVERLAP +
    signals.languageCosine * WEIGHT_LANGUAGE_COSINE

  const identicalFiles = findIdenticalFiles(shaMapA, shaMapB)
  const totalComparedFiles = shaSetA.size + shaSetB.size

  return {
    repoA: repoA.id,
    repoB: repoB.id,
    score,
    label: labelFromScore(score),
    signals,
    relationship: detectRelationship(repoA, repoB),
    identicalFiles,
    isLowConfidence: totalComparedFiles < 10
      || repoA.coverage?.treeStatus === 'partial'
      || repoB.coverage?.treeStatus === 'partial',
    totalComparedFiles,
  }
}

/**
 * Compute pairwise similarity for all unique repo pairs, sorted by score descending.
 */
export function computeAllSimilarities(
  repos: ComparisonRepo[]
): SimilarityResult[] {
  const results: SimilarityResult[] = []
  for (let i = 0; i < repos.length; i++) {
    for (let j = i + 1; j < repos.length; j++) {
      results.push(computePairwiseSimilarity(repos[i], repos[j]))
    }
  }
  return results.sort((a, b) => b.score - a.score)
}
