// Unit tests of src/clippy/driver.ts (lane clippy-contract-a): the two upstream `#[test]`s of driver.rs, and the argument
// handling of `main`, run in-process with `rustc_driver::compiler_entrypoint` replaced by a spy (restored after each case) that
// records the argv and the callbacks it gets (and `init_rustc_env_logger` a no-op, as it is without RUSTC_LOG). `help_message` is compared with the string in the pinned clippy-driver binary.
import { afterAll, expect, spyOn, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as rustc_driver_impl from "../rustc_driver_impl/lib.ts";
import type { Callbacks } from "../rustc_driver_impl/lib.ts";
import type { Config } from "../rustc_interface/interface.ts";
import type { Session } from "../rustc_session/session.ts";
import { create_session_globals_then } from "../rustc_span/lib.ts";
import { Symbol } from "../rustc_span/symbol.ts";
import { args_os, remove_var, set_args_os, set_var, var_os } from "../std/env.ts";
import { take_hook } from "../std/panicking.ts";
import { Unported } from "../std/panic.ts";
import * as sym from "../clippy_utils/sym.gen.ts";
import { str_lines } from "../std/str.ts";
import { arg_value, file_stem, help_message, is_arg, main } from "./driver.ts";

// `main` installs the ICE hook, and `bun test` runs every file in this process.
afterAll(take_hook);

// rustc: src/tools/clippy/src/driver.rs:57 test_arg_value
test("test_arg_value", () => {
  const args = ["--bar=bar", "--foobar", "123", "--foo"];

  expect(!arg_value([], "--foobar", (_) => true)).toBe(true);
  expect(!arg_value(args, "--bar", (_) => false)).toBe(true);
  expect(arg_value(args, "--bar", (_) => true)).toBe(true);
  expect(arg_value(args, "--bar", (p) => p === "bar")).toBe(true);
  expect(!arg_value(args, "--bar", (p) => p === "foo")).toBe(true);
  expect(!arg_value(args, "--foobar", (p) => p === "foo")).toBe(true);
  expect(arg_value(args, "--foobar", (p) => p === "123")).toBe(true);
  expect(arg_value(args, "--foobar", (p) => p.includes("12"))).toBe(true);
  expect(!arg_value(args, "--foo", (_) => true)).toBe(true);
});

// rustc: src/tools/clippy/src/driver.rs:74 test_has_arg
test("test_has_arg", () => {
  expect(is_arg("--foo=bar", "--foo")).toBe(true);
  expect(is_arg("--baz", "--baz")).toBe(true);
  expect(is_arg("-vV", "-vV")).toBe(true);

  expect(["--=bar", "--barr", "-bar", "bar"].every((arg) => !is_arg(arg, "--bar"))).toBe(true);
});

test("Path::file_stem and str::lines (std semantics)", () => {
  // Rust: Path::new(p).file_stem()
  const stems: [string, string | undefined][] = [
    ["rustc", "rustc"],
    ["/usr/bin/rustc", "rustc"],
    ["rustc.exe", "rustc"],
    ["x/rustc/", "rustc"],
    ["x/rustc/.", "rustc"],
    [".rustc", ".rustc"],
    ["a.b.c", "a.b"],
    ["foo.", "foo"],
    ["/", undefined],
    ["", undefined],
    ["..", undefined],
    ["x/..", undefined],
    [".", undefined],
  ];
  for (const [p, s] of stems) expect([p, file_stem(p)]).toEqual([p, s]);
  // `str::lines` (std's `str_lines`): `\r` is stripped only before a `\n`, so a final bare `\r` stays
  expect(str_lines("a\n--sysroot\r")).toEqual(["a", "--sysroot\r"]);
});

test("help_message is color_print::cstr!'s expansion in the pinned clippy-driver", async () => {
  const { DATA } = await import("../../scripts/lib/common.ts");
  const { toolPinsOrDie } = await import("../../scripts/lib/oracle.ts");
  const { toolBinary } = await import("../../scripts/lib/tool-oracles.ts");
  const bin = toolBinary(DATA, toolPinsOrDie().clippy, "clippy", "clippy-driver");
  expect(existsSync(bin)).toBe(true);
  const msg = Buffer.from(help_message());
  // The literal sits in the binary's string data, followed by the next literal (`BUG_REPORT_URL`).
  const at = readFileSync(bin).indexOf(Buffer.concat([msg, Buffer.from("https://github.com/rust-lang/rust-clippy/issues/new?template=ice.yml")]));
  expect(at).toBeGreaterThan(0);
});

interface Call {
  args: string[];
  callbacks: Callbacks;
}

const enc = new TextEncoder();

/** Runs `f` with each variable of `env` set (`undefined` = unset), restoring them afterwards. The names come only through `env`. */
function with_env<R>(env: Record<string, string | undefined>, f: () => R): R {
  const saved = new Map(Object.keys(env).map((k) => [k, var_os(k)]));
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) remove_var(k);
    else set_var(k, v);
  }
  try {
    return f();
  } finally {
    for (const [k, v] of saved) {
      if (v === undefined) remove_var(k);
      else set_var(k, v);
    }
  }
}

/** Runs `clippy-driver <args>` in-process with `env` set (`undefined` = unset; the driver's own variables unset unless given):
 * [exit code, compiler_entrypoint calls]. */
function run(args: string[], env: Record<string, string | undefined> = {}): [number, Call[]] {
  const calls: Call[] = [];
  const spy = spyOn(rustc_driver_impl, "compiler_entrypoint").mockImplementation((a, callbacks) => {
    calls.push({ args: [...a], callbacks });
  });
  // The env logger can be set once per process (a second `init` is a fatal error); RUSTC_LOG is unset here, so it is a no-op.
  const logger = spyOn(rustc_driver_impl, "init_rustc_env_logger").mockImplementation(() => {});
  const previous_args = args_os();
  set_args_os(["clippy-driver", ...args].map((a) => enc.encode(a)));
  try {
    return with_env({ SYSROOT: undefined, CLIPPY_ARGS: undefined, CARGO_PRIMARY_PACKAGE: undefined, ...env }, () => [main(), calls]);
  } finally {
    set_args_os(previous_args);
    spy.mockRestore();
    logger.mockRestore();
  }
}

/** The one call's argv (without the binary name) and callbacks type. */
function one(args: string[], env: Record<string, string | undefined> = {}): [string[], string] {
  const [code, calls] = run(args, env);
  expect(code).toBe(0);
  expect(calls.length).toBe(1);
  return [calls[0]!.args, calls[0]!.callbacks.constructor.name];
}

const CFG = ["--cfg", "clippy"];

test("main: --rustc, wrapper mode and --sysroot from SYSROOT", () => {
  expect(one(["--rustc", "a.rs"])).toEqual([["rustc", "a.rs"], "DefaultCallbacks"]);
  expect(one(["a.rs", "--rustc", "--version"])).toEqual([["rustc", "a.rs", "--version"], "DefaultCallbacks"]);
  expect(one(["--rustc", "a.rs"], { SYSROOT: "/s" })).toEqual([["rustc", "a.rs", "--sysroot", "/s"], "DefaultCallbacks"]);
  expect(one(["--rustc", "a.rs", "--sysroot=/t"], { SYSROOT: "/s" })).toEqual([["rustc", "a.rs", "--sysroot=/t"], "DefaultCallbacks"]);
  expect(one(["a.rs"], { SYSROOT: "/s" })).toEqual([["clippy-driver", "a.rs", "--sysroot", "/s", ...CFG], "ClippyCallbacks"]);
  // an @file naming --sysroot counts; one that cannot be read does not
  const dir = mkdtempSync(join(process.env.TMPDIR ?? "/tmp", "clippy-driver-test-"));
  try {
    const f = join(dir, "args");
    writeFileSync(f, "a.rs\r\n--sysroot\n/u\n");
    expect(one([`@${f}`], { SYSROOT: "/s" })).toEqual([["clippy-driver", `@${f}`, ...CFG], "ClippyCallbacks"]);
    // a last line `--sysroot\r` with no `\n` is not `--sysroot` (str::lines keeps the `\r`), so SYSROOT's is added
    const g = join(dir, "args2");
    writeFileSync(g, "a.rs\n--sysroot\r");
    expect(one([`@${g}`], { SYSROOT: "/s" })).toEqual([["clippy-driver", `@${g}`, "--sysroot", "/s", ...CFG], "ClippyCallbacks"]);
    expect(one([`@${join(dir, "missing")}`], { SYSROOT: "/s" })).toEqual([["clippy-driver", `@${join(dir, "missing")}`, "--sysroot", "/s", ...CFG], "ClippyCallbacks"]);
  } finally {
    rmSync(dir, { recursive: true });
  }
  // RUSTC_WRAPPER: argv[1] whose file stem is `rustc` is dropped, and then no `--help` / lone-binary check applies
  expect(one(["/x/rustc", "a.rs"])).toEqual([["clippy-driver", "a.rs", ...CFG], "ClippyCallbacks"]);
  expect(one(["rustc.exe"])).toEqual([["clippy-driver", ...CFG], "ClippyCallbacks"]);
  expect(one(["rustc", "--help"])).toEqual([["clippy-driver", "--help", ...CFG], "ClippyCallbacks"]);
});

test("main: when clippy runs (CLIPPY_ARGS, --no-deps, --cap-lints, info queries)", () => {
  expect(one(["a.rs"], { CLIPPY_ARGS: "-Dwarnings__CLIPPY_HACKERY__-Wclippy::pedantic__CLIPPY_HACKERY__" })).toEqual([
    ["clippy-driver", "a.rs", "-Dwarnings", "-Wclippy::pedantic", ...CFG],
    "ClippyCallbacks",
  ]);
  const no_deps = "-Dwarnings__CLIPPY_HACKERY__--no-deps__CLIPPY_HACKERY__";
  expect(one(["a.rs"], { CLIPPY_ARGS: no_deps })).toEqual([["clippy-driver", "a.rs"], "RustcCallbacks"]);
  expect(one(["a.rs"], { CLIPPY_ARGS: no_deps, CARGO_PRIMARY_PACKAGE: "1" })).toEqual([["clippy-driver", "a.rs", "-Dwarnings", ...CFG], "ClippyCallbacks"]);
  expect(one(["a.rs", "--cap-lints", "allow"])).toEqual([["clippy-driver", "a.rs", "--cap-lints", "allow"], "RustcCallbacks"]);
  expect(one(["a.rs", "--cap-lints=allow", "--force-warn", "clippy::pedantic"])[1]).toBe("ClippyCallbacks");
  expect(one(["a.rs", "--cap-lints", "warn"])[1]).toBe("ClippyCallbacks");
  expect(one(["-vV"])).toEqual([["clippy-driver", "-vV"], "RustcCallbacks"]);
  expect(one(["--print", "sysroot"])[1]).toBe("RustcCallbacks");
  expect(one(["--print=crate-root-lint-levels", "a.rs"])[1]).toBe("ClippyCallbacks");
});

test("main: --version stops unported (rustc_tools_util::get_version_info!)", () => {
  expect(() => run(["--version"])).toThrow(Unported);
  expect(() => run(["a.rs", "-V"])).toThrow(Unported);
});

/** A `Config` with only what the callbacks write. */
function fake_config(): Config {
  return { opts: { unstable_opts: { mir_opt_level: undefined, mir_enable_passes: [], flatten_format_args: true } }, extra_symbols: [] } as unknown as Config;
}

test("ClippyCallbacks::config and RustcCallbacks::config", () => {
  const [, [clippy]] = run(["a.rs"], { CLIPPY_ARGS: "-Dwarnings", CLIPPY_CONF_DIR: "conf" });
  const [, [rustc]] = run(["-vV"], { CLIPPY_ARGS: "-Dwarnings" });
  const c = fake_config();
  clippy!.callbacks.config(c);
  expect(c.opts.unstable_opts.mir_opt_level).toBe(0);
  expect(c.opts.unstable_opts.mir_enable_passes).toEqual([
    ["CheckNull", false],
    ["CheckAlignment", false],
  ]);
  expect(c.opts.unstable_opts.flatten_format_args).toBe(false);
  expect(c.extra_symbols).toEqual([...sym.EXTRA_SYMBOLS]);
  const cb = c as unknown as { track_state?: (sess: Session) => void; register_lints?: unknown };
  expect(typeof cb.register_lints).toBe("function");
  const r = fake_config();
  rustc!.callbacks.config(r);
  expect(r.opts.unstable_opts.mir_opt_level).toBe(undefined);
  expect(r.extra_symbols).toEqual([...sym.EXTRA_SYMBOLS]);
  expect((r as unknown as { register_lints?: unknown }).register_lints).toBe(undefined);

  // track_state: CLIPPY_ARGS (as given to the callbacks), CLIPPY_CONF_DIR (read when it runs) and Cargo.toml if present
  const depinfo = (f: (sess: Session) => void, env: Record<string, string | undefined>): [string[], string[]] =>
    create_session_globals_then("Edition2015", sym.EXTRA_SYMBOLS, undefined, () => {
      const sess = { env_depinfo: new Set<string>(), file_depinfo: new Set<Symbol>() } as unknown as Session;
      with_env(env, () => f(sess));
      return [[...sess.env_depinfo], [...sess.file_depinfo].map((s) => Symbol.as_str(s))];
    });
  const cargo_toml = existsSync("Cargo.toml") ? ["Cargo.toml"] : [];
  expect(depinfo(cb.track_state!, { CLIPPY_CONF_DIR: "conf" })).toEqual([['["CLIPPY_ARGS","-Dwarnings"]', '["CLIPPY_CONF_DIR","conf"]'], cargo_toml]);
  expect(depinfo(cb.track_state!, { CLIPPY_CONF_DIR: undefined })).toEqual([['["CLIPPY_ARGS","-Dwarnings"]', '["CLIPPY_CONF_DIR",null]'], cargo_toml]);
  const rcb = r as unknown as { track_state: (sess: Session) => void };
  expect(depinfo(rcb.track_state, { CLIPPY_CONF_DIR: undefined })).toEqual([['["CLIPPY_ARGS","-Dwarnings"]'], []]);
});
