// Port of compiler/rustc_lint/src/default_could_be_derived.rs. The lint static and the `declare_lint_pass!` expansion
// are generated (default_could_be_derived.lints.gen.ts).
import { Diag, type DiagCtxtHandle, type Diagnostic, type Level } from "../rustc_errors/lib.ts";
import type * as hir from "../rustc_hir/hir.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { Ty } from "../rustc_middle/ty/mod.ts";
import { type DefId, LocalDefId } from "../rustc_span/def_id.ts";
import { Span } from "../rustc_span/lib.ts";
import { type Symbol, sym } from "../rustc_span/symbol.ts";
import { EarlyBinder } from "../rustc_type_ir/binder.ts";
import { Unnormalized } from "../rustc_type_ir/unnormalized.ts";
import type { LateContext } from "./context.ts";
import { DEFAULT_OVERRIDES_DEFAULT_FIELDS, DefaultCouldBeDerived } from "./default_could_be_derived.lints.gen.ts";
import type { LateLintPass } from "./passes.ts";

export * from "./default_could_be_derived.lints.gen.ts";

declare module "./default_could_be_derived.lints.gen.ts" {
  interface DefaultCouldBeDerived extends LateLintPass {}
}

// impl<'tcx> LateLintPass<'tcx> for DefaultCouldBeDerived
// rustc: compiler/rustc_lint/src/default_could_be_derived.rs:56 check_impl_item
DefaultCouldBeDerived.prototype.check_impl_item = function (this: DefaultCouldBeDerived, cx: LateContext, impl_item: hir.ImplItem): void {
  // Look for manual implementations of `Default`.
  if (impl_item.impl_kind.$ !== "Trait") {
    return;
  }
  const { trait_item_def_id } = impl_item.impl_kind;
  if (!(trait_item_def_id.$ === "Ok" && cx.tcx.is_diagnostic_item(sym.default_fn, trait_item_def_id._0))) {
    return;
  }
  if (impl_item.kind.$ !== "Fn") return;
  const body_id = impl_item.kind._1;
  const impl_id = cx.tcx.local_parent(impl_item.owner_id.def_id);
  if (cx.tcx.is_automatically_derived(LocalDefId.to_def_id(impl_id))) {
    // We don't care about what `#[derive(Default)]` produces in this lint.
    return;
  }
  const ty = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(cx.tcx.type_of(impl_id) as EarlyBinder<Ty>));
  const ty_kind = ty.kind();
  if (ty_kind.$ !== "Adt") return;
  const def = ty_kind._0;

  // We now know we have a manually written definition of a `<Type as Default>::default()`.

  const type_def_id = def.did();
  const body = cx.tcx.hir_body(body_id);

  // FIXME: evaluate bodies with statements and evaluate bindings to see if they would be
  // derivable.
  if (!(body.value.kind.$ === "Block" && body.value.kind._0.expr !== undefined && body.value.kind._1 === undefined)) {
    return;
  }
  const expr = body.value.kind._0.expr;

  // Keep a mapping of field name to `hir::FieldDef` for every field in the type. We'll use
  // these to check for things like checking whether it has a default or using its span for
  // suggestions.
  let orig_fields: Map<Symbol, hir.FieldDef>;
  const node = cx.tcx.hir_get_if_local(type_def_id);
  if (node !== undefined && node.$ === "Item" && node._0.kind.$ === "Struct" && node._0.kind._2.$ === "Struct") {
    const { fields } = node._0.kind._2;
    orig_fields = new Map(fields.map((f): [Symbol, hir.FieldDef] => [f.ident.name, f]));
  } else {
    return;
  }

  // We check `fn default()` body is a single ADT literal and get all the fields that are
  // being set.
  if (expr.kind.$ !== "Struct") return;
  const fields = expr.kind._1;
  const tail = expr.kind._2;

  // We have a struct literal
  //
  // struct Foo {
  //     field: Type,
  // }
  //
  // impl Default for Foo {
  //     fn default() -> Foo {
  //         Foo {
  //             field: val,
  //         }
  //     }
  // }
  //
  // We would suggest `#[derive(Default)]` if `field` has a default value, regardless of what
  // it is; we don't want to encourage divergent behavior between `Default::default()` and
  // `..`.

  if (tail.$ === "Base") {
    // This is *very* niche. We'd only get here if someone wrote
    // impl Default for Ty {
    //     fn default() -> Ty {
    //         Ty { ..something() }
    //     }
    // }
    // where `something()` would have to be a call or path.
    // We have nothing meaningful to do with this.
    return;
  }

  // At least one of the fields with a default value have been overridden in
  // the `Default` implementation. We suggest removing it and relying on `..`
  // instead.
  const any_default_field_given = fields.some((f) => orig_fields.get(f.ident.name)?.default !== undefined);

  if (!any_default_field_given) {
    // None of the default fields were actually provided explicitly, so the manual impl
    // doesn't override them (the user used `..`), so there's no risk of divergent behavior.
    return;
  }

  const hir_id = cx.tcx.local_def_id_to_hir_id(impl_id);
  const span = cx.tcx.hir_span_with_body(hir_id);
  cx.tcx.emit_node_span_lint(
    DEFAULT_OVERRIDES_DEFAULT_FIELDS,
    hir_id,
    span,
    WrongDefaultImpl_diagnostic({ tcx: cx.tcx, type_def_id, orig_fields, fields, impl_span: span }),
  );
};

interface WrongDefaultImpl {
  tcx: TyCtxt;
  type_def_id: DefId;
  orig_fields: Map<Symbol, hir.FieldDef>;
  fields: readonly hir.ExprField[];
  impl_span: Span;
}

// impl<'a, 'b, 'tcx> Diagnostic<'a> for WrongDefaultImpl<'b, 'tcx>
// rustc: compiler/rustc_lint/src/default_could_be_derived.rs:168 into_diag
function WrongDefaultImpl_into_diag(self: WrongDefaultImpl, dcx: DiagCtxtHandle, level: Level): Diag {
  const { tcx, type_def_id, orig_fields, fields, impl_span } = self;
  const diag = Diag.new(dcx, level, "`Default` impl doesn't use the declared default field values");

  // For each field in the struct expression
  //   - if the field in the type has a default value, it should be removed
  //   - elif the field is an expression that could be a default value, it should be used as the
  //     field's default value (FIXME: not done).
  //   - else, we wouldn't touch this field, it would remain in the manual impl
  let removed_all_fields = true;
  for (const field of fields) {
    if (orig_fields.get(field.ident.name)?.default !== undefined) {
      diag.span_label(field.expr.span, "this field has a default value");
    } else {
      removed_all_fields = false;
    }
  }

  if (removed_all_fields) {
    diag.multipart_suggestion(
      "to avoid divergence in behavior between `Struct { .. }` and " + "`<Struct as Default>::default()`, derive the `Default`",
      [
        [Span.shrink_to_lo(tcx.def_span(type_def_id)), "#[derive(Default)] "],
        [impl_span, ""],
      ],
      "MachineApplicable",
    );
  } else {
    diag.help("use the default values in the `impl` with `Struct { mandatory_field, .. }` to " + "avoid them diverging over time");
  }
  return diag;
}

/** `WrongDefaultImpl` as a `Diagnostic` trait object. */
function WrongDefaultImpl_diagnostic(self: WrongDefaultImpl): Diagnostic {
  return { into_diag: (dcx, level) => WrongDefaultImpl_into_diag(self, dcx, level) };
}
