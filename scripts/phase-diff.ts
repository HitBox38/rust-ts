// Find the first compiler phase where rust-ts diverges from rustc on one file.
//   bun scripts/phase-diff.ts <file.rs> [--edition 2021] [--impl port|shim|stub]
// Paths are relative to the upstream checkout unless absolute. Full outputs are written
// to $RUST_TS_DATA/phase-diff/<phase>.{oracle,subject}.txt
// Both sides run in the file's directory, which nothing may write into (lane harness-w20c): every phase gets
// `--out-dir $RUST_TS_DATA/phase-diff/out` (rustc's output files: dep-info, the sdylib interface `lib<crate>.rs`,
// `<stem>.long-type-<hash>.txt` notes) and the check phase writes its metadata to stdout with `--emit=metadata=-`
// (was `-o -`, whose out dir is the cwd). Env: the caller's minus scripts/lib/env.ts's scrubbed variables, plus
// `RUSTC_ICE=0` (no `rustc-ice-*.txt` report in the cwd) and `RUST_BACKTRACE=0`, as the M2/M3 suites.
// MIR stage `mir-dump` (plan-m4 D11, lane harness-w21), before `mir`: both sides run `-Zunpretty=mir` with
// `-Zdump-mir=all -Zdump-mir-exclude-pass-number -Zdump-mir-dir=$RUST_TS_DATA/phase-diff/mir-dump/{oracle,subject}`
// (emptied first), and the stage reports the first dump file that differs in pass order (scripts/lib/mir-dump.ts:
// `<crate>.<item>.built.after.mir`, `<crate>.<item>.<Pass>.{before,after}.mir`, `renumber.0.mir`, `nll.0.mir`, ...),
// or that only one side wrote. Its stdout/stderr are not compared there; the `mir` phase compares them.
import { isAbsolute, join, dirname, basename } from "node:path";
import { rmSync, writeFileSync } from "node:fs";
import { DATA, REPO, UPSTREAM, ensureDir, parseArgs, run } from "./lib/common.ts";
import { caseEnv } from "./lib/env.ts";
import { dumpFilesInOrder, firstDumpDifference } from "./lib/mir-dump.ts";
import { upstreamChanges, upstreamError, upstreamStatus } from "./lib/upstream.ts";
import { oracleRustcCmd, verifyOraclePin } from "./lib/oracle.ts";

const PHASES: [string, string[]][] = [
  ["parse", ["-Zunpretty=ast-tree"]],
  ["expand", ["-Zunpretty=ast-tree,expanded"]],
  ["hir", ["-Zunpretty=hir-tree"]],
  ["thir", ["-Zunpretty=thir-tree"]],
  // + `-Zdump-mir-dir=<per side>` (see the header).
  ["mir-dump", ["-Zunpretty=mir", "-Zdump-mir=all", "-Zdump-mir-exclude-pass-number"]],
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

const dumpDir = (side: "oracle" | "subject") => join(out, "mir-dump", side);
for (const [phase, flags] of PHASES) {
  const args = [`--edition=${edition}`, ...flags, "--out-dir", outDir, rel];
  const dump = phase === "mir-dump";
  if (dump) for (const side of ["oracle", "subject"] as const) rmSync(dumpDir(side), { recursive: true, force: true });
  const sideArgs = (side: "oracle" | "subject") => (dump ? [`-Zdump-mir-dir=${dumpDir(side)}`, ...args] : args);
  const [o, s] = await Promise.all([
    run(oracleRustcCmd(sideArgs("oracle")), { cwd, timeoutMs: 120_000, env: oracleEnv }),
    run([process.execPath, join(REPO, "src/rust_ts/main.ts"), ...sideArgs("subject")], { cwd, timeoutMs: 120_000, env }),
  ]);
  if (dump) {
    const d = firstDumpDifference(dumpDir("oracle"), dumpDir("subject"));
    const n = dumpFilesInOrder(dumpDir("oracle")).length;
    if (!d) {
      console.log(`ok    ${phase} (${n} files)`);
      continue;
    }
    const exits = s.code === 70 ? "subject unported" : `exit ${s.code} vs ${o.code}`;
    console.log(`DIVERGES at phase '${phase}' (${exits}), file ${d.file} (${d.kind}; ${d.matched} of the oracle's ${n} files matched before it)${d.line ? `, line ${d.line}:` : ""}`);
    if (d.line) {
      console.log(`  - ${d.oracle ?? "<eof>"}`);
      console.log(`  + ${d.subject ?? "<eof>"}`);
    }
    if (s.code === 70) console.log(`  ${s.stderr.split("\n").find((l) => l.startsWith("rust-ts: unported")) ?? ""}`);
    console.log(`dump dirs: ${join(out, "mir-dump")}/{oracle,subject}`);
    checkUpstream();
    process.exit(1);
  }
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
