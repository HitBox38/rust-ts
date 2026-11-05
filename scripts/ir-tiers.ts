// What the normal form tiers do on real oracle IR, across a sample of the run-pass corpus (scripts/lib/ir-normal.ts, ir-mutations.ts; review plan-m7 F1): the
// evidence behind scripts/ir-normal.test.ts, which uses one small program. Not a suite, not a gate; oracle only.
//
//   bun scripts/ir-tiers.ts [--sample N] [--sites K] [--jobs J] [--run-id ID]
//
// For each sampled `mir-o2` case, its compile becomes pre-pass IR, then for each mutation with a site in that program:
// - **whole:** every site at once, at each tier, against the stated expectation;
// - **single:** K sites alone, chosen by a hash of the case, at each tier: how often one wrong site is absorbed, which `whole` can hide.
// It also checks that a bitcode round trip with names kept gives N1's text, so names are all the N2 path gives up.
// Output: one line per mutation (AGENTS.md §4). Files: $RUST_TS_DATA/runs/<run>/ir-tiers/{report.txt,absorbed.jsonl}. Exit 0: every `whole` as expected, 1 otherwise, 2 an `ERROR:`.
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { suite } from "../harness/suites.ts";
import { DATA, RUNS, UPSTREAM, ensureDir, hash, nowId, parseArgs, run } from "./lib/common.ts";
import { caseEnv } from "./lib/env.ts";
import { applyEdits, MUTATIONS, type Edit } from "./lib/ir-mutations.ts";
import { IR_TIERS, normalForm, stripIrComments, type IrTier } from "./lib/ir-normal.ts";
import { llvmBinDir, llvmToolsError } from "./lib/llvm-tools.ts";
import { oracleHost, oracleRustcCmd, oracleSysroot, verifyOraclePin } from "./lib/oracle.ts";

const a = parseArgs(process.argv.slice(2));
const SAMPLE = Number(a.sample ?? 50);
const SITES = Number(a.sites ?? 2);
const JOBS = Number(a.jobs ?? 3);
await verifyOraclePin();
const sysroot = oracleSysroot();
const host = oracleHost();
const bad = llvmToolsError(sysroot, host, false);
if (bad !== undefined) {
  console.log(`ERROR: ${bad}`);
  process.exit(2);
}
const BIN = llvmBinDir(sysroot, host);
const out = ensureDir(join(RUNS, typeof a["run-id"] === "string" ? a["run-id"] : nowId(), "ir-tiers"));
const tmp = ensureDir(join(DATA, "tmp", "ir-tiers", String(process.pid)));

const cases = suite("mir-o2")
  .cases()
  .map((c) => ({ c, k: hash(`ir-tiers ${c.id}`) }))
  .sort((x, y) => (x.k < y.k ? -1 : 1))
  .slice(0, SAMPLE)
  .map((x) => x.c);

interface Tally {
  sites: number;
  programs: number;
  whole: Record<IrTier, { caught: number; absorbed: number }>;
  single: Record<IrTier, { caught: number; absorbed: number }>;
  wrong: string[];
}
const tally = new Map(MUTATIONS.map((m): [string, Tally] => [m.name, { sites: 0, programs: 0, whole: blank(), single: blank(), wrong: [] }]));
function blank(): Record<IrTier, { caught: number; absorbed: number }> {
  return { N1: { caught: 0, absorbed: 0 }, N2: { caught: 0, absorbed: 0 }, N3: { caught: 0, absorbed: 0 } };
}
const absorbed: string[] = [];
let compared = 0;
let notBuilt = 0;
let bitcodeDiffers = 0;

const nf = async (ir: string, t: IrTier): Promise<string> => {
  const n = await normalForm(Buffer.from(ir, "latin1"), t, BIN);
  return "error" in n ? `ERROR ${n.error}` : n.text;
};
/** Up to K sites, the same ones on every run. */
const pick = (edits: Edit[], seed: string): Edit[] =>
  edits
    .map((e, i) => ({ e, k: hash(`${seed} ${i}`) }))
    .sort((x, y) => (x.k < y.k ? -1 : 1))
    .slice(0, SITES)
    .map((x) => x.e);

async function one(c: (typeof cases)[number], w: number): Promise<void> {
  const dir = join(tmp, String(w));
  rmSync(dir, { recursive: true, force: true });
  const args = c.args.filter((x) => x !== "-Zunpretty=mir");
  const r = await run(oracleRustcCmd([...args, "-Cno-prepopulate-passes", "--emit=llvm-ir", "--out-dir", dir]), { cwd: UPSTREAM, timeoutMs: 120_000, env: caseEnv(c.env) });
  const files = r.code === 0 && existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".ll")) : [];
  if (files.length !== 1) {
    notBuilt++;
    return;
  }
  const ir = readFileSync(join(dir, files[0]!), "latin1");
  compared++;
  const ref = { N1: await nf(ir, "N1"), N2: await nf(ir, "N2"), N3: await nf(ir, "N3") };
  const as = Bun.spawnSync([join(BIN, "llvm-as"), "-", "-o", "-"], { stdin: Buffer.from(ir, "latin1"), stdout: "pipe" }).stdout;
  const viaBitcode = Bun.spawnSync([join(BIN, "opt"), "-passes=assign-guid,verify", "-S", "-o", "-"], { stdin: as, stdout: "pipe" }).stdout;
  if (stripIrComments(Buffer.from(viaBitcode).toString("latin1")) !== ref.N1) bitcodeDiffers++;
  for (const m of MUTATIONS) {
    const edits = m.sites(ir);
    if (edits.length === 0) continue;
    const t = tally.get(m.name)!;
    t.programs++;
    t.sites += edits.length;
    const whole = applyEdits(ir, edits);
    if (whole === ir) continue;
    for (const tier of IR_TIERS) {
      const v = (await nf(whole, tier)) === ref[tier] ? "absorbed" : "caught";
      t.whole[tier][v]++;
      if (v !== m.expect[tier] && !(tier === "N3" && m.n3MayAbsorb) && t.wrong.length < 3) t.wrong.push(`${c.id} ${tier} ${v}`);
    }
    if (edits.length === 1) continue;
    for (const e of pick(edits, `${c.id} ${m.name}`)) {
      const single = applyEdits(ir, [e]);
      for (const tier of IR_TIERS) {
        const v = (await nf(single, tier)) === ref[tier] ? "absorbed" : "caught";
        t.single[tier][v]++;
        if (v === "absorbed" && m.expect[tier] === "caught") absorbed.push(JSON.stringify({ case: c.id, mutation: m.name, tier, was: ir.slice(e.at, e.at + Math.min(e.len, 200)), now: e.text.slice(0, 200) }));
      }
    }
  }
  rmSync(dir, { recursive: true, force: true });
}

let next = 0;
await Promise.all(
  Array.from({ length: JOBS }, async (_, w) => {
    while (next < cases.length) await one(cases[next++]!, w);
  }),
);
rmSync(tmp, { recursive: true, force: true });

const pct = (x: { caught: number; absorbed: number }) => (x.caught + x.absorbed === 0 ? "-" : `${x.caught}/${x.caught + x.absorbed}`);
const lines = [`ir-tiers: ${compared} programs of ${cases.length} (${notBuilt} did not build); bitcode with names kept differs from N1 text on ${bitcodeDiffers}`, "mutation | programs | whole caught N1 N2 N3 | one site caught N1 N2 N3"];
let ok = bitcodeDiffers === 0;
for (const m of MUTATIONS) {
  const t = tally.get(m.name)!;
  lines.push(`${m.name} | ${t.programs} | ${IR_TIERS.map((x) => pct(t.whole[x])).join(" ")} | ${IR_TIERS.map((x) => pct(t.single[x])).join(" ")}${t.wrong.length ? ` | NOT AS STATED: ${t.wrong.join("; ")}` : ""}`);
  if (t.wrong.length) ok = false;
}
writeFileSync(join(out, "report.txt"), lines.join("\n") + "\n");
writeFileSync(join(out, "absorbed.jsonl"), absorbed.length ? absorbed.join("\n") + "\n" : "");
for (const l of lines) console.log(l);
console.log(`files: ${out}`);
process.exit(ok ? 0 : 1);
