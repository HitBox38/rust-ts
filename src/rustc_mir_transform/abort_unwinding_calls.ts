// Port of compiler/rustc_mir_transform/src/abort_unwinding_calls.rs (lane mt-cleanup).
import { ExternAbi } from "../rustc_abi/extern_abi.ts";
import { InlineAsmOptions } from "../rustc_ast/lib.ts";
import { DefKind } from "../rustc_hir/def.ts";
import { type Body, debug_Terminator, Operand, TerminatorKind, UnwindAction } from "../rustc_middle/mir/mod.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { fn_can_unwind } from "../rustc_middle/ty/layout.ts";
import type { Ty } from "../rustc_middle/ty/mod.ts";
import { debug_Ty } from "../rustc_middle/ty/structural_impls.ts";
import type { DefId } from "../rustc_span/def_id.ts";
import { span_bug } from "../rustc_span/macros.ts";
import { sym } from "../rustc_span/symbol.ts";
import { EarlyBinder } from "../rustc_type_ir/binder.ts";
import { PolyFnSig } from "../rustc_type_ir/ty_kind.ts";
import { PLAIN } from "../std/fmt.ts";
import { unwrap } from "../std/panic.ts";
import { MirPass, type PassCtx, PassPolicy } from "./pass_manager.ts";
import { remove_dead_blocks } from "./simplify.ts";

/// A pass that runs which is targeted at ensuring that codegen guarantees about
/// unwinding are upheld for compilations of panic=abort programs.
///
/// When compiling with panic=abort codegen backends generally want to assume
/// that all Rust-defined functions do not unwind, and it's UB if they actually
/// do unwind. Foreign functions, however, can be declared as "may unwind" via
/// their ABI (e.g. `extern "C-unwind"`). To uphold the guarantees that
/// Rust-defined functions never unwind a well-behaved Rust program needs to
/// catch unwinding from foreign functions and force them to abort.
///
/// This pass walks over all functions calls which may possibly unwind,
/// and if any are found sets their cleanup to a block that aborts the process.
/// This forces all unwinds, in panic=abort mode happening in foreign code, to
/// trigger a process abort.
// rustc-type: compiler/rustc_mir_transform/src/abort_unwinding_calls.rs:25 AbortUnwindingCalls
// #[derive(PartialEq)]
export class AbortUnwindingCalls extends MirPass {
  readonly type_name = "rustc_mir_transform::abort_unwinding_calls::AbortUnwindingCalls";

  // rustc: compiler/rustc_mir_transform/src/abort_unwinding_calls.rs:28 run_pass
  run_pass(tcx: TyCtxt, body: Body): void {
    const def_id = body.source.def_id();
    const kind = tcx.def_kind(def_id);

    // We don't simplify the MIR of constants at this time because that
    // namely results in a cyclic query when we call `tcx.type_of` below.
    if (!DefKind.is_fn_like(kind)) {
      return;
    }

    // Represent whether this compilation target fundamentally doesn't
    // support unwinding at all at an ABI level. If this the target has no
    // support for unwinding then cleanup actions, for example, are all
    // unnecessary and can be considered unreachable.
    //
    // Currently this is only true for wasm targets on panic=abort when the
    // `exception-handling` target feature is disabled. In such a
    // configuration it's illegal to emit exception-related instructions so
    // it's not possible to unwind.
    const target_supports_unwinding = !(
      tcx.sess.target.options.is_like_wasm &&
      tcx.sess.panic_strategy() === "Abort" &&
      !tcx.asm_target_features(def_id).has(sym.exception_handling)
    );

    // Here we test for this function itself whether its ABI allows
    // unwinding or not.
    // PORT: the `type_of` query value is `unknown` in queries.gen.ts.
    const body_ty = EarlyBinder.skip_binder(tcx.type_of(def_id) as EarlyBinder<Ty>);
    let body_abi: ExternAbi;
    const body_kind = body_ty.kind();
    switch (body_kind.$) {
      case "FnDef":
        body_abi = PolyFnSig.abi(body_ty.fn_sig(tcx));
        break;
      case "Closure":
        body_abi = ExternAbi.RustCall;
        break;
      case "CoroutineClosure":
        body_abi = ExternAbi.RustCall;
        break;
      case "Coroutine":
        body_abi = ExternAbi.Rust;
        break;
      case "Error":
        return;
      default:
        return span_bug(body.span, `unexpected body ty: ${debug_Ty(body_ty, PLAIN)}`);
    }
    const body_can_unwind = fn_can_unwind(tcx, def_id, body_abi);

    // Look in this function body for any basic blocks which are terminated
    // with a function call, and whose function we're calling may unwind.
    // This will filter to functions with `extern "C-unwind"` ABIs, for
    // example.
    for (const block of body.basic_blocks.as_mut()) {
      if (block.terminator === undefined) continue;
      const terminator = block.terminator;
      const span = terminator.source_info.span;

      // If we see an `UnwindResume` terminator inside a function then:
      //
      // * If the target doesn't support unwinding at all, then this is an
      //   unreachable block.
      // * If the body cannot unwind, we need to replace it with
      //   `UnwindTerminate`.
      if (terminator.kind.$ === "UnwindResume") {
        if (!target_supports_unwinding) {
          terminator.kind = TerminatorKind.Unreachable;
        } else if (!body_can_unwind) {
          terminator.kind = { $: "UnwindTerminate", _0: "Abi" };
        }
      }

      if (block.is_cleanup) {
        continue;
      }

      let call_can_unwind: boolean;
      const tk = terminator.kind;
      if (tk.$ === "Call") {
        const func = tk.func;
        const ty = Operand.ty(func, body.local_decls, tcx);
        const sig = ty.fn_sig(tcx);
        let fn_def_id: DefId | undefined;
        const ty_kind = ty.kind();
        switch (ty_kind.$) {
          case "FnPtr":
            fn_def_id = undefined;
            break;
          case "FnDef":
            fn_def_id = ty_kind._0;
            break;
          default:
            return span_bug(span, `invalid callee of type ${debug_Ty(ty, PLAIN)}`);
        }
        call_can_unwind = fn_can_unwind(tcx, fn_def_id, PolyFnSig.abi(sig));
      } else if (tk.$ === "Drop") {
        call_can_unwind = tcx.sess.opts.unstable_opts.panic_in_drop === "Unwind" && fn_can_unwind(tcx, undefined, ExternAbi.Rust);
      } else if (tk.$ === "Assert" || tk.$ === "FalseUnwind") {
        call_can_unwind = fn_can_unwind(tcx, undefined, ExternAbi.Rust);
      } else if (tk.$ === "InlineAsm") {
        const options = tk.options;
        call_can_unwind = InlineAsmOptions.contains(options, InlineAsmOptions.MAY_UNWIND);
      } else if (terminator.unwind() !== undefined) {
        return span_bug(span, `unexpected terminator that may unwind ${debug_Terminator(terminator, PLAIN)}`);
      } else {
        continue;
      }

      if (!call_can_unwind || !target_supports_unwinding) {
        // If this function call can't unwind, or if the target doesn't
        // support unwinding at all, then there's no need for it
        // to have a landing pad. This means that we can remove any cleanup
        // registered for it (and turn it into `UnwindAction::Unreachable`).
        const cleanup = unwrap(block.terminator_mut().unwind_mut());
        cleanup.value = UnwindAction.Unreachable;
      } else if (!body_can_unwind && terminator.unwind()?.$ === "Continue") {
        // Otherwise if this function can unwind, then if the outer function
        // can also unwind there's nothing to do. If the outer function
        // can't unwind, however, we need to ensure that any `UnwindAction::Continue`
        // is replaced with terminate. For those with `UnwindAction::Cleanup`,
        // cleanup will still happen, and terminate will happen afterwards handled by
        // the `UnwindResume` -> `UnwindTerminate` terminator replacement.
        const cleanup = unwrap(block.terminator_mut().unwind_mut());
        cleanup.value = { $: "Terminate", _0: "Abi" };
      }
    }

    // We may have invalidated some `cleanup` blocks so clean those up now.
    remove_dead_blocks(body);
  }

  // rustc: compiler/rustc_mir_transform/src/abort_unwinding_calls.rs:142 policy
  policy(_ctx: PassCtx): PassPolicy {
    // Implements part of MIR semantics, turning effectively implicit aborts into explicit
    // ones.
    return PassPolicy.Required;
  }
}
