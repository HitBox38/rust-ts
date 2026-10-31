// Oracle test committing the evidence of lanes rmeta-fxmap and rmeta-gaps-a (lane followups-33): small `#![no_core]`
// crates built `--crate-type lib --emit=metadata --target x86_64-unknown-linux-gnu` by the pinned rustc and by the
// port's driver (src/rust_ts/main.ts), in the same work directory with the same relative source path (the source
// path is encoded), must give the same exit code, the same stderr and a byte-identical `.rmeta`.
//   - rmeta-fxmap: `encode_def_ids` encodes `associated_types_for_impl_traits_in_trait_or_impl` and
//     `collect_return_position_impl_trait_in_trait_tys`, whose `UnordMap`s are written in hashbrown order
//     (`FxDefIdMap`, rustc_span def_id.ts). `fx9`: a trait with 9 fns plus an assoc type and const; `fx40`: a 40-fn
//     trait (the table resizes) and a 2-fn trait; `rpitit`: 13 RPITIT fns, one with 2 RPITITs (both maps, the second
//     with 2 entries); `assoc`: the src/rustc_ty_utils/assoc_test fixture with the lang items it needs appended (so
//     its DefIndexes don't move), whose hashbrown order assoc.expected.txt lists.
//   - rmeta-gaps-a: `raw_dylib`: a `kind = "raw-dylib"` foreign module (`raw_dylib_elf` on this target), so the
//     `NativeLib`'s `dll_imports` go through the generated `DllImport` / `DllCallingConvention` /
//     `DllImportSymbolType` codecs (3 imports, one renamed with `link_name`, one static).
// Skips (visibly) if the pinned rustc is unavailable; fails instead under RUST_TS_REQUIRE_PROBES=1.
import { expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA, REPO } from "../../../scripts/lib/common.ts";

const REQUIRE = process.env.RUST_TS_REQUIRE_PROBES === "1";
const oracle = require("../../../scripts/lib/oracle.ts") as typeof import("../../../scripts/lib/oracle.ts");
function rustcAvailable(): boolean {
  try {
    return Bun.spawnSync(oracle.oracleRustcCmd(["-vV"])).exitCode === 0;
  } catch {
    return false;
  }
}
const HAVE = rustcAvailable();
const SKIP = !HAVE && !REQUIRE;
if (SKIP) console.log("SKIP: pinned rustc unavailable; RUST_TS_REQUIRE_PROBES=1 makes this a failure");

const WORK = join(DATA, "tmp", "rmeta-fxmap-oracle", process.env.RUST_TS_AGENT ?? "default");
const ARGS = ["--target", "x86_64-unknown-linux-gnu", "--crate-type", "lib", "--emit=metadata"];

const BASE_ENV: Record<string, string> = { RUSTC_ICE: "0", RUST_BACKTRACE: "0" };
for (const [k, v] of Object.entries(process.env)) {
  if (v === undefined) continue;
  if (["MAKEFLAGS", "CARGO_MAKEFLAGS", "MFLAGS", "RUSTC_LOG", "RUSTC_BOOTSTRAP", "RUSTC_ICE", "RUST_BACKTRACE"].includes(k)) continue;
  if (k.startsWith("CARGO_PKG_VERSION_")) continue;
  BASE_ENV[k] = v;
}

const LANG = `#[lang = "pointee_sized"] pub trait PointeeSized {}
#[lang = "meta_sized"] pub trait MetaSized: PointeeSized {}
#[lang = "sized"] pub trait Sized: MetaSized {}
#[lang = "copy"] pub trait Copy {}
impl Copy for u32 {}
`;
const HEAD = `#![feature(no_core, lang_items)]
#![no_core]
#![crate_type = "lib"]
${LANG}`;
const range = (n: number): number[] => Array.from({ length: n }, (_, i) => i);

const SOURCES: Record<string, string> = {
  fx9: `${HEAD}pub trait Tr {
${["a();", "b() -> u32;", "c();", "d();", "e();", "f();", "g();", "h();", "i();"].map((s) => `    fn ${s}\n`).join("")}    type X;
    const K: u32;
}
pub struct S;
impl Tr for S {
${["a() {}", "b() -> u32 { 0 }", "c() {}", "d() {}", "e() {}", "f() {}", "g() {}", "h() {}", "i() {}"].map((s) => `    fn ${s}\n`).join("")}    type X = S;
    const K: u32 = 1;
}
`,
  fx40: `${HEAD}pub trait Big {
${range(40).map((i) => `    fn f${i}();\n`).join("")}}
pub struct S;
impl Big for S {
${range(40).map((i) => `    fn f${i}() {}\n`).join("")}}
pub trait Small { fn x(); fn y(); }
impl Small for S { fn x() {} fn y() {} }
`,
  rpitit: `${HEAD}pub trait Q {}
impl Q for u32 {}
pub trait R {
${range(12).map((i) => `    fn r${i}() -> impl Q;\n`).join("")}    fn two() -> (impl Q, impl Q);
}
pub struct T;
impl R for T {
${range(12).map((i) => `    fn r${i}() -> u32 { 0 }\n`).join("")}    fn two() -> (u32, u32) { (0, 0) }
}
`,
  assoc: `${readFileSync(join(REPO, "src", "rustc_ty_utils", "assoc_test", "assoc.rs"), "utf8").replace("#![feature(no_core)]", "#![feature(no_core, lang_items)]")}#[lang = "pointee_sized"] pub trait PointeeSized {}
#[lang = "meta_sized"] pub trait MetaSized: PointeeSized {}
#[lang = "sized"] pub trait Sized: MetaSized {}
#[lang = "legacy_receiver"] pub trait LegacyReceiver {}
impl<T: PointeeSized> LegacyReceiver for &T {}
#[lang = "copy"] pub trait Copy {}
`,
  raw_dylib: `#![feature(no_core, lang_items, raw_dylib_elf)]
#![no_core]
#![crate_type = "lib"]
${LANG}#[link(name = "foo", kind = "raw-dylib")]
unsafe extern "C" {
    pub fn foo_fn(x: u32) -> u32;
    #[link_name = "bar_renamed"]
    pub fn bar_fn();
    pub static FOO_STATIC: u32;
}
`,
};

interface Out {
  code: number;
  stderr: string;
  rmeta: Uint8Array | undefined;
}
function build(cmd: string[], name: string, out_dir: string): Out {
  rmSync(join(WORK, out_dir), { recursive: true, force: true });
  mkdirSync(join(WORK, out_dir), { recursive: true });
  const r = Bun.spawnSync([...cmd, ...ARGS, "--out-dir", out_dir, `${name}.rs`], { cwd: WORK, env: BASE_ENV, stdout: "pipe", stderr: "pipe" });
  let rmeta: Uint8Array | undefined;
  try {
    rmeta = new Uint8Array(readFileSync(join(WORK, out_dir, `lib${name}.rmeta`)));
  } catch {
    rmeta = undefined;
  }
  return { code: r.exitCode ?? -1, stderr: r.stderr.toString(), rmeta };
}

for (const name of Object.keys(SOURCES)) {
  test.skipIf(SKIP)(`rmeta oracle: ${name} --emit=metadata is byte-identical`, () => {
    mkdirSync(WORK, { recursive: true });
    writeFileSync(join(WORK, `${name}.rs`), SOURCES[name]!);
    const o = build(oracle.oracleRustcCmd([]), name, `o_${name}`);
    const p = build(["bun", join(REPO, "src", "rust_ts", "main.ts")], name, `p_${name}`);
    expect(o.code).toBe(0);
    expect(o.rmeta).toBeDefined();
    expect(p.code).toBe(o.code);
    expect(p.stderr).toBe(o.stderr);
    expect(p.rmeta?.length).toBe(o.rmeta!.length);
    expect(Buffer.compare(Buffer.from(p.rmeta!), Buffer.from(o.rmeta!))).toBe(0);
  }, 120_000);
}
