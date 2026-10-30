// Port of compiler/rustc_passes/src/reachable.rs (lane passes-reachable).
//
// PORT notes:
// - `LocalDefIdSet` (`reachable_symbols`, `scanned`) is a `Set<LocalDefId>`: the query's users only test membership
//   (`should_encode_mir`'s `reachable_set.contains`, rustc_codegen_ssa symbol_export).
// - `ReachableContext` is a HIR `Visitor` (`type Result = ()`) and a rustc_privacy `DefIdVisitor` (`type Result = ()`),
//   as `TypePrivacyVisitor` there: its `tcx` field is `tcx_` (the trait method is `tcx()`).
// - `&dyn fmt::Display` descriptions are thunks (rustc_privacy's `Display`).
// - Query values typed `unknown` in queries.gen.ts (`generics_of`, `codegen_fn_attrs`, `hir_crate_items`) are cast to
//   their upstream types at the read site.
// - tracing (`debug!`) is left out.
//! Finds local items that are "reachable", which means that other crates need access to their
//! compiled code or their *runtime* MIR. (Compile-time MIR is always encoded anyway, so we don't
//! worry about that here.)
//!
//! An item is "reachable" if codegen that happens in downstream crates can end up referencing this
//! item. This obviously includes all public items. However, some of these items cannot be codegen'd
//! (because they are generic), and for some the compiled code is not sufficient (because we want to
//! cross-crate inline them). These items "need cross-crate MIR". When a reachable function `f`
//! needs cross-crate MIR, then its MIR may be codegen'd in a downstream crate, and hence items it
//! mentions need to be considered reachable.
//!
//! Furthermore, if a `const`/`const fn` is reachable, then it can return pointers to other items,
//! making those reachable as well. For instance, consider a `const fn` returning a pointer to an
//! otherwise entirely private function: if a downstream crate calls that `const fn` to compute the
//! initial value of a `static`, then it needs to generate a direct reference to this function --
//! i.e., the function is directly reachable from that downstream crate! Hence we have to recurse
//! into `const` and `const fn`.
//!
//! Conversely, reachability *stops* when it hits a monomorphic non-`const` function that we do not
//! want to cross-crate inline. That function will just be codegen'd in this crate, which means the
//! monomorphization collector will consider it a root and then do another graph traversal to
//! codegen everything called by this function -- but that's a very different graph from what we are
//! considering here as at that point, everything is monomorphic.
import { VisitorResult } from "../rustc_ast_ir/visit.ts";
import { DefKind, type Res } from "../rustc_hir/def.ts";
import type * as hir from "../rustc_hir/hir.ts";
import { debug_Node, type Node } from "../rustc_hir/hir.ts";
import { Visitor, walk_expr, walk_inline_asm } from "../rustc_hir/intravisit.ts";
import type { HirId } from "../rustc_hir_id/lib.ts";
import type { ModuleItems } from "../rustc_middle/hir/mod.ts";
import { CodegenFnAttrFlags, CodegenFnAttrs } from "../rustc_middle/middle/codegen_fn_attrs.ts";
import type { EffectiveVisibilities } from "../rustc_middle/middle/privacy.ts";
import type { ConstAllocation } from "../rustc_middle/mir/interpret/allocation.ts";
import { GlobalAlloc } from "../rustc_middle/mir/interpret/mod.ts";
import { CtfeProvenance } from "../rustc_middle/mir/interpret/pointer.ts";
import type { Providers } from "../rustc_middle/queries.gen.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { BodyId as MiddleBodyId, TypeckResults } from "../rustc_middle/ty/decls.ts";
import { fold_GenericArgs } from "../rustc_middle/ty/generic_args.ts";
import type { Generics } from "../rustc_middle/ty/generics.ts";
import { Instance } from "../rustc_middle/ty/instance.ts";
import { fold_Ty } from "../rustc_middle/ty/structural_impls.ts";
import type { Clause } from "../rustc_middle/ty/predicate.ts";
import type { GenericClauses } from "../rustc_middle/ty/generics.ts";
import { DefIdVisitor_provided, type DefIdVisitor, type DefIdVisitorSkeleton } from "../rustc_privacy/lib.ts";
import { type DefId, LocalDefId } from "../rustc_span/def_id.ts";
import type { Span } from "../rustc_span/lib.ts";
import { bug } from "../rustc_span/macros.ts";
import { Binder } from "../rustc_type_ir/binder.ts";
import type { TraitRef } from "../rustc_type_ir/predicate.ts";
import type { TypeVisitable } from "../rustc_type_ir/visit.ts";
import { format_debug, PLAIN } from "../std/fmt.ts";
import { panic } from "../std/panic.ts";

/** `&dyn fmt::Display` (rustc_privacy's thunk). */
type Display = () => string;

/// Determines whether this item is recursive for reachability. See `is_recursively_reachable_local`
/// below for details.
// rustc: compiler/rustc_passes/src/reachable.rs:43 recursively_reachable
function recursively_reachable(tcx: TyCtxt, def_id: DefId): boolean {
  return (tcx.generics_of(def_id) as Generics).requires_monomorphization(tcx) || tcx.cross_crate_inlinable(def_id) || tcx.is_const_fn(def_id);
}

// Information needed while computing reachability.
// rustc-type: compiler/rustc_passes/src/reachable.rs:50 ReachableContext
class ReachableContext extends Visitor implements DefIdVisitor<undefined> {
  /** `impl DefIdVisitor`: `type Result = ();` */
  readonly DefIdResult = VisitorResult.unit;
  readonly SHALLOW = DefIdVisitor_provided.SHALLOW;

  constructor(
    // The type context.
    readonly tcx_: TyCtxt,
    public maybe_typeck_results: TypeckResults | undefined,
    // The set of items which must be exported in the linkage sense.
    public reachable_symbols: Set<LocalDefId>,
    // A worklist of item IDs. Each item ID in this worklist will be inlined
    // and will be scanned for further references.
    // FIXME(eddyb) benchmark if this would be faster as a `VecDeque`.
    public worklist: LocalDefId[],
    // Whether any output of this compilation is a library
    readonly any_library: boolean,
  ) {
    super();
  }

  // impl<'tcx> Visitor<'tcx> for ReachableContext<'tcx>

  // rustc: compiler/rustc_passes/src/reachable.rs:65 visit_nested_body
  override visit_nested_body(body: hir.BodyId): undefined {
    // `self.maybe_typeck_results.replace(self.tcx.typeck_body(body))`
    const old_maybe_typeck_results = this.maybe_typeck_results;
    // PORT: rustc_middle ty/decls.ts still declares its own (pending) `BodyId`; the HIR one is the same value (dead.ts).
    this.maybe_typeck_results = this.tcx_.typeck_body(body as unknown as MiddleBodyId);
    const body_ = this.tcx_.hir_body(body);
    this.visit_body(body_);
    this.maybe_typeck_results = old_maybe_typeck_results;
    return undefined;
  }

  // rustc: compiler/rustc_passes/src/reachable.rs:73 visit_expr
  override visit_expr(expr: hir.Expr): undefined {
    let res: Res | undefined;
    switch (expr.kind.$) {
      case "Path": {
        // This covers fn ptr casts but also "non-method" calls.
        res = this.typeck_results().qpath_res(expr.kind._0, expr.hir_id);
        break;
      }
      case "MethodCall": {
        // Method calls don't involve a full "path", so we need to determine the callee
        // based on the receiver type.
        // If this is a method call on a generic type, we might not be able to find the
        // callee. That's why `reachable_set` also adds all potential callees for such
        // calls, i.e. all trait impl items, to the reachable set. So here we only worry
        // about the calls we can identify.
        const d = this.typeck_results().type_dependent_def(expr.hir_id);
        res = d === undefined ? undefined : { $: "Def", _0: d[0], _1: d[1] };
        break;
      }
      case "Closure": {
        this.reachable_symbols.add(expr.kind._0.def_id);
        res = undefined;
        break;
      }
      default:
        res = undefined;
    }

    if (res !== undefined) {
      this.propagate_item(res);
    }

    return walk_expr(this, expr);
  }

  // rustc: compiler/rustc_passes/src/reachable.rs:104 visit_inline_asm
  override visit_inline_asm(asm: hir.InlineAsm, id: HirId): undefined {
    for (const [op, _] of asm.operands) {
      if (op.$ === "SymStatic") {
        const def_id = op.def_id.as_local();
        if (def_id !== undefined) {
          this.reachable_symbols.add(def_id);
        }
      }
    }
    return walk_inline_asm(this, asm, id);
  }

  // impl<'tcx> ReachableContext<'tcx>

  /// Gets the type-checking results for the current body.
  /// As this will ICE if called outside bodies, only call when working with
  /// `Expr` or `Pat` nodes (they are guaranteed to be found only in bodies).
  // #[track_caller]
  // rustc: compiler/rustc_passes/src/reachable.rs:121 typeck_results
  typeck_results(): TypeckResults {
    const r = this.maybe_typeck_results;
    if (r === undefined) return panic("`ReachableContext::typeck_results` called outside of body");
    return r;
  }

  /// Returns true if the given def ID represents a local item that is recursive for reachability,
  /// i.e. whether everything mentioned in here also needs to be considered reachable.
  ///
  /// There are two reasons why an item may be recursively reachable:
  /// - It needs cross-crate MIR (see the module-level doc comment above).
  /// - It is a `const` or `const fn`. This is *not* because we need the MIR to interpret them
  ///   (MIR for const-eval and MIR for codegen is separate, and MIR for const-eval is always
  ///   encoded). Instead, it is because `const fn` can create `fn()` pointers to other items
  ///   which end up in the evaluated result of the constant and can then be called from other
  ///   crates. Those items must be considered reachable.
  // rustc: compiler/rustc_passes/src/reachable.rs:136 is_recursively_reachable_local
  is_recursively_reachable_local(def_id_: DefId): boolean {
    const def_id = def_id_.as_local();
    if (def_id === undefined) {
      return false;
    }

    const node = this.tcx_.hir_node_by_def_id(def_id);
    switch (node.$) {
      case "Item":
        switch (node._0.kind.$) {
          case "Fn":
            return recursively_reachable(this.tcx_, LocalDefId.to_def_id(def_id));
          default:
            return false;
        }
      case "TraitItem": {
        const kind = node._0.kind;
        switch (kind.$) {
          case "Const":
            return kind._1 !== undefined;
          case "Fn":
            if (kind._1.$ === "Provided") return true;
            return false;
          case "Type":
            return false;
        }
        break;
      }
      case "ImplItem": {
        const impl_item = node._0;
        switch (impl_item.kind.$) {
          case "Const":
            return true;
          case "Fn":
            return recursively_reachable(this.tcx_, impl_item.hir_id().owner.to_def_id());
          case "Type":
            return false;
        }
        break;
      }
      case "Expr":
        if (node._0.kind.$ === "Closure") return true;
        return false;
    }
    return false;
  }

  // Step 2: Mark all symbols that the symbols on the worklist touch.
  // rustc: compiler/rustc_passes/src/reachable.rs:165 propagate
  propagate(): void {
    const scanned = new Set<LocalDefId>();
    let search_item: LocalDefId | undefined;
    while ((search_item = this.worklist.pop()) !== undefined) {
      // `if !scanned.insert(search_item)`
      if (scanned.has(search_item)) {
        continue;
      }
      scanned.add(search_item);

      this.propagate_node(this.tcx_.hir_node_by_def_id(search_item), search_item);
    }
  }

  // rustc: compiler/rustc_passes/src/reachable.rs:176 propagate_node
  propagate_node(node: Node, search_item: LocalDefId): void {
    if (!this.any_library) {
      // If we are building an executable, only explicitly extern
      // types need to be exported.
      const codegen_attrs: CodegenFnAttrs = DefKind.has_codegen_attrs(this.tcx_.def_kind(search_item))
        ? (this.tcx_.codegen_fn_attrs(search_item) as CodegenFnAttrs)
        : CodegenFnAttrs.EMPTY;
      const is_extern = CodegenFnAttrs.contains_extern_indicator(codegen_attrs);
      // Right now, the only way to get "foreign item symbol aliases" is by being an EII-implementation.
      // EII implementations will generate under their own name but also under the name of some foreign item
      // (hence alias) that may be in another crate. These functions are marked as always-reachable since
      // it's very hard to track whether the original foreign item was reachable. It may live in another crate
      // and may be reachable from sibling crates.
      const has_foreign_aliases_eii = codegen_attrs.foreign_item_symbol_aliases.length !== 0;
      if (is_extern || has_foreign_aliases_eii) {
        this.reachable_symbols.add(search_item);
      }
    } else {
      // If we are building a library, then reachable symbols will
      // continue to participate in linkage after this product is
      // produced. In this case, we traverse the ast node, recursing on
      // all reachable nodes from this one.
      this.reachable_symbols.add(search_item);
    }

    switch (node.$) {
      case "Item": {
        const item = node._0;
        const kind = item.kind;
        switch (kind.$) {
          case "Fn": {
            if (recursively_reachable(this.tcx_, item.owner_id.to_def_id())) {
              this.visit_nested_body(kind.body);
            }
            break;
          }
          case "Const": {
            const init = kind._3;
            // For `type const` we want to evaluate the RHS.
            if (init.$ === "Direct") {
              this.visit_const_item_rhs(init);
              break;
            }
            if ((this.tcx_.generics_of(item.owner_id.to_def_id()) as Generics).own_requires_monomorphization()) {
              // In this case, we don't want to evaluate the const initializer.
              // In lieu of that, we have to consider everything mentioned in it
              // as reachable, since it *may* end up in the final value.
              this.visit_const_item_rhs(init);
              return;
            }

            const r = this.tcx_.const_eval_poly_to_alloc(LocalDefId.to_def_id(item.owner_id.def_id));
            if (r.$ === "Ok") {
              // Only things actually ending up in the final constant value are
              // reachable for codegen. Everything else is only needed during
              // const-eval, so even if const-eval happens in a downstream crate,
              // all they need is `mir_for_ctfe`.
              const alloc = GlobalAlloc.unwrap_memory(this.tcx_.global_alloc(r._0.alloc_id));
              this.propagate_from_alloc(alloc);
            } else if (r._0.$ === "TooGeneric") {
              // Trivially unsatisfiable bounds on the item prevented us from
              // normalizing the initializer. Similar to the other case, we have to
              // everything mentioned in it as reachable.
              this.visit_const_item_rhs(init);
            } else {
              // If there was an error evaluating the const, nothing can be reachable
              // via it, and anyway compilation will fail.
            }
            break;
          }
          case "Static": {
            const r = this.tcx_.eval_static_initializer(item.owner_id.def_id);
            if (r.$ === "Ok") {
              this.propagate_from_alloc(r._0);
            }
            break;
          }

          // These are normal, nothing reachable about these
          // inherently and their children are already in the
          // worklist, as determined by the privacy pass
          case "ExternCrate":
          case "Use":
          case "TyAlias":
          case "Macro":
          case "Mod":
          case "ForeignMod":
          case "Impl":
          case "Trait":
          case "TraitAlias":
          case "Struct":
          case "Enum":
          case "Union":
          case "GlobalAsm":
          case "TestBinderConstraints":
            break;
        }
        break;
      }
      case "TraitItem": {
        const trait_method = node._0;
        const kind = trait_method.kind;
        switch (kind.$) {
          case "Const":
            if (kind._1 === undefined) {
              // Keep going, nothing to get exported
            } else {
              this.visit_const_item_rhs(kind._1);
            }
            break;
          case "Fn":
            if (kind._1.$ === "Required") {
              // Keep going, nothing to get exported
            } else {
              this.visit_nested_body(kind._1._0);
            }
            break;
          case "Type":
            break;
        }
        break;
      }
      case "ImplItem": {
        const impl_item = node._0;
        const kind = impl_item.kind;
        switch (kind.$) {
          case "Const":
            this.visit_const_item_rhs(kind._1);
            break;
          case "Fn":
            if (recursively_reachable(this.tcx_, impl_item.hir_id().owner.to_def_id())) {
              this.visit_nested_body(kind._1);
            }
            break;
          case "Type":
            break;
        }
        break;
      }
      case "Expr":
        if (node._0.kind.$ === "Closure") {
          this.visit_nested_body(node._0.kind._0.body);
          break;
        }
        this.unexpected_node(node, search_item);
        break;
      // Nothing to recurse on for these
      case "ForeignItem":
      case "Variant":
      case "Ctor":
      case "Field":
      case "Ty":
      case "Crate":
      case "NestedUseTree":
      case "Synthetic":
      case "OpaqueTy":
        break;
      default:
        this.unexpected_node(node, search_item);
    }
  }

  /** The `_ => bug!(..)` arm of `propagate_node`. */
  private unexpected_node(node: Node, search_item: LocalDefId): never {
    return bug(
      `found unexpected node kind in worklist: ${this.tcx_.hir_id_to_string(this.tcx_.local_def_id_to_hir_id(search_item))} (${format_debug(node, debug_Node, PLAIN)})`,
    );
  }

  /// Finds things to add to `reachable_symbols` within allocations.
  /// In contrast to visit_nested_body this ignores things that were only needed to evaluate
  /// the allocation.
  // rustc: compiler/rustc_passes/src/reachable.rs:320 propagate_from_alloc
  propagate_from_alloc(alloc: ConstAllocation): void {
    if (!this.any_library) {
      return;
    }
    for (const [_, prov] of alloc.inner().provenance_().ptrs_().iter()) {
      const ga = this.tcx_.global_alloc(CtfeProvenance.alloc_id(prov));
      switch (ga.$) {
        case "Static":
          this.propagate_item({ $: "Def", _0: this.tcx_.def_kind(ga._0), _1: ga._0 });
          break;
        case "Function": {
          const instance = ga.instance;
          // Manually visit to actually see the instance's `DefId`. Type visitors won't see it
          this.propagate_item({ $: "Def", _0: this.tcx_.def_kind(Instance.def_id(instance)), _1: Instance.def_id(instance) });
          this.visit(instance.args, fold_GenericArgs);
          break;
        }
        case "VTable": {
          const [ty, dyn_ty] = [ga._0, ga._1];
          this.visit(ty, fold_Ty);
          // Manually visit to actually see the trait's `DefId`. Type visitors won't see it
          const trait_ref = dyn_ty.principal();
          if (trait_ref !== undefined) {
            const { def_id, args } = Binder.skip_binder(trait_ref);
            this.visit_def_id(def_id, "", () => "");
            this.visit(args, fold_GenericArgs);
          }
          break;
        }
        case "TypeId":
          this.visit(ga.ty, fold_Ty);
          break;
        case "Memory":
          this.propagate_from_alloc(ga._0);
          break;
      }
    }
  }

  // rustc: compiler/rustc_passes/src/reachable.rs:352 propagate_item
  propagate_item(res: Res): void {
    if (res.$ !== "Def") return;
    const kind = res._0;
    const def_id = res._1.as_local();
    if (def_id === undefined) return;
    if (kind.$ === "Static" && kind.nested) {
      // This is the main purpose of this function: add the def_id we find
      // to `reachable_symbols`.
      // `if self.reachable_symbols.insert(def_id)`
      if (!this.reachable_symbols.has(def_id)) {
        this.reachable_symbols.add(def_id);
        const r = this.tcx_.eval_static_initializer(def_id);
        if (r.$ === "Ok") {
          // This cannot cause infinite recursion, because we abort by inserting into the
          // work list once we hit a normal static. Nested statics, even if they somehow
          // become recursive, are also not infinitely recursing, because of the
          // `reachable_symbols` check above.
          // We still need to protect against stack overflow due to deeply nested statics.
          this.propagate_from_alloc(r._0);
        }
      }
    } else if (kind.$ === "Const" || kind.$ === "AssocConst" || kind.$ === "Static") {
      // Reachable constants and reachable statics can have their contents inlined
      // into other crates. Mark them as reachable and recurse into their body.
      this.worklist.push(def_id);
    } else {
      if (this.is_recursively_reachable_local(LocalDefId.to_def_id(def_id))) {
        this.worklist.push(def_id);
      } else {
        this.reachable_symbols.add(def_id);
      }
    }
  }

  // impl<'tcx> DefIdVisitor<'tcx> for ReachableContext<'tcx>
  skip_assoc_tys(): boolean {
    return DefIdVisitor_provided.skip_assoc_tys(this);
  }

  // rustc: compiler/rustc_passes/src/reachable.rs:389 tcx
  tcx(): TyCtxt {
    return this.tcx_;
  }

  // rustc: compiler/rustc_passes/src/reachable.rs:393 visit_def_id
  visit_def_id(def_id: DefId, _kind: string, _descr: Display): undefined {
    this.propagate_item({ $: "Def", _0: this.tcx_.def_kind(def_id), _1: def_id });
    return undefined;
  }

  // ---- provided `DefIdVisitor` methods ----
  skeleton(): DefIdVisitorSkeleton<undefined> {
    return DefIdVisitor_provided.skeleton(this);
  }
  visit<T>(ty_fragment: T, d: TypeVisitable<T>): undefined {
    return DefIdVisitor_provided.visit(this, ty_fragment, d);
  }
  visit_trait(trait_ref: TraitRef): undefined {
    return DefIdVisitor_provided.visit_trait(this, trait_ref);
  }
  visit_gen_clauses(gen_clauses: GenericClauses): undefined {
    return DefIdVisitor_provided.visit_gen_clauses(this, gen_clauses);
  }
  visit_clauses(clauses: readonly (readonly [Clause, Span])[]): undefined {
    return DefIdVisitor_provided.visit_clauses(this, clauses);
  }
}

// rustc: compiler/rustc_passes/src/reachable.rs:403 check_item
function check_item(tcx: TyCtxt, id: hir.ItemId, worklist: LocalDefId[], effective_visibilities: EffectiveVisibilities): void {
  if (has_custom_linkage(tcx, id.owner_id.def_id)) {
    worklist.push(id.owner_id.def_id);
  }

  const def_kind = tcx.def_kind(id.owner_id.def_id);
  if (!(def_kind.$ === "Impl" && def_kind.of_trait)) {
    return;
  }

  // We need only trait impls here, not inherent impls, and only non-exported ones
  if (effective_visibilities.is_reachable(id.owner_id.def_id)) {
    return;
  }

  const items = tcx.associated_item_def_ids(id.owner_id.to_def_id());
  worklist.push(...items.map((ii_ref) => ii_ref.expect_local()));

  const trait_def_id = tcx.impl_trait_id(id.owner_id.to_def_id());

  if (!trait_def_id.is_local()) {
    return;
  }

  for (const assoc of tcx.provided_trait_methods(trait_def_id)) {
    worklist.push(assoc.def_id.expect_local());
  }
}

// rustc: compiler/rustc_passes/src/reachable.rs:435 has_custom_linkage
function has_custom_linkage(tcx: TyCtxt, def_id: LocalDefId): boolean {
  // Anything which has custom linkage gets thrown on the worklist no
  // matter where it is in the crate, along with "special std symbols"
  // which are currently akin to allocator symbols.
  if (!DefKind.has_codegen_attrs(tcx.def_kind(def_id))) {
    return false;
  }

  const codegen_attrs = tcx.codegen_fn_attrs(def_id) as CodegenFnAttrs;
  return (
    CodegenFnAttrs.contains_extern_indicator(codegen_attrs) ||
    // FIXME(nbdd0121): `#[used]` are marked as reachable here so it's picked up by
    // `linked_symbols` in cg_ssa. They won't be exported in binary or cdylib due to their
    // `SymbolExportLevel::Rust` export level but may end up being exported in dylibs.
    // Also note that Miri is relying on this to be able to find private `link_section` statics
    // across all crates.
    CodegenFnAttrFlags.contains(codegen_attrs.flags, CodegenFnAttrFlags.USED_COMPILER) ||
    CodegenFnAttrFlags.contains(codegen_attrs.flags, CodegenFnAttrFlags.USED_LINKER) ||
    // Right now, the only way to get "foreign item symbol aliases" is by being an EII-implementation.
    // EII implementations will generate under their own name but also under the name of some foreign item
    // (hence alias) that may be in another crate. These functions are marked as always-reachable since
    // it's very hard to track whether the original foreign item was reachable. It may live in another crate
    // and may be reachable from sibling crates.
    codegen_attrs.foreign_item_symbol_aliases.length !== 0
  );
}

/// See module-level doc comment above.
// rustc: compiler/rustc_passes/src/reachable.rs:461 reachable_set
function reachable_set(tcx: TyCtxt, _: null): Set<LocalDefId> {
  const effective_visibilities = tcx.effective_visibilities(null);

  const any_library = tcx.crate_types().some((ty) => ty === "Rlib" || ty === "Dylib" || ty === "ProcMacro" || ty === "Sdylib");
  const reachable_context = new ReachableContext(tcx, undefined, new Set(), [], any_library);

  // Step 1: Seed the worklist with all nodes which were found to be public as
  //         a result of the privacy pass along with all local lang items and impl items.
  //         If other crates link to us, they're going to expect to be able to
  //         use the lang items, so we need to be sure to mark them as
  //         exported.
  reachable_context.worklist = [...effective_visibilities.iter()]
    .filter(([_id, effective_vis]) => effective_vis.is_public_at_level("ReachableThroughImplTrait"))
    .map(([id]) => id);

  for (const [_, def_id_] of tcx.lang_items().iter()) {
    const def_id = def_id_.as_local();
    if (def_id !== undefined) {
      reachable_context.worklist.push(def_id);
    }
  }
  {
    // As explained above, we have to mark all functions called from reachable
    // `item_might_be_inlined` items as reachable. The issue is, when those functions are
    // generic and call a trait method, we have no idea where that call goes! So, we
    // conservatively mark all trait impl items as reachable.
    // FIXME: One possible strategy for pruning the reachable set is to avoid marking impl
    // items of non-exported traits (or maybe all local traits?) unless their respective
    // trait items are used from inlinable code through method call syntax or UFCS, or their
    // trait is a lang item.
    // (But if you implement this, don't forget to take into account that vtables can also
    // make trait methods reachable!)
    const crate_items = tcx.hir_crate_items(null) as ModuleItems;

    for (const id of crate_items.free_items()) {
      check_item(tcx, id, reachable_context.worklist, effective_visibilities);
    }

    for (const id of crate_items.impl_items()) {
      if (has_custom_linkage(tcx, id.owner_id.def_id)) {
        reachable_context.worklist.push(id.owner_id.def_id);
      }
    }
  }

  // Step 2: Mark all symbols that the symbols on the worklist touch.
  reachable_context.propagate();

  // debug!("Inline reachability shows: {:?}", reachable_context.reachable_symbols);

  // Return the set of reachable symbols.
  return reachable_context.reachable_symbols;
}

// rustc: compiler/rustc_passes/src/reachable.rs:528 provide
export function provide(providers: Providers): void {
  providers.reachable_set = reachable_set;
}
