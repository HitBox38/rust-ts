// Differential test (not a port): src/vendor/rustc_apfloat against the rustc_apfloat crate the pinned rustc links.
// `oracle/apfloat_oracle.rs` is built with the pinned toolchain as a rustc-dev program (`#![feature(rustc_private)]`,
// `extern crate rustc_apfloat`), so it runs exactly the oracle compiler's copy of the crate. Both sides run the same
// generated operations (random bit patterns, edge values, near-tie strings, every rounding mode, every format) and
// must print identical lines: status bits, result bit patterns (NaN payloads included), `loses_info` / `is_exact`,
// parse errors, Display / Debug text.
//
// Without the pinned toolchain (and its rustc-dev component) this is a visible skip; RUST_TS_REQUIRE_PROBES=1 makes
// that a failure.
import { beforeAll, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA, PIN } from "../../../scripts/lib/common.ts";
import { test_scratch_dir } from "../../rust_ts/test_scratch.ts";
import { gen, run_line } from "./oracle/cases.ts";

const REQUIRE = process.env.RUST_TS_REQUIRE_PROBES === "1";

// ---- oracle ----

let LINES: string[] = [];
let oracle: string[] | undefined;

function rustc_at_pin(): boolean {
  try {
    const r = Bun.spawnSync(["rustc", `+${PIN.toolchain}`, "-vV"], { stdout: "pipe", stderr: "pipe" });
    return r.exitCode === 0 && r.stdout.toString().includes(`commit-hash: ${PIN.commit}`);
  } catch {
    return false;
  }
}

beforeAll(() => {
  LINES = gen();
  let cmd: string[];
  let sysroot: string;
  try {
    const o = require("../../../scripts/lib/oracle.ts") as typeof import("../../../scripts/lib/oracle.ts");
    if (!rustc_at_pin()) throw new Error("not at the pin");
    cmd = o.oracleRustcCmd([]);
    sysroot = o.oracleSysroot();
  } catch {
    if (REQUIRE) throw new Error("ERROR: pinned toolchain missing");
    return;
  }
  const dir = test_scratch_dir("apfloat");
  writeFileSync(join(dir, "apfloat_oracle.rs"), readFileSync(join(import.meta.dir, "oracle", "apfloat_oracle.rs")));
  const exe = join(dir, process.platform === "win32" ? "apfloat_oracle.exe" : "apfloat_oracle");
  const link = process.platform === "win32" ? [] : ["-C", `link-arg=-Wl,-rpath,${join(sysroot, "lib")}`];
  const c = Bun.spawnSync([...cmd, "-O", "--edition=2021", ...link, "-o", exe, join(dir, "apfloat_oracle.rs")], {
    stdout: "pipe",
    stderr: "pipe",
  });
  if (c.exitCode !== 0) {
    if (REQUIRE) throw new Error(`ERROR: building the apfloat oracle failed (rustc-dev component?): ${c.stderr.toString().split("\n")[0]}`);
    return;
  }
  const env = process.platform === "win32" ? { ...process.env, PATH: `${join(sysroot, "bin")};${process.env.PATH}` } : process.env;
  const r = Bun.spawnSync([exe], { stdin: Buffer.from(LINES.join("\n") + "\n"), stdout: "pipe", stderr: "pipe", env });
  if (r.exitCode !== 0) {
    const input = join(DATA, "tmp", "apfloat-oracle-input.txt");
    writeFileSync(input, LINES.join("\n") + "\n");
    const err = r.stderr.toString().split("\n").filter((l) => l.trim() !== "");
    throw new Error(`ERROR: the apfloat oracle failed (input: ${input}): ${err.slice(0, 2).join(" / ")}`);
  }
  oracle = r.stdout.toString().split("\n").slice(0, LINES.length);
}, 120_000);

test("rustc_apfloat port equals the pinned rustc's rustc_apfloat (all formats, ops, rounding modes)", () => {
  if (oracle === undefined) return;
  expect(oracle.length).toBe(LINES.length);
  const bad: string[] = [];
  const per_op = new Map<string, number>();
  LINES.forEach((line, i) => {
    const key = line.split(" ").slice(0, 2).join(" ");
    per_op.set(key, (per_op.get(key) ?? 0) + 1);
    const ours = run_line(line);
    if (ours !== oracle![i] && bad.length < 30) bad.push(`${line}\n  ours:   ${ours}\n  oracle: ${oracle![i]}`);
  });
  expect(bad).toEqual([]);
  expect(per_op.size).toBeGreaterThan(8 * 20);
}, 300_000);
