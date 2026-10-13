// Scratch directories for tests (not a port). Each call makes a fresh directory under `$RUST_TS_DATA/tmp`
// that is unique to this process (`mkdtemp`), so tests of two worktrees (or two runs) never share or delete
// each other's files, and removes it when the test file is done. Call it at module scope of a test file.
import { afterAll } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { DATA } from "../../scripts/lib/common.ts";

/** A new, empty directory `$RUST_TS_DATA/tmp/<name>-<pid>-XXXXXX`, removed after the file's tests. */
export function test_scratch_dir(name: string): string {
  const base = join(DATA, "tmp");
  mkdirSync(base, { recursive: true });
  const dir = mkdtempSync(join(base, `${name}-${process.pid}-`));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
