// Oracle tests for lane ty-print-b (compiler/rustc_middle/src/ty/print/pretty.rs 1705..end): region Display through
// `FmtPrinter::print_region` / `pretty_print_region` (plain, `-Zidentify-regions`, region highlights),
// `should_print_optional_region`, `print_crate_name` (with `with_crate_prefix` / `with_resolve_crate_name`),
// `print_path_with_simple` over every free item's `DefKey`, `print_path_with_generic_args` in the type and value
// namespaces, `typed_value`, `pretty_print_byte_str`, `pretty_print_bound_constness`, `should_print_verbose`
// (`-Zverbose-internals`) and `trimmed_def_paths` (local items, glob imports, an extern crate's public module tree
// with `#[doc(hidden)]`, type aliases, re-exports under two names).
//
// The expected outputs (pretty_oracle/expected.json) come from the oracle compiler itself: pretty_oracle/probe.rs, a
// throwaway rustc-dev probe (its header says how to build it; lanes may not add tools/probes). The subject side is
// pretty_oracle/run.ts (the ported driver, same sections). stdout, stderr and the exit code must be identical.
//
// To regenerate expected.json from the probe: TYPRINT_PROBE=<path to the built probe> TYPRINT_WRITE=1 bun test <this file>.
// With only TYPRINT_PROBE set, the cases compare against the live probe instead of expected.json.
import { beforeAll, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { REPO } from "../../../../scripts/lib/common.ts";
import { test_scratch_dir } from "../../../rust_ts/test_scratch.ts";

const WORK = test_scratch_dir("ty-print-b");
const RUNNER = join(REPO, "src/rustc_middle/ty/print/pretty_oracle/run.ts");
const EXPECTED = join(REPO, "src/rustc_middle/ty/print/pretty_oracle/expected.json");
const PROBE = process.env.TYPRINT_PROBE;
const WRITE = process.env.TYPRINT_WRITE === "1";

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

const MINI = '#[lang = "pointee_sized"] pub trait PointeeSized {}\n#[lang = "meta_sized"] pub trait MetaSized: PointeeSized {}\n#[lang = "sized"] pub trait Sized: MetaSized {}\n#[lang = "copy"] pub trait Copy {}\n';

/** The extern crate of the `ext` cases, built with the oracle rustc into `aux/`. */
const AUX_PA =
  '#![feature(no_core, lang_items)]\n#![no_core]\n#![crate_type = "rlib"]\n' +
  "pub mod a {\n    pub struct Thing;\n    pub struct Only;\n    pub(crate) struct Hidden;\n    pub mod deep { pub struct Deeper; pub fn helper() {} }\n}\n" +
  "pub use self::a::Thing as Alpha;\npub use self::a::Thing as Zeta;\n" +
  "#[doc(hidden)]\npub mod secret { pub struct Inside; }\n#[doc(hidden)]\npub struct Shy;\n" +
  "pub type Al = a::Only;\npub trait Tr { type Assoc; fn method(); }\npub struct Dup;\npub fn func() {}\n" +
  "macro_rules! m { () => {} }\n#[macro_export]\nmacro_rules! exported { () => {} }\n" +
  MINI;

const SOURCES: Record<string, string> = {
  "local.rs":
    '#![feature(no_core, lang_items)]\n#![no_core]\n#![crate_type = "lib"]\n' +
    "pub mod m {\n    pub struct Foo;\n    pub fn bar() {}\n    pub mod inner { pub struct Foo; pub struct Gl; }\n    pub trait Tr {}\n}\n" +
    "pub use m::bar as baz;\npub use m::inner::*;\npub struct Unique;\npub enum E { A, B(u8) }\npub fn r#match() {}\npub fn r#async() {}\n" +
    'extern "C" { fn ext(); }\nmacro_rules! mac { () => {} }\ntype Alias = Unique;\nimpl Unique {}\nconst C: u8 = 0;\nstatic S: u8 = 0;\npub union U { a: u8 }\n',
  "ext.rs": '#![feature(no_core)]\n#![no_core]\n#![crate_type = "lib"]\nextern crate pa;\npub struct Dup;\npub struct Only;\npub mod x { pub fn func() {} }\n',
};

// `-Zprint-type-sizes` keeps `Session::record_trimmed_def_paths` from setting `must_produce_diag` (session.rs:675),
// which would make both compilers ICE at exit since the probe emits no diagnostic after trimming.
const CASES: { name: string; args: string[] }[] = [
  { name: "local", args: ["local.rs"] },
  { name: "local_identify_regions", args: ["local.rs", "-Zidentify-regions"] },
  { name: "local_verbose", args: ["local.rs", "-Zverbose-internals"] },
  { name: "local_2021", args: ["local.rs", "--edition", "2021"] },
  { name: "ext", args: ["ext.rs", "-L", "aux"] },
  { name: "ext_verbose", args: ["ext.rs", "-L", "aux", "-Zverbose-internals"] },
];

let sysroot = "";
const expected: Record<string, Out> = PROBE !== undefined ? {} : JSON.parse(readFileSync(EXPECTED, "utf8"));

beforeAll(async () => {
  const oracle = require("../../../../scripts/lib/oracle.ts") as typeof import("../../../../scripts/lib/oracle.ts");
  sysroot = oracle.oracleSysroot();
  mkdirSync(join(WORK, "aux"), { recursive: true });
  writeFileSync(join(WORK, "aux", "pa.rs"), AUX_PA);
  const r = await run(oracle.oracleRustcCmd(["--out-dir", "aux", "aux/pa.rs"]), WORK);
  if (r.code !== 0) throw new Error(`ERROR: building aux crate pa failed: ${r.stderr.slice(0, 2000)}`);
  for (const [name, src] of Object.entries(SOURCES)) writeFileSync(join(WORK, name), src);
}, 120_000);

for (const c of CASES) {
  test(`ty-print-b oracle: ${c.name}`, async () => {
    const args = [...c.args, "-Zprint-type-sizes", "--sysroot", sysroot];
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
    expect(want.stdout).toContain("== trimmed (");
    expect(ours.stderr).toBe(want.stderr);
    expect(ours.stdout).toBe(want.stdout);
    expect(ours.code).toBe(want.code);
  }, 120_000);
}
