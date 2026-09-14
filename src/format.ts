import type { Diff } from './types'

export interface FormatOptions {
  /** Emit a single-line JSON object instead of the human sentence. */
  json?: boolean
}

export function formatDiff(d: Diff, options: FormatOptions = {}): string {
  if (options.json) return JSON.stringify(d)

  if (d.changeType === 'none') return `${d.from} and ${d.to} are the same version`

  return `${d.from} -> ${d.to}: ${d.changeType} ${d.direction}`
}
