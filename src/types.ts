export interface Version {
  readonly major: number
  readonly minor: number
  readonly patch: number
  readonly prerelease: ReadonlyArray<string | number>
  readonly build: ReadonlyArray<string>
}

export type ChangeType = 'major' | 'minor' | 'patch' | 'prerelease' | 'build' | 'none'

export interface Diff {
  readonly from: string
  readonly to: string
  readonly changeType: ChangeType
  readonly direction: 'upgrade' | 'downgrade' | 'same'
}
