// Port of compiler/rustc_lint/src/foreign_modules.rs. The `declare_lint!` static is generated
// (foreign_modules.lints.gen.ts). `debug!` / `#[instrument]` tracing is not ported.
import { type Align, Align_eq, FIRST_VARIANT } from "../rustc_abi/lib.ts";
import { ExternAbi } from "../rustc_abi/extern_abi.ts";
import { find_attr } from "../rustc_attr_ir/lib.ts";
import type * as hir from "../rustc_hir/lib.ts";
import type { LintVec } from "../rustc_lint_defs/lib.ts";
import type { ModuleItems } from "../rustc_middle/hir/mod.ts";
import type { Providers as QueryProviders } from "../rustc_middle/queries.gen.ts";
import type { AdtDef } from "../rustc_middle/ty/adt.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { RawList } from "../rustc_middle/ty/list.ts";
import { Instance } from "../rustc_middle/ty/instance.ts";
import { HasAttrs_OwnerId, type Ty, TypingEnv } from "../rustc_middle/ty/mod.ts";
import type { Span } from "../rustc_span/lib.ts";
import { Symbol } from "../rustc_span/symbol.ts";
import { EarlyBinder } from "../rustc_type_ir/binder.ts";
import { FnSig, fold_FnSig } from "../rustc_type_ir/ty_kind.ts";
import { fold_Ty } from "../rustc_middle/ty/structural_impls.ts";
import { Unnormalized } from "../rustc_type_ir/unnormalized.ts";
import { KeyedSet } from "../rust_ts/keyed.ts";
import { unreachable, unwrap } from "../std/panic.ts";
import { BuiltinClashingExtern_diagnostic, type BuiltinClashingExtern } from "./diagnostics.gen.ts";
import { CLASHING_EXTERN_DECLARATIONS } from "./foreign_modules.lints.gen.ts";
import * as types from "./types.ts";

export * from "./foreign_modules.lints.gen.ts";

// rustc: compiler/rustc_lint/src/foreign_modules.rs:15 provide
export function provide(providers: QueryProviders): void {
  providers.clashing_extern_declarations = clashing_extern_declarations;
}

// rustc: compiler/rustc_lint/src/foreign_modules.rs:19 lint_vec
export function lint_vec(): LintVec {
  return [CLASHING_EXTERN_DECLARATIONS];
}

// rustc: compiler/rustc_lint/src/foreign_modules.rs:23 clashing_extern_declarations
function clashing_extern_declarations(tcx: TyCtxt, _: null): null {
  const lint = ClashingExternDeclarations.new();
  for (const id of (tcx.hir_crate_items(null) as ModuleItems).foreign_items()) {
    lint.check_foreign_item(tcx, id);
  }
  return null;
}

// struct ClashingExternDeclarations
class ClashingExternDeclarations {
  constructor(
    /// Map of function symbol name to the first-seen hir id for that symbol name.. If seen_decls
    /// contains an entry for key K, it means a symbol with name K has been seen by this lint and
    /// the symbol should be reported as a clashing declaration.
    // FIXME: Technically, we could just store a &'tcx str here without issue; however, the
    // `impl_lint_pass` macro doesn't currently support lints parametric over a lifetime.
    public seen_decls: Map<Symbol, hir.OwnerId>,
  ) {}

  // rustc: compiler/rustc_lint/src/foreign_modules.rs:99 new
  static new(): ClashingExternDeclarations {
    return new ClashingExternDeclarations(new Map());
  }

  /// Insert a new foreign item into the seen set. If a symbol with the same name already exists
  /// for the item, return its HirId without updating the set.
  // rustc: compiler/rustc_lint/src/foreign_modules.rs:105 insert
  insert(tcx: TyCtxt, fi: hir.ForeignItemId): hir.OwnerId | undefined {
    const did = fi.owner_id.to_def_id();
    const instance = Instance.new_raw(did, RawList.identity_for_item(tcx, did));
    const name = Symbol.intern((tcx.symbol_name(instance) as { name: string }).name);
    const existing_id = this.seen_decls.get(name);
    if (existing_id !== undefined) {
      // Avoid updating the map with the new entry when we do find a collision. We want to
      // make sure we're always pointing to the first definition as the previous declaration.
      // This lets us avoid emitting "knock-on" diagnostics.
      return existing_id;
    } else {
      // `HashMap::insert` returns the previous value: `None` here.
      const prev = this.seen_decls.get(name);
      this.seen_decls.set(name, fi.owner_id);
      return prev;
    }
  }

  // #[instrument(level = "trace", skip(self, tcx))]
  // rustc: compiler/rustc_lint/src/foreign_modules.rs:120 check_foreign_item
  check_foreign_item(tcx: TyCtxt, this_fi: hir.ForeignItemId): void {
    if (tcx.def_kind(this_fi.owner_id).$ !== "Fn") return;
    const existing_did = this.insert(tcx, this_fi);
    if (existing_did === undefined) return;

    const existing_decl_ty = EarlyBinder.skip_binder(tcx.type_of(existing_did) as EarlyBinder<Ty>);
    const this_decl_ty = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.type_of(this_fi.owner_id) as EarlyBinder<Ty>));
    // debug!("ClashingExternDeclarations: Comparing existing {:?}: {:?} to this {:?}: {:?}", ..);

    // Check that the declarations match.
    if (!structurally_same_type(tcx, TypingEnv.non_body_analysis(tcx, this_fi.owner_id), existing_decl_ty, this_decl_ty)) {
      const orig_ = name_of_extern_decl(tcx, existing_did);

      // Finally, emit the diagnostic.
      const this_ = tcx.item_name(this_fi.owner_id.to_def_id());
      const orig = SymbolName.get_name(orig_);
      const previous_decl_label = get_relevant_span(tcx, existing_did);
      const mismatch_label = get_relevant_span(tcx, this_fi.owner_id);
      const sub = { tcx, expected: existing_decl_ty, found: this_decl_ty };
      let decorator: BuiltinClashingExtern;
      if (orig === this_) {
        decorator = {
          $: "SameName",
          this: this_,
          orig,
          previous_decl_label,
          mismatch_label,
          sub,
        };
      } else {
        decorator = {
          $: "DiffName",
          this: this_,
          orig,
          previous_decl_label,
          mismatch_label,
          sub,
        };
      }
      tcx.emit_node_span_lint(CLASHING_EXTERN_DECLARATIONS, this_fi.hir_id(), mismatch_label, BuiltinClashingExtern_diagnostic(decorator));
    }
  }
}

// #[derive(Clone, Debug)]
type SymbolName =
  /// The name of the symbol + the span of the annotation which introduced the link name.
  | { readonly $: "Link"; readonly _0: Symbol; readonly _1: Span }
  /// No link name, so just the name of the symbol.
  | { readonly $: "Normal"; readonly _0: Symbol };

const SymbolName = {
  // rustc: compiler/rustc_lint/src/foreign_modules.rs:91 get_name
  get_name(self: SymbolName): Symbol {
    switch (self.$) {
      case "Link":
      case "Normal":
        return self._0;
    }
  },
};

/// Get the name of the symbol that's linked against for a given extern declaration. That is,
/// the name specified in a #[link_name = ...] attribute if one was specified, else, just the
/// symbol's name.
// rustc: compiler/rustc_lint/src/foreign_modules.rs:177 name_of_extern_decl
function name_of_extern_decl(tcx: TyCtxt, fi: hir.OwnerId): SymbolName {
  const overridden_link_name = (tcx.codegen_fn_attrs(fi) as { symbol_name: Symbol | undefined }).symbol_name;
  if (overridden_link_name !== undefined) {
    // FIXME: Instead of searching through the attributes again to get span
    // information, we could have codegen_fn_attrs also give span information back for
    // where the attribute was defined. However, until this is found to be a
    // bottleneck, this does just fine.
    const overridden_link_name_span = unwrap(find_attr(HasAttrs_OwnerId.get_attrs(fi, tcx), (k) => (k.$ === "LinkName" ? k.span : undefined)));
    return { $: "Link", _0: overridden_link_name, _1: overridden_link_name_span };
  } else {
    return { $: "Normal", _0: tcx.item_name(fi.to_def_id()) };
  }
}

/// We want to ensure that we use spans for both decls that include where the
/// name was defined, whether that was from the link_name attribute or not.
// rustc: compiler/rustc_lint/src/foreign_modules.rs:195 get_relevant_span
function get_relevant_span(tcx: TyCtxt, fi: hir.OwnerId): Span {
  const n = name_of_extern_decl(tcx, fi);
  switch (n.$) {
    case "Normal":
      return tcx.def_span(fi);
    case "Link":
      return n._1;
  }
}

/// Checks whether two types are structurally the same enough that the declarations shouldn't
/// clash. We need this so we don't emit a lint when two modules both declare an extern struct,
/// with the same members (as the declarations shouldn't clash).
// rustc: compiler/rustc_lint/src/foreign_modules.rs:205 structurally_same_type
function structurally_same_type(tcx: TyCtxt, typing_env: TypingEnv, a: Ty, b: Ty): boolean {
  const seen_types = new KeyedSet<[Ty, Ty]>(([x, y]) => `${x.id},${y.id}`);
  const result = structurally_same_type_impl(seen_types, tcx, typing_env, a, b);
  // PORT: `if cfg!(debug_assertions) && result { .. }` (the layout sanity check): rustc ships without debug
  // assertions, so the block never runs.
  return result;
}

/** `Iterator::eq_by` */
function eq_by<A, B>(a: readonly A[], b: readonly B[], eq: (x: A, y: B) => boolean): boolean {
  for (let i = 0; ; i++) {
    if (i >= a.length) return i >= b.length;
    if (i >= b.length) return false;
    if (!eq(a[i]!, b[i]!)) return false;
  }
}

// rustc: compiler/rustc_lint/src/foreign_modules.rs:225 structurally_same_type_impl
function structurally_same_type_impl(seen_types: KeyedSet<[Ty, Ty]>, tcx: TyCtxt, typing_env: TypingEnv, a: Ty, b: Ty): boolean {
  // debug!("structurally_same_type_impl(tcx, a = {:?}, b = {:?})", a, b);

  // Given a transparent newtype, reach through and grab the inner
  // type unless the newtype makes the type non-null.
  const non_transparent_ty = (ty: Ty): Ty => {
    for (;;) {
      const k = ty.kind();
      if (k.$ === "Adt") {
        const [def, args] = [k._0, k._1];
        const is_transparent = def.repr().transparent();
        const is_non_null = types.nonnull_optimization_guaranteed(tcx, def);
        // debug!(?ty, is_transparent, is_non_null);
        if (is_transparent && !is_non_null) {
          // debug_assert_eq!(def.variants().len(), 1);
          const v = def.variant(FIRST_VARIANT);
          // continue with `ty`'s non-ZST field,
          // otherwise `ty` is a ZST and we can return
          const field = types.transparent_newtype_field(tcx, v);
          if (field !== undefined) {
            ty = Unnormalized.skip_norm_wip(field.ty(tcx, args));
            continue;
          }
        }
      }
      // debug!("non_transparent_ty -> {:?}", ty);
      return ty;
    }
  };

  a = non_transparent_ty(a);
  b = non_transparent_ty(b);

  const pair: [Ty, Ty] = [a, b];
  const inserted = !seen_types.has(pair);
  if (inserted) seen_types.add(pair);
  if (!inserted) {
    // We've encountered a cycle. There's no point going any further -- the types are
    // structurally the same.
    return true;
  } else if (a === b) {
    // All nominally-same types are structurally same, too.
    return true;
  } else {
    // Do a full, depth-first comparison between the two.
    const is_primitive_or_pointer = (ty: Ty): boolean => ty.is_primitive() || ty.kind().$ === "RawPtr" || ty.kind().$ === "Ref";

    const ak = a.kind();
    const bk = b.kind();
    if (ak.$ === "Adt" && bk.$ === "Adt") {
      const [a_def, a_gen_args] = [ak._0, ak._1];
      const [b_def, b_gen_args] = [bk._0, bk._1];
      // Only `repr(C)` types can be compared structurally.
      if (!(a_def.repr().c() && b_def.repr().c())) {
        return false;
      }
      // If the types differ in their packed-ness, align, or simd-ness they conflict.
      const repr_characteristica = (def: AdtDef): [Align | undefined, Align | undefined, boolean] => [
        def.repr().pack,
        def.repr().align,
        def.repr().simd(),
      ];
      const opt_align_eq = (x: Align | undefined, y: Align | undefined): boolean =>
        x === undefined || y === undefined ? x === y : Align_eq(x, y);
      const [a_pack, a_align, a_simd] = repr_characteristica(a_def);
      const [b_pack, b_align, b_simd] = repr_characteristica(b_def);
      if (!(opt_align_eq(a_pack, b_pack) && opt_align_eq(a_align, b_align) && a_simd === b_simd)) {
        return false;
      }

      // Grab a flattened representation of all fields.
      const a_fields = a_def.variants().flatMap((v) => v.fields);
      const b_fields = b_def.variants().flatMap((v) => v.fields);

      // Perform a structural comparison for each field.
      return eq_by(a_fields, b_fields, ({ did: a_did }, { did: b_did }) =>
        structurally_same_type_impl(
          seen_types,
          tcx,
          typing_env,
          Unnormalized.skip_norm_wip(EarlyBinder.instantiate(tcx.type_of(a_did) as EarlyBinder<Ty>, tcx, a_gen_args, fold_Ty)),
          Unnormalized.skip_norm_wip(EarlyBinder.instantiate(tcx.type_of(b_did) as EarlyBinder<Ty>, tcx, b_gen_args, fold_Ty)),
        ),
      );
    } else if (ak.$ === "Array" && bk.$ === "Array") {
      // For arrays, we also check the length.
      return ak._1 === bk._1 && structurally_same_type_impl(seen_types, tcx, typing_env, ak._0, bk._0);
    } else if (ak.$ === "Slice" && bk.$ === "Slice") {
      return structurally_same_type_impl(seen_types, tcx, typing_env, ak._0, bk._0);
    } else if (ak.$ === "RawPtr" && bk.$ === "RawPtr") {
      return ak._1 === bk._1 && structurally_same_type_impl(seen_types, tcx, typing_env, ak._0, bk._0);
    } else if (ak.$ === "Ref" && bk.$ === "Ref") {
      // For structural sameness, we don't need the region to be same.
      return ak._2 === bk._2 && structurally_same_type_impl(seen_types, tcx, typing_env, ak._1, bk._1);
    } else if (ak.$ === "FnDef" && bk.$ === "FnDef") {
      const a_poly_sig = a.fn_sig(tcx);
      const b_poly_sig = b.fn_sig(tcx);

      // We don't compare regions, but leaving bound regions around ICEs, so
      // we erase them.
      const a_sig = tcx.instantiate_bound_regions_with_erased(a_poly_sig, fold_FnSig);
      const b_sig = tcx.instantiate_bound_regions_with_erased(b_poly_sig, fold_FnSig);

      // FIXME(splat): Is splatting ever repr(C)?
      // Can two splatted functions to have the same structure?
      // Can a splatted and non-splatted function have the same structure?
      // For now, we require splatting to match exactly.
      if (FnSig.splatted(a_sig) !== FnSig.splatted(b_sig)) {
        return false;
      }

      return (
        ExternAbi.eq(FnSig.abi(a_sig), FnSig.abi(b_sig)) &&
        FnSig.safety(a_sig) === FnSig.safety(b_sig) &&
        FnSig.c_variadic(a_sig) === FnSig.c_variadic(b_sig) &&
        eq_by(FnSig.inputs(a_sig), FnSig.inputs(b_sig), (a, b) => structurally_same_type_impl(seen_types, tcx, typing_env, a, b)) &&
        structurally_same_type_impl(seen_types, tcx, typing_env, FnSig.output(a_sig), FnSig.output(b_sig))
      );
    } else if (ak.$ === "Tuple" && bk.$ === "Tuple") {
      // Tuples are not `repr(C)` so these cannot be compared structurally.
      return false;
    }
    // For these, it's not quite as easy to define structural-sameness quite so easily.
    // For the purposes of this lint, take the conservative approach and mark them as
    // not structurally same.
    else if (
      (ak.$ === "Dynamic" && bk.$ === "Dynamic") ||
      (ak.$ === "Error" && bk.$ === "Error") ||
      (ak.$ === "Closure" && bk.$ === "Closure") ||
      (ak.$ === "Coroutine" && bk.$ === "Coroutine") ||
      (ak.$ === "CoroutineWitness" && bk.$ === "CoroutineWitness") ||
      (ak.$ === "Alias" && ak._1.kind.$ === "Projection" && bk.$ === "Alias" && bk._1.kind.$ === "Projection") ||
      (ak.$ === "Alias" && ak._1.kind.$ === "Inherent" && bk.$ === "Alias" && bk._1.kind.$ === "Inherent") ||
      (ak.$ === "Alias" && ak._1.kind.$ === "Opaque" && bk.$ === "Alias" && bk._1.kind.$ === "Opaque")
    ) {
      return false;
    }

    // These definitely should have been caught above.
    else if (
      (ak.$ === "Bool" && bk.$ === "Bool") ||
      (ak.$ === "Char" && bk.$ === "Char") ||
      (ak.$ === "Never" && bk.$ === "Never") ||
      (ak.$ === "Str" && bk.$ === "Str")
    ) {
      return unreachable();
    }

    // An Adt and a primitive or pointer type. This can be FFI-safe if non-null
    // enum layout optimisation is being applied.
    else if ((ak.$ === "Adt" || ak.$ === "Pat") && is_primitive_or_pointer(b)) {
      const a_inner = types.repr_nullable_ptr(tcx, typing_env, a);
      if (a_inner !== undefined) {
        return a_inner === b;
      } else {
        return false;
      }
    } else if ((bk.$ === "Adt" || bk.$ === "Pat") && is_primitive_or_pointer(a)) {
      const b_inner = types.repr_nullable_ptr(tcx, typing_env, b);
      if (b_inner !== undefined) {
        return b_inner === a;
      } else {
        return false;
      }
    } else {
      return false;
    }
  }
}
