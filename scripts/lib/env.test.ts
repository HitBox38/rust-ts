// Unit tests of the case environment (scripts/lib/env.ts), the upstream-checkout check (scripts/lib/upstream.ts) and
// the unstable-output patterns (scripts/lib/unstable.ts), lane harness-w20c. All three modules have no imports, so
// nothing here loads scripts/lib/common.ts (see scripts/lib/deps.test.ts).
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { caseEnv, getEnv, isScrubbedEnvVar, mergeEnv, pinnedPathEnv, scrubbedEnv } from "./env.ts";
import { unstableOracleReason } from "./unstable.ts";
import { upstreamChanges, upstreamError, upstreamStatus } from "./upstream.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

describe("mergeEnv", () => {
  test("posix: plain overlay, case-sensitive, existing keys keep their place", () => {
    const base = { A: "1", Path: "p", PATH: "q", B: "2" };
    const env = mergeEnv(base, { A: "x", PATH: null, C: "3" }, "darwin");
    expect(env).toEqual({ A: "x", Path: "p", B: "2", C: "3" });
    expect(Object.keys(env)).toEqual(["A", "Path", "B", "C"]);
    expect(mergeEnv(base, {}, "linux")).toEqual(base);
  });
  test("posix: undefined base values are dropped", () => {
    expect(mergeEnv({ A: undefined, B: "1" }, {}, "linux")).toEqual({ B: "1" });
  });
  test("win32: every spelling of a name is replaced or removed", () => {
    const base = { Path: "C:\\Windows", SystemRoot: "C:\\Windows", rustc_log: "debug", TEMP: "t" };
    expect(mergeEnv(base, { PATH: "C:\\Users\\u\\.cargo\\bin" }, "win32")).toEqual({ SystemRoot: "C:\\Windows", rustc_log: "debug", TEMP: "t", PATH: "C:\\Users\\u\\.cargo\\bin" });
    expect(mergeEnv(base, { RUSTC_LOG: null, temp: null }, "win32")).toEqual({ Path: "C:\\Windows", SystemRoot: "C:\\Windows" });
    // An entry spelled exactly as the overlay is updated in place.
    expect(Object.keys(mergeEnv(base, { SystemRoot: "D:\\" }, "win32"))).toEqual(["Path", "SystemRoot", "rustc_log", "TEMP"]);
  });
});

describe("scrubbed variables", () => {
  const base = {
    PATH: "/usr/bin",
    HOME: "/h",
    TMPDIR: "/tmp",
    RUSTUP_HOME: "/r",
    RUSTUP_TOOLCHAIN: "stable",
    CARGO_HOME: "/c",
    RUST_TS_IMPL: "port",
    RUSTC_LOG: "debug",
    RUSTC_LOG_COLOR: "always",
    RUST_BACKTRACE: "1",
    RUST_LIB_BACKTRACE: "1",
    RUSTC_BOOTSTRAP: "1",
    RUSTC_ICE: "0",
    RUST_MIN_STACK: "100",
    CLICOLOR_FORCE: "1",
    COLORTERM: "truecolor",
    TERM: "xterm-256color",
    CARGO: "/c/bin/cargo",
    CARGO_PKG_NAME: "x",
    CARGO_MANIFEST_DIR: "/m",
    MallocStackLogging: "1",
  };
  test("posix: scrubs logger, backtrace, behaviour, colour, cargo and malloc variables, keeps the rest", () => {
    expect(Object.keys(scrubbedEnv(base, "darwin")).sort()).toEqual(
      ["CARGO", "CARGO_MANIFEST_DIR", "CARGO_PKG_NAME", "CLICOLOR_FORCE", "COLORTERM", "MallocStackLogging", "RUSTC_BOOTSTRAP", "RUSTC_ICE", "RUSTC_LOG", "RUSTC_LOG_COLOR", "RUST_BACKTRACE", "RUST_LIB_BACKTRACE", "RUST_MIN_STACK", "TERM"].sort(),
    );
    for (const k of ["PATH", "HOME", "TMPDIR", "RUSTUP_HOME", "RUSTUP_TOOLCHAIN", "CARGO_HOME", "RUST_TS_IMPL"]) expect(isScrubbedEnvVar(k, "darwin")).toBe(false);
    // Case-sensitive off Windows.
    expect(isScrubbedEnvVar("rustc_log", "linux")).toBe(false);
  });
  test("win32: names match case-insensitively; CARGO_HOME is kept in any spelling", () => {
    expect(isScrubbedEnvVar("rustc_log", "win32")).toBe(true);
    expect(isScrubbedEnvVar("Cargo_Pkg_Name", "win32")).toBe(true);
    expect(isScrubbedEnvVar("Cargo_Home", "win32")).toBe(false);
    expect(isScrubbedEnvVar("Path", "win32")).toBe(false);
  });
  test("caseEnv: the case's own values win over the scrub", () => {
    const env = mergeEnv(base, caseEnv({ RUST_BACKTRACE: "0", RUSTC_ICE: "0", PWD: null }, base, "darwin"), "darwin");
    expect(env.RUST_BACKTRACE).toBe("0");
    expect(env.RUSTC_ICE).toBe("0");
    expect(env.RUSTC_LOG).toBeUndefined();
    expect(env.CARGO_PKG_NAME).toBeUndefined();
    expect(env.PATH).toBe("/usr/bin");
    expect(env.CARGO_HOME).toBe("/c");
    expect(caseEnv(undefined, {}, "darwin")).toEqual({});
  });
});

describe("pinned PATH", () => {
  test("macOS/Linux: PATH alone (as before lane harness-w20c)", () => {
    expect(pinnedPathEnv("/h/.cargo/bin", "darwin")).toEqual({ PATH: "/h/.cargo/bin" });
    expect(pinnedPathEnv("/h/.cargo/bin", "linux")).toEqual({ PATH: "/h/.cargo/bin" });
  });
  test("Windows: PATH plus RUSTUP_WINDOWS_PATH_ADD_BIN=0", () => {
    expect(pinnedPathEnv("C:\\Users\\u\\.cargo\\bin", "win32")).toEqual({ PATH: "C:\\Users\\u\\.cargo\\bin", RUSTUP_WINDOWS_PATH_ADD_BIN: "0" });
  });
  test("Windows: a pinned case's whole environment has one PATH, the pin, and no inherited RUSTUP_WINDOWS_PATH_ADD_BIN=1", () => {
    const winBase = { Path: "C:\\Windows;C:\\Users\\u\\.cargo\\bin;C:\\tools", SystemRoot: "C:\\Windows", USERPROFILE: "C:\\Users\\u", Rustup_Windows_Path_Add_Bin: "1", RUSTC_LOG: "info" };
    const dir = "C:\\Users\\u\\.cargo\\bin";
    const env = mergeEnv(winBase, caseEnv({ RUSTC_ICE: "0", ...pinnedPathEnv(dir, "win32") }, winBase, "win32"), "win32");
    expect(env).toEqual({ SystemRoot: "C:\\Windows", USERPROFILE: "C:\\Users\\u", RUSTC_ICE: "0", PATH: dir, RUSTUP_WINDOWS_PATH_ADD_BIN: "0" });
    expect(Object.keys(env).filter((k) => k.toUpperCase() === "PATH")).toEqual(["PATH"]);
  });
  test("getEnv: case-insensitive on Windows only", () => {
    expect(getEnv({ SystemRoot: "C:\\Windows" }, "SYSTEMROOT", "win32")).toBe("C:\\Windows");
    expect(getEnv({ SystemRoot: "C:\\Windows" }, "SYSTEMROOT", "linux")).toBeUndefined();
    expect(getEnv({ HOME: "/h" }, "HOME", "darwin")).toBe("/h");
  });
});

describe("upstream checkout status", () => {
  const git = (cwd: string, ...args: string[]) => {
    const r = Bun.spawnSync(["git", "-c", "user.email=t@t", "-c", "user.name=t", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
    if (r.exitCode !== 0) throw new Error(r.stderr.toString());
  };
  test("lists untracked and ignored files one by one, except under build/", () => {
    const d = mkdtempSync(join(tmpdir(), "rust-ts-upstream-"));
    dirs.push(d);
    git(d, "init", "-q");
    writeFileSync(join(d, ".gitignore"), "/build\nrustc-ice-*.txt\n");
    mkdirSync(join(d, "tests/ui"), { recursive: true });
    writeFileSync(join(d, "tests/ui/a.rs"), "fn main() {}\n");
    git(d, "add", ".");
    git(d, "commit", "-q", "-m", "init");
    expect(upstreamStatus(d)).toEqual([]);
    const before = upstreamStatus(d);
    mkdirSync(join(d, "build/x86_64-unknown-linux-gnu/test/ui/a"), { recursive: true });
    writeFileSync(join(d, "build/x86_64-unknown-linux-gnu/test/ui/a/a.long-type-1.txt"), "T\n");
    writeFileSync(join(d, "tests/ui/a.long-type-123.txt"), "T\n");
    writeFileSync(join(d, "rustc-ice-2026-10-21T11_18_00-1.txt"), "ice\n");
    writeFileSync(join(d, "tests/ui/a.rs"), "fn main() { }\n");
    const after = upstreamStatus(d);
    expect(after).toEqual(["!! rustc-ice-2026-10-21T11_18_00-1.txt", " M tests/ui/a.rs", "?? tests/ui/a.long-type-123.txt"].sort());
    expect(upstreamChanges(before, after)).toEqual(after);
    expect(upstreamChanges(after, after)).toEqual([]);
    expect(upstreamError("x", after, d)).toStartWith("ERROR: x: 3 path(s) in the upstream checkout");
  });
  test("throws outside a git checkout", () => {
    const d = mkdtempSync(join(tmpdir(), "rust-ts-upstream-nogit-"));
    dirs.push(d);
    expect(() => upstreamStatus(d)).toThrow();
  });
});

describe("unstable oracle output patterns", () => {
  test("thread ids, long-type hashes and ICE report files are detected", () => {
    expect(unstableOracleReason("error: x\n\nthread 'rustc' (178972394) panicked at /rustc-dev/x/compiler/a.rs:1:1:\n")).toContain("thread id");
    expect(unstableOracleReason("thread 'rustc' (rtid 5) panicked at x\n")).toContain("thread id");
    expect(unstableOracleReason("   = note: the full name for the type has been written to 'build/a/b.long-type-11093767555032064917.txt'\n")).toContain("long-type");
    expect(unstableOracleReason("note: please attach the file at `/u/rustc-ice-2026-10-21T11_18_00-4242.txt` to your bug report\n")).toContain("ICE note");
  });
  test("reproducible output is not", () => {
    expect(unstableOracleReason("")).toBeUndefined();
    expect(unstableOracleReason("error[E0277]: x\n  --> a.rs:1:1\nLL | thread 'rustc' (1) panicked at\n")).toBeUndefined();
    expect(unstableOracleReason("   = note: the full name for the type has been written to '$TEST_BUILD_DIR/a.long-type-$LONG_TYPE_HASH.txt'\n")).toBeUndefined();
    expect(unstableOracleReason("note: run with `RUST_BACKTRACE=1` environment variable to display a backtrace\n")).toBeUndefined();
  });
});
