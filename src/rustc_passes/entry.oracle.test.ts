// Oracle tests for rustc_passes/src/entry.rs (`entry_fn`, E0601 `NoMainErr`, E0137, `ExternMain`, `#[rustc_main]`,
// `-Zon-broken-pipe`, `-Zteach`), eii.rs (`check_externally_implementable_items`) and check_export.rs (the
// non-sdylib paths of `exportable_items` / `stable_order_of_exportable_impls`) (lane passes-a).
//
// The oracle is the pinned rustc itself (`--emit=metadata`, so nothing is linked): its stderr holds every diagnostic
// of the compilation. The subject is src/rustc_passes/oracle/entry_run.ts, the ported driver, which runs these
// queries from `after_expansion` in `run_required_analyses` order, then `abort_if_errors`. The cases are chosen so
// that rustc emits nothing after misc_checking_1 (no later errors or lints): stderr and the exit code must be
// identical. stdout (the subject's query values: `def_path_str` of the entry fn and its `EntryFnType`) is checked
// against the value implied by the case (the `sigpipe` constants are rustc_session/config/sigpipe.rs).
//
// The oracle rustc (`scripts/lib/oracle.ts`) is required, as for the difftest suites.
import { beforeAll, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { REPO } from "../../scripts/lib/common.ts";
import { oracleRustcCmd, oracleSysroot } from "../../scripts/lib/oracle.ts";
import { test_scratch_dir } from "../rust_ts/test_scratch.ts";

const WORK = test_scratch_dir("passes-entry-oracle");
const RUNNER = join(REPO, "src/rustc_passes/oracle/entry_run.ts");

const ENV: Record<string, string> = {};
for (const [k, v] of Object.entries(process.env)) {
  if (v !== undefined && !["MAKEFLAGS", "CARGO_MAKEFLAGS", "MFLAGS", "RUSTC_LOG", "RUSTC_BOOTSTRAP", "RUSTC_ICE"].includes(k)) ENV[k] = v;
}

interface Out {
  stdout: string;
  stderr: string;
  code: number;
}
async function run(cmd: string[], cwd: string, queries = "all"): Promise<Out> {
  const p = Bun.spawn(cmd, { cwd, env: { ...ENV, RUST_TS_PASSES_QUERIES: queries }, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  return { stdout, stderr, code };
}

/** `sym::env_CFG_RELEASE` (`StableSince::Current`): the pinned release. */
const CFG_RELEASE = (JSON.parse(readFileSync(join(REPO, "UPSTREAM.json"), "utf8")) as { rust: { release: string } }).rust.release;

const NONE_REST = "exportable_items: []\nstable_order_of_exportable_impls: []\n";

interface Case {
  name: string;
  src: string;
  args?: string[];
  /** The subject's RUST_TS_PASSES_QUERIES (default `all`). */
  queries?: string;
  /** The subject's stdout when the compilation has no errors (it aborts before printing otherwise). */
  stdout?: string;
}
const CASES: Case[] = [
  // E0601, with the span at the end of the crate
  { name: "no_main_fn", src: "fn foo() {}\n" },
  // E0601 in an empty file: the span-less note (`file_empty`)
  { name: "empty_file", src: "" },
  // E0601 with `non_main_fns` notes (a `main` not at the crate root)
  { name: "nested_main", src: "mod m { pub fn main() {} }\n" },
  // E0601 with the `non-function item at crate::main` label
  { name: "static_main", src: "static main: u32 = 0;\n" },
  // E0601 with -Zteach (the Rust Book note)
  { name: "teach", src: "fn foo() {}\n", args: ["-Zteach"] },
  // E0137
  { name: "multiple_rustc_main", src: "#![feature(rustc_attrs)]\n#[rustc_main]\nfn foo() {}\n#[rustc_main]\nfn bar() {}\n" },
  // `ExternMain`
  { name: "extern_main", src: 'extern "C" { fn main(); }\n' },
  // `#[rustc_main]` wins over `main`
  { name: "rustc_main", src: "#![feature(rustc_attrs)]\n#![allow(dead_code)]\n#[rustc_main]\nfn foo() {}\nfn main() {}\n", stdout: "entry_fn: foo Main { sigpipe: 0 }\n" + NONE_REST },
  // `main` resolved by the resolver, every `-Zon-broken-pipe` value
  { name: "main_default", src: "fn main() {}\n", stdout: "entry_fn: main Main { sigpipe: 0 }\n" + NONE_REST },
  { name: "main_kill", src: "fn main() {}\n", args: ["-Zon-broken-pipe=kill"], stdout: "entry_fn: main Main { sigpipe: 3 }\n" + NONE_REST },
  { name: "main_error", src: "fn main() {}\n", args: ["-Zon-broken-pipe=error"], stdout: "entry_fn: main Main { sigpipe: 2 }\n" + NONE_REST },
  { name: "main_inherit", src: "fn main() {}\n", args: ["-Zon-broken-pipe=inherit"], stdout: "entry_fn: main Main { sigpipe: 1 }\n" + NONE_REST },
  // `main` imported from a module
  { name: "main_use", src: "mod m { pub fn main() {} }\nuse m::main;\n", stdout: "entry_fn: m::main Main { sigpipe: 0 }\n" + NONE_REST },
  // no executable / `#![no_main]`: no entry fn
  { name: "lib_crate", src: "pub fn main() {}\n", args: ["--crate-type", "lib"], stdout: "entry_fn: None\n" + NONE_REST },
  { name: "no_main_attr", src: "#![no_main]\n", stdout: "entry_fn: None\n" + NONE_REST },
  // EII: a declaration without an implementation in a binary (`EiiWithoutImpl`), with an explicit and a default impl
  { name: "eii_without_impl", src: "#![feature(extern_item_impls)]\n#[eii(eii1)]\nfn decl1(x: u64);\nfn main() {}\n" },
  {
    name: "eii_explicit",
    src: "#![feature(extern_item_impls)]\n#![allow(dead_code)]\n#[eii(eii1)]\nfn decl1(x: u64);\n#[eii1]\nfn imp(_x: u64) {}\nfn main() {}\n",
    stdout: "entry_fn: main Main { sigpipe: 0 }\n" + NONE_REST,
  },
  {
    name: "eii_default",
    src: "#![feature(extern_item_impls)]\n#![allow(dead_code)]\n#[eii(eii1)]\nfn decl1(_x: u64) {}\nfn main() {}\n",
    stdout: "entry_fn: main Main { sigpipe: 0 }\n" + NONE_REST,
  },
  // diagnostic_items.rs: a duplicate local diagnostic item, and the local items of `all_diagnostic_items`
  {
    name: "diag_item_dup",
    src: '#![feature(rustc_attrs)]\n#![allow(internal_features, dead_code)]\n#[rustc_diagnostic_item = "Foo"]\nstruct A;\n#[rustc_diagnostic_item = "Foo"]\nstruct B;\nfn main() {}\n',
    queries: "all,diagnostic_items",
  },
  {
    name: "diag_items",
    src: '#![feature(rustc_attrs)]\n#![allow(internal_features, dead_code)]\n#[rustc_diagnostic_item = "Foo"]\nstruct A;\nmod m {\n    #[rustc_diagnostic_item = "Bar"]\n    pub fn f() {}\n}\nfn main() {}\n',
    queries: "all,diagnostic_items",
    stdout: "entry_fn: main Main { sigpipe: 0 }\n" + NONE_REST + "all_diagnostic_items (local): [Foo = A, Bar = m::f]\n",
  },
  // lib_features.rs: E0711 (stable twice with different versions; stable after unstable), and the collected features
  {
    name: "lib_features_err",
    src:
      "#![feature(staged_api)]\n#![allow(internal_features)]\n#![stable(feature = \"a\", since = \"1.0.0\")]\n" +
      '#[stable(feature = "f", since = "1.0.0")]\npub fn a() {}\n#[stable(feature = "f", since = "1.1.0")]\npub fn b() {}\n' +
      '#[unstable(feature = "g", issue = "none")]\npub fn c() {}\n#[stable(feature = "g", since = "1.0.0")]\npub fn d() {}\n' +
      '#[stable(feature = "h", since = "1.0.0")]\npub fn e() {}\n#[unstable(feature = "h", issue = "none")]\npub fn f() {}\n',
    args: ["--crate-type", "lib"],
    queries: "all,lib_features",
  },
  {
    name: "lib_features",
    src:
      "#![feature(staged_api)]\n#![allow(internal_features)]\n#![stable(feature = \"a\", since = \"1.0.0\")]\n" +
      '#[stable(feature = "f", since = "1.2.0")]\npub fn a() {}\n#[stable(feature = "f", since = "1.2.0")]\npub fn b() {}\n' +
      '#[unstable(feature = "g", issue = "none")]\npub fn c() {}\n#[unstable(feature = "g", issue = "none")]\npub fn d() {}\n' +
      '#[stable(feature = "cur", since = "CURRENT_RUSTC_VERSION")]\npub fn e() {}\n',
    args: ["--crate-type", "lib"],
    queries: "all,lib_features",
    stdout:
      "entry_fn: None\n" +
      NONE_REST +
      `lib_features: [a: AcceptedSince("1.0.0"), cur: AcceptedSince("${CFG_RELEASE}"), f: AcceptedSince("1.2.0"), g: Unstable { old_name: None }]\n`,
  },
];

let sysroot = "";

beforeAll(() => {
  sysroot = oracleSysroot();
  mkdirSync(join(WORK, "out"), { recursive: true });
  for (const c of CASES) writeFileSync(join(WORK, `${c.name}.rs`), c.src);
});

for (const c of CASES) {
  test(`entry: ${c.name}`, async () => {
    const common = [`${c.name}.rs`, "--edition", "2021", "--emit=metadata", ...(c.args ?? [])];
    const [ora, ours] = await Promise.all([
      run(oracleRustcCmd([...common, "-o", `out/oracle_${c.name}.rmeta`]), WORK),
      run([process.execPath, RUNNER, ...common, "--sysroot", sysroot, "-o", `out/ours_${c.name}.rmeta`], WORK, c.queries),
    ]);
    expect(ours.stderr).toBe(ora.stderr);
    expect(ours.code).toBe(ora.code);
    if (c.stdout !== undefined) {
      expect(ora.code).toBe(0);
      expect(ours.stdout).toBe(c.stdout);
    } else {
      // an error case: the oracle reported something
      expect(ora.code).toBe(1);
      expect(ours.stdout).toBe("");
    }
  }, 120_000);
}
