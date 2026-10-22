// Find the first compiler phase where rust-ts diverges from rustc on one file.
//   bun scripts/phase-diff.ts <file.rs> [--edition 2021] [--impl port|shim|stub]
// Paths are relative to the upstream checkout unless absolute. Full outputs are written
// to $RUST_TS_DATA/phase-diff/<phase>.{oracle,subject}.txt
// Both sides run in the file's directory, which nothing may write into (lane harness-w20c): every phase gets
// `--out-dir $RUST_TS_DATA/phase-diff/out` (rustc's output files: dep-info, the sdylib interface `lib<crate>.rs`,
// `<stem>.long-type-<hash>.txt` notes) and the check phase writes its metadata to stdout with `--emit=metadata=-`
// (was `-o -`, whose out dir is the cwd). Env: the caller's minus scripts/lib/env.ts's scrubbed variables, plus
// `RUSTC_ICE=0` (no `rustc-ice-*.txt` report in the cwd) and `RUST_BACKTRACE=0`, as the M2/M3 suites.
import { isAbsolute, join, dirname, basename } from "node:path";
import { writeFileSync } from "node:fs";
import { DATA, REPO, UPSTREAM, ensureDir, parseArgs, run } from "./lib/common.ts";
import { caseEnv } from "./lib/env.ts";
import { upstreamChanges, upstreamError, upstreamStatus } from "./lib/upstream.ts";
import { oracleRustcCmd, verifyOraclePin } from "./lib/oracle.ts";

const PHASES: [string, string[]][] = [
  ["parse", ["-Zunpretty=ast-tree"]],
  ["expand", ["-Zunpretty=ast-tree,expanded"]],
  ["hir", ["-Zunpretty=hir-tree"]],
  ["thir", ["-Zunpretty=thir-tree"]],
  ["mir", ["-Zunpretty=mir"]],
  ["check", ["--emit=metadata=-"]],
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
const outDir = join(out, "out");
const oracleEnv = caseEnv({ RUSTC_ICE: "0", RUST_BACKTRACE: "0" });
const env = { ...oracleEnv, RUST_TS_IMPL: typeof a.impl === "string" ? a.impl : "port" };
const upstreamBefore = upstreamStatus(UPSTREAM);
/** One `ERROR:` line if the upstream checkout changed since the start (this run or a concurrent process). */
const checkUpstream = () => {
  const changed = upstreamChanges(upstreamBefore, upstreamStatus(UPSTREAM));
  if (changed.length) console.log(upstreamError("the upstream checkout changed during phase-diff", changed, UPSTREAM));
};

for (const [phase, flags] of PHASES) {
  const args = [`--edition=${edition}`, ...flags, "--out-dir", outDir, rel];
  const [o, s] = await Promise.all([
    run(oracleRustcCmd(args), { cwd, timeoutMs: 120_000, env: oracleEnv }),
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
  checkUpstream();
  process.exit(1);
}
checkUpstream();
console.log("all phases match");
