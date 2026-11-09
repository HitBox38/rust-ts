// Dumps the oracle cache key of every registered case (lane subject-bin): proof that a harness change moved no key.
//
//   bun scripts/oracle-keys.ts --out <file> [--suite S]...
//
// One line per case, `<suite>\t<case id>\t<key>` (scripts/difftest.ts `oracleCacheKey`, with the same file hash and
// dependencies difftest uses), suites in registration order; a suite whose cases cannot be listed here gets one
// `<suite>\tERROR\t<message>` line. Each suite runs in its own process, so one that exits does not end the dump. Prints the
// number of keys and the dump's sha1; compare two dumps with `cmp`.
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SUITES, suite as getSuite } from "../harness/suites.ts";
import { cwdOf, depsOf, oracleCacheKey } from "./difftest.ts";
import { hash, parseArgs } from "./lib/common.ts";

const a = parseArgs(process.argv.slice(2));
const out = typeof a.out === "string" ? a.out : undefined;
if (out === undefined) {
  console.log("usage: bun scripts/oracle-keys.ts --out <file> [--suite S]");
  process.exit(1);
}

if (typeof a.one === "string") {
  // The child: one suite's keys, appended to `out`.
  const s = getSuite(a.one);
  const lines: string[] = [];
  for (const c of s.cases()) {
    const fileHash = c.file === "" ? "" : hash(readFileSync(join(cwdOf(s), c.file)));
    lines.push(`${s.name}\t${c.id}\t${oracleCacheKey(s, c, fileHash, depsOf(s, c))}\n`);
  }
  appendFileSync(out, lines.join(""));
  process.exit(0);
}

const names = a.suite === undefined ? SUITES.map((s) => s.name) : ([] as string[]).concat(a.suite as string | string[]);
writeFileSync(out, "");
let errors = 0;
for (const name of names) {
  const r = Bun.spawnSync([process.execPath, import.meta.path, "--out", out, "--one", name], { stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== 0) {
    errors++;
    const why = (r.stdout.toString() + r.stderr.toString()).split("\n").find((l) => l.trim() !== "") ?? `exit ${r.exitCode}`;
    appendFileSync(out, `${name}\tERROR\t${why.trim()}\n`);
  }
}
const text = readFileSync(out);
console.log(`${text.toString().split("\n").filter((l) => l !== "" && !l.includes("\tERROR\t")).length} keys, ${errors} suite(s) not listed, sha1 ${hash(text)}: ${out}`);
