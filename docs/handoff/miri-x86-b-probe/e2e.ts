// End-to-end check of lane miri-x86-b: runs every fixture program (src/miri/intrinsics/x86/fixtures) through the port's
// Miri, exactly as the suites run it, and compares exit code, stdout and normalised stderr with its .oracle.txt. It needs
// miri-x86-a's `emulate_x86_intrinsic` dispatch, so root runs it after merging both lanes:
//   bun docs/handoff/miri-x86-b-probe/e2e.ts [--jobs N] [--timeout-ms N] [name..]
// Prints one line per program; a per-program log with both sides goes to $RUST_TS_DATA/tmp/miri-x86-b/.
import { readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { miriSubject } from "../../../harness/suites.ts";
import { DATA, ensureDir, parseArgs, pool, run } from "../../../scripts/lib/common.ts";
import { caseEnv } from "../../../scripts/lib/env.ts";
import { MIRI_CASE_ENV, MIRI_SYSROOT, miriPin } from "../../../scripts/lib/miri.ts";
import { flags_of, normalise_stderr, programs } from "./gen.ts";

const REPO = join(import.meta.dir, "../../..");
const FIXTURES = join(REPO, "src/miri/intrinsics/x86/fixtures");
const LOGS = ensureDir(join(DATA, "tmp", "miri-x86-b"));

const a = parseArgs(process.argv.slice(2));
const names = a._ as string[];
const list = programs().filter((f) => names.length === 0 || names.includes(basename(f, ".rs")));
const jobs = Number(a.jobs ?? 4);
const timeoutMs = Number(a["timeout-ms"] ?? 1_800_000);

const results = await pool(list, jobs, async (f) => {
  const name = basename(f, ".rs");
  const flags = flags_of(readFileSync(join(FIXTURES, f), "utf8"));
  const argv = miriSubject([f, "--sysroot", MIRI_SYSROOT, "--target", miriPin().target, ...flags]);
  const p = await run(argv.map((x, i) => (i > 0 && x.startsWith("src/") ? join(REPO, x) : x)), { cwd: FIXTURES, env: caseEnv({ ...MIRI_CASE_ENV, RUSTC_ICE: "0" }), timeoutMs });
  const got = `exit: ${p.code}\n--- stdout\n${p.stdout}--- stderr\n${normalise_stderr(p.stderr)}`;
  const want = readFileSync(join(FIXTURES, `${name}.oracle.txt`), "utf8");
  writeFileSync(join(LOGS, `${name}.port.txt`), `${got}\n--- raw stderr\n${p.stderr}`);
  let verdict: string;
  if (got === want) verdict = "MATCH";
  else if (p.code === 70) verdict = "UNPORTED";
  else if (p.timedOut) verdict = "TIMEOUT";
  else verdict = "DIFF";
  let detail = "";
  if (verdict !== "MATCH") {
    const g = got.split("\n");
    const w = want.split("\n");
    const i = g.findIndex((l, n) => l !== w[n]);
    const at = i < 0 ? Math.min(g.length, w.length) : i;
    detail = verdict === "UNPORTED" ? p.stderr.split("\n").find((l) => l.includes("unported")) ?? "" : `line ${at + 1}: port ${JSON.stringify(g[at]?.slice(0, 160))} oracle ${JSON.stringify(w[at]?.slice(0, 160))}`;
  }
  console.log(`${verdict} ${name} (${(p.ms / 1000).toFixed(1)} s)${detail === "" ? "" : `: ${detail}`}`);
  return verdict;
});
const count = (v: string) => results.filter((r) => r === v).length;
console.log(`MATCH=${count("MATCH")} DIFF=${count("DIFF")} UNPORTED=${count("UNPORTED")} TIMEOUT=${count("TIMEOUT")}`);
