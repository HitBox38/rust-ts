// Port of the `#[cfg(test)] mod test` of anstyle-query =1.1.5 `src/lib.rs`, plus rust-ts checks of
// the `var_os` unset/empty distinction.
import { afterEach, expect, test } from "bun:test";
import { clicolor, clicolor_force, is_ci, no_color, non_empty, term_supports_ansi_color, term_supports_color, truecolor } from "./lib.ts";
import { enable_ansi_colors } from "./windows.ts";

// crate: anstyle-query-1.1.5/src/lib.rs:146 non_empty_not_present
test("non_empty_not_present", () => {
  expect(!non_empty(undefined)).toBe(true);
});

// crate: anstyle-query-1.1.5/src/lib.rs:151 non_empty_empty
test("non_empty_empty", () => {
  expect(!non_empty("")).toBe(true);
});

// crate: anstyle-query-1.1.5/src/lib.rs:156 non_empty_texty
test("non_empty_texty", () => {
  expect(non_empty("hello")).toBe(true);
});

const VARS = ["CLICOLOR", "CLICOLOR_FORCE", "NO_COLOR", "TERM", "COLORTERM", "CI"] as const;
const saved = Object.fromEntries(VARS.map((k) => [k, process.env[k]]));
afterEach(() => {
  for (const k of VARS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

test("rust-ts: var_os unset vs empty", () => {
  for (const k of VARS) delete process.env[k];
  expect(clicolor()).toBeUndefined();
  expect(clicolor_force()).toBe(false);
  expect(no_color()).toBe(false);
  expect(term_supports_color()).toBe(false);
  expect(term_supports_ansi_color()).toBe(false);
  expect(truecolor()).toBe(false);
  expect(is_ci()).toBe(false);

  process.env["CLICOLOR"] = "";
  process.env["NO_COLOR"] = "";
  process.env["CLICOLOR_FORCE"] = "";
  process.env["CI"] = "";
  process.env["TERM"] = "";
  expect(clicolor()).toBe(true);
  expect(no_color()).toBe(false);
  expect(clicolor_force()).toBe(false);
  expect(is_ci()).toBe(true);
  expect(term_supports_color()).toBe(true);

  process.env["CLICOLOR"] = "0";
  process.env["NO_COLOR"] = "1";
  process.env["TERM"] = "dumb";
  process.env["COLORTERM"] = "24bit";
  expect(clicolor()).toBe(false);
  expect(no_color()).toBe(true);
  expect(term_supports_color()).toBe(false);
  expect(truecolor()).toBe(true);

  expect(enable_ansi_colors()).toBeUndefined();
});
