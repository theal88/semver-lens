import type { Version } from './types'
import { toIdentifier, toString as versionToString } from './semver'

export type ComparatorOperator = '=' | '>' | '>=' | '<' | '<='

export interface Comparator {
  readonly operator: ComparatorOperator
  readonly version: Version
}

/**
 * A range is an OR of AND-sets ("1.x || ^2.0.0" -> two AND-sets). An empty
 * AND-set means "matches any version" (what a bare "*" or "" branch parses
 * to), so callers can fold over the comparators without special-casing it.
 */
export type Range = ReadonlyArray<ReadonlyArray<Comparator>>

interface PartialVersion {
  readonly major: number | null
  readonly minor: number | null
  readonly patch: number | null
  readonly prerelease: ReadonlyArray<string | number>
  readonly build: ReadonlyArray<string>
}

const XR_SRC = '(?:x|X|\\*|0|[1-9]\\d*)'
const PRERELEASE_SRC =
  '(?:0|[1-9]\\d*|\\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\\.(?:0|[1-9]\\d*|\\d*[a-zA-Z-][0-9a-zA-Z-]*))*'
const BUILD_SRC = '[0-9a-zA-Z-]+(?:\\.[0-9a-zA-Z-]+)*'

// No capturing groups of its own, so it can be wrapped in a single group
// wherever it's embedded (e.g. twice, for the two sides of a hyphen range).
const PARTIAL_TOKEN_SRC = `${XR_SRC}(?:\\.${XR_SRC}(?:\\.${XR_SRC}(?:-${PRERELEASE_SRC})?(?:\\+${BUILD_SRC})?)?)?`

const PARTIAL_RE = new RegExp(
  `^(${XR_SRC})(?:\\.(${XR_SRC})(?:\\.(${XR_SRC})(?:-(${PRERELEASE_SRC}))?(?:\\+(${BUILD_SRC}))?)?)?$`,
)
const HYPHEN_RE = new RegExp(`^(${PARTIAL_TOKEN_SRC})\\s+-\\s+(${PARTIAL_TOKEN_SRC})$`)
const PRIMITIVE_OP_RE = /^(>=|<=|<|>|=)/

function xrToNumberOrNull(raw: string | undefined): number | null {
  if (raw === undefined || raw === 'x' || raw === 'X' || raw === '*') return null
  return Number(raw)
}

function parsePartial(token: string): PartialVersion | null {
  const match = PARTIAL_RE.exec(token)
  if (!match) return null

  const [, majorStr, minorStr, patchStr, prereleaseStr, buildStr] = match
  return {
    major: xrToNumberOrNull(majorStr),
    minor: xrToNumberOrNull(minorStr),
    patch: xrToNumberOrNull(patchStr),
    prerelease: prereleaseStr ? prereleaseStr.split('.').map(toIdentifier) : [],
    build: buildStr ? buildStr.split('.') : [],
  }
}

// 0 = only "*" given, 1 = major only, 2 = major.minor only, 3 = fully specified.
function wildcardIndex(p: PartialVersion): 0 | 1 | 2 | 3 {
  if (p.major === null) return 0
  if (p.minor === null) return 1
  if (p.patch === null) return 2
  return 3
}

function toVersion(major: number, minor: number, patch: number, p: PartialVersion): Version {
  return { major, minor, patch, prerelease: p.prerelease, build: p.build }
}

function lowerBound(p: PartialVersion): Version {
  return toVersion(p.major ?? 0, p.minor ?? 0, p.patch ?? 0, p)
}

// The version just past the range implied by the wildcard, e.g. "1.2.x" ->
// 1.3.0, "1.x" -> 2.0.0. Only meaningful when there is an actual wildcard.
function upperBoundExclusive(p: PartialVersion): Version {
  const w = wildcardIndex(p)
  if (w === 1) return { major: (p.major as number) + 1, minor: 0, patch: 0, prerelease: [], build: [] }
  return { major: p.major as number, minor: (p.minor as number) + 1, patch: 0, prerelease: [], build: [] }
}

function expandComparator(operator: ComparatorOperator | null, p: PartialVersion): Comparator[] {
  const w = wildcardIndex(p)

  if (w === 3) {
    return [{ operator: operator ?? '=', version: toVersion(p.major as number, p.minor as number, p.patch as number, p) }]
  }
  if (w === 0) return [] // "*", ">*", etc. all reduce to "matches anything"

  const lower = lowerBound(p)
  const upper = upperBoundExclusive(p)

  switch (operator) {
    case null:
    case '=':
      return [
        { operator: '>=', version: lower },
        { operator: '<', version: upper },
      ]
    case '>':
      return [{ operator: '>=', version: upper }]
    case '>=':
      return [{ operator: '>=', version: lower }]
    case '<':
      return [{ operator: '<', version: lower }]
    case '<=':
      return [{ operator: '<', version: upper }]
  }
}

// ~1.2.3 := >=1.2.3 <1.3.0, ~1.2 := >=1.2.0 <1.3.0, ~1 := >=1.0.0 <2.0.0
function tildeRange(p: PartialVersion): Comparator[] {
  const w = wildcardIndex(p)
  if (w === 0) return []

  const major = p.major as number
  if (w === 1) {
    return [
      { operator: '>=', version: toVersion(major, 0, 0, p) },
      { operator: '<', version: { major: major + 1, minor: 0, patch: 0, prerelease: [], build: [] } },
    ]
  }

  const minor = p.minor as number
  const patch = p.patch ?? 0
  return [
    { operator: '>=', version: toVersion(major, minor, patch, p) },
    { operator: '<', version: { major, minor: minor + 1, patch: 0, prerelease: [], build: [] } },
  ]
}

// Caret allows changes that don't touch the leftmost non-zero component.
// ^1.2.3 := >=1.2.3 <2.0.0, ^0.2.3 := >=0.2.3 <0.3.0, ^0.0.3 := >=0.0.3 <0.0.4
function caretRange(p: PartialVersion): Comparator[] {
  const w = wildcardIndex(p)
  if (w === 0) return []

  const major = p.major as number
  if (w === 1) {
    return [
      { operator: '>=', version: toVersion(major, 0, 0, p) },
      { operator: '<', version: { major: major + 1, minor: 0, patch: 0, prerelease: [], build: [] } },
    ]
  }

  const minor = p.minor as number
  if (w === 2) {
    const upper =
      major !== 0
        ? { major: major + 1, minor: 0, patch: 0, prerelease: [], build: [] }
        : { major, minor: minor + 1, patch: 0, prerelease: [], build: [] }
    return [{ operator: '>=', version: toVersion(major, minor, 0, p) }, { operator: '<', version: upper }]
  }

  const patch = p.patch as number
  let upper: Version
  if (major !== 0) upper = { major: major + 1, minor: 0, patch: 0, prerelease: [], build: [] }
  else if (minor !== 0) upper = { major, minor: minor + 1, patch: 0, prerelease: [], build: [] }
  else upper = { major, minor, patch: patch + 1, prerelease: [], build: [] }

  return [{ operator: '>=', version: toVersion(major, minor, patch, p) }, { operator: '<', version: upper }]
}

function parseToken(token: string): Comparator[] | null {
  if (token === '' || token === '*') return []

  if (token[0] === '~') {
    const p = parsePartial(token.slice(1))
    return p ? tildeRange(p) : null
  }
  if (token[0] === '^') {
    const p = parsePartial(token.slice(1))
    return p ? caretRange(p) : null
  }

  const opMatch = PRIMITIVE_OP_RE.exec(token)
  const operator = (opMatch?.[1] as ComparatorOperator | undefined) ?? null
  const rest = operator ? token.slice(operator.length) : token
  const p = parsePartial(rest)
  return p ? expandComparator(operator, p) : null
}

function parseHyphenRange(fromToken: string, toToken: string): Comparator[] | null {
  const from = parsePartial(fromToken)
  const to = parsePartial(toToken)
  if (!from || !to) return null

  const lower: Comparator = { operator: '>=', version: lowerBound(from) }

  const toWildcard = wildcardIndex(to)
  if (toWildcard === 0) return [lower]

  const upper: Comparator =
    toWildcard === 3
      ? { operator: '<=', version: toVersion(to.major as number, to.minor as number, to.patch as number, to) }
      : { operator: '<', version: upperBoundExclusive(to) }

  return [lower, upper]
}

function parseComparatorSet(branch: string): Comparator[] | null {
  const trimmed = branch.trim()
  if (trimmed.length === 0) return []

  // Let "operator, space, version" (">= 1.2.3") parse the same as the
  // no-space form before we split the set into individual tokens.
  const normalized = trimmed.replace(/(>=|<=|<|>|=)\s+/g, '$1')

  const hyphenMatch = HYPHEN_RE.exec(normalized)
  if (hyphenMatch) return parseHyphenRange(hyphenMatch[1]!, hyphenMatch[2]!)

  const comparators: Comparator[] = []
  for (const token of normalized.split(/\s+/)) {
    const parsed = parseToken(token)
    if (parsed === null) return null
    comparators.push(...parsed)
  }
  return comparators
}

/**
 * Parses an npm-style range string ("^1.2.3", "~1.2", ">=1.0.0 <2.0.0",
 * "1.2.x", "1.2.3 - 2.3.4", "1.x || 2.x") into an OR-of-AND-sets of plain
 * comparators. Returns null if any branch of the range is malformed.
 */
export function parseRange(input: string): Range | null {
  const branches = input.trim().split(/\s*\|\|\s*/)
  const range: Comparator[][] = []
  for (const branch of branches) {
    const set = parseComparatorSet(branch)
    if (set === null) return null
    range.push(set)
  }
  return range
}

/** Renders a parsed range back to its canonical comparator-set form. */
export function rangeToString(range: Range): string {
  return range
    .map((andSet) =>
      andSet.length === 0
        ? '*'
        : andSet.map((c) => `${c.operator === '=' ? '' : c.operator}${versionToString(c.version)}`).join(' '),
    )
    .join(' || ')
}
