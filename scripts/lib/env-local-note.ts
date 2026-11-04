// A worktree with no `.env.local` has no RUST_TS_DATA or RUST_TS_HOST_TUPLE for the tests' child processes, so the tests
// that need the upstream checkout, the oracle or a probe skip and `bun test` still exits 0, which reads as a real pass
// (review harness-m6c-recheck, "False green"). bunfig.toml preloads this file, so every `bun test` from the repo root
// prints one line about it, after the last test and just before the summary, where `| tail` still shows it (Bun 1.4.3
// runs no `process.on("exit")` handler under `bun test`). It does not change any result or exit code, and with a
// `.env.local` (the gate's root host) it prints nothing. Imports no harness code: scripts/lib/common.ts fixes
// RUST_TS_DATA when it first loads, and scripts/lib/deps.test.ts sets its own first.
import { afterAll } from "bun:test";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

/** The line to print for a checkout at `repo`, or undefined when it has a `.env.local`. */
export function envLocalNote(repo: string): string | undefined {
  const file = join(repo, ".env.local");
  if (existsSync(file)) return undefined;
  return `WARNING: no ${file}: tests that need RUST_TS_DATA or RUST_TS_HOST_TUPLE skipped, and a 0 exit does not cover them; copy it from the main checkout and rerun with RUST_TS_REQUIRE_PROBES=1`;
}

const note = envLocalNote(resolve(import.meta.dir, "..", ".."));
if (note !== undefined) afterAll(() => console.error(note));
