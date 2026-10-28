// Port of compiler/rustc_mir_transform/src/cross_crate_inline.rs (lane mt-inline).
//
// PORT: `providers.cross_crate_inlinable = cross_crate_inlinable` assigns the field of the query provider table (lib.ts
// passes `providers.queries`, as for ffi_unwind_calls.ts).
// PORT: `find_attr!(tcx, def_id, RustcIntrinsic)` is `find_attr(HasAttrs_*.get_attrs(..), ..) !== undefined` (precedent
// check_inline.ts). The query values typed `unknown` by queries.gen.ts (`codegen_fn_attrs`, `constness`, `fn_sig`) are
// cast to their upstream types.
// PORT: the local `CostChecker` `extends Visitor` (mir/visit.ts, D4); its `tcx` field is `tcx_`.
// PORT: `crate::inline` is ./inline.ts, reached through a lazy `require` (inline.ts imports cost_checker.ts and the pass
// modules; this module is imported by lib.ts only, but the lazy form keeps every pass module free of load-time cycles).
import { find_attr } from "../rustc_attr_ir/lib.ts";
import type { Constness } from "../rustc_hir/hir.ts";
import type { CodegenFnAttrs } from "../rustc_middle/middle/codegen_fn_attrs.ts";
import { CodegenFnAttrs as CodegenFnAttrs_ } from "../rustc_middle/middle/codegen_fn_attrs.ts";
import { type Body, debug_TerminatorKind, type Location, Operand, type Statement, type Terminator } from "../rustc_middle/mir/mod.ts";
import { Visitor } from "../rustc_middle/mir/visit.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { HasAttrs_DefId, HasAttrs_LocalDefId } from "../rustc_middle/ty/mod.ts";
import type { Providers } from "../rustc_middle/util/mod.ts";
import { LocalDefId } from "../rustc_span/def_id.ts";
import { bug } from "../rustc_span/macros.ts";
import type { InliningThreshold } from "../rustc_session/config.ts";
import { sym } from "../rustc_span/symbol.ts";
import { type Binder, EarlyBinder } from "../rustc_type_ir/binder.ts";
import { type FnSig, PolyFnSig } from "../rustc_type_ir/ty_kind.ts";
import { Unnormalized } from "../rustc_type_ir/unnormalized.ts";
import { format_debug, PLAIN } from "../std/fmt.ts";
import { PassCtx, should_run_pass } from "./pass_manager.ts";

/** PORT: `crate::inline` (see the header). */
function inline_(): typeof import("./inline.ts") {
  return require("./inline.ts") as typeof import("./inline.ts");
}

// rustc: compiler/rustc_mir_transform/src/cross_crate_inline.rs:14 provide
export function provide(providers: Providers["queries"]): void {
  providers.cross_crate_inlinable = cross_crate_inlinable;
}

// rustc: compiler/rustc_mir_transform/src/cross_crate_inline.rs:18 cross_crate_inlinable
function cross_crate_inlinable(tcx: TyCtxt, def_id: LocalDefId): boolean {
  const codegen_fn_attrs = tcx.codegen_fn_attrs(def_id) as CodegenFnAttrs;
  // If this has an extern indicator, then this function is globally shared and thus will not
  // generate cgu-internal copies which would make it cross-crate inlinable.
  if (CodegenFnAttrs_.contains_extern_indicator(codegen_fn_attrs)) {
    return false;
  }

  // This just reproduces the logic from Instance::requires_inline.
  switch (tcx.def_kind(def_id).$) {
    case "Ctor":
    case "Closure":
    case "SyntheticCoroutineBody":
      return true;
    case "Fn":
    case "AssocFn":
      break;
    default:
      return false;
  }

  // From this point on, it is valid to return true or false.
  if (tcx.sess.opts.unstable_opts.cross_crate_inline_threshold.$ === "Always") {
    return true;
  }

  if (find_attr(HasAttrs_LocalDefId.get_attrs(def_id, tcx), (k) => (k.$ === "RustcIntrinsic" ? true : undefined)) !== undefined) {
    // Intrinsic fallback bodies are always cross-crate inlineable.
    // To ensure that the MIR inliner doesn't cluelessly try to inline fallback
    // bodies even when the backend would implement something better, we stop
    // the MIR inliner from ever inlining an intrinsic.
    return true;
  }

  const constness = tcx.constness(def_id) as Constness;
  if (constness.$ === "Const" && constness.always === true) {
    // Comptime functions only exist during const eval and can never be passed
    // to codegen. The const eval MIR pipeline also doesn't inline anything at all.
    return false;
  }

  // Obey source annotations first; this is important because it means we can use
  // #[inline(never)] to force code generation.
  switch (codegen_fn_attrs.inline.$) {
    case "Never":
      return false;
    case "Hint":
    case "Always":
    case "Force":
      return true;
    default:
      break;
  }

  // If the crate is likely to be mostly unused, use cross-crate inlining to defer codegen until
  // the function is referenced, in order to skip codegen for unused functions. This is
  // intentionally after the check for `inline(never)`, so that `inline(never)` wins.
  if (tcx.sess.opts.unstable_opts.hint_mostly_unused) {
    return true;
  }

  const reliable_f16 = tcx.sess.config.contains([sym.target_has_reliable_f16, undefined]);
  const reliable_f128 = tcx.sess.config.contains([sym.target_has_reliable_f128, undefined]);
  if (!reliable_f16 || !reliable_f128) {
    const sig = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.fn_sig(def_id) as EarlyBinder<Binder<FnSig>>));
    for (const ty of [...PolyFnSig.inputs(sig).value, PolyFnSig.output(sig).value]) {
      // FIXME(f16,f128): in order to avoid crashes building `core`, inline on targets that
      // have issues to skip codegen if the function is not used.
      if ((!reliable_f16 && ty === tcx.types.f16) || (!reliable_f128 && ty === tcx.types.f128)) {
        return true;
      }
    }
  }

  // Don't do any inference when incremental compilation is enabled; the additional inlining that
  // inference permits also creates more work for small edits.
  if (tcx.sess.opts.incremental !== undefined) {
    return false;
  }

  // Don't do any inference if codegen optimizations are disabled and also MIR inlining is not
  // enabled. This ensures that we do inference even if someone only passes -Zinline-mir,
  // which is less confusing than having to also enable -Copt-level=1.
  const inline = inline_();
  const inliner_will_run =
    should_run_pass(new inline.Inline(), PassCtx.for_body(tcx, LocalDefId.to_def_id(def_id))) ||
    inline.ForceInline.should_run_pass_for_callee(tcx, LocalDefId.to_def_id(def_id));
  if (tcx.sess.opts.optimize === "No" && !inliner_will_run) {
    return false;
  }

  if (!tcx.is_mir_available(def_id)) {
    return false;
  }

  let threshold: number;
  // PORT: re-read of the option; the cast undoes TS's narrowing from the `Always` check above.
  const t = tcx.sess.opts.unstable_opts.cross_crate_inline_threshold as InliningThreshold;
  switch (t.$) {
    case "Always":
      return true;
    case "Sometimes":
      threshold = t._0;
      break;
    case "Never":
      return false;
  }

  const mir = tcx.optimized_mir(def_id);
  const checker = new CostChecker(tcx, mir, 0, 0, 0, 0);
  checker.visit_body(mir);
  return checker.calls === 0 && checker.resumes === 0 && checker.landing_pads === 0 && checker.statements <= threshold;
}

// The threshold that CostChecker computes is balancing the desire to make more things
// inlinable cross crates against the growth in incremental CGU size that happens when too many
// things in the sysroot are made inlinable.
// Permitting calls causes the size of some incremental CGUs to grow, because more functions are
// made inlinable out of the sysroot or dependencies.
// Assert terminators are similar to calls, but do not have the same impact on compile time, so
// those are just treated as statements.
// A threshold exists at all because we don't want to blindly mark a huge function as inlinable.

// rustc-type: compiler/rustc_mir_transform/src/cross_crate_inline.rs:128 CostChecker
class CostChecker extends Visitor {
  constructor(
    public tcx_: TyCtxt,
    public callee_body: Body,
    public calls: number,
    public statements: number,
    public landing_pads: number,
    public resumes: number,
  ) {
    super();
  }

  // impl<'tcx> Visitor<'tcx> for CostChecker<'_, 'tcx>

  // rustc: compiler/rustc_mir_transform/src/cross_crate_inline.rs:138 visit_statement
  override visit_statement(statement: Statement, _: Location): void {
    // Don't count StorageLive/StorageDead in the inlining cost.
    switch (statement.kind.$) {
      case "StorageLive":
      case "StorageDead":
      case "Nop":
        break;
      default:
        this.statements += 1;
    }
  }

  // rustc: compiler/rustc_mir_transform/src/cross_crate_inline.rs:146 visit_terminator
  override visit_terminator(terminator: Terminator, _: Location): void {
    this.statements += 1;
    const tcx = this.tcx_;
    const kind = terminator.kind;
    switch (kind.$) {
      case "Drop": {
        const { place, unwind } = kind;
        const ty = place.ty(this.callee_body, tcx).ty;
        if (!ty.is_trivially_pure_clone_copy()) {
          this.calls += 1;
          if (unwind.$ === "Cleanup") {
            this.landing_pads += 1;
          }
        }
        break;
      }
      case "Call": {
        const { func, unwind } = kind;
        // We track calls because they make our function not a leaf (and in theory, the
        // number of calls indicates how likely this function is to perturb other CGUs).
        // But there are a handful of intrinsics such as raw_eq that should not block
        // cross-crate-inlining. Adding a broad exception for all intrinsics benchmarks well
        // and seems more sustainable than an ever-growing list of intrinsics to ignore.
        const def = Operand.const_fn_def(func);
        if (
          def !== undefined &&
          find_attr(HasAttrs_DefId.get_attrs(def[0], tcx), (k) => (k.$ === "RustcIntrinsic" ? true : undefined)) !== undefined
        ) {
          return;
        }
        this.calls += 1;
        if (unwind.$ === "Cleanup") {
          this.landing_pads += 1;
        }
        break;
      }
      case "TailCall": {
        this.calls += 1;
        break;
      }
      case "Assert": {
        const { unwind } = kind;
        if (unwind.$ === "Cleanup") {
          this.landing_pads += 1;
        }
        break;
      }
      case "UnwindResume":
        this.resumes += 1;
        break;
      case "InlineAsm": {
        const { unwind } = kind;
        if (unwind.$ === "Cleanup") {
          this.landing_pads += 1;
        }
        break;
      }
      case "Return":
      case "Goto":
      case "SwitchInt":
      case "Unreachable":
      case "UnwindTerminate":
        break;
      case "FalseUnwind":
      case "FalseEdge":
      case "Yield":
      case "CoroutineDrop": {
        bug(`${format_debug(kind, debug_TerminatorKind, PLAIN)} should not be in runtime MIR`);
      }
    }
  }
}
