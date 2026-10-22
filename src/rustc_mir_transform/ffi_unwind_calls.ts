// Port of compiler/rustc_mir_transform/src/ffi_unwind_calls.rs (lane mt-built-lints).
//
// PORT: `*providers = Providers { has_ffi_unwind_calls, required_panic_strategy, ..*providers }` assigns the two
// fields of the query provider table (lib.ts passes `providers.queries`). `&*tcx.mir_built(..).borrow()` is the
// `Steal`'s value.
import { ExternAbi } from "../rustc_abi/extern_abi.ts";
import { InlineAsmOptions } from "../rustc_ast/lib.ts";
import { DefKind } from "../rustc_hir/def.ts";
import { FFI_UNWIND_CALLS } from "../rustc_lint_defs/builtin.ts";
import { type Body, ClearCrossCrate, Operand } from "../rustc_middle/mir/mod.ts";
import type { LocalCrate } from "../rustc_middle/query/keys.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { fn_can_unwind } from "../rustc_middle/ty/layout.ts";
import type { Ty } from "../rustc_middle/ty/mod.ts";
import { debug_Ty } from "../rustc_middle/ty/structural_impls.ts";
import type { Providers } from "../rustc_middle/util/mod.ts";
import { type DefId, LOCAL_CRATE, LocalDefId } from "../rustc_span/def_id.ts";
import { bug, span_bug } from "../rustc_span/macros.ts";
import type { PanicStrategy } from "../rustc_target/spec/mod.ts";
import { EarlyBinder } from "../rustc_type_ir/binder.ts";
import { PolyFnSig } from "../rustc_type_ir/ty_kind.ts";
import { PLAIN } from "../std/fmt.ts";
import * as diagnostics from "./diagnostics.ts";


// Check if the body of this def_id can possibly leak a foreign unwind into Rust code.
// rustc: compiler/rustc_mir_transform/src/ffi_unwind_calls.rs:15 has_ffi_unwind_calls
function has_ffi_unwind_calls(tcx: TyCtxt, local_def_id: LocalDefId): boolean {
  // debug!("has_ffi_unwind_calls({local_def_id:?})");

  // Only perform check on functions because constants cannot call FFI functions.
  const def_id = LocalDefId.to_def_id(local_def_id);
  const kind = tcx.def_kind(def_id);
  if (!DefKind.is_fn_like(kind)) {
    return false;
  }

  const body: Body = tcx.mir_built(local_def_id).borrow();

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
      return false;
    default:
      return span_bug(body.span, `unexpected body ty: ${debug_Ty(body_ty, PLAIN)}`);
  }
  const body_can_unwind = fn_can_unwind(tcx, def_id, body_abi);

  // Foreign unwinds cannot leak past functions that themselves cannot unwind.
  if (!body_can_unwind) {
    return false;
  }

  let tainted = false;

  for (const block of body.basic_blocks.deref()) {
    if (block.is_cleanup) {
      continue;
    }
    if (block.terminator === undefined) continue;
    const terminator = block.terminator;

    if (terminator.kind.$ === "InlineAsm") {
      const options = terminator.kind.options;
      if (InlineAsmOptions.contains(options, InlineAsmOptions.MAY_UNWIND)) {
        // We have detected an inline asm block that can possibly leak foreign unwind.
        //
        // Because the function body itself can unwind, we are not aborting this function call
        // upon unwind, so this call can possibly leak foreign unwind into Rust code if the
        // panic runtime linked is panic-abort.

        const lint_root = ClearCrossCrate.unwrap_crate_local(
          ClearCrossCrate.as_ref(body.source_scopes[terminator.source_info.scope]!.local_data),
        ).lint_root;
        const span = terminator.source_info.span;

        tcx.emit_node_span_lint(FFI_UNWIND_CALLS, lint_root, span, diagnostics.AsmUnwindCall_diagnostic({ span }));

        tainted = true;
      }
      continue;
    }

    if (terminator.kind.$ !== "Call") continue;
    const func = terminator.kind.func;

    const ty = Operand.ty(func, body, tcx);
    const sig = ty.fn_sig(tcx);

    // Rust calls cannot themselves create foreign unwinds.
    // We assume this is true for intrinsics as well.
    if (ExternAbi.is_rustic_abi(PolyFnSig.abi(sig))) {
      continue;
    }

    let fn_def_id: DefId | undefined;
    const ty_kind = ty.kind();
    switch (ty_kind.$) {
      case "FnPtr":
        fn_def_id = undefined;
        break;
      case "FnDef": {
        const def_id = ty_kind._0;
        // Rust calls cannot themselves create foreign unwinds (even if they use a non-Rust
        // ABI). So the leak of the foreign unwind into Rust can only be elsewhere, not
        // here.
        if (!tcx.is_foreign_item(def_id)) {
          continue;
        }
        fn_def_id = def_id;
        break;
      }
      default:
        return bug(`invalid callee of type ${debug_Ty(ty, PLAIN)}`);
    }

    if (fn_can_unwind(tcx, fn_def_id, PolyFnSig.abi(sig))) {
      // We have detected a call that can possibly leak foreign unwind.
      //
      // Because the function body itself can unwind, we are not aborting this function call
      // upon unwind, so this call can possibly leak foreign unwind into Rust code if the
      // panic runtime linked is panic-abort.

      const lint_root = ClearCrossCrate.unwrap_crate_local(
        ClearCrossCrate.as_ref(body.source_scopes[terminator.source_info.scope]!.local_data),
      ).lint_root;
      const span = terminator.source_info.span;

      const foreign = fn_def_id !== undefined;
      tcx.emit_node_span_lint(FFI_UNWIND_CALLS, lint_root, span, diagnostics.FfiUnwindCall_diagnostic({ span, foreign }));

      tainted = true;
    }
  }

  return tainted;
}

// rustc: compiler/rustc_mir_transform/src/ffi_unwind_calls.rs:132 required_panic_strategy
function required_panic_strategy(tcx: TyCtxt, _: LocalCrate): PanicStrategy | undefined {
  const local_strategy = tcx.sess.panic_strategy();

  if (tcx.is_panic_runtime(LOCAL_CRATE)) {
    return local_strategy;
  }

  switch (local_strategy) {
    case "Abort":
    case "ImmediateAbort":
      return local_strategy;
    default:
      break;
  }

  for (const def_id of tcx.hir_body_owners()) {
    if (tcx.has_ffi_unwind_calls(def_id)) {
      // Given that this crate is compiled in `-C panic=unwind`, the `AbortUnwindingCalls`
      // MIR pass will not be run on FFI-unwind call sites, therefore a foreign exception
      // can enter Rust through these sites.
      //
      // On the other hand, crates compiled with `-C panic=abort` expects that all Rust
      // functions cannot unwind (whether it's caused by Rust panic or foreign exception),
      // and this expectation mismatch can cause unsoundness (#96926).
      //
      // To address this issue, we enforce that if FFI-unwind calls are used in a crate
      // compiled with `panic=unwind`, then the final panic strategy must be `panic=unwind`.
      // This will ensure that no crates will have wrong unwindability assumption.
      //
      // It should be noted that it is okay to link `panic=unwind` into a `panic=abort`
      // program if it contains no FFI-unwind calls. In such case foreign exception can only
      // enter Rust in a `panic=abort` crate, which will lead to an abort. There will also
      // be no exceptions generated from Rust, so the assumption which `panic=abort` crates
      // make, that no Rust function can unwind, indeed holds for crates compiled with
      // `panic=unwind` as well. In such case this function returns `None`, indicating that
      // the crate does not require a particular final panic strategy, and can be freely
      // linked to crates with either strategy (we need such ability for libstd and its
      // dependencies).
      return "Unwind";
    }
  }

  // This crate can be linked with either runtime.
  return undefined;
}

// rustc: compiler/rustc_mir_transform/src/ffi_unwind_calls.rs:175 provide
export function provide(providers: Providers["queries"]): void {
  providers.has_ffi_unwind_calls = has_ffi_unwind_calls;
  providers.required_panic_strategy = required_panic_strategy;
}
