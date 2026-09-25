import type { ChangeType, Diff, Version } from './types'

// Grammar straight from the semver.org spec (BNF section), translated to a
// single regex so parsing and validation happen in one pass.
const SEMVER_RE =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/

export function toIdentifier(raw: string): string | number {
  // The grammar only allows a bare numeric identifier to be all digits with
  // no leading zero (or "0" itself), so this check doubles as the "is it
  // safe to treat as a number" check.
  return /^(0|[1-9]\d*)$/.test(raw) ? Number(raw) : raw
}

export function parse(input: string): Version | null {
  const match = SEMVER_RE.exec(input.trim())
  if (!match) return null

  const [, majorStr, minorStr, patchStr, prereleaseStr, buildStr] = match

  return {
    major: Number(majorStr),
    minor: Number(minorStr),
    patch: Number(patchStr),
    prerelease: prereleaseStr ? prereleaseStr.split('.').map(toIdentifier) : [],
    build: buildStr ? buildStr.split('.') : [],
  }
}

export function parseOrThrow(input: string): Version {
  const parsed = parse(input)
  if (!parsed) throw new Error(`not a valid semantic version: ${JSON.stringify(input)}`)
  return parsed
}

export function toString(version: Version): string {
  let out = `${version.major}.${version.minor}.${version.patch}`
  if (version.prerelease.length > 0) out += `-${version.prerelease.join('.')}`
  if (version.build.length > 0) out += `+${version.build.join('.')}`
  return out
}

function compareIdentifier(a: string | number, b: string | number): number {
  const aIsNumeric = typeof a === 'number'
  const bIsNumeric = typeof b === 'number'

  // Spec rule: numeric identifiers always have lower precedence than
  // alphanumeric ones, regardless of value.
  if (aIsNumeric && bIsNumeric) return a === b ? 0 : a < b ? -1 : 1
  if (aIsNumeric) return -1
  if (bIsNumeric) return 1
  return a === b ? 0 : a < b ? -1 : 1
}

/** Compares by precedence per semver 2.0.0: build metadata is ignored. */
export function compareVersions(a: Version, b: Version): number {
  if (a.major !== b.major) return a.major < b.major ? -1 : 1
  if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1
  if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1

  // A pre-release version has lower precedence than the associated normal
  // version, so "no prerelease" wins over "has one".
  if (a.prerelease.length === 0 && b.prerelease.length === 0) return 0
  if (a.prerelease.length === 0) return 1
  if (b.prerelease.length === 0) return -1

  const len = Math.max(a.prerelease.length, b.prerelease.length)
  for (let i = 0; i < len; i++) {
    if (i >= a.prerelease.length) return -1
    if (i >= b.prerelease.length) return 1
    const cmp = compareIdentifier(a.prerelease[i]!, b.prerelease[i]!)
    if (cmp !== 0) return cmp
  }
  return 0
}

export function compare(a: string, b: string): number {
  return compareVersions(parseOrThrow(a), parseOrThrow(b))
}

function arraysEqual(a: ReadonlyArray<unknown>, b: ReadonlyArray<unknown>): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i])
}

/**
 * Classifies the highest-level field that changed between two versions and
 * the resulting precedence direction. Build metadata differences are
 * reported but never affect direction, since the spec says they carry no
 * precedence weight.
 */
export function diff(fromInput: string, toInput: string): Diff {
  const from = parseOrThrow(fromInput)
  const to = parseOrThrow(toInput)

  let changeType: ChangeType
  if (from.major !== to.major) changeType = 'major'
  else if (from.minor !== to.minor) changeType = 'minor'
  else if (from.patch !== to.patch) changeType = 'patch'
  else if (!arraysEqual(from.prerelease, to.prerelease)) changeType = 'prerelease'
  else if (!arraysEqual(from.build, to.build)) changeType = 'build'
  else changeType = 'none'

  const cmp = compareVersions(from, to)
  const direction = cmp === 0 ? 'same' : cmp < 0 ? 'upgrade' : 'downgrade'

  return { from: toString(from), to: toString(to), changeType, direction }
}
