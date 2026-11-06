// Reads of `env::var`, `env::var_os` and `env::current_dir` against the oracle (docs/reviews/fixers-42.md R3 and "Seen"): `env::var` gives
// `NotUnicode` on a value that is not UTF-8, which a lossy `process.env` read cannot show. The other variables were compared by hand
// (docs/handoff/fixers-43.md). One port process per case: the driver's load time is most of each.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PIN } from "../../scripts/lib/common.ts";

const REQUIRE = process.env.RUST_TS_REQUIRE_PROBES === "1";
const RUSTC = ["rustc", `+${PIN.toolchain}`];
const rustc_ok = ((): boolean => {
  try {
    return Bun.spawnSync([...RUSTC, "-vV"]).stdout.toString().includes(`commit-hash: ${PIN.commit}`);
  } catch {
    return false;
  }
})();
const SKIP = process.platform === "win32" || (!rustc_ok && !REQUIRE);
if (SKIP) console.log(`SKIP: pinned rustc (${PIN.toolchain}) unavailable; RUST_TS_REQUIRE_PROBES=1 makes this a failure`);

const SYSROOT = rustc_ok ? Bun.spawnSync([...RUSTC, "--print", "sysroot"]).stdout.toString().trim() : "";
const EXEC_WITH_ENV = join(import.meta.dir, "..", "rust_ts", "exec_with_env.ts");
const ORACLE = [join(SYSROOT, "bin", "rustc")];
const PORT = [process.execPath, join(import.meta.dir, "..", "rust_ts", "main.ts"), "--sysroot", SYSROOT];
// An interpreter error, which is what `RUSTC_CTFE_BACKTRACE` is read for.
const PROGRAM = `#![feature(no_core, lang_items)]
#![no_core]
#[lang = "pointee_sized"] pub trait PointeeSized {}
#[lang = "meta_sized"] pub trait MetaSized: PointeeSized {}
#[lang = "sized"] pub trait Sized: MetaSized {}
#[lang = "copy"] pub trait Copy {}
impl Copy for u32 {}
pub const X: u32 = unsafe { *(0 as *const u32) };
`;

let dir = "";
let deep: string[] = [];
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "rust-ts-env-reads-"));
  writeFileSync(join(dir, "p.rs"), PROGRAM);
  // A cwd of over 1,024 bytes: `mkdir` takes one component at a time, relative to a shell that goes down them.
  deep = Array.from({ length: 6 }, () => "d".repeat(200));
  mkdirSync(join(dir, deep[0]!));
  Bun.spawnSync(["/bin/sh", "-c", deep.map((d) => `mkdir -p ${d} && cd ${d}`).join(" && ") + ' && cp "$0" .', join(dir, "p.rs")], { cwd: dir });
});
afterAll(() => {
  // `rm -r` walks one level at a time, so the depth does not stop it.
  Bun.spawnSync(["/bin/rm", "-rf", dir]);
});

function run(entries: string[], cmd: string[], opts: { stdin?: string; cwd?: string[] } = {}): { stdout: string; stderr: string; code: number | null } {
  // HOME keeps Bun's transpile cache where it is; given an empty one, Bun makes a `Library/Caches` in the cwd.
  const env = [`HOME=${process.env.HOME ?? ""}`, "RUSTC_ICE=0", ...entries];
  const argv = [process.execPath, EXEC_WITH_ENV, JSON.stringify(env), ...cmd];
  // The shell changes into the deep directory and execs; `Bun.spawn`'s `cwd` could not state it.
  const down = opts.cwd === undefined ? argv : ["/bin/sh", "-c", `${opts.cwd.map((d) => `cd ${d}`).join(" && ")} && exec "$@"`, "sh", ...argv];
  const r = Bun.spawnSync(down, { cwd: dir, stdin: opts.stdin === undefined ? undefined : Buffer.from(opts.stdin), stdout: "pipe", stderr: "pipe" });
  return {
    stdout: r.stdout.toString("latin1" as never),
    stderr: r.stderr
      .toString("latin1" as never)
      .replace(/(thread '[^']*') \(\d+\)/g, "$1 (N)")
      .replace(/stack backtrace:\n(?:(?:[ \t]+\S|note: rust-ts prints).*\n)*/g, "stack backtrace:\n"),
    code: r.exitCode,
  };
}

test.skipIf(SKIP)("RUSTC_OVERRIDE_VERSION_STRING that is not UTF-8 counts as unset", () => {
  const entries = ["RUSTC_OVERRIDE_VERSION_STRING=\xff"];
  const oracle = run(entries, [...ORACLE, "-vV"]);
  expect(oracle.stdout).toContain("release: 1.");
  expect(run(entries, [...PORT, "-vV"])).toEqual(oracle);
});

test.skipIf(SKIP)("from a cwd of over 1,024 bytes, with RUSTC_CTFE_BACKTRACE, MAKEFLAGS and RUSTC_GRAPHVIZ_FONT that are not UTF-8", () => {
  const entries = ["RUSTC_CTFE_BACKTRACE=\xff", "MAKEFLAGS=\xff", "RUSTC_GRAPHVIZ_FONT=\xff"];
  const args = ["p.rs", "--crate-type=lib", "--emit=metadata", "--out-dir", "."];
  const oracle = run(entries, [...ORACLE, ...args], { cwd: deep });
  expect(oracle.stderr).toContain("error[E0080]");
  expect(oracle.stderr).toContain('`MAKEFLAGS="\\xFF"`: cannot parse jobserver environment variable value: not valid UTF-8');
  expect(run(entries, [...PORT, ...args], { cwd: deep })).toEqual(oracle);
});

test.skipIf(SKIP)("UNSTABLE_RUSTDOC_TEST_LINE that is not UTF-8: `.expect`'s text and location", () => {
  const entries = ["UNSTABLE_RUSTDOC_TEST_PATH=p.rs", "UNSTABLE_RUSTDOC_TEST_LINE=\xff"];
  const oracle = run(entries, [...ORACLE, "-"], { stdin: PROGRAM });
  expect(oracle.stderr).toContain('NotUnicode("\\xFF")');
  expect(oracle.stderr).toContain("lib.rs:396:71");
  expect(run(entries, [...PORT, "-"], { stdin: PROGRAM })).toEqual(oracle);
});

test.skipIf(SKIP)("Backtrace::capture: RUST_LIB_BACKTRACE that is not UTF-8 falls through to RUST_BACKTRACE", () => {
  const script = `import { Backtrace } from ${JSON.stringify(join(import.meta.dir, "..", "rustc_error_messages", "diagnostic_impls.ts"))}; console.log(Backtrace.capture().status());`;
  const status = (entries: string[]) => run(entries, [process.execPath, "-e", script]).stdout.trim();
  expect(status(["RUST_LIB_BACKTRACE=\xff", "RUST_BACKTRACE=0"])).toBe("Disabled");
  expect(status(["RUST_LIB_BACKTRACE=\xff", "RUST_BACKTRACE=1"])).toBe("Captured");
  expect(status(["RUST_LIB_BACKTRACE=\xff", "RUST_BACKTRACE=\xff"])).toBe("Disabled");
  expect(status(["RUST_LIB_BACKTRACE=1", "RUST_BACKTRACE=\xff"])).toBe("Captured");
});
