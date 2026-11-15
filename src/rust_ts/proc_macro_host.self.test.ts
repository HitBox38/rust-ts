// Proc macros the port builds, loaded by the port (lane pm-self, plan-m7 §6 and M7d `pm-self`).
//
// One small proc-macro crate (a derive with a helper attribute, an attribute macro, a function-like macro, and one that
// expands to `compile_error!`) is built with `--crate-type proc-macro` by the pinned rustc and by src/rust_ts/main.ts,
// each into the same path in turn (the dylib's install name is its output path). Checked against the oracle:
// - the port's dylib and rmeta are byte-identical to the oracle's (so its exported `__rustc_proc_macro_decls_<id>__`
//   and `rust_metadata_<crate>_<id>` symbols, its `.rustc` section and its code are too);
// - a user crate compiled by the port against the port-built dylib, which the port's own proc-macro host loads
//   (rustc_metadata host_dylib.ts, proc_macro_host.ts), gives the same `-Zunpretty=expanded` stdout, stderr and exit
//   code as the oracle against the oracle-built dylib; so does a compile with an error from a macro.
//
// The byte check holds for this crate. A crate with two or more always-inline call sites of one callee in a function can
// differ in stack-slot order: the IR model hands textual IR to the pinned `opt`, which loses the in-process use-list order
// that LLVM's AlwaysInliner follows (docs/handoff/pm-self.md). Behaviour is unaffected.
//
// Skips (visibly) if the pinned rustc is unavailable; fails instead under RUST_TS_REQUIRE_PROBES=1.
import { describe, expect, test } from "bun:test";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PIN, REPO } from "../../scripts/lib/common.ts";
import { test_scratch_dir } from "./test_scratch.ts";

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
// The Windows host is unchecked (AGENTS.md §5): the FFI edge stops `unported` there. Say so.
const SKIP = (!HAVE && !REQUIRE) || process.platform === "win32";
if (process.platform === "win32") console.warn("proc_macro_host.self.test.ts: skipped on win32 (the Windows FFI edge is unchecked and stops unported)");
if (SKIP && process.platform !== "win32") console.log(`SKIP: pinned rustc (${PIN.toolchain}, ${PIN.commit.slice(0, 12)}) unavailable; RUST_TS_REQUIRE_PROBES=1 makes this a failure`);

const WORK = test_scratch_dir("pm-self");

const BASE_ENV: Record<string, string> = { RUSTC_ICE: "0", RUST_BACKTRACE: "0" };
for (const [k, v] of Object.entries(process.env)) {
  if (v === undefined) continue;
  if (["MAKEFLAGS", "CARGO_MAKEFLAGS", "MFLAGS", "RUSTC_LOG", "RUSTC_BOOTSTRAP", "RUSTC_ICE", "RUST_BACKTRACE"].includes(k)) continue;
  BASE_ENV[k] = v;
}

interface Out {
  stdout: string;
  stderr: string;
  code: number;
}
function run(cmd: string[]): Out {
  const r = Bun.spawnSync(cmd, { cwd: WORK, env: BASE_ENV, stdout: "pipe", stderr: "pipe" });
  return { stdout: r.stdout.toString(), stderr: r.stderr.toString(), code: r.exitCode ?? -1 };
}
let SYSROOT: string | undefined;
const sysroot = (): string => (SYSROOT ??= Bun.spawnSync([...RUSTC, "--print", "sysroot"]).stdout.toString().trim());
const PORT = (): string[] => ["bun", join(REPO, "src/rust_ts/main.ts"), "--sysroot", sysroot()];

const DYLIB = `libpm_self.${process.platform === "darwin" ? "dylib" : "so"}`;

const PROC_MACRO = `extern crate proc_macro;
use proc_macro::{Delimiter, Group, Ident, Literal, Punct, Spacing, Span, TokenStream, TokenTree};

/// A derive with a helper attribute: \`impl <name> { fn name() -> &'static str }\`.
#[proc_macro_derive(Named, attributes(name))]
pub fn named(input: TokenStream) -> TokenStream {
    let mut it = input.into_iter();
    let mut ident = None;
    while let Some(t) = it.next() {
        if let TokenTree::Ident(i) = &t {
            if i.to_string() == "struct" {
                ident = it.next();
                break;
            }
        }
    }
    let ident = ident.expect("a struct");
    format!("impl {ident} {{ pub fn name() -> &'static str {{ {:?} }} }}", ident.to_string()).parse().unwrap()
}

/// An attribute macro: the item, then the attribute's tokens.
#[proc_macro_attribute]
pub fn then(attr: TokenStream, item: TokenStream) -> TokenStream {
    let mut out = item;
    out.extend(attr);
    out
}

/// A function-like macro building \`fn answer() -> u32 { 42u32 }\` from token trees.
#[proc_macro]
pub fn make_answer(_input: TokenStream) -> TokenStream {
    let body = TokenStream::from_iter([TokenTree::Literal(Literal::u32_suffixed(42))]);
    TokenStream::from_iter([
        TokenTree::Ident(Ident::new("fn", Span::call_site())),
        TokenTree::Ident(Ident::new("answer", Span::mixed_site())),
        TokenTree::Group(Group::new(Delimiter::Parenthesis, TokenStream::new())),
        TokenTree::Punct(Punct::new('-', Spacing::Joint)),
        TokenTree::Punct(Punct::new('>', Spacing::Alone)),
        TokenTree::Ident(Ident::new("u32", Span::call_site())),
        TokenTree::Group(Group::new(Delimiter::Brace, body)),
    ])
}

/// A function-like macro that expands to \`compile_error!\` with the input as message.
#[proc_macro]
pub fn fail(input: TokenStream) -> TokenStream {
    format!("compile_error!({:?});", input.to_string()).parse().unwrap()
}
`;

const USER = `#[macro_use]
extern crate pm_self;
#[derive(Named)]
#[name = "n"]
struct S;
#[then(fn g() {})]
fn f() {}
make_answer!();
fn main() {
    f();
    g();
    println!("{} {}", S::name(), answer());
}
`;

const USER_ERROR = `#[macro_use]
extern crate pm_self;
fail!(nope here);
fn main() {}
`;

describe.skipIf(SKIP)("pm-self: a proc-macro crate built by the port, loaded by the port", () => {
  writeFileSync(join(WORK, "pm_self.rs"), PROC_MACRO);
  mkdirSync(join(WORK, "oracle"));
  writeFileSync(join(WORK, "user.rs"), USER);
  writeFileSync(join(WORK, "user_error.rs"), USER_ERROR);
  const build = ["--edition", "2021", "--crate-type", "proc-macro", "--extern", "proc_macro", "--emit=metadata,link", "--out-dir", ".", "pm_self.rs"];
  let built = false;
  /** Oracle first (its outputs copied aside to `oracle/`), then the port into the same paths. */
  function build_both(): void {
    if (built) return;
    const o = run([...RUSTC, ...build]);
    expect(o.stderr).toBe("");
    expect(o.code).toBe(0);
    copyFileSync(join(WORK, DYLIB), join(WORK, "oracle", DYLIB));
    copyFileSync(join(WORK, "libpm_self.rmeta"), join(WORK, "oracle", "libpm_self.rmeta"));
    const p = run([...PORT(), ...build]);
    expect(p.stderr).toBe("");
    expect(p.code).toBe(0);
    built = true;
  }

  test("the port's dylib and rmeta are byte-identical to the oracle's", () => {
    build_both();
    const same = (a: string, b: string): boolean => Buffer.compare(readFileSync(join(WORK, a)), readFileSync(join(WORK, b))) === 0;
    expect(same(DYLIB, `oracle/${DYLIB}`)).toBe(true);
    expect(same("libpm_self.rmeta", "oracle/libpm_self.rmeta")).toBe(true);
    // (Implied by the bytes; spelled out so a failure says which part differs first.)
    const nm = (f: string): string => Bun.spawnSync(["nm", "-gU", join(WORK, f)]).stdout.toString();
    if (process.platform === "darwin") expect(nm(DYLIB)).toMatch(/___rustc_proc_macro_decls_[0-9a-f]{16}__\n/);
  }, 60_000);

  // The port loads its own dylib (`--extern pm_self=<port-built>`); the oracle loads the oracle-built one.
  for (const [name, file] of [
    ["expansion", "user.rs"],
    ["a compile error from a macro", "user_error.rs"],
  ] as const) {
    test(`${name}: -Zunpretty=expanded stdout, stderr and exit match the oracle`, () => {
      build_both();
      const args = ["--edition", "2021", "-Zunpretty=expanded", file];
      const o = run([...RUSTC, "--extern", `pm_self=oracle/${DYLIB}`, ...args]);
      const p = run([...PORT(), "--extern", `pm_self=${DYLIB}`, ...args]);
      expect(p).toEqual(o);
      expect(o.code).toBe(file === "user.rs" ? 0 : 1);
    }, 60_000);
  }
});
