// Oracle scenarios for rustc_ast_passes (ast_validation.rs, feature_gate.rs) against the pinned nightly rustc.
//
// Subject: src/rustc_ast_passes/oracle/run.ts (the ported driver, stopping after the crate root is parsed and
// running features + ast_validation::check_crate + feature_gate::check_crate there; see its header).
// Oracle: `rustc <file> <args> -Zunpretty=expanded` (stderr and exit code; stdout is the expanded crate).
// Both sides get `-Zcrate-attr=feature(no_core) -Zcrate-attr=no_core`, so no std metadata is involved.
//
// - oracle/cases.txt: hand-written scenarios. Each must match byte for byte unless listed in PENDING.
// - oracle/ui_cases.txt: tests/ui files of the pinned checkout (plus `--crate-type=lib -Zui-testing` and the
//   file's `//@ edition`), selected because their full diagnostics come from these two passes only. Must match.
//
// PENDING cases need code the runner does not run (expansion/cfg stripping, name resolution, the early
// lint pass that emits the lints these passes buffer). For them, every diagnostic block we print must
// occur, in order, in the oracle's stderr, and the expected buffered lints must be reported on stdout.
//
// Skips (visibly) if rustc is unavailable; fails instead under RUST_TS_REQUIRE_PROBES=1.
import { expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA, PIN, REPO } from "../../scripts/lib/common.ts";
import { test_scratch_dir } from "../rust_ts/test_scratch.ts";

const REQUIRE = process.env.RUST_TS_REQUIRE_PROBES === "1";
const RUSTC = ["rustc", `+${PIN.toolchain}`];
function rustcAvailable(): boolean {
  try {
    return Bun.spawnSync([...RUSTC, "-vV"]).stdout.toString().includes(`commit-hash: ${PIN.commit}`);
  } catch {
    return false;
  }
}
const HAVE = rustcAvailable();
const SKIP = !HAVE && !REQUIRE;
if (SKIP) console.log(`SKIP: pinned rustc (${PIN.toolchain}, ${PIN.commit.slice(0, 12)}) unavailable; RUST_TS_REQUIRE_PROBES=1 makes this a failure`);

const WORK = test_scratch_dir("ast-passes-oracle");
const UI = join(DATA, "rust", "tests", "ui");
const RUNNER = join(REPO, "src/rustc_ast_passes/oracle/run.ts");
const COMMON = ["-Zcrate-attr=feature(no_core)", "-Zcrate-attr=no_core"];

const ENV: Record<string, string> = {};
for (const [k, v] of Object.entries(process.env)) {
  if (v !== undefined && !["MAKEFLAGS", "CARGO_MAKEFLAGS", "MFLAGS", "RUSTC_LOG", "RUSTC_BOOTSTRAP", "RUSTC_ICE"].includes(k)) ENV[k] = v;
}

interface Out {
  stdout: string;
  stderr: string;
  code: number;
}
async function run(cmd: string[], cwd: string): Promise<Out> {
  const p = Bun.spawn(cmd, { cwd, env: ENV, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  return { stdout, stderr, code };
}
async function both(file: string, args: string[], cwd: string): Promise<[Out, Out]> {
  return Promise.all([
    run([...RUSTC, file, ...COMMON, ...args, "-Zunpretty=expanded"], cwd),
    run([process.execPath, RUNNER, file, ...COMMON, ...args], cwd),
  ]);
}

/** Runs `f` over `items` with at most `n` in flight. */
async function pool<T, R>(items: readonly T[], n: number, f: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await f(items[i]!);
      }
    }),
  );
  return out;
}

interface Case {
  name: string;
  args: string[];
  src: string;
}
function parse_cases(text: string): Case[] {
  const cases: Case[] = [];
  let cur: { name: string; args: string[]; lines: string[] } | undefined;
  for (const line of text.split("\n")) {
    if (line.startsWith("=== ")) {
      if (cur) cases.push({ name: cur.name, args: cur.args, src: cur.lines.join("\n") });
      const [name, ...args] = line.slice(4).trim().split(/\s+/);
      cur = { name: name!, args, lines: [] };
    } else if (cur) {
      cur.lines.push(line);
    }
  }
  if (cur) cases.push({ name: cur.name, args: cur.args, src: cur.lines.join("\n") });
  return cases;
}

/** case -> [reason, buffered lints our runner must report on stdout]. */
const PENDING: Record<string, [string, string[]]> = {
  multiple_self_params: ["needs the resolver (E0415 follows our diagnostics)", []],
  where_clause_before_assoc_type_lint: ["buffered lint, emitted by the early lint pass (pending lint-early-a)", ["deprecated_where_clause_location"]],
  missing_abi_lint: ["buffered lint, emitted by the early lint pass (pending lint-early-a)", ["missing_abi"]],
  unused_visibility_lint: ["buffered lint, emitted by the early lint pass (pending lint-early-a)", ["unused_visibilities"]],
  patterns_in_fns_without_body_lint: ["buffered lint, emitted by the early lint pass (pending lint-early-a)", ["patterns_in_fns_without_body"]],
};

/** The diagnostics of a stderr, without the final summary lines. */
function blocks(stderr: string): string[] {
  return stderr
    .split("\n\n")
    .map((b) => b.trim())
    .filter((b) => b !== "" && !/^(error: aborting due to|warning: \d+ warnings? emitted)/.test(b));
}

const CASES = parse_cases(readFileSync(join(import.meta.dir, "oracle", "cases.txt"), "utf8"));
const UI_CASES = readFileSync(join(import.meta.dir, "oracle", "ui_cases.txt"), "utf8")
  .split("\n")
  .filter((l) => l !== "" && !l.startsWith("#"));

test.skipIf(SKIP)(
  "rustc_ast_passes scenarios (oracle/cases.txt)",
  async () => {
    if (!HAVE) throw new Error("ERROR: pinned rustc unavailable and RUST_TS_REQUIRE_PROBES=1");
    for (const name of Object.keys(PENDING)) expect(CASES.some((c) => c.name === name)).toBe(true);
    const failures = (
      await pool(CASES, 8, async (c): Promise<string | undefined> => {
        const dir = join(WORK, "cases", c.name);
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, "t.rs"), c.src);
        const [o, u] = await both("t.rs", c.args, dir);
        const pending = PENDING[c.name];
        if (pending === undefined) {
          if (o.stderr === u.stderr && o.code === u.code) return undefined;
          return `${c.name}: stderr/exit differ (oracle exit ${o.code}, ours ${u.code})\n--- oracle\n${o.stderr}--- ours\n${u.stderr}`;
        }
        if (u.code === 70 || u.code === 101) return `${c.name}: ours exited ${u.code}: ${u.stderr}`;
        const ob = blocks(o.stderr);
        let j = 0;
        for (const b of blocks(u.stderr)) {
          while (j < ob.length && ob[j] !== b) j++;
          if (j === ob.length) return `${c.name} (PENDING): our diagnostic is not in the oracle's output, in order:\n${b}`;
          j++;
        }
        const lints = u.stdout
          .split("\n")
          .filter((l) => l.startsWith("buffered lint: "))
          .map((l) => l.split(" ")[2]);
        if (JSON.stringify(lints) !== JSON.stringify(pending[1])) return `${c.name} (PENDING): buffered lints ${JSON.stringify(lints)}, expected ${JSON.stringify(pending[1])}`;
        return undefined;
      })
    ).filter((f) => f !== undefined);
    expect(failures).toEqual([]);
  },
  300_000,
);

test.skipIf(SKIP)(
  "rustc_ast_passes on tests/ui (oracle/ui_cases.txt)",
  async () => {
    if (!HAVE) throw new Error("ERROR: pinned rustc unavailable and RUST_TS_REQUIRE_PROBES=1");
    const failures = (
      await pool(UI_CASES, 8, async (rel): Promise<string | undefined> => {
        const src = readFileSync(join(UI, rel), "utf8");
        const ed = /\/\/@\s*edition:\s*(\S+)/.exec(src)?.[1];
        const args = ["--crate-type=lib", "-Zui-testing", ...(ed !== undefined ? [`--edition=${ed}`] : [])];
        const [o, u] = await both(rel, args, UI);
        if (o.stderr === u.stderr && o.code === u.code) return undefined;
        const ol = o.stderr.split("\n");
        const ul = u.stderr.split("\n");
        let i = 0;
        while (i < ol.length && ol[i] === ul[i]) i++;
        return `${rel}: first difference at stderr line ${i + 1}: oracle ${JSON.stringify(ol[i])}, ours ${JSON.stringify(ul[i])}`;
      })
    ).filter((f) => f !== undefined);
    expect(failures).toEqual([]);
  },
  300_000,
);
