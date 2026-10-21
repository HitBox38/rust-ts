// State of the upstream checkout ($RUST_TS_DATA/rust) around a run (lane harness-w20c). Nothing a suite runs may
// write into it: a stray file can change a later case list or a case's dependencies (scripts/lib/deps.ts), and a
// stray under tests/ui would even become a case. Only `build/` is expected to change: compiletest's output
// directories (`build/<target>/test/ui/...`, harness/compiletest.ts), which upstream's .gitignore ignores and which
// neither test collection nor the dependency scan reads.
// (No imports: unit-testable without loading scripts/lib/common.ts; callers pass the checkout, `UPSTREAM`.)

/**
 * `git status --porcelain` lines of the upstream checkout, untracked files listed one by one and ignored files
 * included (rustc's `rustc-ice-*.txt` reports, for one, are ignored), except those under `build/`. Sorted. Throws if
 * git fails. `--no-optional-locks`: concurrent runs must not contend for the index lock.
 */
export function upstreamStatus(dir: string): string[] {
  const r = Bun.spawnSync(["git", "--no-optional-locks", "-c", "core.quotePath=false", "status", "--porcelain", "--ignored", "--untracked-files=all"], { cwd: dir, stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== 0) throw new Error(`git status of the upstream checkout ${dir} failed: ${r.stderr.toString().trim()}`);
  return r.stdout
    .toString()
    .split("\n")
    .filter((l) => l !== "" && !/^.. "?build\//.test(l))
    .sort();
}

/** Lines of `after` that `before` lacks: what changed in the checkout between two `upstreamStatus` calls. */
export function upstreamChanges(before: readonly string[], after: readonly string[]): string[] {
  const b = new Set(before);
  return after.filter((l) => !b.has(l));
}

/** One `ERROR:` line for a non-empty status of the checkout `dir`, naming up to 3 paths. */
export function upstreamError(what: string, lines: readonly string[], dir: string): string {
  return `ERROR: ${what}: ${lines.length} path(s) in the upstream checkout ${dir} (${lines.slice(0, 3).join("; ")}${lines.length > 3 ? "; ..." : ""}); move strays to $RUST_TS_DATA/tmp/upstream-strays/`;
}
