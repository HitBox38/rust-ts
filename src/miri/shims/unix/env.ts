// Port of src/tools/miri/src/shims/unix/env.rs (crate `miri`, plan-m6 D2): STUB by lane miri-contract (wave 35).
// Fill lane: `miri-shims-c` (plan-m6 wave 37). Contract and rules: docs/handoff/miri-contract.md ("How to fill a stub").
// Its types are generated into env.gen.ts (tools/codegen set `miri`); this module re-exports them.
// Until ported, every method declared below is an `unported` placeholder (`stub_*` calls at the end, installed by
// src/miri/lib.ts) and every free fn stops with `unported`. The declarations were translated mechanically from the
// upstream signatures (`Pending<"..">` = a type the translation did not map); the fill lane owns and corrects them.
import { type OpTy, type Pointer, type Scalar } from "../../lib.ts";
import { type MiriInterpCx } from "../../machine.ts";
import { UnixEnvVars } from "./env.gen.ts";
import { stub_methods, stub_statics } from "../../../rust_ts/miri_stub.ts";
import { InterpCx } from "../../../rustc_const_eval/interpret/eval_context.ts";
import { type AnyMachine, type Machine } from "../../../rustc_const_eval/interpret/machine.ts";
import { type InterpResult } from "../../../rustc_middle/mir/interpret/mod.ts";
export * from "./env.gen.ts";

declare module "../../../rustc_const_eval/interpret/eval_context.ts" {
  interface InterpCx<M extends AnyMachine = Machine> {
    // ---- shims/unix/env.rs: `trait EvalContextExt` (impl for `MiriInterpCx`) ----
    // shims/unix/env.rs:129
    getenv(this: MiriInterpCx, name_op: OpTy): InterpResult<Pointer>;
    // shims/unix/env.rs:140
    setenv(this: MiriInterpCx, name_op: OpTy, value_op: OpTy): InterpResult<Scalar>;
    // shims/unix/env.rs:172
    unsetenv(this: MiriInterpCx, name_op: OpTy): InterpResult<Scalar>;
    // shims/unix/env.rs:196
    getcwd(this: MiriInterpCx, buf_op: OpTy, size_op: OpTy): InterpResult<Pointer>;
    // shims/unix/env.rs:223
    gethostname(this: MiriInterpCx, name_op: OpTy, len_op: OpTy): InterpResult<Scalar>;
    // shims/unix/env.rs:298
    chdir(this: MiriInterpCx, path_op: OpTy): InterpResult<Scalar>;
    // shims/unix/env.rs:314
    update_environ(this: MiriInterpCx): InterpResult;
    // shims/unix/env.rs:329
    getpid(this: MiriInterpCx): InterpResult<Scalar>;
    // shims/unix/env.rs:342
    unix_gettid(this: MiriInterpCx, link_name: string): InterpResult<Scalar>;
    // shims/unix/env.rs:352
    uname(this: MiriInterpCx, uname: OpTy, fields_size: OpTy | undefined): InterpResult<Scalar>;
    // shims/unix/env.rs:402
    apple_pthread_threadid_np(this: MiriInterpCx, thread_op: OpTy, tid_op: OpTy): InterpResult<Scalar>;
  }
}

declare module "./env.gen.ts" {
  interface UnixEnvVars {
    // shims/unix/env.rs:55 // PORT: `environ_` (a field `environ` exists; mir-contract rule)
    environ_(): Pointer;
    // shims/unix/env.rs:59
    get_ptr(ecx: MiriInterpCx, name: string): InterpResult<Pointer | undefined>;
    // shims/unix/env.rs:80
    get(ecx: MiriInterpCx, name: string): InterpResult<string | undefined>;
  }
  namespace UnixEnvVars {
    // shims/unix/env.rs:35
    function new_(ecx: MiriInterpCx, env_vars: Map<string, string>): InterpResult<UnixEnvVars>;
    export { new_ as new };
  }
}

// ---- inventory: the other fns of the file (trait impls, private fns, macros), in upstream order of kind ----
// impl VisitProvenance for UnixEnvVars<'_> (shims/unix/env.rs:23): visit_provenance (:24)
// fn alloc_env_var (shims/unix/env.rs:95)
// fn alloc_environ_block (shims/unix/env.rs:107)

// ---- placeholders (src/rust_ts/miri_stub.ts; the fill lane deletes each name it ports) ----
stub_methods("miri::shims::unix::env::EvalContextExt", "src/tools/miri/src/shims/unix/env.rs", "miri-shims-c", () => InterpCx.prototype, ["getenv", "setenv", "unsetenv", "getcwd", "gethostname", "chdir", "update_environ", "getpid", "unix_gettid", "uname", "apple_pthread_threadid_np"]);
stub_methods("miri::shims::unix::env::UnixEnvVars", "src/tools/miri/src/shims/unix/env.rs", "miri-shims-c", () => UnixEnvVars.prototype, ["environ_", "get_ptr", "get"]);
stub_statics("miri::shims::unix::env::UnixEnvVars", "src/tools/miri/src/shims/unix/env.rs", "miri-shims-c", () => UnixEnvVars, ["new"]);
