// Oracle checks of the proc-macro host path (lane pm-host, plan-m6 D7): rustc_metadata host_dylib.ts + the FFI edge
// src/rust_ts/proc_macro_host.ts + the ported bridge server, against the pinned nightly rustc.
//
// Each test builds small proc-macro crates with the oracle (`--crate-type proc-macro`, a host dylib) into a
// scratch directory, then compiles user crates that use them with both the oracle and src/rust_ts/main.ts
// (`-Zunpretty=expanded`, same argv, same cwd) and compares stdout, stderr and the exit code. The proc macros
// run as the oracle's own compiled client code inside the dylib, talking to the TS server over real `Buffer`s,
// so this checks the bridge's byte format end to end (handles, `ExpnGlobals`, `Option` / `Result` tags, symbols,
// spans, literals, diagnostics, panics).
//
// Skips (visibly) if the pinned rustc is unavailable; fails instead under RUST_TS_REQUIRE_PROBES=1.
import { describe, expect, test } from "bun:test";
import { copyFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PIN, REPO } from "../../scripts/lib/common.ts";
import "../proc_macro/lib.ts";
import type { Client } from "../proc_macro/bridge/client.ts";
import type { ExpnGlobals, TokenTree } from "../proc_macro/bridge/mod.ts";
import { SAME_THREAD, type Server } from "../proc_macro/bridge/server.ts";
import { Unported, unported } from "../std/panic.ts";
import { dlsym_proc_macros } from "../rustc_metadata/host_dylib.ts";
import { Hash64 } from "../rustc_hashes/lib.ts";
import { StableCrateId } from "../rustc_span/def_id.ts";
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
const SKIP = (!HAVE && !REQUIRE) || process.platform === "win32";
// The Windows host is unchecked (plan §3 A4): the FFI edge stops `unported` there, so these tests cannot pass. Say so.
if (process.platform === "win32") console.warn("proc_macro_host.oracle.test.ts: skipped on win32 (the Windows FFI edge is unchecked and stops unported)");
if (SKIP) console.log(`SKIP: pinned rustc (${PIN.toolchain}, ${PIN.commit.slice(0, 12)}) unavailable; RUST_TS_REQUIRE_PROBES=1 makes this a failure`);

const WORK = test_scratch_dir("pm-host");

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

/** Build `<name>.rs` as a proc-macro dylib `lib<name>.dylib` (or `.so`) in WORK with the oracle. */
function build_proc_macro(name: string, src: string): string {
  writeFileSync(join(WORK, `${name}.rs`), src);
  const file = `lib${name}.${process.platform === "darwin" ? "dylib" : "so"}`;
  const r = run([...RUSTC, "--edition", "2021", "--crate-type", "proc-macro", `${name}.rs`, "-o", file]);
  if (r.code !== 0) throw new Error(`oracle failed to build proc macro ${name}: ${r.stderr}`);
  return file;
}

/** The `{:08x}` stable crate id in the dylib's `__rustc_proc_macro_decls_<id>__` export. */
function decls_id(file: string): bigint {
  const nm = Bun.spawnSync(["nm", "-gU", join(WORK, file)]).stdout.toString();
  const m = /_rustc_proc_macro_decls_([0-9a-f]+)__/.exec(nm);
  if (!m) throw new Error(`no proc-macro decls symbol in ${file}`);
  return BigInt(`0x${m[1]}`);
}

/** The panic hook's thread id (`thread '<unnamed>' (12345) panicked`) differs per run on both sides. */
const normalize = (s: string): string => s.replace(/(thread '[^']*') \(\d+\)/g, "$1 (TID)");

/** Runs the oracle and the port on the same argv; returns the oracle's result. The oracle output must not be empty,
 * so a case where both sides fail the same way without printing anything cannot pass. */
function compare(user: string, src: string, externs: [string, string][], extra: string[] = []): { code: number; stdout: string; stderr: string } {
  writeFileSync(join(WORK, user), src);
  const args = ["--edition", "2021", ...extra, "-Zunpretty=expanded", ...externs.flatMap(([n, f]) => ["--extern", `${n}=${f}`]), user];
  const oracle = run([...RUSTC, ...args]);
  const port = run(["bun", join(REPO, "src/rust_ts/main.ts"), "--sysroot", sysroot(), ...args]);
  expect(oracle.stdout.length + oracle.stderr.length).toBeGreaterThan(0);
  expect(normalize(port.stderr)).toBe(normalize(oracle.stderr));
  expect(port.stdout).toBe(oracle.stdout);
  expect(port.code).toBe(oracle.code);
  return oracle;
}

const ECHO_PM = `extern crate proc_macro;
use proc_macro::{TokenStream, TokenTree, Ident, Span};

#[proc_macro]
pub fn echo(input: TokenStream) -> TokenStream {
    let mut v: Vec<TokenTree> = input.into_iter().collect();
    v.push(TokenTree::Ident(Ident::new("extra", Span::call_site())));
    v.into_iter().collect()
}

#[proc_macro_derive(Hello, attributes(hello))]
pub fn hello(input: TokenStream) -> TokenStream {
    let s = input.to_string();
    let name = s.split_whitespace().skip_while(|w| *w != "struct").nth(1).unwrap().trim_end_matches(';').to_string();
    format!("impl {} {{ pub fn hello() -> u32 {{ 42 }} }}", name).parse().unwrap()
}

#[proc_macro_attribute]
pub fn wrap(attr: TokenStream, item: TokenStream) -> TokenStream {
    let mut out: TokenStream = format!("#[doc = {:?}]", attr.to_string()).parse().unwrap();
    out.extend(item);
    out
}
`;

const HARD_PM = `extern crate proc_macro;
use proc_macro::*;

#[proc_macro]
pub fn boom(_: TokenStream) -> TokenStream { panic!("boom at {}", 42) }

#[proc_macro]
pub fn boom_any(_: TokenStream) -> TokenStream { std::panic::panic_any(7u8) }

#[proc_macro]
pub fn err(input: TokenStream) -> TokenStream {
    let span = input.into_iter().next().map(|t| t.span()).unwrap_or(Span::call_site());
    let mut ce: TokenStream = "compile_error!".parse().unwrap();
    let mut msg = Literal::string("bad input here: ünïcödé");
    msg.set_span(span);
    let mut g = Group::new(Delimiter::Parenthesis, TokenTree::Literal(msg).into());
    g.set_span(span);
    ce.extend([TokenTree::Group(g), TokenTree::Punct(Punct::new(';', Spacing::Alone))]);
    ce
}

#[proc_macro]
pub fn describe(input: TokenStream) -> TokenStream {
    let mut out = String::new();
    fn walk(ts: TokenStream, out: &mut String, depth: usize) {
        for t in ts {
            match t {
                TokenTree::Group(g) => { out.push_str(&format!("{}G{:?}[", " ".repeat(depth), g.delimiter())); walk(g.stream(), out, depth + 1); out.push(']'); }
                TokenTree::Ident(i) => out.push_str(&format!("I({})", i)),
                TokenTree::Punct(p) => out.push_str(&format!("P({}{:?})", p.as_char(), p.spacing())),
                TokenTree::Literal(l) => out.push_str(&format!("L({})", l)),
            }
        }
    }
    walk(input.clone(), &mut out, 0);
    // A large stream: the client's buffers grow through the server's \`reserve\`.
    let big: String = (0..2000).map(|i| format!("x{} ", i)).collect();
    let n = big.parse::<TokenStream>().unwrap().into_iter().count();
    format!("const DESC: &str = {:?}; const N: usize = {}; const S: &str = {:?};", out, n, input.to_string()).parse().unwrap()
}

#[proc_macro]
pub fn idents(_: TokenStream) -> TokenStream {
    let a = Ident::new("größe", Span::call_site());
    let r = Ident::new_raw("match", Span::mixed_site());
    let lits = vec![Literal::u8_suffixed(3), Literal::i64_unsuffixed(-5), Literal::f64_suffixed(1.5), Literal::character('\\''), Literal::byte_string(b"a\\0b"), Literal::c_string(c"hi")];
    let mut ts: TokenStream = format!("let {} = 1; let {} = 2;", a, r).parse().unwrap();
    for (i, l) in lits.into_iter().enumerate() {
        ts.extend(format!("let _l{} = ", i).parse::<TokenStream>().unwrap());
        ts.extend([TokenTree::Literal(l), TokenTree::Punct(Punct::new(';', Spacing::Alone))]);
    }
    ts
}

#[proc_macro_derive(Fields)]
pub fn fields(input: TokenStream) -> TokenStream {
    let v: Vec<TokenTree> = input.into_iter().collect();
    let name = v.iter().skip_while(|t| t.to_string() != "struct").nth(1).unwrap().to_string();
    let body = match v.last().unwrap() { TokenTree::Group(g) => g.stream().to_string(), _ => String::new() };
    format!("impl {} {{ const BODY: &'static str = {:?}; }}", name, body).parse().unwrap()
}

#[proc_macro]
pub fn bad_parse(_: TokenStream) -> TokenStream { "let x = (;".parse().unwrap() }

#[proc_macro]
pub fn say(input: TokenStream) -> TokenStream { println!("OUT {}", input); eprintln!("ERR {}", input); TokenStream::new() }
`;

describe.skipIf(SKIP)("proc-macro host dylibs vs the oracle (-Zunpretty=expanded)", () => {
  let echo = "";
  let hard = "";
  const echo_pm = (): string => (echo ||= build_proc_macro("echo_pm", ECHO_PM));
  const hard_pm = (): string => (hard ||= build_proc_macro("hard_pm", HARD_PM));

  test("dlsym_proc_macros: one Client per proc macro; a wrong decls symbol is DlSym", () => {
    const file = echo_pm();
    const path = join(WORK, file);
    const id = decls_id(file);
    const ok = dlsym_proc_macros(path, StableCrateId.of(Hash64.new(id)));
    expect(ok.$).toBe("Ok");
    if (ok.$ === "Ok") expect(ok._0.length).toBe(3);
    const bad = dlsym_proc_macros(path, StableCrateId.of(Hash64.new(id ^ 1n)));
    expect(bad.$).toBe("Err");
    if (bad.$ === "Err") {
      expect(bad._0.$).toBe("DlSym");
      expect(bad._0._1.startsWith(": dlsym failed: ")).toBe(true);
    }
  }, 60_000);

  test("derive, attribute and bang macros", () => {
    expect(compare(
      "user_echo.rs",
      `#[macro_use]
extern crate echo_pm;

#[derive(Hello)]
struct Foo;

#[wrap(a + b)]
fn f() {}

fn main() {
    let extra = 1;
    let _x = echo!(1 + );
}
`,
      [["echo_pm", echo_pm()]],
    ).code).toBe(0);
  }, 60_000);

  test("token trees, literals, raw and non-ASCII idents, large streams", () => {
    expect(compare(
      "user_hard.rs",
      `extern crate hard_pm;
use hard_pm::*;

#[derive(Fields)]
struct S { a: u32, /// doc
    b: Vec<String> }

describe!(a.b::<c>(1, "s", 'c', 2.0f32) { [x] } # ! r#match 'lt => ...);

fn main() {
    idents!();
}
`,
      [["hard_pm", hard_pm()]],
    ).code).toBe(0);
  }, 60_000);

  const ERRORS = `extern crate hard_pm;
use hard_pm::*;
boom!();
boom_any!();
err!(here);
bad_parse!();
fn main() {}
`;
  test("proc-macro panics and compile_error! spans", () => {
    compare("user_errors.rs", ERRORS, [["hard_pm", hard_pm()]]);
  }, 60_000);

  test("-Zproc-macro-backtrace: the dylib's panic hook prints", () => {
    compare("user_errors_bt.rs", ERRORS, [["hard_pm", hard_pm()]], ["-Zproc-macro-backtrace"]);
  }, 60_000);

  test("the dylib's own stdout / stderr writes interleave with diagnostics", () => {
    compare(
      "user_print.rs",
      `extern crate hard_pm;
use hard_pm::say;
say!(one);
compile_error!("first");
say!(two);
fn main() {}
`,
      [["hard_pm", hard_pm()]],
    );
  }, 60_000);

  test.skipIf(process.platform !== "darwin" || !Bun.which("codesign"))("dlopen failure (unsigned dylib on macOS) is CrateError::DlOpen", () => {
    const file = echo_pm();
    const unsigned = `unsigned_${file}`;
    copyFileSync(join(WORK, file), join(WORK, unsigned));
    expect(run(["codesign", "--remove-signature", unsigned]).code).toBe(0);
    compare("user_unsigned.rs", "extern crate echo_pm;\nfn main() {}\n", [["echo_pm", unsigned]]);
  }, 60_000);
});

// ---- in process: the dylib's `Client.run1` against a minimal TS server (no rustc pipeline) ----

interface MiniTS {
  trees: TokenTree<MiniTS, number, string>[];
}
/** Answers what `echo!` asks (into_trees, concat_trees); `fail` makes `ts_into_trees` throw `unported`. */
class MiniServer {
  constructor(public fail: boolean) {}
  static intern_symbol(ident: string): string {
    return ident;
  }
  static with_symbol_string(symbol: string, f: (s: string) => void): void {
    f(symbol);
  }
  static default_TokenStream(): MiniTS {
    return { trees: [] };
  }
  globals(): ExpnGlobals<number> {
    return { def_site: 10, call_site: 11, mixed_site: 12 };
  }
  ts_into_trees(stream: MiniTS): TokenTree<MiniTS, number, string>[] {
    if (this.fail) return unported("pm-host test: a server method that is not ported");
    return stream.trees;
  }
  ts_concat_trees(base: MiniTS | undefined, trees: TokenTree<MiniTS, number, string>[]): MiniTS {
    return { trees: [...(base?.trees ?? []), ...trees] };
  }
  ts_drop(_stream: MiniTS): void {}
}
/** The rest of `Server` is not called by `echo!`; a call fails the test. */
function mini_server(fail: boolean): Server<MiniTS, number, string> {
  const m = new MiniServer(fail);
  return new Proxy(m, {
    get(target, key, recv) {
      if (key in target) return Reflect.get(target, key, recv);
      return () => {
        throw new Error(`MiniServer: unexpected call ${String(key)}`);
      };
    },
  }) as unknown as Server<MiniTS, number, string>;
}

describe.skipIf(SKIP)("proc-macro host dylibs in process (Client.run1 through the FFI edge)", () => {
  let echo: Client | undefined;
  const echo_client = (): Client => {
    if (echo !== undefined) return echo;
    const file = build_proc_macro("echo_pm_inproc", ECHO_PM);
    const r = dlsym_proc_macros(join(WORK, file), StableCrateId.of(Hash64.new(decls_id(file))));
    if (r.$ !== "Ok") throw new Error(`dlsym_proc_macros failed: ${r._0._1}`);
    // The decls order is the crate's: echo (bang), hello (derive), wrap (attr).
    echo = r._0[0]!;
    return echo;
  };
  const input = (): MiniTS => ({ trees: [{ $: "Ident", _0: { sym: "a", kind: "Normal", span: 11 } }] });

  test("echo!: trees out, one call-site Ident appended", () => {
    const r = echo_client().run1(SAME_THREAD, mini_server(false), input(), false);
    expect(r.$).toBe("Ok");
    if (r.$ === "Ok") {
      expect(r._0.trees.length).toBe(2);
      expect(r._0.trees[1]).toEqual({ $: "Ident", _0: { sym: "extra", kind: "Normal", span: 11 } });
    }
  }, 60_000);

  test("a JS exception in a server method is rethrown after the client returns; the bridge stays usable", () => {
    expect(() => echo_client().run1(SAME_THREAD, mini_server(true), input(), false)).toThrow(Unported);
    const again = echo_client().run1(SAME_THREAD, mini_server(false), input(), false);
    expect(again.$).toBe("Ok");
  }, 60_000);
});
