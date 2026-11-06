// `StalledPrefix` under its self-check (`set_stalled_prefix_check`): no pass skips an entry upstream's check would not keep, on programs
// with each kind of stalled variable, and the output is still the oracle's. Review perf-near-limit N1: a build with `first_reader`
// keeping the latest entry passed every other test. The programs are the review's generator's (`ints`, `floats`, `consts`, `tait`), on `no_core`
// so that none loads std (plan-m7 F5); each one stops on a deliberate bug the others miss, as docs/handoff/fixers-42.md lists.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PIN } from "../../../scripts/lib/common.ts";

const REQUIRE = process.env.RUST_TS_REQUIRE_PROBES === "1";
const RUSTC = ["rustc", `+${PIN.toolchain}`];
const rustc_ok = ((): boolean => {
  try {
    return Bun.spawnSync([...RUSTC, "-vV"]).stdout.toString().includes(`commit-hash: ${PIN.commit}`);
  } catch {
    return false;
  }
})();
const SKIP = !rustc_ok && !REQUIRE;
if (SKIP) console.log(`SKIP: pinned rustc (${PIN.toolchain}) unavailable; RUST_TS_REQUIRE_PROBES=1 makes this a failure`);

const DRIVER = join(import.meta.dir, "..", "..", "rust_ts", "stalled_prefix_driver.ts");
const N = 16;
const each = (f: (i: number) => string): string => Array.from({ length: N }, (_, i) => f(i)).join("\n");
const reversed = (f: (i: number) => string): string => Array.from({ length: N }, (_, i) => f(N - 1 - i)).join("\n");

const PRELUDE = `#![feature(no_core, lang_items, rustc_attrs, type_alias_impl_trait, decl_macro)]
#![no_core]
#![allow(unused, dead_code, incomplete_features, internal_features)]
#[lang = "pointee_sized"] pub trait PointeeSized {}
#[lang = "meta_sized"] pub trait MetaSized: PointeeSized {}
#[lang = "sized"] pub trait Sized: MetaSized {}
#[lang = "copy"] pub trait Copy {}
#[rustc_builtin_macro] pub macro define_opaque($($tt:tt)*) {}
trait Tr {}
impl Tr for u8 {} impl Tr for u32 {} impl Tr for f32 {} impl Tr for f64 {}
struct A<const N: usize>; impl Tr for A<3> {}
fn mk<T: Tr>() -> T { loop {} }
fn nd<T: Tr>(_: &T) {}
fn mkc<const N: usize>() -> A<N> where A<N>: Tr { loop {} }
`;
const PROGRAMS: Record<string, string> = {
  ints: `pub fn f() {\n${each((i) => `let a${i} = 1; nd(&a${i});`)}\n${reversed((i) => (i % 3 !== 0 ? "" : i % 2 ? `let _: u8 = a${i};` : `let _: u32 = a${i};`))}\n}\n`,
  floats: `pub fn f() {\n${each((i) => `let a${i} = 1.0; nd(&a${i});`)}\n${reversed((i) => (i % 3 !== 0 ? "" : i % 2 ? `let _: f32 = a${i};` : `let _: f64 = a${i};`))}\n}\n`,
  consts: `pub fn f() {\n${each((i) => `let a${i} = mkc();`)}\n${reversed((i) => (i % 5 === 1 ? `let _: A<4> = a${i};` : `let _: A<3> = a${i};`))}\n}\n`,
  tait: `type O0 = impl Tr;\ntype O1 = impl Tr;\ntype O2 = impl Tr;\n#[define_opaque(O0, O1, O2)]\npub fn f() {\n${each((i) => `let a${i} = mk();`)}\nlet o0: O0 = a0;\nlet o1: O1 = a1;\nlet o2: O2 = a2;\n${reversed((i) => `let _: u8 = a${i};`)}\n}\n`,
};
const ARGS = ["--crate-type", "lib", "--edition", "2021", "-Znext-solver", "--emit=metadata"];

let WORK = "";
beforeAll(() => {
  WORK = mkdtempSync(join(tmpdir(), "rust-ts-stalled-prefix-"));
  for (const [name, body] of Object.entries(PROGRAMS)) writeFileSync(join(WORK, `${name}.rs`), PRELUDE + body);
});
afterAll(() => rmSync(WORK, { recursive: true, force: true }));

test.skipIf(SKIP)("no wrong skip, and the oracle's output, under the self-check", () => {
  const files = Object.keys(PROGRAMS).map((p) => `${p}.rs`);
  const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !["RUSTC_LOG", "RUSTC_BOOTSTRAP", "MAKEFLAGS", "CARGO_MAKEFLAGS", "MFLAGS"].includes(k))) as Record<string, string>;
  const oracle = files.map((f) => Bun.spawnSync([...RUSTC, ...ARGS, f], { cwd: WORK, env: { ...clean, RUSTC_ICE: "0" }, stdout: "pipe", stderr: "pipe" }));
  const port = Bun.spawnSync([process.execPath, DRIVER, ...ARGS, "--", ...files], { cwd: WORK, env: clean, stdout: "pipe", stderr: "pipe" });
  expect(port.stderr.toString()).toBe(oracle.map((o) => o.stderr.toString()).join(""));
  expect(port.exitCode).toBe(0);
  const lines = port.stdout.toString().trim().split("\n");
  expect(lines.map((l) => /exit (\d+)/.exec(l)?.[1])).toEqual(oracle.map((o) => String(o.exitCode)));
  // Each program must have reached the code under test, and the two with errors must be the ones that have them.
  for (const line of lines) expect(Number(/skipped (\d+)/.exec(line)?.[1])).toBeGreaterThan(0);
  expect(oracle.some((o) => o.exitCode !== 0)).toBe(true);
}, 60_000);
