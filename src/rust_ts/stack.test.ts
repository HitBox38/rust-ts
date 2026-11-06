// rust-ts: the compiler-stack glue (stack.ts) uses rustc's default thread stack size and RUST_MIN_STACK rule, and leaves the
// process with the stack it needs and exactly the environment it was started with. The programs that show that environment under
// the oracle, too, are in environment.oracle.test.ts; this file holds what is cheap enough to try many environments on.
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import "../rustc_session/options.ts"; // LOAD ORDER: see rustc_session/config.ts
import { DEFAULT_STACK_SIZE as CONFIG_DEFAULT } from "../rustc_session/config.ts";
import { DEFAULT_STACK_SIZE, rust_thread_stack_size } from "./stack.ts";

test("DEFAULT_STACK_SIZE is rustc_session::config::DEFAULT_STACK_SIZE", () => {
  expect(DEFAULT_STACK_SIZE).toBe(CONFIG_DEFAULT);
});

test("RUST_MIN_STACK: number of bytes, else the default (the driver reports bad values)", () => {
  expect(rust_thread_stack_size(undefined)).toBe(DEFAULT_STACK_SIZE);
  expect(rust_thread_stack_size("  ")).toBe(DEFAULT_STACK_SIZE);
  expect(rust_thread_stack_size(" 1048576 ")).toBe(1048576);
  expect(rust_thread_stack_size("+64")).toBe(64);
  expect(rust_thread_stack_size("64MB")).toBe(DEFAULT_STACK_SIZE);
});

const EXEC_WITH_ENV = join(import.meta.dir, "exec_with_env.ts");
const DRIVER = join(import.meta.dir, "stack_env_driver.ts");
/** A value CoreFoundation's startup would leave alone, so it does not change the expected `environ` (see `cf_user_text_encoding`). */
const CF_KEEP = `__CF_USER_TEXT_ENCODING=0x${(process.getuid?.() ?? 0).toString(16).toUpperCase()}:0x0:0x0`;

interface Seen {
  environ: string[];
  process_env: Record<string, string>;
  depth: number;
}

/** The driver's view when started with exactly `entries` (one char per byte) in `cwd`. */
function seen_with(entries: readonly string[], cwd?: string): Seen {
  const r = Bun.spawnSync([process.execPath, EXEC_WITH_ENV, JSON.stringify(entries), process.execPath, DRIVER], { cwd, stdout: "pipe", stderr: "pipe" });
  expect(r.stderr.toString()).toBe("");
  expect(r.exitCode).toBe(0);
  return JSON.parse(r.stdout.toString());
}

function every_byte(): string {
  let s = "";
  for (let b = 1; b <= 255; b++) s += String.fromCharCode(b);
  return s;
}

/** Names a shell acts on or rewrites, entries that look like options of `env` or that a JS object would reorder, and awkward bytes. */
const AWKWARD = [
  "Z=first",
  "A=second",
  `ALL_BYTES=${every_byte()}`,
  "NL=a\nb\n",
  `QUOTES='"\`$HOME\\`,
  "EQUALS==x=",
  "EMPTY=",
  "_=under",
  "IFS=:",
  "OPTIND=9",
  "SHELLOPTS=xtrace",
  "POSIXLY_CORRECT=1",
  "ENV=/nonexistent/env",
  "BASH_ENV=/nonexistent/bash_env",
  "PWD=/not/the/cwd",
  "OLDPWD=/not/a/dir",
  "SHLVL=7",
  "-i=1",
  "foo.bar=1",
  "a-b=2",
  "BASH_FUNC_x()=() { :; }",
  "1=numeric",
  "10=numeric",
  "NAME\xff=non-utf8 name",
  "VALUE=a\xffb",
  "DYLD_LIBRARY_PATH=/nonexistent/dyld",
  "RUST_TS_JS_STACK=the caller's",
  "RUST_TS_SHELL_ENV=the caller's",
  "RUST_TS_REEXEC_1=the caller's",
  CF_KEEP,
];

/** Environments `env` cannot carry: these stay on the default stack, with the environment as it was (`env_can_carry`). */
const NOT_CARRIED: readonly (readonly string[])[] = [
  ["NO_EQUALS", "A=1", CF_KEEP],
  ["=LEADING=x", "A=1", CF_KEEP],
  ["", "A=1", CF_KEEP],
  ["DUP=first", "A=1", "DUP=second", CF_KEEP],
  ["A=1", "BUN_JSC_maxPerThreadStackUsage=4194304", "B=2", CF_KEEP],
];

describe.skipIf(process.platform === "win32")("ensure_stack", () => {
  test("the program sees the environment it was started with, in order; the stack limit is not in it", () => {
    const { environ, process_env, depth } = seen_with(AWKWARD);
    // SHELLOPTS=xtrace and an IFS would also show on stderr or split words, if a shell had read them: `seen_with` checks stderr.
    expect(environ).toEqual(AWKWARD);
    expect(process_env.VALUE).toBe("a�b");
    expect(process_env["NAME�"]).toBe("non-utf8 name");
    expect(process_env.PWD).toBe("/not/the/cwd");
    expect(process_env.BUN_JSC_maxPerThreadStackUsage).toBeUndefined();
    expect(Object.keys(process_env).filter((k) => k.startsWith("RUST_TS_REEXEC_"))).toEqual(["RUST_TS_REEXEC_1"]);
    expect(depth).toBeGreaterThan(seen_with(NOT_CARRIED[0]!).depth * 2);
  });

  test("an empty environment stays empty, and still gets the stack", () => {
    const { environ, depth } = seen_with([]);
    expect(environ).toEqual(process.platform === "darwin" ? [expect.stringMatching(/^__CF_USER_TEXT_ENCODING=/)] : []);
    expect(depth).toBeGreaterThan(seen_with(NOT_CARRIED[0]!).depth * 2);
  });

  test("an environment `env` cannot carry stays exact, on the default stack", () => {
    for (const entries of NOT_CARRIED) expect(seen_with(entries).environ).toEqual([...entries]);
    expect(seen_with(NOT_CARRIED[3]!).process_env.DUP).toBe("first");
  });

  test("an environment close to the limit, with a long cwd, keeps running: the shell's own exec cannot be what fails", () => {
    const dir = mkdtempSync(join(tmpdir(), "rust-ts-arg-max-"));
    try {
      let cwd = dir;
      while (cwd.length < 900) cwd = join(cwd, "d".repeat(Math.min(200, 900 - cwd.length)));
      mkdirSync(cwd, { recursive: true });
      const env = (n: number): Record<string, string> => ({ PAD: "x".repeat(n), __CF_USER_TEXT_ENCODING: CF_KEEP.slice(CF_KEEP.indexOf("=") + 1) });
      const fits = (n: number): boolean => {
        try {
          return Bun.spawnSync(["/usr/bin/true", DRIVER], { env: env(n), stdout: "ignore", stderr: "ignore" }).exitCode === 0;
        } catch {
          return false;
        }
      };
      let lo = 0;
      let hi = 8 * 1024 * 1024;
      while (hi - lo > 64) {
        const mid = (lo + hi) >>> 1;
        if (fits(mid)) lo = mid;
        else hi = mid;
      }
      // Bytes below the limit where, before the fix, this cwd made `exec env` fail with exit 1 (docs/reviews/fixers-41.md F4).
      for (const below of [500, 1000]) {
        const r = Bun.spawnSync([process.execPath, DRIVER], { cwd, env: env(lo - below), stdout: "pipe", stderr: "pipe" });
        expect(r.stderr.toString()).toBe("");
        expect(r.exitCode).toBe(0);
        const seen = JSON.parse(r.stdout.toString()) as Seen;
        expect(seen.environ).toEqual([`PAD=${"x".repeat(lo - below)}`, CF_KEEP]);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a `.env` in the cwd cannot choose RUST_TS_IMPL; the process's own variable does (docs/reviews/fixers-41.md N4)", () => {
    const cwd = mkdtempSync(join(tmpdir(), "rust-ts-impl-"));
    try {
      writeFileSync(join(cwd, ".env"), "RUST_TS_IMPL=shim\n");
      const script = `import { selected_impl } from ${JSON.stringify(join(import.meta.dir, "stack.ts"))}; console.log(process.env.RUST_TS_IMPL, selected_impl());`;
      const seen = (env: Record<string, string>): string => Bun.spawnSync([process.execPath, "-e", script], { cwd, env, stdout: "pipe", stderr: "pipe" }).stdout.toString().trim();
      expect(seen({})).toBe("shim port"); // Bun's dotenv did load it: this is the case that matters.
      expect(seen({ RUST_TS_IMPL: "stub" })).toBe("stub stub");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
    // Every entry asks `selected_impl`, not `process.env`.
    for (const entry of ["main", "ckdump", "mirdump", "resdump", "thirdump", "tydump"]) {
      expect(readFileSync(join(import.meta.dir, `${entry}.ts`), "utf8")).toContain("const impl = selected_impl();");
    }
  });

  test("a `.env` in the cwd does not reach the environment, under any of Bun's names; a real variable keeps its value", () => {
    const cwd = mkdtempSync(join(tmpdir(), "rust-ts-dotenv-"));
    try {
      for (const f of [".env", ".env.local", ".env.production", ".env.production.local", ".env.development", ".env.development.local", ".env.test", ".env.test.local"]) {
        writeFileSync(join(cwd, f), `FROM${f.replaceAll(".", "_").toUpperCase()}=dotenv\nREAL=dotenv\nRUST_TS_REEXEC_${process.pid}=dotenv\n`);
      }
      for (const node_env of ["production", "development", "test"]) {
        const entries = [`NODE_ENV=${node_env}`, "REAL=real", CF_KEEP];
        const { environ, process_env } = seen_with(entries, cwd);
        expect(environ).toEqual(entries);
        expect(Object.keys(process_env).sort()).toEqual(["NODE_ENV", "REAL", "__CF_USER_TEXT_ENCODING"]);
        expect(process_env.REAL).toBe("real");
      }
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
