// Tests of src/rustc_interface/interface.ts `run_compiler`: its `Config.make_codegen_backend` arm (interface.rs:424-437;
// Miri's driver is the user, src/miri/bin/miri.ts), and its `track_state` / `register_lints` arms (interface.rs:480, :488).
import { afterAll, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DATA } from "../../scripts/lib/common.ts";
import { compiler_entrypoint } from "../rustc_driver_impl/lib.ts";
import type { LintStore } from "../rustc_lint/lib.ts";
import { Lint, LintId } from "../rustc_lint_defs/lib.ts";
import { EarlyDiagCtxt, type EarlySession, type Session } from "../rustc_session/session.ts";
import { Symbol } from "../rustc_span/symbol.ts";
import { type Config, run_compiler } from "./interface.ts";
import type { CodegenBackend } from "./stand_ins.ts";
import { get_codegen_backend } from "./util.ts";

class CaptureConfig extends Error {}

function config_of(file: string): Config {
  let config: Config | undefined;
  try {
    compiler_entrypoint(["rustc", "--crate-type", "lib", "--edition", "2024", file], {
      config(c: Config) {
        config = c;
        throw new CaptureConfig();
      },
    });
  } catch (e) {
    if (!(e instanceof CaptureConfig)) throw e;
  }
  if (config === undefined) throw new Error("ERROR: no config");
  return config;
}

const SOURCE_FILE = join(DATA, "tmp", "interface-test", `${process.pid}.rs`);
afterAll(() => rmSync(SOURCE_FILE, { force: true }));

function source_file(): string {
  mkdirSync(dirname(SOURCE_FILE), { recursive: true });
  writeFileSync(SOURCE_FILE, "");
  return SOURCE_FILE;
}

test("run_compiler uses Config.make_codegen_backend when it is set, then calls init and target_config on what it made", () => {
  const calls: string[] = [];
  let stub: CodegenBackend | undefined;
  const config = config_of(source_file());
  config.make_codegen_backend = (sess: EarlySession) => {
    calls.push("make");
    expect(sess.opts).toBe(config.opts);
    const native = get_codegen_backend(EarlyDiagCtxt.new(sess.opts.error_format), sess.opts.sysroot, undefined, sess.target);
    const init = native.init(sess);
    const backend: CodegenBackend = Object.create(native);
    backend.name = () => "stub";
    backend.init = () => {
      calls.push("init");
      return init;
    };
    backend.target_config = (s) => {
      calls.push("target_config");
      return native.target_config(s);
    };
    stub = backend;
    return backend;
  };
  let ran = false;
  run_compiler(config, (compiler) => {
    ran = true;
    expect(stub).toBeDefined();
    expect(compiler.codegen_backend).toBe(stub!);
    expect(compiler.codegen_backend.name()).toBe("stub");
  });
  expect(ran).toBe(true);
  expect(calls).toEqual(["make", "init", "target_config"]);
});

test("run_compiler without Config.make_codegen_backend gets the default backend", () => {
  const config = config_of(source_file());
  expect(config.make_codegen_backend).toBeUndefined();
  let name: string | undefined;
  run_compiler(config, (compiler) => {
    name = compiler.codegen_backend.name();
  });
  expect(name).toBe("llvm");
});

// `Config.track_state` and `Config.register_lints` (interface.rs:480, :488; clippy-driver sets both, src/tools/clippy/src/driver.rs),
// with a fake tool registration.
test("run_compiler calls Config.track_state once with the session, after parse_check_cfg and before the lint store exists", () => {
  const config = config_of(source_file());
  expect(config.track_state).toBeUndefined();
  // `parse_check_cfg` is the last statement upstream runs before `track_state` (interface.rs:474; `psess_created`, between
  // them, is always `None`). `build_session` already sets a default `CheckCfg`, so the check is this `--check-cfg` name being
  // in it, which only `sess.check_config = parse_check_cfg(..)` puts there (review N2).
  const FAKE_CFG = "faketool_cfg";
  config.crate_check_cfg = [...config.crate_check_cfg, `cfg(${FAKE_CFG})`];
  const calls: string[] = [];
  let tracked: Session | undefined;
  config.track_state = (sess) => {
    calls.push("track_state");
    tracked = sess;
    expect(sess.check_config.expecteds.has(Symbol.intern(FAKE_CFG))).toBe(true);
    expect(sess.lint_store).toBeUndefined();
    // What a driver does with it: record otherwise untracked inputs for the dep-info file (passes.rs write_out_deps).
    sess.env_depinfo.add(JSON.stringify(["FAKE_TOOL_ARGS", "-Dwarnings"]));
    sess.file_depinfo.add(Symbol.intern("fake-tool.toml"));
  };
  config.register_lints = () => {
    calls.push("register_lints");
  };
  run_compiler(config, (compiler) => {
    calls.push("f");
    expect(compiler.sess).toBe(tracked!);
    expect(compiler.sess.env_depinfo.has(JSON.stringify(["FAKE_TOOL_ARGS", "-Dwarnings"]))).toBe(true);
    expect(compiler.sess.file_depinfo.has(Symbol.intern("fake-tool.toml"))).toBe(true);
  });
  expect(calls).toEqual(["track_state", "register_lints", "f"]);
});

test("run_compiler calls Config.register_lints with the session and the new lint store, which the session then holds", () => {
  const config = config_of(source_file());
  expect(config.register_lints).toBeUndefined();
  const FAKE_LINT: Lint = { ...Lint.default_fields_for_macro(), name: "faketool::FAKE_LINT", default_level: "Warn", desc: "a fake tool lint", is_externally_loaded: true };
  let store: LintStore | undefined;
  let calls = 0;
  config.register_lints = (sess, lint_store) => {
    calls++;
    store = lint_store;
    // the builtin lints are already in it (`new_lint_store`), the session is fully initialized
    expect(lint_store.get_lints().length).toBeGreaterThan(0);
    expect(lint_store.get_lints().some((l) => l.is_externally_loaded)).toBe(false);
    expect(sess.check_config).toBeDefined();
    lint_store.register_lints([FAKE_LINT]);
    lint_store.register_group(true, "faketool::all", undefined, [LintId.of(FAKE_LINT)]);
  };
  run_compiler(config, (compiler) => {
    const lint_store = compiler.sess.lint_store as LintStore;
    expect(lint_store).toBe(store!);
    expect(lint_store.get_lints().filter((l) => l.is_externally_loaded)).toEqual([FAKE_LINT]);
    expect(lint_store.find_lints("faketool::fake_lint")).toEqual([LintId.of(FAKE_LINT)]);
    expect([...lint_store.get_lint_groups()].filter(([, , loaded]) => loaded)).toEqual([["faketool::all", [LintId.of(FAKE_LINT)], true]]);
  });
  expect(calls).toBe(1);
});

test("run_compiler without the hooks builds the plain lint store", () => {
  const config = config_of(source_file());
  expect(config.track_state).toBeUndefined();
  expect(config.register_lints).toBeUndefined();
  run_compiler(config, (compiler) => {
    const lint_store = compiler.sess.lint_store as LintStore;
    expect(lint_store.get_lints().some((l) => l.is_externally_loaded)).toBe(false);
    expect(lint_store.find_lints("faketool::fake_lint")).toBeUndefined();
  });
});
