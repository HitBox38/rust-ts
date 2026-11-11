// Where the pinned checkout is, for runner unit tests that must not load scripts/lib/common.ts (lane scope-m7). The gate runs the
// scripts/ and harness/ tests in one process, and common.ts fixes RUST_TS_DATA when it first loads: a test file that loads it
// before scripts/lib/deps.test.ts has set its temp RUST_TS_DATA points that file's oracle cache at the shared one. This reads
// the variable when called, the way common.ts does when it loads: the environment, else `<repo>/.env.local`, else `<repo>/.data`.
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

/** The repo this file is in. */
export const REPO_ROOT = resolve(import.meta.dir, "..", "..");

/** `$RUST_TS_DATA` as common.ts would resolve it now. */
export function dataDir(repo: string = REPO_ROOT): string {
  let data = process.env.RUST_TS_DATA;
  const envLocal = join(repo, ".env.local");
  if (data === undefined && existsSync(envLocal)) {
    for (const line of readFileSync(envLocal, "utf8").split(/\r?\n/)) {
      const m = /^\s*RUST_TS_DATA\s*=\s*(.*?)\s*$/.exec(line);
      if (m) data = m[1]!;
    }
  }
  return resolve(data ?? join(repo, ".data"));
}

/** The pinned upstream rust checkout (`$RUST_TS_DATA/rust`). */
export const upstreamRoot = (repo: string = REPO_ROOT): string => join(dataDir(repo), "rust");

/** `UPSTREAM.json`'s rust commit. */
export const pinCommit = (repo: string = REPO_ROOT): string => (JSON.parse(readFileSync(join(repo, "UPSTREAM.json"), "utf8")) as { rust: { commit: string } }).rust.commit;
