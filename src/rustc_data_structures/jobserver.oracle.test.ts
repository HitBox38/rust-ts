// plan-m7 O4, D11: `jobserver::initialize` against the oracle. Each case is one `CARGO_MAKEFLAGS` value, with the
// descriptors `setup` gives the process. All that upstream does with a jobserver that can be seen is the warning.
import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PIN, REPO } from "../../scripts/lib/common.ts";
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
if (!HAVE && REQUIRE) throw new Error("ERROR: pinned rustc unavailable and RUST_TS_REQUIRE_PROBES=1");

const WORK = test_scratch_dir("jobserver-oracle");
mkdirSync(join(WORK, "dir"), { recursive: true });
writeFileSync(join(WORK, "x.rs"), "#![feature(no_core)]\n#![no_core]\n");
writeFileSync(join(WORK, "plainfile"), "");

const q = (s: string) => `'${s.replaceAll("'", "'\\''")}'`;
/** Runs `argv` under bash, after `setup`, with the variable set. stdin is /dev/null, a character device. */
function sh(value: string, setup: string, argv: string[]) {
  const line = `${setup}${setup ? "; " : ""}exec ${argv.map(q).join(" ")}`;
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && k !== "MAKEFLAGS" && k !== "MFLAGS") env[k] = v;
  env.CARGO_MAKEFLAGS = value;
  env.RUSTC_ICE = "0";
  return Bun.spawnSync(["bash", "-c", line], { cwd: WORK, env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
}
const LIB = ["--crate-type", "lib", "--emit=metadata", "x.rs", "-o", "out.rmeta"];
const oracle = (value: string, setup: string) => sh(value, setup, [...RUSTC, ...LIB]);
const WARN = "warning: ";

const PIPE = `mkfifo ff 2>/dev/null; exec 5<>ff; exec 6>&5`;
const CASES: [string, string][] = [
  ["", ""],
  ["-j4 --no-print-directory", ""],
  // Closed. 3 and 4 name descriptors Bun has opened for itself by then: see unix.ts `runtime_owned_fd`.
  ["--jobserver-auth=3,4", ""],
  ["--jobserver-auth=100,101", ""],
  ["--jobserver-fds=100,101", ""],
  // `--jobserver-auth=` wins over `--jobserver-fds=`, and the last of them wins.
  ["--jobserver-fds=7,8 --jobserver-auth=100,101", ""],
  ["--jobserver-auth=7,8 x --jobserver-auth=100,101 y", ""],
  // Not a pipe: stdin.
  ["--jobserver-auth=0,1", ""],
  // Negative: disabled, silently.
  ["--jobserver-auth=-1,-1", ""],
  ["--jobserver-auth=100,-1", ""],
  // Malformed.
  ["--jobserver-auth=5", ""],
  ["--jobserver-auth=a,b", ""],
  ["--jobserver-auth=1,b", ""],
  ["--jobserver-auth=,", ""],
  ["--jobserver-auth=+,1", ""],
  ["--jobserver-auth=99999999999,1", ""],
  ["--jobserver-auth=-99999999999,1", ""],
  ["--jobserver-auth=99999999999x,1", ""],
  ['--jobserver-auth="x', ""],
  // Fifos: only the open is checked, not what it opens.
  ["--jobserver-auth=fifo", ""],
  ["--jobserver-auth=fifo:/nonexistent/ff", ""],
  ["--jobserver-auth=fifo:dir", ""],
  ["--jobserver-auth=fifo:plainfile", ""],
  // Open descriptors. `NotAPipe` wins over a closed one, whichever comes first.
  ["--jobserver-auth=5,6", PIPE],
  ["--jobserver-auth=5,100", `mkfifo ff 2>/dev/null; exec 5<>ff`],
  ["--jobserver-auth=5,6", `exec 5<plainfile; exec 6<plainfile`],
  ["--jobserver-auth=100,6", `exec 6<plainfile`],
];

describe.skipIf(SKIP)("jobserver::initialize, oracle", () => {
  for (const [value, setup] of CASES) {
    test(`${value || "(empty)"}${setup ? ` [${setup}]` : ""}`, () => {
      const o = oracle(value, setup);
      expect(o.exitCode).toBe(0);
      const line = o.stderr.toString().split("\n")[0]!;
      const want = line.startsWith(WARN) ? `${line.slice(WARN.length)}\n` : "";
      const p = sh(value, setup, [process.execPath, join(import.meta.dir, "jobserver_oracle", "run.ts")]);
      expect(p.stderr.toString()).toBe("");
      expect(p.exitCode).toBe(0);
      expect(p.stdout.toString()).toBe(want);
    });
  }

  // The whole driver: where it is called, the diagnostic's note, and that a compile goes on after it.
  test("through the driver: bad jobserver, then a pipe from `cargo`", () => {
    for (const [value, setup] of [["--jobserver-auth=3,4", ""], ["--jobserver-auth=5,6", PIPE]] as const) {
      const o = oracle(value, setup);
      const p = sh(value, setup, [process.execPath, join(REPO, "src/rust_ts/main.ts"), ...LIB]);
      expect(p.stderr.toString()).toBe(o.stderr.toString());
      expect(p.exitCode).toBe(o.exitCode);
    }
  }, 30_000);

  // PORT rule (lib.ts `Client_from_env_ext`): a value that may not be UTF-8 stops; `process.env` has lost its bytes.
  test("a non-UTF-8 value stops rather than guess", () => {
    const line = `CARGO_MAKEFLAGS=$'--jobserver-auth=\\xff' exec ${q(process.execPath)} ${q(join(import.meta.dir, "jobserver_oracle", "run.ts"))}`;
    const p = Bun.spawnSync(["bash", "-c", line], { cwd: WORK, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    // (Exit 70 is main.ts's, which this subject does not go through.)
    expect(p.exitCode).not.toBe(0);
    expect(p.stderr.toString()).toContain("unported: jobserver::Client::from_env_ext");
  });
});
