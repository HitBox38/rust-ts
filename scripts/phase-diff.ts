// Find the first compiler phase where rust-ts diverges from rustc on one file.
//   bun scripts/phase-diff.ts <file.rs> [--edition 2021] [--impl port|shim|stub]
// Paths are relative to the upstream checkout unless absolute. Full outputs are written
// to $RUST_TS_DATA/phase-diff/<phase>.{oracle,subject}.txt
import { isAbsolute, join, dirname, basename } from "node:path";
import { writeFileSync } from "node:fs";
import { DATA, REPO, UPSTREAM, ensureDir, parseArgs, run } from "./lib/common.ts";
import { oracleRustcCmd, verifyOraclePin } from "./lib/oracle.ts";

const PHASES: [string, string[]][] = [
  ["parse", ["-Zunpretty=ast-tree"]],
  ["expand", ["-Zunpretty=ast-tree,expanded"]],
  ["hir", ["-Zunpretty=hir-tree"]],
  ["thir", ["-Zunpretty=thir-tree"]],
  ["mir", ["-Zunpretty=mir"]],
  ["check", ["--emit=metadata", "-o", "-"]],
];

const a = parseArgs(process.argv.slice(2));
const file = a._[0];
if (!file) {
  console.log("usage: bun scripts/phase-diff.ts <file.rs> [--edition E] [--impl I]");
  process.exit(0);
}
await verifyOraclePin();
const abs = isAbsolute(file) ? file : join(UPSTREAM, file);
const cwd = dirname(abs);
const rel = basename(abs);
const edition = typeof a.edition === "string" ? a.edition : "2021";
const out = ensureDir(join(DATA, "phase-diff"));
const env = { RUST_TS_IMPL: typeof a.impl === "string" ? a.impl : "port" };

for (const [phase, flags] of PHASES) {
  const args = [`--edition=${edition}`, ...flags, rel];
  const [o, s] = await Promise.all([
    run(oracleRustcCmd(args), { cwd, timeoutMs: 120_000 }),
    run([process.execPath, join(REPO, "src/rust_ts/main.ts"), ...args], { cwd, timeoutMs: 120_000, env }),
  ]);
  const ot = `${o.stdout}\n--- stderr ---\n${o.stderr}\n--- exit: ${o.code} ---\n`;
  const st = `${s.stdout}\n--- stderr ---\n${s.stderr}\n--- exit: ${s.code} ---\n`;
  writeFileSync(join(out, `${phase}.oracle.txt`), ot);
  writeFileSync(join(out, `${phase}.subject.txt`), st);
  if (ot === st) {
    console.log(`ok    ${phase}`);
    continue;
  }
  const ol = ot.split("\n");
  const sl = st.split("\n");
  let i = 0;
  while (ol[i] === sl[i]) i++;
  console.log(`DIVERGES at phase '${phase}' (${s.code === 70 ? "unported" : `exit ${s.code} vs ${o.code}`}), line ${i + 1}:`);
  for (let k = Math.max(0, i - 3); k < i; k++) console.log(`    ${ol[k]}`);
  console.log(`  - ${ol[i] ?? "<eof>"}`);
  console.log(`  + ${sl[i] ?? "<eof>"}`);
  console.log(`full outputs: ${join(out, phase)}.{oracle,subject}.txt`);
  process.exit(1);
}
console.log("all phases match");
