// Port of compiler/rustc_mir_transform/src/check_const_item_mutation.rs (lane mt-built-lints).
//
// PORT: `ConstMutationChecker` is a class extending rustc_middle mir/visit.ts's `Visitor` (D4).
import type { HirId } from "../rustc_hir_id/lib.ts";
import { CONST_ITEM_MUTATION } from "../rustc_lint_defs/builtin.ts";
import {
  type Body,
  ClearCrossCrate,
  find_self_call,
  type Local,
  type Location,
  type Place,
  type Rvalue,
  type Statement,
} from "../rustc_middle/mir/mod.ts";
import { Visitor } from "../rustc_middle/mir/visit.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { type Ty, TypingEnv } from "../rustc_middle/ty/mod.ts";
import { fold_Ty } from "../rustc_middle/ty/structural_impls.ts";
import type { DefId } from "../rustc_span/def_id.ts";
import type { Span } from "../rustc_span/lib.ts";
import { EarlyBinder } from "../rustc_type_ir/binder.ts";
import { Unnormalized } from "../rustc_type_ir/unnormalized.ts";
import { TypeVisitableExt } from "../rustc_type_ir/visit.ts";
import * as diagnostics from "./diagnostics.ts";
import { MirLint } from "./pass_manager.ts";

// rustc-type: compiler/rustc_mir_transform/src/check_const_item_mutation.rs:11 CheckConstItemMutation
export class CheckConstItemMutation extends MirLint {
  readonly type_name = "rustc_mir_transform::check_const_item_mutation::CheckConstItemMutation";

  // impl<'tcx> crate::MirLint<'tcx> for CheckConstItemMutation
  // rustc: compiler/rustc_mir_transform/src/check_const_item_mutation.rs:14 run_lint
  run_lint(tcx: TyCtxt, body: Body): void {
    const checker = new ConstMutationChecker(body, tcx, undefined);
    checker.visit_body(body);
  }
}

// rustc-type: compiler/rustc_mir_transform/src/check_const_item_mutation.rs:20 ConstMutationChecker
class ConstMutationChecker extends Visitor {
  constructor(
    public body: Body,
    public tcx: TyCtxt,
    public target_local: Local | undefined,
  ) {
    super();
  }

  // rustc: compiler/rustc_mir_transform/src/check_const_item_mutation.rs:27 is_const_item
  is_const_item(local: Local): DefId | undefined {
    const info = this.body.local_decls[local]!.local_info_();
    if (info.$ === "ConstRef") {
      return info.def_id;
    } else {
      return undefined;
    }
  }

  // rustc: compiler/rustc_mir_transform/src/check_const_item_mutation.rs:35 is_const_item_without_destructor
  is_const_item_without_destructor(local: Local): DefId | undefined {
    const def_id = this.is_const_item(local);
    if (def_id === undefined) return undefined;

    // We avoid linting mutation of a const item if the const's type needs
    // drop. Any drop logic (including that of fields) may observe the
    // mutation which was performed.
    //
    //     pub struct Log { msg: &'static str }
    //     pub const LOG: Log = Log { msg: "" };
    //     impl Drop for Log {
    //         fn drop(&mut self) { println!("{}", self.msg); }
    //     }
    //
    //     LOG.msg = "wow";  // prints "wow"
    //
    // Likewise, if a field of the const type has its own Drop impl, that
    // drop logic may also observe the mutation:
    //
    //     struct Inner { val: u32 }
    //     impl Drop for Inner { fn drop(&mut self) { println!("{}", self.val); } }
    //     struct Outer { inner: Inner }
    //     const O: Outer = Outer { inner: Inner { val: 0 } };
    //
    //     O.inner.val = 42;  // Inner::drop prints "42"
    //
    // FIXME(https://github.com/rust-lang/rust/issues/77425):
    // Drop this exception once there is a stable attribute to suppress the
    // const item mutation lint for a single specific const only.
    // PORT: the `type_of` query value is `unknown` in queries.gen.ts.
    const ty = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(this.tcx.type_of(def_id) as EarlyBinder<Ty>));
    // `needs_drop` is overly conservative for types that contain type
    // parameters (e.g. `Self` in a trait associated const): it always
    // returns `true` because the parameter *might* implement Drop, even
    // when the concrete type at the call site does not. In that case we
    // cannot suppress the lint, so fall through and warn.
    if (TypeVisitableExt.has_param(ty, fold_Ty)) {
      return def_id;
    }
    const typing_env = TypingEnv.non_body_analysis(this.tcx, def_id);
    if (ty.needs_drop(this.tcx, typing_env)) {
      return undefined;
    } else {
      return def_id;
    }
  }

  /// If we should lint on this usage, return the [`HirId`], source [`Span`]
  /// and [`Span`] of the const item to use in the lint.
  // rustc: compiler/rustc_mir_transform/src/check_const_item_mutation.rs:78 should_lint_const_item_usage
  should_lint_const_item_usage(place: Place, const_item: DefId, location: Location): [HirId, Span, Span] | undefined {
    // Don't lint on borrowing/assigning when a dereference is involved.
    // If we 'leave' the temporary via a dereference, we must
    // be modifying something else
    //
    // `unsafe { *FOO = 0; *BAR.field = 1; }`
    // `unsafe { &mut *FOO }`
    // `unsafe { (*ARRAY)[0] = val; }`
    if (!place.projection.some((p) => p.$ === "Deref")) {
      const source_info = this.body.source_info(location);
      const lint_root = ClearCrossCrate.unwrap_crate_local(
        ClearCrossCrate.as_ref(this.body.source_scopes[source_info.scope]!.local_data),
      ).lint_root;

      return [lint_root, source_info.span, this.tcx.def_span(const_item)];
    } else {
      return undefined;
    }
  }

  // impl<'tcx> Visitor<'tcx> for ConstMutationChecker<'_, 'tcx>
  // rustc: compiler/rustc_mir_transform/src/check_const_item_mutation.rs:107 visit_statement
  override visit_statement(stmt: Statement, loc: Location): void {
    if (stmt.kind.$ === "Assign") {
      const lhs = stmt.kind._0[0];
      // Check for assignment to fields of a constant
      // Assigning directly to a constant (e.g. `FOO = true;`) is a hard error,
      // so emitting a lint would be redundant.
      if (lhs.projection.length !== 0) {
        const def_id = this.is_const_item_without_destructor(lhs.local);
        if (def_id !== undefined) {
          const found = this.should_lint_const_item_usage(lhs, def_id, loc);
          if (found !== undefined) {
            const [lint_root, span, item] = found;
            this.tcx.emit_node_span_lint(
              CONST_ITEM_MUTATION,
              lint_root,
              span,
              diagnostics.ConstMutate_diagnostic({ $: "Modify", konst: item }),
            );
          }
        }
      }

      // We are looking for MIR of the form:
      //
      // ```
      // _1 = const FOO;
      // _2 = &mut _1;
      // method_call(_2, ..)
      // ```
      //
      // Record our current LHS, so that we can detect this
      // pattern in `visit_rvalue`
      this.target_local = lhs.as_local();
    }
    this.super_statement(stmt, loc);
    this.target_local = undefined;
  }

  // rustc: compiler/rustc_mir_transform/src/check_const_item_mutation.rs:141 visit_rvalue
  override visit_rvalue(rvalue: Rvalue, loc: Location): void {
    if (rvalue.$ === "Ref" && rvalue._1.$ === "Mut") {
      const place = rvalue._2;
      const local = place.local;
      const def_id = this.is_const_item(local);
      if (def_id !== undefined) {
        // If this Rvalue is being used as the right-hand side of a
        // `StatementKind::Assign`, see if it ends up getting used as
        // the `self` parameter of a method call (as the terminator of our current
        // BasicBlock). If so, we emit a more specific lint.
        const method_did =
          this.target_local === undefined ? undefined : find_self_call(this.tcx, this.body, this.target_local, loc.block);
        const lint_loc = method_did !== undefined ? this.body.terminator_loc(loc.block) : loc;

        let method_call: Span | undefined;
        if (method_did !== undefined) {
          const [method_did_, _] = method_did;
          method_call = this.tcx.def_span(method_did_);
        } else {
          method_call = undefined;
        }
        const found = this.should_lint_const_item_usage(place, def_id, lint_loc);
        if (found !== undefined) {
          const [lint_root, span, item] = found;
          this.tcx.emit_node_span_lint(
            CONST_ITEM_MUTATION,
            lint_root,
            span,
            diagnostics.ConstMutate_diagnostic({ $: "MutBorrow", method_call, konst: item }),
          );
        }
      }
    }
    this.super_rvalue(rvalue, loc);
  }
}
