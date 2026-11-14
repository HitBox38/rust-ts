// Tests of config.ts `Sysroot` and session.ts `get_tools_search_paths` (lane default-sysroot; review default-sysroot F1, N2).
//
// The guard: the port's default sysroot is the oracle's, found by spawning `rustc +<pin> --print sysroot`
// (rustc_session/filesearch.ts `default_sysroot`). That spawn fails where the harness runs the port under Miri's own `RUSTUP_HOME`
// and where a test clears `PATH`, so `Sysroot` reads the default lazily: a `--sysroot` compile that reaches no reader of the default
// must never ask the oracle. An eager read in `Sysroot::new` turned the protected `miri-hello` case UNPORTED (review F1).
//
// Skips (visibly) if the pinned rustc is unavailable; fails instead under RUST_TS_REQUIRE_PROBES=1.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PIN } from "../../scripts/lib/common.ts";
import { host_tuple, Sysroot } from "./config.ts";
import { Session } from "./session.ts";

const REQUIRE = process.env.RUST_TS_REQUIRE_PROBES === "1";
const rustc_ok = ((): boolean => {
  try {
    return Bun.spawnSync(["rustc", `+${PIN.toolchain}`, "-vV"]).stdout.toString().includes(`commit-hash: ${PIN.commit}`);
  } catch {
    return false;
  }
})();
const SKIP = process.platform === "win32" || (!rustc_ok && !REQUIRE);
if (SKIP) console.log(`SKIP: pinned rustc (${PIN.toolchain}) unavailable; RUST_TS_REQUIRE_PROBES=1 makes this a failure`);

let dir = "";
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "rust-ts-sysroot-guard-"));
});
afterAll(() => {
  if (dir !== "") Bun.spawnSync(["/bin/rm", "-rf", dir]);
});

test.skipIf(SKIP)("Sysroot::new does not read the default sysroot: a --sysroot compile never asks the oracle (review default-sysroot F1 guard)", () => {
  const sysroot = Bun.spawnSync(["rustc", `+${PIN.toolchain}`, "--print", "sysroot"], { env: { ...process.env, RUSTUP_AUTO_INSTALL: "0" } })
    .stdout.toString()
    .replace(/\n$/, "");
  // A `rustc` first in `PATH` that logs each call and fails, as `rustc +<pin>` does under Miri's `RUSTUP_HOME`.
  const bin = join(dir, "bin");
  mkdirSync(bin, { recursive: true });
  const log = join(dir, "rustc-calls.log");
  writeFileSync(join(bin, "rustc"), `#!/bin/sh\necho "$@" >> '${log}'\necho "error: toolchain is not installed" >&2\nexit 1\n`);
  chmodSync(join(bin, "rustc"), 0o755);
  writeFileSync(join(dir, "l.rs"), "pub fn f() -> u32 { 1 }\n");
  const r = Bun.spawnSync(
    [process.execPath, join(import.meta.dir, "..", "rust_ts", "main.ts"), "--crate-type=lib", "--emit=metadata", "--sysroot", sysroot, "l.rs"],
    // HOME keeps Bun's transpile cache where it is.
    { cwd: dir, env: { HOME: process.env.HOME ?? "", RUSTC_ICE: "0", PATH: `${bin}:/usr/bin:/bin` }, stdout: "pipe", stderr: "pipe" },
  );
  expect(r.stderr.toString()).toBe("");
  expect(r.exitCode).toBe(0);
  expect(existsSync(join(dir, "libl.rmeta"))).toBe(true);
  expect(existsSync(log) ? readFileSync(log, "utf8") : "").toBe("");
}, 60_000);

test("Sysroot::all_paths lists the explicit sysroot before the default (config.rs:1447)", () => {
  expect(new Sysroot("/explicit", "/default").all_paths()).toEqual(["/explicit", "/default"]);
  expect(new Sysroot(undefined, "/default").all_paths()).toEqual(["/default"]);
  expect(new Sysroot("/explicit", "/default").path()).toBe("/explicit");
  expect(new Sysroot(undefined, "/default").path()).toBe("/default");
});

test("Session::get_tools_search_paths: each sysroot's bin, then its self-contained dir, explicit first (session.rs:825)", () => {
  const h = host_tuple();
  const sess = { opts: { sysroot: new Sysroot("/explicit", "/default") } } as unknown as Session;
  const get = (self_contained: boolean): string[] => Session.prototype.get_tools_search_paths.call(sess, self_contained);
  expect(get(false)).toEqual([`/explicit/lib/rustlib/${h}/bin`, `/default/lib/rustlib/${h}/bin`]);
  expect(get(true)).toEqual([
    `/explicit/lib/rustlib/${h}/bin`,
    `/explicit/lib/rustlib/${h}/bin/self-contained`,
    `/default/lib/rustlib/${h}/bin`,
    `/default/lib/rustlib/${h}/bin/self-contained`,
  ]);
});
