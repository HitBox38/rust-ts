// What `Suite.inputDirs` contributes to the oracle cache key (scripts/difftest.ts `inputDirsHash`), as text to hash: one line per file
// under the input directories, sorted by path, `<path>\0<content hash>`. No imports beyond node:, so tests load it without
// scripts/lib/common.ts.
//
// **Symbolic links** (review harness-m8a-build-recheck R1): the walk follows no link to a directory. A link that resolves to a file is
// hashed by that file's contents, as before. A link that resolves to a directory, or to nothing, is hashed by its link text, as
// `<path>\0-> <target>`. Both used to throw (`EISDIR`, `ENOENT`) from the read, so no suite whose key computed before has a different key now:
// cargo's pinned source tree (`cargo-build`) holds 93 links to directories, such as
// `tests/testsuite/cargo_remove/dry_run/in -> ../remove-basic.in/`.
import { readdirSync, readFileSync, readlinkSync, statSync } from "node:fs";
import { join } from "node:path";

/** The lines `inputDirsHash` hashes, joined with `\n`; `fileHash` is the hash of one file's contents. */
export function inputDirsText(cwd: string, dirs: readonly string[], fileHash: (b: Uint8Array) => string): string {
  const files: { rel: string; link: boolean }[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(join(cwd, d), { withFileTypes: true })) {
      const rel = `${d}/${e.name}`;
      if (e.isDirectory()) walk(rel);
      else files.push({ rel, link: e.isSymbolicLink() });
    }
  };
  for (const d of dirs) walk(d);
  files.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  return files.map(({ rel, link }) => `${rel}\0${link && !resolvesToFile(join(cwd, rel)) ? `-> ${readlinkSync(join(cwd, rel))}` : fileHash(readFileSync(join(cwd, rel)))}`).join("\n");
}

/** Whether `p` (a symbolic link) resolves to something that is not a directory. */
function resolvesToFile(p: string): boolean {
  try {
    return !statSync(p).isDirectory();
  } catch {
    return false;
  }
}
