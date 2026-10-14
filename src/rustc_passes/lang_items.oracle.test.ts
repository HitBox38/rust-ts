// Oracle tests for rustc_passes/src/lang_items.rs + weak_lang_items.rs and rustc_middle/src/middle/lang_items.rs
// (lane lang-items): `tcx.lang_items()` (the `get_lang_items` query), compared with the langitems probe
// (tools/probes/langitems, rustc-dev: the oracle compiler itself, stopping after expansion) against
// src/rustc_passes/oracle/run.ts (the ported driver, same callbacks). stdout (the lang items, the missing ones and
// `tcx.as_lang_item` of each), stderr (E0152 duplicate lang items local / from metadata / through a dependency,
// E0718 generics counts, the weak lang item errors) and the exit code must be identical.
//
// Without the probe this is a visible skip; RUST_TS_REQUIRE_PROBES=1 makes that a failure.
import { beforeAll, expect, test } from "bun:test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA, REPO } from "../../scripts/lib/common.ts";
import { test_scratch_dir } from "../rust_ts/test_scratch.ts";

const REQUIRE_PROBES = process.env.RUST_TS_REQUIRE_PROBES === "1";
const PROBE = join(DATA, "target", "probes", "release", "langitems");
const SKIP = !existsSync(PROBE) && !REQUIRE_PROBES;
if (SKIP) console.log("SKIP: langitems probe not built (bun scripts/probes.ts build langitems); RUST_TS_REQUIRE_PROBES=1 makes this a failure");

const WORK = test_scratch_dir("lang-items-oracle");
const RUNNER = join(REPO, "src/rustc_passes/oracle/run.ts");

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

const NO_CORE = "#![feature(no_core, lang_items)]\n#![no_core]\n#![crate_type = \"lib\"]\n";
const MINI = '#[lang = "pointee_sized"] pub trait PointeeSized {}\n#[lang = "meta_sized"] pub trait MetaSized: PointeeSized {}\n#[lang = "sized"] pub trait Sized: MetaSized {}\n';

/** Auxiliary crates, built with the oracle rustc into `aux/`: two define `sized`, `lc` depends on `la`. */
const AUX: Record<string, string> = {
  la: NO_CORE.replace("\"lib\"", "\"rlib\"") + MINI,
  lb: NO_CORE.replace("\"lib\"", "\"rlib\"") + MINI.replaceAll("PointeeSized", "PS").replaceAll("MetaSized", "MS").replaceAll("Sized", "S"),
  lc: '#![feature(no_core)]\n#![no_core]\n#![crate_type = "rlib"]\nextern crate la;\n',
};

interface Case {
  name: string;
  src: string;
  args?: string[];
}
const CASES: Case[] = [
  {
    name: "no_core",
    src:
      NO_CORE +
      MINI +
      '#[lang = "copy"] pub trait Copy {}\n#[lang = "add"] pub trait Add<Rhs> { type Output; fn add(self, rhs: Rhs) -> Self::Output; }\n' +
      'pub enum Option<T> { #[lang = "None"] None, #[lang = "Some"] Some(T) }\n' +
      'pub trait Tr { #[lang = "deref_target"] type Target; }\n' +
      'pub mod m { #[lang = "drop"] pub trait Drop { fn drop(&mut self); } }\n' +
      'pub fn f() { #[lang = "clone"] trait Clone {} }\n',
  },
  { name: "std", src: "fn main() {}\n" },
  { name: "no_std_lib", src: "#![no_std]\npub fn f() {}\n" },
  // E0152, both definitions local (`first_defined_span`)
  { name: "dup_local", src: NO_CORE + MINI + '#[lang = "sized"] pub trait Sized2 {}\n' },
  // E0152, the first definition from core's metadata
  { name: "dup_std", src: '#![feature(lang_items)]\n#[lang = "copy"]\ntrait MyCopy {}\nfn main() {}\n' },
  // E0152 between two extern crates (`dependency_of`), directly and through a dependency
  { name: "dup_crates", src: '#![feature(no_core)]\n#![no_core]\n#![crate_type = "lib"]\nextern crate la;\nextern crate lb;\n', args: ["-L", "aux"] },
  { name: "dup_crates_dep", src: '#![feature(no_core)]\n#![no_core]\n#![crate_type = "lib"]\nextern crate lc;\nextern crate lb;\n', args: ["-L", "aux"] },
  { name: "extern_ok", src: '#![feature(no_core)]\n#![no_core]\n#![crate_type = "lib"]\nextern crate lc;\n', args: ["-L", "aux"] },
  // E0718: wrong number of generic parameters (exact, minimum, associated item counting its parent's)
  {
    name: "generics",
    src:
      NO_CORE +
      MINI +
      '#[lang = "add"] pub trait Add {}\n#[lang = "index"] pub trait Index<A, B> {}\n#[lang = "coerce_unsized"] pub trait CU {}\n' +
      'pub trait Tr<T> { #[lang = "fn_once_output"] type Output; }\n',
  },
  // weak lang items (weak_lang_items.rs): a `no_std` binary without and with `#[panic_handler]`
  { name: "weak_abort", src: "#![no_std]\n#![no_main]\n", args: ["--crate-type", "bin", "-Cpanic=abort"] },
  { name: "weak_unwind", src: "#![no_std]\n#![no_main]\n", args: ["--crate-type", "bin"] },
  {
    name: "panic_handler",
    src: "#![no_std]\n#![no_main]\n#[panic_handler]\nfn p(_: &core::panic::PanicInfo) -> ! { loop {} }\n",
    args: ["--crate-type", "bin", "-Cpanic=abort"],
  },
];

let sysroot = "";

beforeAll(async () => {
  if (SKIP) return;
  if (!existsSync(PROBE)) throw new Error("ERROR: langitems probe not built and RUST_TS_REQUIRE_PROBES=1");
  const oracle = require("../../scripts/lib/oracle.ts") as typeof import("../../scripts/lib/oracle.ts");
  sysroot = oracle.oracleSysroot();
  mkdirSync(join(WORK, "aux"), { recursive: true });
  for (const [name, src] of Object.entries(AUX)) {
    writeFileSync(join(WORK, "aux", `${name}.rs`), src);
    const r = await run(oracle.oracleRustcCmd(["--edition", "2021", "--out-dir", "aux", "-L", "aux", `aux/${name}.rs`]), WORK);
    if (r.code !== 0) throw new Error(`ERROR: building aux crate ${name} failed: ${r.stderr.slice(0, 2000)}`);
  }
  for (const c of CASES) writeFileSync(join(WORK, `${c.name}.rs`), c.src);
}, 120_000);

for (const c of CASES) {
  test.skipIf(SKIP)(`langitems: ${c.name}`, async () => {
    const args = [`${c.name}.rs`, "--edition", "2021", "--sysroot", sysroot, ...(c.args ?? [])];
    const [oracle, ours] = await Promise.all([run([PROBE, ...args], WORK), run([process.execPath, RUNNER, ...args], WORK)]);
    // the oracle did something (guards against a case that tests nothing)
    expect(oracle.stdout.length + oracle.stderr.length).toBeGreaterThan(0);
    expect(ours.stderr).toBe(oracle.stderr);
    expect(ours.stdout).toBe(oracle.stdout);
    expect(ours.code).toBe(oracle.code);
  }, 120_000);
}
