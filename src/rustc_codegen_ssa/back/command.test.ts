// Unit tests of back/command.ts (lane ssa-linker; command.rs has no tests of its own).
import { expect, test } from "bun:test";
import { IoError_kind } from "../../std/io.ts";
import { Command, debug_Command, display_ExitStatus } from "./command.ts";

test("Debug: env removals, sorted changes, then the program and its arguments", () => {
  const cmd = Command.new("cc");
  cmd.env("ZED", "1").env("PATH", "/a:/b").env_remove("XROS_DEPLOYMENT_TARGET").env_remove("IPHONEOS_DEPLOYMENT_TARGET");
  cmd.args(["-o", "out"]);
  expect(debug_Command(cmd)).toBe('env -u IPHONEOS_DEPLOYMENT_TARGET -u XROS_DEPLOYMENT_TARGET PATH="/a:/b" ZED="1" "cc" "-o" "out"');
  cmd.env_clear();
  // `env_clear` runs after the changes in `command()`, so it drops them.
  expect(debug_Command(cmd)).toBe('env -i "cc" "-o" "out"');
});

test("Debug escapes: the arguments as OsStr, the program as CStr", () => {
  // The oracle printed the argument for `-Clink-arg=a'b"c\dé<U+0001>x<TAB>t` as below, and a `-Clinker` path holding `q'd` as
  // `q\'d` (`--print link-args`, 2026-11-14).
  const cmd = Command.new("it's");
  cmd.arg("a'b\"c\\d\u00e9\u0001x\tt");
  // (Bun's transpiler rewrites non-ASCII inside a `String.raw` template, so the `é` is joined on.)
  expect(debug_Command(cmd)).toBe(String.raw`"it\'s" "a'b\"c\\d` + "\u00e9" + String.raw`\u{1}x\tt"`);
});

test("Lld programs get -flavor; take_args empties the list", () => {
  const cmd = Command.lld("rust-lld", "Ld64");
  cmd.arg("x");
  expect(cmd.command().argv).toEqual(["rust-lld", "-flavor", "darwin", "x"]);
  expect(cmd.take_args()).toEqual(["x"]);
  expect(cmd.get_args()).toEqual([]);
});

test("very_likely_to_exceed_some_spawn_limit compares with ARG_MAX", () => {
  const cmd = Command.new("cc");
  cmd.arg("a");
  expect(cmd.very_likely_to_exceed_some_spawn_limit()).toBe(false);
  cmd.arg("x".repeat(8 * 1024 * 1024));
  expect(cmd.very_likely_to_exceed_some_spawn_limit()).toBe(true);
});

test("output: status, stdout and stderr; a missing program is NotFound", () => {
  const ok = Command.new("/bin/sh");
  ok.args(["-c", 'echo "$X"; echo err >&2; exit 3']).env("X", "hi");
  const r = ok.output();
  if (r.$ !== "Ok") throw new Error("ERROR: /bin/sh did not run");
  expect(r._0.status.code()).toBe(3);
  expect(r._0.status.success()).toBe(false);
  expect(display_ExitStatus(r._0.status)).toBe("exit status: 3");
  expect(new TextDecoder().decode(r._0.stdout)).toBe("hi\n");
  expect(new TextDecoder().decode(r._0.stderr)).toBe("err\n");

  const missing = Command.new("/nonexistent/rust-ts-linker").output();
  expect(missing.$ === "Err" && IoError_kind(missing._0)).toBe("NotFound");
});
