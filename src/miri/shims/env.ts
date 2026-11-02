// Port of src/tools/miri/src/shims/env.rs (crate `miri`, plan-m6 D2).
// Fill lane: `miri-shims-a` (plan-m6 wave 37): ported.
// Its types are generated into env.gen.ts (tools/codegen set `miri`); this module re-exports them.
//
// PORT:
// - `OsStr` / `OsString` are `string` (typemap `std::ffi::OsString`, D14: host OS strings are UTF-8; see os_str.ts).
// - `impl EnvVars` (an enum) is the companion const's methods (`EnvVars.init(ecx, config)`, `EnvVars.unix(self)`, ...);
//   `impl VisitProvenance for EnvVars` is the table `VisitProvenance_EnvVars` (provenance_gc.ts, borrowck-contract
//   rule 5). `unix_mut` / `windows_mut` return the same object as `unix` / `windows` (`&mut T` is `T`).
// - `FxHashMap<OsString, OsString>` is rust_ts/hash_map.ts's `FxHashMap` with `OsString_key` (unix/env.ts: `OsString`
//   hashes its bytes with a length prefix, not `str`'s 0xff terminator), so `UnixEnvVars::new` sees upstream's FxHash
//   order (the `environ` block order depends on it).
// - Windows (`WindowsEnvVars`, shims/windows/env.rs) is out of scope (plan-m6 D2): its arms stop `unported`.
// - `std::process::id()` (isolation off) is the host's `process.pid` (D14 stand-in).
import * as gen from "./env.gen.ts";
import { type ThreadId } from "../concurrency/thread.ts";
import { type MiriConfig } from "../eval.ts";
import { type MiriInterpCx } from "../machine.ts";
import { type VisitProvenance, type VisitWith } from "../provenance_gc.ts";
import { OsString_key, UnixEnvVars } from "./unix/env.ts";
import { FxHashMap, LAYOUT_VEC } from "../../rust_ts/hash_map.ts";
import { InterpCx } from "../../rustc_const_eval/interpret/eval_context.ts";
import { type AnyMachine, type Machine } from "../../rustc_const_eval/interpret/machine.ts";
import { type InterpResult, interp_ok } from "../../rustc_middle/mir/interpret/mod.ts";
import { debug_target_spec_other } from "../../rustc_target/lib.ts";
import { assert, assert_matches, unported, unreachable } from "../../std/panic.ts";
import { ok } from "../../std/result.ts";
export * from "./env.gen.ts";

declare module "../../rustc_const_eval/interpret/eval_context.ts" {
  interface InterpCx<M extends AnyMachine = Machine> {
    // ---- shims/env.rs: `trait EvalContextExt` (impl for `MiriInterpCx`) ----
    // shims/env.rs:97
    get_env_var(this: MiriInterpCx, name: string): InterpResult<string | undefined>;
    // shims/env.rs:107
    get_pid(this: MiriInterpCx): number;
    // shims/env.rs:113
    get_tid(this: MiriInterpCx, thread: ThreadId): number;
    // shims/env.rs:123
    get_thread_id_from_linux_tid(this: MiriInterpCx, tid: number): ThreadId | undefined;
  }
}

/** `shims::windows::WindowsEnvVars` (out of scope, plan-m6 D2): the generated variant field is `never`. */
type WindowsEnvVars = never;

interface EnvVars_methods {
  init(ecx: MiriInterpCx, config: MiriConfig): InterpResult;
  unix(self: EnvVars): UnixEnvVars;
  unix_mut(self: EnvVars): UnixEnvVars;
  windows(self: EnvVars): WindowsEnvVars;
  windows_mut(self: EnvVars): WindowsEnvVars;
}

export type EnvVars = gen.EnvVars;
export const EnvVars = gen.EnvVars as typeof gen.EnvVars & EnvVars_methods;

// impl VisitProvenance for EnvVars<'_>
export const VisitProvenance_EnvVars = {
  // rustc: src/tools/miri/src/shims/env.rs:20 visit_provenance
  visit_provenance(self: EnvVars, visit: VisitWith): void {
    switch (self.$) {
      case "Uninit":
        break;
      case "Unix":
        self._0.visit_provenance(visit);
        break;
      case "Windows":
        return unported("miri::shims::windows::env::WindowsEnvVars::visit_provenance (Windows shims are out of scope, plan-m6 D2)");
    }
  },
};

// rustc: src/tools/miri/src/shims/env.rs:30 init
EnvVars.init = function (ecx: MiriInterpCx, config: MiriConfig): InterpResult {
  // Initialize the `env_vars` map.
  // Skip the loop entirely if we don't want to forward anything.
  const env_vars = FxHashMap.default<string, string>(OsString_key, LAYOUT_VEC);
  if (ecx.machine.communicate() || config.forwarded_env_vars.length !== 0) {
    for (const [name, value] of config.env) {
      const forward = ecx.machine.communicate() || config.forwarded_env_vars.some((v) => v === name);
      if (forward) {
        env_vars.set(name, value);
      }
    }
  }

  for (const [name, value] of config.set_env_vars) {
    env_vars.set(name, value);
  }

  let env_vars_: EnvVars;
  if (ecx.target_os_is_unix()) {
    const r = UnixEnvVars.new(ecx, env_vars);
    if (r.$ === "Err") return r;
    env_vars_ = { $: "Unix", _0: r._0 };
  } else if (ecx.tcx.deref().sess.target.os.$ === "Windows") {
    return unported("miri::shims::windows::env::WindowsEnvVars::new (Windows shims are out of scope, plan-m6 D2)");
  } else {
    // For "none" targets (i.e., without an OS).
    env_vars_ = EnvVars.Uninit;
  }
  ecx.machine.env_vars = env_vars_;

  return interp_ok(undefined);
};

// rustc: src/tools/miri/src/shims/env.rs:64 unix
EnvVars.unix = function (self: EnvVars): UnixEnvVars {
  switch (self.$) {
    case "Unix":
      return self._0;
    default:
      return unreachable();
  }
};

// rustc: src/tools/miri/src/shims/env.rs:71 unix_mut
EnvVars.unix_mut = function (self: EnvVars): UnixEnvVars {
  switch (self.$) {
    case "Unix":
      return self._0;
    default:
      return unreachable();
  }
};

// rustc: src/tools/miri/src/shims/env.rs:78 windows
EnvVars.windows = function (self: EnvVars): WindowsEnvVars {
  switch (self.$) {
    case "Windows":
      return self._0;
    default:
      return unreachable();
  }
};

// rustc: src/tools/miri/src/shims/env.rs:85 windows_mut
EnvVars.windows_mut = function (self: EnvVars): WindowsEnvVars {
  switch (self.$) {
    case "Windows":
      return self._0;
    default:
      return unreachable();
  }
};

/// Try to get an environment variable from the interpreted program's environment. This is
/// useful for implementing shims which are documented to read from the environment.
// rustc: src/tools/miri/src/shims/env.rs:97 get_env_var
InterpCx.prototype.get_env_var = function (this: MiriInterpCx, name: string): InterpResult<string | undefined> {
  const this_ = this.eval_context_ref();
  const env_vars = this_.machine.env_vars;
  switch (env_vars.$) {
    case "Uninit":
      return interp_ok(undefined);
    case "Unix":
      return env_vars._0.get(this_, name);
    case "Windows":
      return unported("miri::shims::windows::env::WindowsEnvVars::get (Windows shims are out of scope, plan-m6 D2)");
  }
};

/// Get the process identifier.
// rustc: src/tools/miri/src/shims/env.rs:107 get_pid
InterpCx.prototype.get_pid = function (this: MiriInterpCx): number {
  const this_ = this.eval_context_ref();
  // PORT: `std::process::id()` is the host's `process.pid` (isolation off only, D14).
  return this_.machine.communicate() ? process.pid : 1000;
};

/// Get an "OS" thread ID for any thread.
// rustc: src/tools/miri/src/shims/env.rs:113 get_tid
InterpCx.prototype.get_tid = function (this: MiriInterpCx, thread: ThreadId): number {
  const this_ = this.eval_context_ref();
  assert(this_.target_os_is_unix(), "assertion failed: this.target_os_is_unix()");
  // On Linux, the main thread has PID == TID so we uphold this. For simplicity we do it
  // everywhere. That also ensures this ID is different from what is returned by
  // `pthread_self`.
  // `u32::strict_add`
  const tid = this_.get_pid() + thread.to_u32();
  assert(tid <= 0xffff_ffff, "attempt to add with overflow");
  return tid;
};

/// Convert TID back to a `ThreadId`, or `None` if it is invalid or the thread has terminated.
// rustc: src/tools/miri/src/shims/env.rs:123 get_thread_id_from_linux_tid
InterpCx.prototype.get_thread_id_from_linux_tid = function (this: MiriInterpCx, tid: number): ThreadId | undefined {
  const this_ = this.eval_context_ref();
  const os = this_.tcx.deref().sess.target.os;
  assert_matches(os, os.$ === "Linux" || os.$ === "Android", "Os::Linux | Os::Android", debug_target_spec_other);
  // TID = PID + thread_index => index = TID - PID.
  // `u32::checked_sub`
  const pid = this_.get_pid();
  if (tid < pid) return undefined;
  const id = tid - pid;
  return ok(this_.machine.threads.thread_id_try_from(id));
};
