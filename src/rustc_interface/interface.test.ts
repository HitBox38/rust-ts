// Tests of src/rustc_interface/interface.ts `run_compiler`: its `Config.make_codegen_backend` arm (interface.rs:424-437;
// Miri's driver is the user, src/miri/bin/miri.ts).
import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DATA } from "../../scripts/lib/common.ts";
import { compiler_entrypoint } from "../rustc_driver_impl/lib.ts";
import { EarlyDiagCtxt, type EarlySession } from "../rustc_session/session.ts";
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

function source_file(): string {
  const file = join(DATA, "tmp", "interface-test", `${process.pid}.rs`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, "");
  return file;
}

test("run_compiler uses Config.make_codegen_backend when it is set, and does not ask for the default backend", () => {
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
