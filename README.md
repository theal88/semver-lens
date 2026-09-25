# semver-lens

A small TypeScript library for parsing, comparing, and diffing semantic
versions (semver.org 2.0.0). No dependencies.

## Why

Comparing two version strings correctly is more fiddly than it looks:
prerelease tags (`1.2.3-alpha.1`) sort *before* the plain release, numeric
identifiers in a prerelease sort before alphanumeric ones regardless of
value, and build metadata (`+build.5`) has no effect on ordering at all. It's
easy to get this wrong with a naive string or float comparison. This library
implements the spec's precedence rules directly instead of approximating
them.

The other recurring need is telling *what kind* of change happened between
two versions (major/minor/patch/prerelease/build) and in which direction,
which is useful for changelogs, release gating, or dependency audits. That's
what `diff` and `formatDiff` are for — including a machine-readable JSON mode
for callers that want to pipe the result somewhere else instead of printing
it.

## Usage

```ts
import { compare, diff, formatDiff, parse } from 'semver-lens'

parse('1.2.3-beta.1+exp.sha.5114f85')
// {
//   major: 1, minor: 2, patch: 3,
//   prerelease: ['beta', 1],
//   build: ['exp', 'sha', '5114f85'],
// }

parse('not a version') // null

compare('1.2.3', '1.10.0') // -1 (1.2.3 sorts before 1.10.0)
compare('1.0.0-alpha', '1.0.0') // -1 (prerelease sorts before release)

const result = diff('1.4.2', '2.0.0')
// { from: '1.4.2', to: '2.0.0', changeType: 'major', direction: 'upgrade' }

formatDiff(result)
// '1.4.2 -> 2.0.0: major upgrade'

formatDiff(result, { json: true })
// '{"from":"1.4.2","to":"2.0.0","changeType":"major","direction":"upgrade"}'
```

`parse` returns `null` on invalid input rather than throwing, so it composes
well with validation code. Use `parseOrThrow` when you'd rather fail loudly.

### Ranges

```ts
import { parseRange, rangeToString } from 'semver-lens'

parseRange('^1.2.3')
// [[{ operator: '>=', version: <1.2.3> }, { operator: '<', version: <2.0.0> }]]

parseRange('1.2.x || >=3.0.0 <4.0.0')
// two OR branches, each an AND-set of comparators

rangeToString(parseRange('~1.2')!) // '>=1.2.0 <1.3.0'
```

`parseRange` understands caret (`^`), tilde (`~`), x-ranges (`1.2.x`, `1.x`),
hyphen ranges (`1.2.3 - 2.3.4`), comparator sets (`>=1.0.0 <2.0.0`), and `||`
alternation, and normalizes all of them down to plain `>=`/`<`/`=` comparator
sets. It returns `null` on a malformed range rather than throwing. There is
no `satisfies(version, range)` yet to actually test a version against the
parsed result.

## Status

Early skeleton: parsing, precedence comparison, diffing, and range parsing
are implemented and follow the semver 2.0.0 spec's grammar and comparison
rules. Testing a version against a range (`satisfies`) is not implemented
yet.

## Install

Not published yet. Clone the repo and `import` from `src/index.ts`, or run
`tsc` to emit `dist/`.

## License

MIT, see [LICENSE](LICENSE).
