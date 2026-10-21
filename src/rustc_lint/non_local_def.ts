// Port of compiler/rustc_lint/src/non_local_def.rs. The lint static and the `impl_lint_pass!` expansion are generated
// (non_local_def.lints.gen.ts).
import { find_attr } from "../rustc_attr_ir/lib.ts";
import { msg } from "../rustc_errors/lib.ts";
import { MultiSpan } from "../rustc_error_messages/lib.ts";
import type { Res } from "../rustc_hir/def.ts";
import { Res as ResC } from "../rustc_hir/def.ts";
import { Visitor, walk_path } from "../rustc_hir/intravisit.ts";
import type * as hir from "../rustc_hir/lib.ts";
import type { HirId } from "../rustc_hir_id/lib.ts";
import type { LintPass, LintVec } from "../rustc_lint_defs/lib.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { HasAttrs_LocalDefId } from "../rustc_middle/ty/mod.ts";
import { was_invoked_from_cargo } from "../rustc_session/utils.ts";
import { type DefId, DefId_eq, LOCAL_CRATE, LocalDefId } from "../rustc_span/def_id.ts";
import { MacroKind, SyntaxContext } from "../rustc_span/hygiene.ts";
import { Span } from "../rustc_span/lib.ts";
import { display_Ident, Symbol, kw } from "../rustc_span/symbol.ts";
import type { LateContext } from "./context.ts";
import type { NonLocalDefinitionsCargoUpdateNote } from "./diagnostics.gen.ts";
import { NonLocalDefinitionsDiag_diagnostic } from "./diagnostics.ts";
import { NON_LOCAL_DEFINITIONS, NonLocalDefinitions_impl_lint_pass } from "./non_local_def.lints.gen.ts";
import type { LateLintPass } from "./passes.ts";

export * from "./non_local_def.lints.gen.ts";

// #[derive(Default)]
// pub(crate) struct NonLocalDefinitions
export class NonLocalDefinitions implements LintPass, LateLintPass {
  constructor(public body_depth: number) {}

  /** `#[derive(Default)]` */
  static default(): NonLocalDefinitions {
    return new NonLocalDefinitions(0);
  }

  name(): string {
    return NonLocalDefinitions_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return NonLocalDefinitions_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return NonLocalDefinitions_impl_lint_pass.lint_vec();
  }

  // FIXME(Urgau): Figure out how to handle modules nested in bodies.
  // It's currently not handled by the current logic because modules are not bodies.
  // They don't even follow the correct order (check_body -> check_mod -> check_body_post)
  // instead check_mod is called after every body has been handled.

  // impl<'tcx> LateLintPass<'tcx> for NonLocalDefinitions
  // rustc: compiler/rustc_lint/src/non_local_def.rs:62 check_body
  check_body(_cx: LateContext, _body: hir.Body): void {
    this.body_depth += 1;
  }

  // rustc: compiler/rustc_lint/src/non_local_def.rs:66 check_body_post
  check_body_post(_cx: LateContext, _body: hir.Body): void {
    this.body_depth -= 1;
  }

  // rustc: compiler/rustc_lint/src/non_local_def.rs:70 check_item
  check_item(cx: LateContext, item: hir.Item): void {
    if (this.body_depth === 0) {
      return;
    }

    const def_id = LocalDefId.to_def_id(item.owner_id.def_id);
    const parent = cx.tcx.parent(def_id);
    const parent_def_kind = cx.tcx.def_kind(parent);
    const parent_opt_item_name = cx.tcx.opt_item_name(parent);

    // Per RFC we (currently) ignore anon-const (`const _: Ty = ...`) in top-level module.
    if (this.body_depth === 1 && parent_def_kind.$ === "Const" && parent_opt_item_name === kw.Underscore) {
      return;
    }

    const cargo_update = (): NonLocalDefinitionsCargoUpdateNote | undefined => {
      const oexpn = SyntaxContext.outer_expn_data(Span.ctxt(item.span));
      const def_id = oexpn.macro_def_id;
      if (def_id !== undefined && oexpn.kind.$ === "Macro" && def_id.krate !== LOCAL_CRATE && was_invoked_from_cargo()) {
        const [macro_kind, macro_name] = [oexpn.kind._0, oexpn.kind._1];
        return {
          macro_kind: MacroKind.descr(macro_kind),
          macro_name,
          crate_name: cx.tcx.crate_name(def_id.krate),
        };
      } else {
        return undefined;
      }
    };

    // determining if we are in a doctest context can't currently be determined
    // by the code itself (there are no specific attributes), but fortunately rustdoc
    // sets a perma-unstable env var for libtest so we just reuse that for now
    const is_at_toplevel_doctest = (): boolean => {
      return this.body_depth === 2 && cx.tcx.env_var_os("UNSTABLE_RUSTDOC_TEST_PATH") !== undefined;
    };

    const k = item.kind;
    if (k.$ === "Impl") {
      const impl_ = k._0;
      // The RFC states:
      //
      // > An item nested inside an expression-containing item (through any
      // > level of nesting) may not define an impl Trait for Type unless
      // > either the **Trait** or the **Type** is also nested inside the
      // > same expression-containing item.
      //
      // To achieve this we get try to get the paths of the _Trait_ and
      // _Type_, and we look inside those paths to try a find in one
      // of them a type whose parent is the same as the impl definition.
      //
      // If that's the case this means that this impl block declaration
      // is using local items and so we don't lint on it.

      // 1. We collect all the `hir::Path` from the `Self` type and `Trait` ref
      // of the `impl` definition
      const collector = new PathCollector([]);
      collector.visit_ty_unambig(impl_.self_ty);
      if (impl_.of_trait !== undefined) {
        const of_trait = impl_.of_trait;
        collector.visit_trait_ref(of_trait.trait_ref);
      }

      // 1.5. Remove any path that doesn't resolve to a `DefId` or if it resolve to a
      // type-param (e.g. `T`).
      collector.paths = collector.paths.filter((p) => p.res.$ === "Def" && p.res._0.$ !== "TyParam");

      // 1.9. We retrieve the parent def id of the impl item, ...
      //
      // ... modulo const-anons items, for enhanced compatibility with the ecosystem
      // as that pattern is common with `serde`, `bevy`, ...
      //
      // For this example we want the `DefId` parent of the outermost const-anon items.
      // ```
      // const _: () = { // the parent of this const-anon
      //     const _: () = {
      //         impl Foo {}
      //     };
      // };
      // ```
      //
      // It isn't possible to mix a impl in a module with const-anon, but an item can
      // be put inside a module and referenced by a impl so we also have to treat the
      // item parent as transparent to module and for consistency we have to do the same
      // for impl, otherwise the item-def and impl-def won't have the same parent.
      const outermost_impl_parent = peel_parent_while(cx.tcx, parent, (tcx, did) => {
        return (
          tcx.def_kind(did).$ === "Mod" || (tcx.def_kind(did).$ === "Const" && tcx.opt_item_name(did) === kw.Underscore)
        );
      });

      // 2. We check if any of the paths reference a the `impl`-parent.
      //
      // If that the case we bail out, as was asked by T-lang, even though this isn't
      // correct from a type-system point of view, as inference exists and one-impl-rule
      // make its so that we could still leak the impl.
      if (collector.paths.some((path) => path_has_local_parent(path, cx, parent, outermost_impl_parent))) {
        return;
      }

      // Get the span of the parent const item ident (if it's a not a const anon).
      //
      // Used to suggest changing the const item to a const anon.
      let span_for_const_anon_suggestion: Span | undefined = undefined;
      let parent_local: LocalDefId | undefined;
      let node: hir.Node;
      if (
        parent_def_kind.$ === "Const" &&
        parent_opt_item_name !== kw.Underscore &&
        (parent_local = parent.as_local()) !== undefined &&
        (node = cx.tcx.hir_node_by_def_id(parent_local)).$ === "Item" &&
        node._0.kind.$ === "Const" &&
        node._0.kind._2.kind.$ === "Tup" &&
        node._0.kind._2.kind._0.length === 0
      ) {
        span_for_const_anon_suggestion = node._0.kind._0.span;
      }

      // PORT: `bool::then_some(Option<Span>)` is an `Option<Option<Span>>` (`{ $: "Some", _0 }`, PORTING §5).
      const const_anon =
        parent_def_kind.$ === "Const" || parent_def_kind.$ === "Static"
          ? { $: "Some" as const, _0: span_for_const_anon_suggestion }
          : undefined;

      const impl_span = Span.to(Span.shrink_to_lo(item.span), impl_.self_ty.span);
      const ms = MultiSpan.from_span(impl_span);

      for (const path of collector.paths) {
        ms.push_span_label(path_span_without_args(path), `\`${path_name_to_string(path)}\` is not local`);
      }

      const doctest = is_at_toplevel_doctest();

      if (!doctest) {
        ms.push_span_label(
          cx.tcx.def_span(parent),
          msg(
            `move the \`impl\` block outside of this {$body_kind_descr} {$depth ->
                                [one] \`{$body_name}\`
                                *[other] \`{$body_name}\` and up {$depth} bodies
                            }`,
          ),
        );
      }

      const ok = SyntaxContext.outer_expn_data(Span.ctxt(item.span)).kind;
      const macro_to_change: [string, string] | undefined =
        ok.$ === "Macro" ? [Symbol.as_str(ok._1), MacroKind.descr(ok._0)] : undefined;

      cx.emit_span_lint(
        NON_LOCAL_DEFINITIONS,
        ms,
        NonLocalDefinitionsDiag_diagnostic({
          $: "Impl",
          depth: this.body_depth,
          body_kind_descr: cx.tcx.def_kind_descr(parent_def_kind, parent),
          body_name: parent_opt_item_name !== undefined ? Symbol.to_ident_string(parent_opt_item_name) : "<unnameable>",
          cargo_update: cargo_update(),
          const_anon,
          doctest,
          macro_to_change,
        }),
      );
    } else if (
      k.$ === "Macro" &&
      find_attr(HasAttrs_LocalDefId.get_attrs(item.owner_id.def_id, cx.tcx), (a) => (a.$ === "MacroExport" ? null : undefined)) !== undefined
    ) {
      cx.emit_span_lint(
        NON_LOCAL_DEFINITIONS,
        item.span,
        NonLocalDefinitionsDiag_diagnostic({
          $: "MacroRules",
          depth: this.body_depth,
          body_kind_descr: cx.tcx.def_kind_descr(parent_def_kind, parent),
          body_name: parent_opt_item_name !== undefined ? Symbol.to_ident_string(parent_opt_item_name) : "<unnameable>",
          cargo_update: cargo_update(),
          doctest: is_at_toplevel_doctest(),
        }),
      );
    } else {
    }
  }
}

/// Simple hir::Path collector
class PathCollector extends Visitor {
  constructor(public paths: hir.Path[]) {
    super();
  }

  // impl<'tcx> Visitor<'tcx> for PathCollector<'tcx>
  // rustc: compiler/rustc_lint/src/non_local_def.rs:273 visit_path
  override visit_path(path: hir.Path, _id: HirId): undefined {
    // PORT: `path.clone()` (for the borrow's lifetime) is the node itself: HIR paths are never mutated.
    this.paths.push(path); // need to clone, bc of the restricted lifetime
    return walk_path(this, path);
  }
}

/// Given a path, this checks if the if the parent resolution def id corresponds to
/// the def id of the parent impl definition (the direct one and the outermost one).
///
/// Given this path, we will look at the path (and ignore any generic args):
///
/// ```text
///    std::convert::PartialEq<Foo<Bar>>
///    ^^^^^^^^^^^^^^^^^^^^^^^
/// ```
// #[inline]
// rustc: compiler/rustc_lint/src/non_local_def.rs:289 path_has_local_parent
function path_has_local_parent(path: hir.Path, cx: LateContext, impl_parent: DefId, outermost_impl_parent: DefId | undefined): boolean {
  const did = ResC.opt_def_id(path.res as Res);
  return did !== undefined && did_has_local_parent(did, cx.tcx, impl_parent, outermost_impl_parent);
}

/// Given a def id this checks if the parent def id (modulo modules) correspond to
/// the def id of the parent impl definition (the direct one and the outermost one).
// #[inline]
// rustc: compiler/rustc_lint/src/non_local_def.rs:303 did_has_local_parent
function did_has_local_parent(did: DefId, tcx: TyCtxt, impl_parent: DefId, outermost_impl_parent: DefId | undefined): boolean {
  if (!did.is_local()) {
    return false;
  }

  const parent_did = tcx.opt_parent(did);
  if (parent_did === undefined) {
    return false;
  }

  const p = peel_parent_while(tcx, parent_did, (tcx, did) => {
    return tcx.def_kind(did).$ === "Mod" || (tcx.def_kind(did).$ === "Const" && tcx.opt_item_name(did) === kw.Underscore);
  });
  return p !== undefined ? DefId_eq(p, impl_parent) || (outermost_impl_parent !== undefined && DefId_eq(p, outermost_impl_parent)) : false;
}

/// Given a `DefId` checks if it satisfies `f` if it does check with it's parent and continue
/// until it doesn't satisfies `f` and return the last `DefId` checked.
///
/// In other word this method return the first `DefId` that doesn't satisfies `f`.
// #[inline]
// rustc: compiler/rustc_lint/src/non_local_def.rs:331 peel_parent_while
function peel_parent_while(tcx: TyCtxt, did: DefId, f: (tcx: TyCtxt, did: DefId) => boolean): DefId | undefined {
  while (!did.is_crate_root() && f(tcx, did)) {
    const p = tcx.opt_parent(did);
    if (p === undefined || !p.is_local()) return undefined;
    did = p;
  }

  return did;
}

/// Return for a given `Path` the span until the last args
// rustc: compiler/rustc_lint/src/non_local_def.rs:344 path_span_without_args
function path_span_without_args(path: hir.Path): Span {
  const args = path.segments[path.segments.length - 1]!.args;
  if (args !== undefined) {
    return Span.until(path.span, args.span_ext);
  } else {
    return path.span;
  }
}

/// Return a "error message-able" ident for the last segment of the `Path`
// rustc: compiler/rustc_lint/src/non_local_def.rs:353 path_name_to_string
function path_name_to_string(path: hir.Path): string {
  return display_Ident(path.segments[path.segments.length - 1]!.ident);
}
