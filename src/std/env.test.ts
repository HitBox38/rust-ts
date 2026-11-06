// `std::env` on the host: `var_os`, `var_` and `vars_os` read C's `environ`, not `process.env` (src/std/env.ts).
import { expect, test } from "bun:test";
import { environ_entries, remove_var, set_var, var_, var_os, vars_os } from "./env.ts";

const text = (b: Uint8Array | undefined) => (b === undefined ? undefined : new TextDecoder().decode(b));

test.skipIf(process.platform === "win32")("set_var and remove_var reach C's environ and process.env; reads ignore a process.env-only name", () => {
  const name = `RUST_TS_ENV_TEST_${process.pid}`;
  set_var(name, "v=1");
  expect(text(var_os(name))).toBe("v=1");
  expect(var_(name)).toEqual({ $: "Ok", _0: "v=1" });
  expect(process.env[name]).toBe("v=1");
  expect(vars_os().some(([k, v]) => text(k) === name && text(v) === "v=1")).toBe(process.platform === "darwin"); // Linux: as of `execve`.
  remove_var(name);
  expect(var_os(name)).toBeUndefined();
  expect(var_(name)).toEqual({ $: "Err", _0: { $: "NotPresent" } });
  expect(process.env[name]).toBeUndefined();

  process.env[name] = "only in the JS map";
  expect(var_os(name)).toBeUndefined();
  delete process.env[name];
});

test.skipIf(process.platform === "win32")("a name with a NUL is absent, and vars_os splits at the first `=` after the first byte", () => {
  expect(var_os("PATH\0")).toBeUndefined();
  const parsed = vars_os([new TextEncoder().encode("A=b=c"), new TextEncoder().encode("=x=y"), new TextEncoder().encode("none"), new Uint8Array(0), new TextEncoder().encode("E=")]);
  expect(parsed.map(([k, v]) => [text(k), text(v)])).toEqual([
    ["A", "b=c"],
    ["=x", "y"],
    ["E", ""],
  ]);
  expect(environ_entries()!.length).toBeGreaterThan(0);
});
