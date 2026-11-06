// rust-ts: the compiler-stack glue (stack.ts) uses rustc's default thread stack size and RUST_MIN_STACK rule.
import { expect, test } from "bun:test";
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

// rustc does not touch these, so `option_env!` and the program's environment see what the caller set. The re-exec goes through
// `/bin/sh`, which would otherwise add `PWD` and `SHLVL` and drop or replace others (docs/reviews/m6-audit.md).
test.skipIf(process.platform === "win32")("ensure_stack: the re-exec's shell leaves the environment alone", () => {
  const driver = join(import.meta.dir, "stack_env_driver.ts");
  const env_of = (env: Record<string, string>): Record<string, string | undefined> => {
    const r = Bun.spawnSync([process.execPath, driver], { env: { PATH: process.env.PATH ?? "", ...env }, stdout: "pipe", stderr: "pipe" });
    expect(r.stderr.toString()).toBe("");
    return JSON.parse(r.stdout.toString());
  };
  expect(env_of({})).toEqual({ marker: "set" });
  expect(env_of({ PWD: "/not/the/cwd", OLDPWD: "/not/a/dir", SHLVL: "7" })).toEqual({ marker: "set", PWD: "/not/the/cwd", OLDPWD: "/not/a/dir", SHLVL: "7" });
});
