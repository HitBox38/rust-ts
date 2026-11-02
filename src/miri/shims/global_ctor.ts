// Port of src/tools/miri/src/shims/global_ctor.rs (crate `miri`, plan-m6 D2).
// Fill lane: `miri-shims-a` (plan-m6 wave 37): ported.
// Its types are generated into global_ctor.gen.ts (tools/codegen set `miri`); this module re-exports them.
//! Implement global constructors.
//
// PORT:
// - `Poll<()>` is `Poll<null>` (src/std/task.ts); `'new_state: { .. break 'new_state x }` is a nested function
//   returning the new state (or a `Poll` to return directly).
// - `ctors.pop()` mutates the `Ctors` vector in place, as upstream (the state object is kept).
import { type ImmTy } from "../lib.ts";
import { type MiriInterpCx } from "../machine.ts";
import { imm_to_scalar } from "../operator.ts";
import { GlobalCtorState, GlobalCtorStatePriv } from "./global_ctor.gen.ts";
import { ExternAbi } from "../../rustc_abi/extern_abi.ts";
import { FnVal } from "../../rustc_const_eval/interpret/memory.ts";
import { type InterpResult, interp_ok, Scalar } from "../../rustc_middle/mir/interpret/mod.ts";
import { type Span } from "../../rustc_span/lib.ts";
import { Poll } from "../../std/task.ts";
export * from "./global_ctor.gen.ts";

declare module "./global_ctor.gen.ts" {
  interface GlobalCtorState {
    // shims/global_ctor.rs:24
    on_stack_empty(this_: MiriInterpCx): InterpResult<Poll<null>>;
  }
}

/** `Option<&str>` comparisons of the `__mod_init_func` check. */
function opt_eq(a: string | undefined, b: string): boolean {
  return a !== undefined && a === b;
}

// rustc: src/tools/miri/src/shims/global_ctor.rs:24 on_stack_empty
GlobalCtorState.prototype.on_stack_empty = function (this: GlobalCtorState, this_: MiriInterpCx): InterpResult<Poll<null>> {
  // use GlobalCtorStatePriv::*;
  const new_state_r = ((): InterpResult<GlobalCtorStatePriv | Poll<null>> => {
    const state = this._0;
    switch (state.$) {
      case "Init": {
        const this__ = this_.eval_context_mut();

        // Lookup constructors from the relevant magic link section.
        let ctors: [ImmTy, Span][];
        switch (this__.tcx.deref().sess.target.binary_format) {
          // Read the CRT library section on Windows.
          case "Coff": {
            const r = this__.lookup_link_section((section) => section === ".CRT$XCU");
            if (r.$ === "Err") return r;
            ctors = r._0;
            break;
          }

          // Read the `__mod_init_func` section on macOS.
          case "MachO": {
            const r = this__.lookup_link_section((section) => {
              // `section.splitn(3, ',')`
              const parts: string[] = [];
              let rest = section;
              while (parts.length < 2) {
                const i = rest.indexOf(",");
                if (i < 0) break;
                parts.push(rest.slice(0, i));
                rest = rest.slice(i + 1);
              }
              parts.push(rest);
              const [segment_name, section_name, section_type] = [parts[0], parts[1], parts[2]];

              return (
                opt_eq(segment_name, "__DATA") &&
                opt_eq(section_name, "__mod_init_func") &&
                // The `mod_init_funcs` directive ensures that the
                // `S_MOD_INIT_FUNC_POINTERS` flag is set on the section. LLVM
                // adds this automatically so we currently do not require it.
                // FIXME: is this guaranteed LLVM behavior? If not, we shouldn't
                // implicitly add it here. Also see
                // <https://github.com/rust-lang/miri/pull/4459#discussion_r2200115629>.
                (section_type === undefined || section_type === "mod_init_funcs")
              );
            });
            if (r.$ === "Err") return r;
            ctors = r._0;
            break;
          }

          // Read the standard `.init_array` section on platforms that use ELF, or WASM,
          // which supports the same linker directive.
          // FIXME: Add support for `.init_array.N` and `.ctors`?
          case "Elf":
          case "Wasm": {
            const r = this__.lookup_link_section((section) => section === ".init_array");
            if (r.$ === "Err") return r;
            ctors = r._0;
            break;
          }

          // Other platforms have no global ctor support.
          default:
            return interp_ok(GlobalCtorStatePriv.Done);
        }

        return interp_ok({ $: "Ctors", _0: ctors });
      }
      case "Ctors": {
        const ctors = state._0;
        const popped = ctors.pop();
        if (popped !== undefined) {
          const [ctor0, span] = popped;
          const this__ = this_.eval_context_mut();

          const ctor = Scalar.to_pointer(imm_to_scalar(ctor0), this__);
          const fn_r = this__.get_ptr_fn(ctor);
          if (fn_r.$ === "Err") return fn_r;
          const inst_r = FnVal.as_instance(fn_r._0);
          if (inst_r.$ === "Err") return inst_r;
          const thread_callback = inst_r._0;

          // The signature of this function is `unsafe extern "C" fn()`.
          const c = this__.call_thread_root_function(thread_callback, ExternAbi.C(false), [], undefined, span);
          if (c.$ === "Err") return c;

          return interp_ok(Poll.Pending); // we stay in this state (but `ctors` got shorter)
        }

        // No more constructors to run.
        return interp_ok(GlobalCtorStatePriv.Done);
      }
      case "Done":
        return interp_ok(Poll.Ready_unit);
    }
  })();
  if (new_state_r.$ === "Err") return new_state_r;
  const new_state = new_state_r._0;
  // A `Poll` is a direct `return` from inside the `match`; a `GlobalCtorStatePriv` is the `'new_state` value.
  if (new_state.$ === "Pending" || new_state.$ === "Ready") return interp_ok(new_state);

  this._0 = new_state;
  return interp_ok(Poll.Pending);
};
