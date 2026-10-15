// Port of compiler/rustc_const_eval/src/const_eval/fn_queries.rs (lane small-gaps-17).
//
// PORT: the `constness` / `trait_def` / `impl_trait_header` / `lookup_const_stability` query values are `unknown` in
// queries.gen.ts; they are cast to the upstream value types.
import { find_attr } from "../../rustc_attr_ir/lib.ts";
import type { ConstStability } from "../../rustc_attr_ir/stability.gen.ts";
import { debug_DefKind } from "../../rustc_hir/def.gen.ts";
import { Constness, debug_Node } from "../../rustc_hir/hir.ts";
import type { Providers } from "../../rustc_middle/queries.gen.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import { HasAttrs_HirId, type ImplTraitHeader } from "../../rustc_middle/ty/mod.ts";
import type { TraitDef } from "../../rustc_middle/ty/trait_def.ts";
import type { DefId, LocalDefId } from "../../rustc_span/def_id.ts";
import { format_debug, PLAIN, PRETTY } from "../../std/fmt.ts";

/// Checks whether a function-like definition is considered to be `const`. Also stores constness of inherent impls.
// rustc: compiler/rustc_const_eval/src/const_eval/fn_queries.rs:11 constness
function constness(tcx: TyCtxt, def_id: LocalDefId): Constness {
  const node = tcx.hir_node_by_def_id(def_id);

  // PORT: the `match` (with `if let` guards) is an if-chain in arm order.
  if (node.$ === "Ctor" && node._0.$ === "Tuple") {
    return { $: "Const", always: false };
  } else if (node.$ === "ForeignItem" && node._0.kind.$ === "Fn") {
    // Foreign functions cannot be evaluated at compile-time.
    return Constness.NotConst;
  } else if (node.$ === "Expr" && node._0.kind.$ === "Closure") {
    const c = node._0.kind._0;
    if (c.constness.$ === "Const" && tcx.hir_body_const_context(tcx.local_parent(def_id)) === undefined) {
      tcx.dcx().span_err(tcx.def_span(def_id), "cannot use `const` closures outside of const contexts");
      return Constness.NotConst;
    }
    return c.constness;
  }
  // FIXME(fee1-dead): extract this one out and rename this query to `fn_constness` so we don't need `is_const_fn` anymore.
  else if (node.$ === "Item" && node._0.kind.$ === "Impl") {
    return node._0.kind._0.constness;
  } else if (node.$ === "Item" && node._0.kind.$ === "Fn") {
    return node._0.kind.sig.header.constness;
  } else if (node.$ === "ImplItem" && node._0.impl_kind.$ === "Trait" && node._0.kind.$ === "Fn") {
    return (tcx.impl_trait_header(tcx.local_parent(def_id)) as ImplTraitHeader).constness;
  } else if (node.$ === "ImplItem" && node._0.impl_kind.$ === "Inherent" && node._0.kind.$ === "Fn") {
    const sig = node._0.kind._0;
    switch (sig.header.constness.$) {
      case "Const":
        return { $: "Const", always: sig.header.constness.always };
      // inherent impl could be const
      case "NotConst":
        return tcx.constness(tcx.local_parent(def_id)) as Constness;
    }
  } else if (node.$ === "TraitItem" && node._0.kind.$ === "Fn") {
    const ti = node._0;
    if (find_attr(HasAttrs_HirId.get_attrs(ti.hir_id(), tcx), (k) => (k.$ === "RustcNonConstTraitMethod" ? null : undefined)) !== undefined) {
      return Constness.NotConst;
    } else {
      return (tcx.trait_def(tcx.local_parent(def_id)) as TraitDef).constness;
    }
  } else {
    return tcx
      .dcx()
      .span_bug(
        tcx.def_span(def_id),
        `should not be requesting the constness of items that can't be const: ${format_debug(node, debug_Node, PRETTY)}: ${debug_DefKind(tcx.def_kind(def_id), PLAIN)}`,
      );
  }
}

// rustc: compiler/rustc_const_eval/src/const_eval/fn_queries.rs:62 is_promotable_const_fn
function is_promotable_const_fn(tcx: TyCtxt, def_id: DefId): boolean {
  if (!tcx.is_const_fn(def_id)) return false;
  const stab = tcx.lookup_const_stability(def_id) as ConstStability | undefined;
  if (stab !== undefined) {
    // PORT: `if cfg!(debug_assertions) && stab.promotable { assert!(fn_sig.safety().is_safe(), ..) }`: rustc ships
    // without debug assertions, so the check is compiled out (as `debug_assert!`, PORTING §3).
    // if cfg!(debug_assertions) && stab.promotable {
    //     let sig = tcx.fn_sig(def_id);
    //     assert!(
    //         sig.skip_binder().safety().is_safe(),
    //         "don't mark const unsafe fns as promotable",
    //         // https://github.com/rust-lang/rust/pull/53851#issuecomment-418760682
    //     );
    // }
    return stab.promotable;
  } else {
    return false;
  }
}

// rustc: compiler/rustc_const_eval/src/const_eval/fn_queries.rs:80 provide
export function provide(providers: Providers): void {
  providers.constness = constness;
  providers.is_promotable_const_fn = is_promotable_const_fn;
}
