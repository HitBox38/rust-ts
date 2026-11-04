// Marker and function-list check for this crate (lane mono-collector; not a port).
//   bun src/rustc_monomorphize/collector_oracle/check_markers.ts [--fix]
//
// `harness/scope.json` does not list rustc_monomorphize yet, so scripts/coverage.ts does not count it. This does the same
// two checks on the lane's own files: every `// rustc: <path>:<line> <name>` must point at `fn <name>` on that upstream
// line (--fix rewrites a wrong line number to the matching upstream `fn`, taken in file order), and every upstream `fn`
// must have a marker or `// rustc-skip:`. It also reports whether the markers appear in upstream order.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA, REPO } from "../../../scripts/lib/common.ts";

const FILES = ["lib", "util", "collector", "mono_checks/mod", "mono_checks/abi_check", "mono_checks/move_check"];
const FIX = process.argv.includes("--fix");
let bad = 0;

for (const f of FILES) {
  const upstream_path = `compiler/rustc_monomorphize/src/${f}.rs`;
  const upstream = readFileSync(join(DATA, "rust", upstream_path), "utf8").split("\n");
  const fns: { line: number; name: string }[] = [];
  upstream.forEach((text, i) => {
    if (/^\s*\/\//.test(text)) return;
    const m = /^\s*(?:pub(?:\([a-z]+\))? )?(?:const )?(?:unsafe )?fn ([a-zA-Z_0-9]+)/.exec(text);
    if (m) fns.push({ line: i + 1, name: m[1]! });
  });

  const ts_path = join(REPO, "src/rustc_monomorphize", `${f}.ts`);
  const ts = readFileSync(ts_path, "utf8").split("\n");
  const seen = new Set<number>();
  const order: number[] = [];
  ts.forEach((text, i) => {
    const m = /^(\s*)\/\/ rustc: (\S+):(\d+) (\S+)$/.exec(text);
    if (!m) return;
    const [, indent, path, line_s, name] = m;
    if (path !== upstream_path) {
      console.log(`ERROR: ${f}.ts:${i + 1}: marker path ${path}`);
      bad++;
      return;
    }
    let line = Number(line_s);
    if (!fns.some((x) => x.line === line && x.name === name)) {
      const candidate = fns.find((x) => x.name === name && !seen.has(x.line));
      if (FIX && candidate) {
        line = candidate.line;
        ts[i] = `${indent}// rustc: ${path}:${line} ${name}`;
      } else {
        console.log(`ERROR: ${f}.ts:${i + 1}: no \`fn ${name}\` at upstream line ${line}${candidate ? ` (it is at ${candidate.line})` : ""}`);
        bad++;
        return;
      }
    }
    seen.add(line);
    order.push(line);
  });
  if (FIX) writeFileSync(ts_path, ts.join("\n"));

  const missing = fns.filter((x) => !seen.has(x.line));
  const inversions = order.filter((l, i) => i > 0 && l < order[i - 1]!).length;
  console.log(`${f}: ${seen.size}/${fns.length} fns marked, ${inversions} out of upstream order`);
  for (const x of missing) {
    console.log(`ERROR: ${upstream_path}:${x.line} ${x.name} has no marker`);
    bad++;
  }
}
process.exitCode = bad === 0 ? 0 : 1;
