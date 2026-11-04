// Marker check of this lane's files (lane mono-partition; not a port): `rustc_monomorphize` is not in harness/scope.json
// yet, so scripts/coverage.ts does not count it. Remove this once root adds the crate.
//   bun src/rustc_monomorphize/partitioning_oracle/check_markers.ts
//
// Every upstream `fn` line must have a `// rustc:` or `// rustc-skip:` marker with its line and name, no marker may point
// at no fn, and markers must run in upstream order. Prints one line per file; exits 1 on any problem.
import { readFileSync } from "node:fs";
import { UPSTREAM } from "../../../scripts/lib/common.ts";

const FILES: [string, string][] = [
  ["compiler/rustc_monomorphize/src/partitioning.rs", "src/rustc_monomorphize/partitioning.ts"],
  ["compiler/rustc_monomorphize/src/graph_checks/mod.rs", "src/rustc_monomorphize/graph_checks/mod.ts"],
  ["compiler/rustc_monomorphize/src/graph_checks/statics.rs", "src/rustc_monomorphize/graph_checks/statics.ts"],
  ["compiler/rustc_middle/src/mono.rs", "src/rustc_middle/mono.ts"],
];

let bad = false;
for (const [upstream, port] of FILES) {
  const fns: string[] = [];
  readFileSync(`${UPSTREAM}/${upstream}`, "utf8").split("\n").forEach((line, i) => {
    const m = /^\s*(?:pub(?:\([a-z]+\))?\s+)?(?:const\s+)?(?:unsafe\s+)?fn\s+([a-zA-Z0-9_]+)/.exec(line);
    if (m !== null) fns.push(`${upstream}:${i + 1} ${m[1]}`);
  });
  const text = readFileSync(port, "utf8");
  const markers = [...text.matchAll(/\/\/ rustc(?:-skip)?: (\S+:(\d+) [a-zA-Z0-9_]+)/g)];
  const marked = new Set(markers.map((m) => m[1]!));
  const missing = fns.filter((f) => !marked.has(f));
  const stale = [...marked].filter((m) => !fns.includes(m));
  const lines = markers.map((m) => Number(m[2]));
  const inversions = lines.filter((l, i) => i > 0 && l < lines[i - 1]!).length;
  if (missing.length + stale.length + inversions > 0) bad = true;
  console.log(`${upstream}: ${fns.length - missing.length}/${fns.length} missing=${JSON.stringify(missing)} stale=${JSON.stringify(stale)} order_inversions=${inversions}`);
}
process.exitCode = bad ? 1 : 0;
