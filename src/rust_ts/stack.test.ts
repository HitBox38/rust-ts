// rust-ts: the compiler-stack glue (stack.ts) uses rustc's default thread stack size and RUST_MIN_STACK rule.
import { expect, test } from "bun:test";
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
