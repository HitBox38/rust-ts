// Oracle tests for lane ty-results (compiler/rustc_middle/src/ty/consts/{int,valtree}.rs, ty/consts.rs): `ScalarInt`
// construction / conversion and its Debug / LowerHex / UpperHex / Display, `ConstInt`'s Debug (`{:?}`, `{:#?}`), interned
// `ValTree`s (Debug, `is_zst`, interning identity), `ty::Value`'s derived Debug, `Const`'s `to_*` / `try_to_*` /
// `zero_sized`, and `Const` / `Value` Display through the merged printer (`pretty_print_const_valtree`,
// `pretty_print_const_scalar_int`), plain and under `-Zverbose-internals`.
//
// The expected outputs (consts_oracle/expected.json) come from the oracle compiler itself: consts_oracle/probe.rs, a
// throwaway rustc-dev probe (its header says how to build it; lanes may not add tools/probes). The subject side is
// consts_oracle/run.ts (the ported driver, same sections). stdout, stderr and the exit code must be identical, except
// that the sections the subject cannot print yet (`BLOCKED`, see run.ts's header: lane ty-sty's `Ty` predicates) are
// dropped from the probe's stdout; consts.test.ts checks those lines with the predicates mocked.
//
// To regenerate expected.json from the probe: TYCONSTS_PROBE=<path to the built probe> TYCONSTS_WRITE=1 bun test <this file>.
// With only TYCONSTS_PROBE set, the cases compare against the live probe instead of expected.json.
import { beforeAll, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { REPO } from "../../../../scripts/lib/common.ts";
import { test_scratch_dir } from "../../../rust_ts/test_scratch.ts";

const WORK = test_scratch_dir("ty-results-consts");
const RUNNER = join(REPO, "src/rustc_middle/ty/consts/consts_oracle/run.ts");
const EXPECTED = join(REPO, "src/rustc_middle/ty/consts/consts_oracle/expected.json");
const PROBE = process.env.TYCONSTS_PROBE;
const WRITE = process.env.TYCONSTS_WRITE === "1";

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

/** Drops the `== <name>` sections listed in `blocked` from a probe's stdout. */
function drop_sections(stdout: string, blocked: readonly string[]): string {
  let keep = true;
  let out = "";
  for (const line of stdout.split(/(?<=\n)/)) {
    if (line.startsWith("== ")) keep = !blocked.includes(line.slice(3).trimEnd().split(" ")[0]!);
    if (keep) out += line;
  }
  return out;
}

const SOURCE = '#![feature(no_core)]\n#![no_core]\n#![crate_type = "lib"]\n';

const CASES: { name: string; args: string[]; blocked: string[] }[] = [
  // merge-w15b: nothing is blocked any more (the `Ty` predicates of lane ty-sty are ported).
  { name: "plain", args: ["c.rs"], blocked: [] },
  { name: "verbose", args: ["c.rs", "-Zverbose-internals"], blocked: [] },
];

let sysroot = "";
const expected: Record<string, Out> = PROBE !== undefined ? {} : JSON.parse(readFileSync(EXPECTED, "utf8"));

beforeAll(() => {
  const oracle = require("../../../../scripts/lib/oracle.ts") as typeof import("../../../../scripts/lib/oracle.ts");
  sysroot = oracle.oracleSysroot();
  writeFileSync(join(WORK, "c.rs"), SOURCE);
}, 120_000);

for (const c of CASES) {
  test(`ty-results consts oracle: ${c.name}`, async () => {
    const args = [...c.args, "--sysroot", sysroot];
    const ours = await run([process.execPath, RUNNER, ...args], WORK);
    let want: Out;
    if (PROBE !== undefined) {
      want = await run([PROBE, ...args], WORK);
      if (WRITE) {
        expected[c.name] = want;
        writeFileSync(EXPECTED, JSON.stringify(expected, null, 2) + "\n");
      }
    } else {
      want = expected[c.name]!;
    }
    // the oracle did something (guards against a case that tests nothing)
    expect(want.stdout).toContain("== display\n");
    expect(ours.stderr).toBe(want.stderr);
    expect(ours.stdout).toBe(drop_sections(want.stdout, c.blocked));
    expect(ours.code).toBe(want.code);
  }, 120_000);
}
