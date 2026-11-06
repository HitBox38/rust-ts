// rust-ts: the environment is output. Programs that show it, run under both sides with exactly the same `environ`: `env!`,
// `option_env!`, a real proc-macro dylib reading `std::env` and C's `environ`, and Miri's `environ` block with isolation off and with
// `-Zmiri-env-forward`, from a cwd holding `.env` files. The expected value is always the oracle's (docs/reviews/fixers-40.md F1-F3).
//
// Unit-time budget (docs/reviews/plan-m7.md F5): one port process per compiler. Miri's two runs share a process (stack_miri_driver.ts),
// and read `environ` directly, since the same program through `std::env::vars_os()` takes 19 s of CPU. `vars_os` is a loop over that
// block, and docs/handoff/fixers-41.md records it run by hand.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA, PIN, REPO } from "../../scripts/lib/common.ts";
import { MIRI_SYSROOT, miriBinary, miriOracleProblem, miriPin } from "../../scripts/lib/miri.ts";

const REQUIRE = process.env.RUST_TS_REQUIRE_PROBES === "1";
const RUSTC = ["rustc", `+${PIN.toolchain}`];
const rustc_ok = ((): boolean => {
  try {
    return Bun.spawnSync([...RUSTC, "-vV"]).stdout.toString().includes(`commit-hash: ${PIN.commit}`);
  } catch {
    return false;
  }
})();
const miri_problem = miriOracleProblem({ sysroot: true });
const SYSROOT = rustc_ok ? Bun.spawnSync([...RUSTC, "--print", "sysroot"]).stdout.toString().trim() : "";
const SKIP_RUSTC = !rustc_ok && !REQUIRE;
const SKIP_MIRI = miri_problem !== undefined && !REQUIRE;
if (SKIP_RUSTC) console.log(`SKIP: pinned rustc (${PIN.toolchain}) unavailable; RUST_TS_REQUIRE_PROBES=1 makes this a failure`);
if (SKIP_MIRI) console.log(`SKIP: ${miri_problem}; RUST_TS_REQUIRE_PROBES=1 makes this a failure`);

const WORK = join(DATA, "tmp", "environment-oracle", process.env.RUST_TS_AGENT ?? "default");
const EXEC_WITH_ENV = join(REPO, "src/rust_ts/exec_with_env.ts");
const HOME_BYTES = join(WORK, "home_bytes");

const ENVPM = `
extern crate proc_macro;
use proc_macro::TokenStream;
use std::fmt::Write;
#[cfg(target_vendor = "apple")]
unsafe fn environ() -> *const *const std::ffi::c_char {
    unsafe extern "C" { fn _NSGetEnviron() -> *const *const *const std::ffi::c_char; }
    unsafe { *_NSGetEnviron() }
}
#[cfg(not(target_vendor = "apple"))]
unsafe fn environ() -> *const *const std::ffi::c_char {
    unsafe extern "C" { static environ: *const *const std::ffi::c_char; }
    unsafe { environ }
}
#[proc_macro]
pub fn environment(_: TokenStream) -> TokenStream {
    let mut s = String::new();
    for (k, v) in std::env::vars_os() { writeln!(s, "{k:?}={v:?}").unwrap(); }
    unsafe {
        let mut p = environ();
        while !(*p).is_null() { writeln!(s, "raw {:?}", std::ffi::CStr::from_ptr(*p)).unwrap(); p = p.add(1); }
    }
    for k in ["PWD", "SHLVL", "VALUE", "DOTENVVAR", "RUST_TS_JS_STACK", "RUST_TS_SHELL_ENV", "BUN_JSC_maxPerThreadStackUsage"] {
        writeln!(s, "{k}: {:?}", std::env::var(k)).unwrap();
    }
    unsafe { std::env::set_var("SET_BY_MACRO", "yes"); }
    format!("{s:?}").parse().unwrap()
}
`;

const PROBED = [
  "A",
  "A=B", // BSD `getenv` stops at the `=`, glibc's does not.
  "",
  "A\\0",
  "DOTENVVAR",
  "DOTENVLOCAL",
  "REALOVER",
  "__CF_USER_TEXT_ENCODING",
  "RUST_TS_JS_STACK",
  "RUST_TS_SHELL_ENV",
  "BUN_JSC_maxPerThreadStackUsage",
  "PWD",
  "OLDPWD",
  "SHLVL",
  "_",
  "IFS",
  "OPTIND",
  "SHELLOPTS",
  "SET_BY_MACRO",
  "NL",
  "QUOTES",
  "EMOJI",
  "VALUE",
];
// `no_core`: the macros expand all the same, without the cost of loading std.
const MACROS = `#![feature(no_core, rustc_attrs)]
#![no_core]
#[rustc_builtin_macro] macro_rules! option_env { ($name:expr $(,)?) => {{}}; }
#[rustc_builtin_macro] macro_rules! env { ($name:expr $(,)?) => {{}}; ($name:expr, $error_msg:expr $(,)?) => {{}}; }
pub mod option { pub mod Option { pub fn None() {} pub fn Some() {} } }
pub const P: () = envpm::environment!();
${PROBED.map((k, i) => `pub const O${i}: () = option_env!("${k}");`).join("\n")}
pub const E0: () = env!("QUOTES");
pub const E1: () = env!("VALUE");
pub const E2: () = env!("RUST_TS_JS_STACK");
pub const E3: () = env!("BUN_JSC_maxPerThreadStackUsage");
pub const E4: () = env!("DOTENVVAR");
`;

// With no std, as `std::env::vars_os()` under Miri is slow. Bytes go out unformatted, so the comparison sees them exactly.
const BLOCK = `#![no_std]
#![no_main]
use core::ffi::{c_char, c_int, c_void};
unsafe extern "C" {
    static environ: *const *const c_char;
    fn write(fd: c_int, buf: *const c_void, n: usize) -> isize;
    fn strlen(s: *const c_char) -> usize;
    fn getenv(s: *const c_char) -> *const c_char;
}
unsafe fn put(s: *const c_char) { unsafe { write(1, s.cast(), strlen(s)); write(1, b"\\n".as_ptr().cast(), 1); } }
#[unsafe(no_mangle)]
fn miri_start(_: isize, _: *const *const u8) -> isize {
    unsafe {
        let mut p = environ;
        while !(*p).is_null() { put(*p); p = p.add(1); }
        let keys = [c"F1", c"VALUE", c"RUST_TS_JS_STACK", c"BUN_JSC_maxPerThreadStackUsage", c"PWD", c"DOTENVVAR", c"1", c"_"];
        let mut i = 0;
        while i < keys.len() {
            put(keys[i].as_ptr());
            let v = getenv(keys[i].as_ptr());
            if v.is_null() { put(c"<unset>".as_ptr()); } else { put(v); }
            i += 1;
        }
    }
    0
}
#[panic_handler]
fn panic(_: &core::panic::PanicInfo) -> ! { loop {} }
`;

/** One char per byte (exec_with_env.ts). Bytes in names and values that are not UTF-8 hash and print as they are. */
const ENTRIES = [
  "A=1",
  "F1=1",
  "REALOVER=real",
  "NL=a\nb",
  `QUOTES='"\`$H\\`,
  "_=under",
  "IFS=:",
  "OPTIND=9",
  "SHELLOPTS=noglob",
  "PWD=/wrong",
  "OLDPWD=/nope",
  "SHLVL=7",
  "VALUE=a\xffb",
  "NAME\xfe=c",
  "CUT=\xf0\x9f\x98",
  "OVERLONG=\xc0\x80",
  "foo.bar=1",
  "a-b=2",
  "BASH_FUNC_x()=() { :; }",
  "EMOJI=\xf0\x9f\x98\x80",
  "1=num",
  "10=num2",
  // CoreFoundation copies this file's bytes into `__CF_USER_TEXT_ENCODING`, up to 63, here cutting a character (stack.ts).
  `CFFIXED_USER_HOME=${HOME_BYTES}`,
];

interface Out {
  stdout: Buffer;
  stderr: string;
  code: number | null;
}

const run = (cmd: string[]): Out => run_with(ENTRIES, cmd);

function run_with(entries: readonly string[], cmd: string[]): Out {
  const r = Bun.spawnSync([process.execPath, EXEC_WITH_ENV, JSON.stringify(entries), ...cmd], { cwd: WORK, stdout: "pipe", stderr: "pipe" });
  return { stdout: Buffer.from(r.stdout), stderr: r.stderr.toString(), code: r.exitCode };
}

function expect_same(oracle: Out, port: Out): void {
  expect(port.stderr).toBe(oracle.stderr);
  expect(port.stdout.toString("latin1")).toBe(oracle.stdout.toString("latin1"));
  expect(port.code).toBe(oracle.code);
}

beforeAll(() => {
  rmSync(WORK, { recursive: true, force: true });
  mkdirSync(WORK, { recursive: true });
  writeFileSync(join(WORK, "envpm.rs"), ENVPM);
  writeFileSync(join(WORK, "macros.rs"), MACROS);
  writeFileSync(join(WORK, "block.rs"), BLOCK);
  writeFileSync(join(WORK, ".env"), "DOTENVVAR=fromdotenv\nREALOVER=fromdotenv\n");
  writeFileSync(join(WORK, ".env.local"), "DOTENVLOCAL=fromdotenv\n");
  mkdirSync(HOME_BYTES);
  writeFileSync(join(HOME_BYTES, ".CFUserTextEncoding"), Buffer.from(`0x\xff\xfe:${"x".repeat(57)}\xc3\xa9zz`, "latin1"));
});
afterAll(() => {
  rmSync(WORK, { recursive: true, force: true });
});

describe.skipIf(process.platform === "win32")("the environment under both sides", () => {
  test.skipIf(SKIP_RUSTC)("env!, option_env! and a proc macro's std::env and environ", () => {
    const dylib = join(WORK, process.platform === "darwin" ? "libenvpm.dylib" : "libenvpm.so");
    const pm = Bun.spawnSync([join(SYSROOT, "bin", "rustc"), "--crate-type", "proc-macro", "--edition", "2021", "-o", dylib, "envpm.rs"], { cwd: WORK, stderr: "pipe" });
    expect(pm.stderr.toString()).toBe("");
    const args = ["--crate-type", "lib", "--sysroot", SYSROOT, "-Zunpretty=expanded", "--edition", "2021", "--extern", `envpm=${dylib}`, "macros.rs"];
    const oracle = run([join(SYSROOT, "bin", "rustc"), ...args]);
    const port = run([process.execPath, join(REPO, "src/rust_ts/main.ts"), ...args]);
    expect_same(oracle, port);
    // The oracle's own answers, so that a broken program cannot pass by printing nothing on both sides.
    const out = oracle.stdout.toString();
    expect(oracle.stderr).toContain("environment variable `VALUE` is not a valid Unicode string");
    expect(oracle.stderr).toContain("environment variable `RUST_TS_JS_STACK` not defined at compile time");
    expect(out).toContain(`O${PROBED.indexOf("REALOVER")}: () = crate::option::Option::Some("real")`);
    expect(out).toContain(`O${PROBED.indexOf("DOTENVVAR")}: () = crate::option::Option::None`);
    expect(out).toContain(`O${PROBED.indexOf("SET_BY_MACRO")}: () = crate::option::Option::Some("yes")`);
    expect(out).toContain("raw \\\"VALUE=a\\\\xffb\\\"");
    expect(out).toContain("PWD: Ok(\\\"/wrong\\\")");
    if (process.platform === "darwin") expect(out).toContain(`:0x\\\\xff\\\\xfe:${"x".repeat(57)}\\\\xc3\\\"`);
  });

  // PORT: not rustc's doing but CoreFoundation's, which the oracle links (stack.ts `cf_user_text_encoding`).
  test.skipIf(SKIP_RUSTC || process.platform !== "darwin")("__CF_USER_TEXT_ENCODING: what the oracle's process starts with", () => {
    const uid = process.getuid!();
    const hex = uid.toString(16).toUpperCase();
    const home_long = join(WORK, "home_long");
    const home_none = join(WORK, "home_none");
    mkdirSync(home_long, { recursive: true });
    mkdirSync(home_none, { recursive: true });
    writeFileSync(join(home_long, ".CFUserTextEncoding"), "0x8:0x3\n" + "x".repeat(100));
    writeFileSync(join(WORK, "cf.rs"), `#![feature(no_core, rustc_attrs)]\n#![no_core]\n#[rustc_builtin_macro] macro_rules! option_env { ($name:expr $(,)?) => {{}}; }\npub const V: () = option_env!("__CF_USER_TEXT_ENCODING");\n`);
    const CF = "__CF_USER_TEXT_ENCODING";
    const cases: Record<string, string>[] = [
      { HOME: "/nonexistent" }, // The passwd entry's home, not this.
      { [CF]: "0x1:0x8:0x3" }, // Another uid.
      { [CF]: `${uid}:kept` }, // This uid, in decimal: kept.
      { [CF]: `0x${hex}` }, // No \`:\`.
      { CFFIXED_USER_HOME: home_long },
      { CFFIXED_USER_HOME: home_none },
    ];
    const args = ["--crate-type", "lib", "--sysroot", SYSROOT, "-Zunpretty=expanded", "cf.rs"];
    const driver = join(REPO, "src/rust_ts/stack_env_driver.ts");
    for (const env of cases) {
      const oracle = Bun.spawnSync([join(SYSROOT, "bin", "rustc"), ...args], { cwd: WORK, env, stdout: "pipe", stderr: "pipe" }).stdout.toString();
      const value = /Some\("((?:[^"\\]|\\.)*)"\)/.exec(oracle)?.[1];
      expect(value).toBeDefined();
      const seen = JSON.parse(Bun.spawnSync([process.execPath, driver], { cwd: WORK, env, stdout: "pipe", stderr: "pipe" }).stdout.toString()).environ as string[];
      const port = seen.find((e) => e.startsWith(`${CF}=`))!.slice(CF.length + 1);
      expect(port.replaceAll("\n", "\\n")).toBe(value!);
    }
  });

  test.skipIf(SKIP_MIRI)("Miri's environ block and getenv: isolation off, and -Zmiri-env-forward", () => {
    const common = ["--edition", "2021", "--sysroot", MIRI_SYSROOT, "--target", miriPin().target, "-Cpanic=abort"];
    const runs = [
      [...common, "-Zmiri-disable-isolation", "block.rs"],
      [...common, ...["F1", "VALUE", "PWD", "1", "RUST_TS_JS_STACK", "BUN_JSC_maxPerThreadStackUsage", "DOTENVVAR"].map((k) => `-Zmiri-env-forward=${k}`), "block.rs"],
    ];
    const oracle = runs.map((args) => run([miriBinary(), ...args]));
    const port = run([process.execPath, join(REPO, "src/rust_ts/stack_miri_driver.ts"), JSON.stringify(runs)]);
    expect(port.stderr).toBe(oracle.map((o) => o.stderr).join(""));
    const expected = oracle.map((o) => `${o.stdout.toString("latin1")}exit ${o.code}\n`).join("");
    expect(port.stdout.toString("latin1")).toBe(expected);
    // Isolation off forwards all of them, in FxHash order; the forwarded run has only those named.
    expect(expected).toContain("NAME\xfe=c\n");
    expect(expected).toContain("VALUE\na\xffb\n");
    expect(expected).toContain("RUST_TS_JS_STACK\n<unset>\n");
    expect(expected).toContain("DOTENVVAR\n<unset>\n");
    expect(oracle.every((o) => o.code === 0)).toBe(true);
  });
});
