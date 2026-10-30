// Port of compiler/rustc_middle/src/ty/generic_args.rs (contract stub by lane ty-contract, docs/plan-m3.md D2/D3;
// the rest by lane ty-args).
//
// PORT (D3):
// - `GenericArg` (upstream a pointer to a `Ty`/`Region`/`Const` with the kind in its low tag bits) is the union
//   `Ty | Region | Const` of the hash-consed objects: packing is the identity, and `GenericArg.kind(arg)` reads
//   the tag from the object's class. Equality is `===` (upstream: the tagged pointer). Its inherent methods are
//   functions on the `GenericArg` companion (PORTING §8 "enum methods live on the companion").
// - `GenericArgs` is `List<GenericArg>`; its methods (`impl GenericArgs`, `impl inherent::GenericArgs for
//   GenericArgsRef`) are `RawList.prototype` methods typed `this: GenericArgs`, declared in decls.ts; statics
//   (`GenericArgs::identity_for_item`, ...) are on `RawList`. A method of the `inherent::GenericArgs` impl that only
//   forwards to the inherent method of the same name is that method (its marker sits on it).
// - The derived `PartialOrd`/`Ord` of `GenericArg` compare pointer addresses; nothing ported may rely on them.
// - `impl Iterator` results (`types`, `regions`, ...) are arrays (the closures have no side effects).
// - `SmallVec<[GenericArg; 8]>` is `GenericArg[]`.
import type { MutRef } from "../../std/mut_ref.ts";
import type { DiagArgValue, PathBuf } from "../../rustc_error_messages/lib.ts";
import { String_into_diag_arg } from "../../rustc_error_messages/diagnostic_impls.ts";
import type { DefId } from "../../rustc_span/def_id.ts";
import type { Decoder, Encodable } from "../../rustc_serialize/serialize.ts";
import type { TyEncoder } from "./codec.ts";
import type { ClosureArgs, ClosureArgsParts, CoroutineArgs, CoroutineArgsParts, CoroutineClosureArgs, CoroutineClosureArgsParts, GenericArgKind } from "../../rustc_type_ir/decls.ts";
import { type TypeFoldable } from "../../rustc_type_ir/fold.ts";
import { Const, fold_Const, fold_Region, Region } from "../../rustc_type_ir/sty/mod.ts";
import { TypeWalker } from "../../rustc_type_ir/walk.ts";
import { type Fmt, PLAIN, PRETTY } from "../../std/fmt.ts";
import { panic, unported } from "../../std/panic.ts";
import { slice_to } from "../../std/slice.ts";
import { Ok } from "../../std/result.ts";
import { bug } from "../../rustc_span/macros.ts";
import { RawList, type List } from "./list.ts";
import { debug_Ty, Term, Ty } from "./mod.ts";
import type { FallibleTypeFolder, TypeFolder } from "../../rustc_type_ir/fold.ts";
import { try_visit } from "../../rustc_ast_ir/visit.ts";
import { type TypeVisitable, visit_with_slice, type TypeVisitor } from "../../rustc_type_ir/visit.ts";
import { debug_RawList } from "./list.ts";
import { debug_list } from "../../std/fmt.ts";
import type { Result } from "../../std/result.ts";
import type { TyCtxt } from "./context.ts";
import { debug_Generics, type GenericParamDef, GenericParamDef as GenericParamDefC, type Generics } from "./generics.ts";
import type { InlineConstArgs } from "./sty.gen.ts";
import { debug_GenericArg, fold_Ty } from "./structural_impls.ts";

// The other types of generic_args.rs with their derived impls are generated into generic_args.gen.ts (set rustc_ty of
// tools/codegen/types.ts, lane codegen-tyir); merged with the contract stub by merge-w13.
export * from "./generic_args.gen.ts";

/// An entity in the Rust type system, which can be one of
/// several kinds (types, lifetimes, and consts).
/// To reduce memory usage, a `GenericArg` is an interned pointer,
/// with the lowest 2 bits being reserved for a tag to
/// indicate the type (`Ty`, `Region`, or `Const`) it points to.
///
/// Note: the `PartialEq`, `Eq` and `Hash` derives are only valid because `Ty`,
/// `Region` and `Const` are all interned.
// rustc-type: compiler/rustc_middle/src/ty/generic_args.rs:37 GenericArg
export type GenericArg = Ty | Region | Const;

// rustc-type: compiler/rustc_middle/src/ty/generic_args.rs:378 GenericArgs
export type GenericArgs = List<GenericArg>;
/** `pub type GenericArgsRef<'tcx> = &'tcx GenericArgs<'tcx>` (generic_args.rs:380). */
export type GenericArgsRef = GenericArgs;

// ---- impl inherent::GenericArgs for GenericArgsRef (generic_args.rs:44) ----
// `rebase_onto`, `type_at`, `region_at`, `const_at`, `identity_for_item` and `extend_with_error` forward to the inherent
// methods of the same name (module comment); the three `split_*` are here.

// rustc: compiler/rustc_middle/src/ty/generic_args.rs:81 split_closure_args
RawList.prototype.split_closure_args = function (this: GenericArgs): ClosureArgsParts {
  // [ref parent_args @ .., closure_kind_ty, closure_sig_as_fn_ptr_ty, tupled_upvars_ty]
  const n = this.length;
  if (n >= 3) {
    const parent_args = this.slice(0, n - 3);
    const closure_kind_ty = this[n - 3]!;
    const closure_sig_as_fn_ptr_ty = this[n - 2]!;
    const tupled_upvars_ty = this[n - 1]!;
    return {
      parent_args,
      closure_kind_ty: GenericArg.expect_ty(closure_kind_ty),
      closure_sig_as_fn_ptr_ty: GenericArg.expect_ty(closure_sig_as_fn_ptr_ty),
      tupled_upvars_ty: GenericArg.expect_ty(tupled_upvars_ty),
    };
  } else {
    return bug("closure args missing synthetics");
  }
};

// rustc: compiler/rustc_middle/src/ty/generic_args.rs:95 split_coroutine_closure_args
RawList.prototype.split_coroutine_closure_args = function (this: GenericArgs): CoroutineClosureArgsParts {
  // [ref parent_args @ .., closure_kind_ty, signature_parts_ty, tupled_upvars_ty, coroutine_captures_by_ref_ty]
  const n = this.length;
  if (n >= 4) {
    const parent_args = this.slice(0, n - 4);
    const closure_kind_ty = this[n - 4]!;
    const signature_parts_ty = this[n - 3]!;
    const tupled_upvars_ty = this[n - 2]!;
    const coroutine_captures_by_ref_ty = this[n - 1]!;
    return {
      parent_args,
      closure_kind_ty: GenericArg.expect_ty(closure_kind_ty),
      signature_parts_ty: GenericArg.expect_ty(signature_parts_ty),
      tupled_upvars_ty: GenericArg.expect_ty(tupled_upvars_ty),
      coroutine_captures_by_ref_ty: GenericArg.expect_ty(coroutine_captures_by_ref_ty),
    };
  } else {
    return bug("closure args missing synthetics");
  }
};

// rustc: compiler/rustc_middle/src/ty/generic_args.rs:114 split_coroutine_args
RawList.prototype.split_coroutine_args = function (this: GenericArgs): CoroutineArgsParts {
  // [ref parent_args @ .., kind_ty, resume_ty, yield_ty, return_ty, tupled_upvars_ty]
  const n = this.length;
  if (n >= 5) {
    const parent_args = this.slice(0, n - 5);
    const kind_ty = this[n - 5]!;
    const resume_ty = this[n - 4]!;
    const yield_ty = this[n - 3]!;
    const return_ty = this[n - 2]!;
    const tupled_upvars_ty = this[n - 1]!;
    return {
      parent_args,
      kind_ty: GenericArg.expect_ty(kind_ty),
      resume_ty: GenericArg.expect_ty(resume_ty),
      yield_ty: GenericArg.expect_ty(yield_ty),
      return_ty: GenericArg.expect_ty(return_ty),
      tupled_upvars_ty: GenericArg.expect_ty(tupled_upvars_ty),
    };
  } else {
    return bug("coroutine args missing synthetics");
  }
};

/** `impl IntoDiagArg for GenericArg`: `self.to_string().into_diag_arg(&mut None)`.
 *  PORT: `to_string` is the `Display` impl (`forward_display_to_print!`, ty/print/pretty.ts `display_GenericArg`), loaded
 *  lazily: pretty.ts is an extension module, which a defining module must not import (ty-contract "Init order"). */
// rustc: compiler/rustc_middle/src/ty/generic_args.rs:158 into_diag_arg
export function GenericArg_into_diag_arg(self: GenericArg, _: MutRef<PathBuf | undefined>): DiagArgValue {
  return String_into_diag_arg(pretty().display_GenericArg(self), { value: undefined });
}

/** PORT: lazy load of the extension module ty/print/pretty.ts (see `GenericArg_into_diag_arg`). */
function pretty(): typeof import("./print/pretty.ts") {
  return (pretty__m ??= require("./print/pretty.ts") as typeof import("./print/pretty.ts"));
}
var pretty__m: typeof import("./print/pretty.ts") | undefined; // PORT (perf-intern): lazy-require memo (docs/handoff/perf-intern.md)
/** PORT (init order): ty/util.ts is an extension module that imports this file; reached lazily. */
function ty_util(): typeof import("./util.ts") {
  return (ty_util__m ??= require("./util.ts") as typeof import("./util.ts"));
}
var ty_util__m: typeof import("./util.ts") | undefined; // PORT (perf-intern): lazy-require memo (docs/handoff/perf-intern.md)

export const GenericArg = {
  // rustc: compiler/rustc_middle/src/ty/generic_args.rs:196 from
  /** `impl From<Region> for GenericArg` */
  from_Region(r: Region): GenericArg {
    return GenericArg.pack({ $: "Lifetime", _0: r });
  },

  // rustc: compiler/rustc_middle/src/ty/generic_args.rs:203 from
  /** `impl From<Ty> for GenericArg` */
  from_Ty(ty: Ty): GenericArg {
    return GenericArg.pack({ $: "Type", _0: ty });
  },

  // rustc: compiler/rustc_middle/src/ty/generic_args.rs:210 from
  /** `impl From<Const> for GenericArg` */
  from_Const(c: Const): GenericArg {
    return GenericArg.pack({ $: "Const", _0: c });
  },

  // rustc: compiler/rustc_middle/src/ty/generic_args.rs:216 from
  /** `impl From<Term> for GenericArg` */
  from_Term(value: Term): GenericArg {
    const k = Term.kind(value);
    switch (k.$) {
      case "Ty":
        return GenericArg.from_Ty(k._0);
      case "Const":
        return GenericArg.from_Const(k._0);
    }
  },

  // PORT: also `impl IntoKind for GenericArg` (generic_args.rs:135, `self.kind()`): one function. The tag bits
  // are the object's class (module comment).
  // rustc: compiler/rustc_middle/src/ty/generic_args.rs:135 kind
  // rustc: compiler/rustc_middle/src/ty/generic_args.rs:226 kind
  kind(self: GenericArg): GenericArgKind {
    // SAFETY: use of `Interned::new_unchecked` here is ok because these
    // pointers were originally created from `Interned` types in `pack()`,
    // and this is just going in the other direction.
    if (self instanceof Region) return { $: "Lifetime", _0: self };
    if (self instanceof Ty) return { $: "Type", _0: self };
    if (self instanceof Const) return { $: "Const", _0: self };
    return panic_unreachable();
  },

  // rustc: compiler/rustc_middle/src/ty/generic_args.rs:249 as_region
  as_region(self: GenericArg): Region | undefined {
    const k = GenericArg.kind(self);
    return k.$ === "Lifetime" ? k._0 : undefined;
  },

  // rustc: compiler/rustc_middle/src/ty/generic_args.rs:257 as_type
  as_type(self: GenericArg): Ty | undefined {
    const k = GenericArg.kind(self);
    return k.$ === "Type" ? k._0 : undefined;
  },

  // rustc: compiler/rustc_middle/src/ty/generic_args.rs:265 as_const
  as_const(self: GenericArg): Const | undefined {
    const k = GenericArg.kind(self);
    return k.$ === "Const" ? k._0 : undefined;
  },

  // rustc: compiler/rustc_middle/src/ty/generic_args.rs:273 as_term
  as_term(self: GenericArg): Term | undefined {
    const k = GenericArg.kind(self);
    switch (k.$) {
      case "Lifetime":
        return undefined;
      case "Type":
        return Term.from_Ty(k._0);
      case "Const":
        return Term.from_Const(k._0);
    }
  },

  /// Unpack the `GenericArg` as a region when it is known certainly to be a region.
  // rustc: compiler/rustc_middle/src/ty/generic_args.rs:282 expect_region
  expect_region(self: GenericArg): Region {
    return GenericArg.as_region(self) ?? bug("expected a region, but found another kind");
  },

  /// Unpack the `GenericArg` as a type when it is known certainly to be a type.
  /// This is true in cases where `GenericArgs` is used in places where the kinds are known
  /// to be limited (e.g. in tuples, where the only parameters are type parameters).
  // rustc: compiler/rustc_middle/src/ty/generic_args.rs:289 expect_ty
  expect_ty(self: GenericArg): Ty {
    return GenericArg.as_type(self) ?? bug("expected a type, but found another kind");
  },

  /// Unpack the `GenericArg` as a const when it is known certainly to be a const.
  // rustc: compiler/rustc_middle/src/ty/generic_args.rs:294 expect_const
  expect_const(self: GenericArg): Const {
    return GenericArg.as_const(self) ?? bug("expected a const, but found another kind");
  },

  // rustc: compiler/rustc_middle/src/ty/generic_args.rs:298 is_non_region_infer
  is_non_region_infer(self: GenericArg): boolean {
    const k = GenericArg.kind(self);
    switch (k.$) {
      case "Lifetime":
        return false;
      // FIXME: This shouldn't return numerical/float.
      case "Type":
        return k._0.is_ty_or_numeric_infer();
      case "Const":
        return k._0.is_ct_infer();
    }
  },

  /// Iterator that walks `self` and any types reachable from
  /// `self`, in depth-first order. Note that just walks the types
  /// that appear in `self`, it does not descend into the fields of
  /// structs or variants. For example:
  ///
  /// ```text
  /// isize => { isize }
  /// Foo<Bar<isize>> => { Foo<Bar<isize>>, Bar<isize>, isize }
  /// [isize] => { [isize], isize }
  /// ```
  // rustc: compiler/rustc_middle/src/ty/generic_args.rs:317 walk
  walk(self: GenericArg): TypeWalker {
    return TypeWalker.new(self);
  },

  // PORT: `GenericArgPackExt::pack`: the tagged pointer is the object itself (module comment).
  // rustc: compiler/rustc_middle/src/ty/generic_args.rs:171 pack
  pack(self: GenericArgKind): GenericArg {
    switch (self.$) {
      case "Lifetime":
        // Ensure we can use the tag bits.
        // PORT: `assert_eq!(align_of_val(..) & TAG_MASK, 0)` has no meaning without pointers.
        return self._0;
      case "Type":
        return self._0;
      case "Const":
        return self._0;
    }
  },
};

/** `intrinsics::unreachable()` in `GenericArg::kind`: a tag that is no kind. */
function panic_unreachable(): never {
  return bug("GenericArg::kind: not a Ty, Region or Const");
}

// rustc-skip: compiler/rustc_middle/src/ty/generic_args.rs:325 lift_to_interner Lift impl (rustc's Lift: skipped per PORTING §3)

/** `impl Debug for GenericArg` (structural_impls.rs:145, lane ty-results), re-exported for generated code. */
export { debug_GenericArg };

/** D4 descriptor: `impl TypeFoldable for GenericArg` (generic_args.rs:334) + `TypeVisitable` (:355).
 *  PORT: `ty.try_fold_with(folder)` etc. are the `Ty` impls of structural_impls.rs (`fold_Ty`); `Region` / `Const`
 *  are rustc_type_ir sty's `fold_Region` / `fold_Const`. */
export const fold_GenericArg: TypeFoldable<GenericArg> = {
  // rustc: compiler/rustc_middle/src/ty/generic_args.rs:335 try_fold_with
  try_fold_with<E>(self: GenericArg, folder: FallibleTypeFolder<E>): Result<GenericArg, E> {
    const k = GenericArg.kind(self);
    switch (k.$) {
      case "Lifetime": {
        const r = fold_Region.try_fold_with(k._0, folder);
        return r.$ === "Err" ? r : Ok(GenericArg.from_Region(r._0));
      }
      case "Type": {
        const r = fold_Ty.try_fold_with(k._0, folder);
        return r.$ === "Err" ? r : Ok(GenericArg.from_Ty(r._0));
      }
      case "Const": {
        const r = fold_Const.try_fold_with(k._0, folder);
        return r.$ === "Err" ? r : Ok(GenericArg.from_Const(r._0));
      }
    }
  },

  // rustc: compiler/rustc_middle/src/ty/generic_args.rs:346 fold_with
  fold_with(self: GenericArg, folder: TypeFolder): GenericArg {
    const k = GenericArg.kind(self);
    switch (k.$) {
      case "Lifetime":
        return GenericArg.from_Region(fold_Region.fold_with(k._0, folder));
      case "Type":
        return GenericArg.from_Ty(fold_Ty.fold_with(k._0, folder));
      case "Const":
        return GenericArg.from_Const(fold_Const.fold_with(k._0, folder));
    }
  },

  // rustc: compiler/rustc_middle/src/ty/generic_args.rs:356 visit_with
  visit_with<R>(self: GenericArg, visitor: TypeVisitor<R>): R {
    const k = GenericArg.kind(self);
    switch (k.$) {
      case "Lifetime":
        return fold_Region.visit_with(k._0, visitor);
      case "Type":
        return fold_Ty.visit_with(k._0, visitor);
      case "Const":
        return fold_Const.visit_with(k._0, visitor);
    }
  },
};

// impl<'tcx, E: TyEncoder<'tcx>> Encodable<E> for GenericArg<'tcx>
// PORT: `GenericArgKind: Encodable<E>` is `encode_GenericArgKind` (derived; tools/codegen), as for `decode_GenericArg`.
// rustc: compiler/rustc_middle/src/ty/generic_args.rs:366 encode
export function encode_GenericArg<E extends TyEncoder>(self: GenericArg, e: E, encode_GenericArgKind: Encodable<GenericArgKind, E>): void {
  encode_GenericArgKind(GenericArg.kind(self), e);
}

/** `impl<D: TyDecoder> Decodable<D> for GenericArg`: `GenericArgKind::decode(d).pack()`.
 *  PORT: `GenericArgKind: Decodable<D>` is `decode_GenericArgKind` (derived; tools/codegen). */
// rustc: compiler/rustc_middle/src/ty/generic_args.rs:372 decode
export function decode_GenericArg<D extends Decoder>(d: D, decode_GenericArgKind: (d: D) => GenericArgKind): GenericArg {
  return GenericArg.pack(decode_GenericArgKind(d));
}

/** PORT: `&self[i]` with core's `panic_bounds_check` text (no index panics silently into `undefined`). */
function index<T>(v: readonly T[], i: number): T {
  if (i < 0 || i >= v.length) panic(`index out of bounds: the len is ${v.length} but the index is ${i}`);
  return v[i]!;
}

// ---- impl GenericArgs (generic_args.rs:382) ----

/// Converts generic args to a type list.
///
/// # Panics
///
/// If any of the generic arguments are not types.
// rustc: compiler/rustc_middle/src/ty/generic_args.rs:388 into_type_list
RawList.prototype.into_type_list = function (this: GenericArgs, tcx: TyCtxt): List<Ty> {
  return tcx.mk_type_list_from_iter(
    this.map((arg) => {
      const k = GenericArg.kind(arg);
      switch (k.$) {
        case "Type":
          return k._0;
        default:
          return bug("`into_type_list` called on generic arg with non-types");
      }
    }),
  );
};

/// Interpret these generic args as the args of a closure type.
/// Closure args have a particular structure controlled by the
/// compiler that encodes information like the signature and closure kind;
/// see `ty::ClosureArgs` struct for more comments.
// rustc: compiler/rustc_middle/src/ty/generic_args.rs:399 as_closure
RawList.prototype.as_closure = function (this: GenericArgs): ClosureArgs {
  return { args: this };
};

/// Interpret these generic args as the args of a coroutine-closure type.
/// Coroutine-closure args have a particular structure controlled by the
/// compiler that encodes information like the signature and closure kind;
/// see `ty::CoroutineClosureArgs` struct for more comments.
// rustc: compiler/rustc_middle/src/ty/generic_args.rs:407 as_coroutine_closure
RawList.prototype.as_coroutine_closure = function (this: GenericArgs): CoroutineClosureArgs {
  return { args: this };
};

/// Interpret these generic args as the args of a coroutine type.
/// Coroutine args have a particular structure controlled by the
/// compiler that encodes information like the signature and coroutine kind;
/// see `ty::CoroutineArgs` struct for more comments.
// rustc: compiler/rustc_middle/src/ty/generic_args.rs:415 as_coroutine
RawList.prototype.as_coroutine = function (this: GenericArgs): CoroutineArgs {
  return { args: this };
};

/// Interpret these generic args as the args of an inline const.
/// Inline const args have a particular structure controlled by the
/// compiler that encodes information like the inferred type;
/// see `ty::InlineConstArgs` struct for more comments.
// rustc: compiler/rustc_middle/src/ty/generic_args.rs:423 as_inline_const
RawList.prototype.as_inline_const = function (this: GenericArgs): InlineConstArgs {
  return { args: this };
};

/// Creates a [`GenericArgs`] that maps each generic parameter to itself.
// PORT: also `impl inherent::GenericArgs` `identity_for_item` (generic_args.rs:69): one function. `impl Into<DefId>` is
// `DefId`.
// rustc: compiler/rustc_middle/src/ty/generic_args.rs:69 identity_for_item
// rustc: compiler/rustc_middle/src/ty/generic_args.rs:428 identity_for_item
RawList.identity_for_item = function (tcx: TyCtxt, def_id: DefId): GenericArgs {
  return RawList.for_item(tcx, def_id, (param, _) => tcx.mk_param_from_def(param));
};

/// Creates a [`GenericArgs`] for generic parameter definitions,
/// by calling closures to obtain each kind.
/// The closures get to observe the [`GenericArgs`] as they're
/// being built, which can be used to correctly
/// replace defaults of generic parameters.
// rustc: compiler/rustc_middle/src/ty/generic_args.rs:437 for_item
RawList.for_item = function (tcx: TyCtxt, def_id: DefId, mk_kind: (param: GenericParamDef, args: readonly GenericArg[]) => GenericArg): GenericArgs {
  // PORT: `generics_of` is typed `unknown` by queries.gen.ts until its value type is generated.
  const defs = tcx.generics_of(def_id) as Generics;
  const count = defs.count();
  void count; // `SmallVec::with_capacity(count)`
  const args: GenericArg[] = [];
  RawList.fill_item(args, tcx, defs, mk_kind);
  return tcx.mk_args(args);
};

// rustc: compiler/rustc_middle/src/ty/generic_args.rs:448 extend_to
RawList.prototype.extend_to = function (this: GenericArgs, tcx: TyCtxt, def_id: DefId, mk_kind: (param: GenericParamDef, args: readonly GenericArg[]) => GenericArg): GenericArgs {
  return RawList.for_item(tcx, def_id, (param, args) => this[param.index] ?? mk_kind(param, args));
};

// rustc: compiler/rustc_middle/src/ty/generic_args.rs:462 fill_item
RawList.fill_item = function (args: GenericArg[], tcx: TyCtxt, defs: Generics, mk_kind: (param: GenericParamDef, args: readonly GenericArg[]) => GenericArg): void {
  if (defs.parent !== undefined) {
    const def_id = defs.parent;
    const parent_defs = tcx.generics_of(def_id) as Generics;
    RawList.fill_item(args, tcx, parent_defs, mk_kind);
  }
  RawList.fill_single(args, defs, mk_kind);
};

// rustc: compiler/rustc_middle/src/ty/generic_args.rs:477 fill_single
RawList.fill_single = function (args: GenericArg[], defs: Generics, mk_kind: (param: GenericParamDef, args: readonly GenericArg[]) => GenericArg): void {
  // `args.reserve(defs.own_params.len())`
  for (const param of defs.own_params) {
    const kind = mk_kind(param, args);
    if (param.index !== args.length) {
      // `assert_eq!(param.index as usize, args.len(), "{args:#?}, {defs:#?}")`
      panic(
        `assertion \`left == right\` failed: ${debug_list(PRETTY, args.map((a) => debug_GenericArg(a, PRETTY)))}, ${debug_Generics(defs, PRETTY)}\n  left: ${param.index}\n right: ${args.length}`,
      );
    }
    args.push(kind);
  }
};

// Extend an `original_args` list to the full number of args expected by `def_id`,
// filling in the missing parameters with error ty/ct or 'static regions.
// PORT: also `impl inherent::GenericArgs` `extend_with_error` (generic_args.rs:73): one function.
// rustc: compiler/rustc_middle/src/ty/generic_args.rs:73 extend_with_error
// rustc: compiler/rustc_middle/src/ty/generic_args.rs:494 extend_with_error
RawList.extend_with_error = function (tcx: TyCtxt, def_id: DefId, original_args: readonly GenericArg[]): GenericArgs {
  return RawList.for_item(tcx, def_id, (def, _) => {
    const arg = original_args[def.index];
    if (arg !== undefined) {
      return arg;
    } else {
      return GenericParamDefC.to_error(def, tcx);
    }
  });
};

// #[inline]
// rustc: compiler/rustc_middle/src/ty/generic_args.rs:509 types
RawList.prototype.types = function (this: GenericArgs): Ty[] {
  return filter_map(this, (k) => GenericArg.as_type(k));
};

// #[inline]
// rustc: compiler/rustc_middle/src/ty/generic_args.rs:514 regions
RawList.prototype.regions = function (this: GenericArgs): Region[] {
  return filter_map(this, (k) => GenericArg.as_region(k));
};

// #[inline]
// rustc: compiler/rustc_middle/src/ty/generic_args.rs:519 consts
RawList.prototype.consts = function (this: GenericArgs): Const[] {
  return filter_map(this, (k) => GenericArg.as_const(k));
};

// #[inline]
// rustc: compiler/rustc_middle/src/ty/generic_args.rs:524 terms
RawList.prototype.terms = function (this: GenericArgs): Term[] {
  return filter_map(this, (k) => GenericArg.as_term(k));
};

/// Returns generic arguments that are not lifetimes.
// #[inline]
// rustc: compiler/rustc_middle/src/ty/generic_args.rs:530 non_erasable_generics
RawList.prototype.non_erasable_generics = function (this: GenericArgs): GenericArgKind[] {
  return filter_map(this, (arg) => {
    const generic = GenericArg.kind(arg);
    switch (generic.$) {
      case "Lifetime":
        return undefined;
      default:
        return generic;
    }
  });
};

/** `iter().filter_map(f)` collected (module comment). */
function filter_map<T, U>(v: readonly T[], f: (x: T) => U | undefined): U[] {
  const out: U[] = [];
  for (const x of v) {
    const y = f(x);
    if (y !== undefined) out.push(y);
  }
  return out;
}

// PORT: also `impl inherent::GenericArgs` `type_at` (generic_args.rs:55): one method.
// #[inline] #[track_caller]
// rustc: compiler/rustc_middle/src/ty/generic_args.rs:55 type_at
// rustc: compiler/rustc_middle/src/ty/generic_args.rs:539 type_at
RawList.prototype.type_at = function (this: GenericArgs, i: number): Ty {
  return GenericArg.as_type(index(this, i)) ?? bug(`expected type for param #${i} in ${debug_GenericArgs(this, PLAIN)}`);
};

// PORT: also `impl inherent::GenericArgs` `region_at` (generic_args.rs:60): one method.
// #[inline] #[track_caller]
// rustc: compiler/rustc_middle/src/ty/generic_args.rs:60 region_at
// rustc: compiler/rustc_middle/src/ty/generic_args.rs:548 region_at
RawList.prototype.region_at = function (this: GenericArgs, i: number): Region {
  return GenericArg.as_region(index(this, i)) ?? bug(`expected region for param #${i} in ${debug_GenericArgs(this, PLAIN)}`);
};

// PORT: also `impl inherent::GenericArgs` `const_at` (generic_args.rs:65): one method.
// #[inline] #[track_caller]
// rustc: compiler/rustc_middle/src/ty/generic_args.rs:65 const_at
// rustc: compiler/rustc_middle/src/ty/generic_args.rs:557 const_at
RawList.prototype.const_at = function (this: GenericArgs, i: number): Const {
  return GenericArg.as_const(index(this, i)) ?? bug(`expected const for param #${i} in ${debug_GenericArgs(this, PLAIN)}`);
};

// #[inline] #[track_caller]
// rustc: compiler/rustc_middle/src/ty/generic_args.rs:566 type_for_def
RawList.prototype.type_for_def = function (this: GenericArgs, def: GenericParamDef): GenericArg {
  return GenericArg.from_Ty(this.type_at(def.index));
};

/// Transform from generic args for a child of `source_ancestor`
/// (e.g., a trait or impl) to args for the same child
/// in a different item, with `target_args` as the base for
/// the target impl/trait, with the source child-specific
/// parameters (e.g., method parameters) on top of that base.
///
/// For example given:
///
/// ```no_run
/// trait X<S> { fn f<T>(); }
/// impl<U> X<U> for U { fn f<V>() {} }
/// ```
///
/// * If `self` is `[Self, S, T]`: the identity args of `f` in the trait.
/// * If `source_ancestor` is the def_id of the trait.
/// * If `target_args` is `[U]`, the args for the impl.
/// * Then we will return `[U, T]`, the arg for `f` in the impl that
///   are needed for it to match the trait.
// PORT: also `impl inherent::GenericArgs` `rebase_onto` (generic_args.rs:45): one method.
// rustc: compiler/rustc_middle/src/ty/generic_args.rs:45 rebase_onto
// rustc: compiler/rustc_middle/src/ty/generic_args.rs:588 rebase_onto
RawList.prototype.rebase_onto = function (this: GenericArgs, tcx: TyCtxt, source_ancestor: DefId, target_args: GenericArgs): GenericArgs {
  const defs = tcx.generics_of(source_ancestor) as Generics;
  return tcx.mk_args_from_iter([...target_args, ...this.slice(defs.count())]);
};

/// Truncates this list of generic args to have at most the number of args in `generics`.
///
/// You might be looking for [`TraitRef::from_assoc`](super::TraitRef::from_assoc).
// rustc: compiler/rustc_middle/src/ty/generic_args.rs:601 truncate_to
RawList.prototype.truncate_to = function (this: GenericArgs, tcx: TyCtxt, generics: Generics): GenericArgs {
  return tcx.mk_args(slice_to(this, generics.count()));
};

// rustc: compiler/rustc_middle/src/ty/generic_args.rs:605 print_as_list
RawList.prototype.print_as_list = function (this: GenericArgs): string {
  const v = this.map((arg) => pretty().display_GenericArg(arg));
  return `[${v.join(", ")}]`;
};

/** D4 descriptor: `impl TypeFoldable for GenericArgsRef` (generic_args.rs:611) + `TypeVisitable for &List<T>` (:714). */
export const fold_GenericArgs: TypeFoldable<GenericArgs> = {
  // rustc: compiler/rustc_middle/src/ty/generic_args.rs:612 try_fold_with
  try_fold_with<E>(self: GenericArgs, folder: FallibleTypeFolder<E>): Result<GenericArgs, E> {
    // This code is hot enough that it's worth specializing for the most
    // common length lists, to avoid the overhead of `SmallVec` creation.
    // The match arms are in order of frequency. The 1, 2, and 0 cases are
    // typically hit in 90--99.99% of cases. When folding doesn't change
    // the args, it's faster to reuse the existing args rather than
    // calling `mk_args`.
    switch (self.length) {
      case 1: {
        const param0 = fold_GenericArg.try_fold_with(self[0]!, folder);
        if (param0.$ === "Err") return param0;
        if (param0._0 === self[0]) {
          return Ok(self);
        } else {
          return Ok(folder.cx().mk_args([param0._0]));
        }
      }
      case 2: {
        const param0 = fold_GenericArg.try_fold_with(self[0]!, folder);
        if (param0.$ === "Err") return param0;
        const param1 = fold_GenericArg.try_fold_with(self[1]!, folder);
        if (param1.$ === "Err") return param1;
        if (param0._0 === self[0] && param1._0 === self[1]) {
          return Ok(self);
        } else {
          return Ok(folder.cx().mk_args([param0._0, param1._0]));
        }
      }
      case 0:
        return Ok(self);
      default:
        return ty_util().try_fold_list(self, folder, (tcx, v) => tcx.mk_args(v), fold_GenericArg);
    }
  },

  // rustc: compiler/rustc_middle/src/ty/generic_args.rs:641 fold_with
  fold_with(self: GenericArgs, folder: TypeFolder): GenericArgs {
    // See justification for this behavior in `try_fold_with`.
    switch (self.length) {
      case 1: {
        const param0 = fold_GenericArg.fold_with(self[0]!, folder);
        if (param0 === self[0]) {
          return self;
        } else {
          return folder.cx().mk_args([param0]);
        }
      }
      case 2: {
        const param0 = fold_GenericArg.fold_with(self[0]!, folder);
        const param1 = fold_GenericArg.fold_with(self[1]!, folder);
        if (param0 === self[0] && param1 === self[1]) {
          return self;
        } else {
          return folder.cx().mk_args([param0, param1]);
        }
      }
      case 0:
        return self;
      default:
        return ty_util().fold_list(self, folder, (tcx, v) => tcx.mk_args(v), fold_GenericArg);
    }
  },

  visit_with<R>(self: GenericArgs, visitor: TypeVisitor<R>): R {
    // PORT: (perf) the descriptor is made once (`visit_List` is stateless).
    return (visit_List_GenericArg ??= visit_List(fold_GenericArg)).visit_with(self, visitor);
  },
};

/** D4 descriptor: `impl TypeFoldable for &List<Ty>` (generic_args.rs:663) + `TypeVisitable for &List<T>` (:714). */
export const fold_List_Ty: TypeFoldable<List<Ty>> = {
  // rustc: compiler/rustc_middle/src/ty/generic_args.rs:664 try_fold_with
  try_fold_with<E>(self: List<Ty>, folder: FallibleTypeFolder<E>): Result<List<Ty>, E> {
    // This code is fairly hot, though not as hot as `GenericArgsRef`.
    //
    // When compiling stage 2, I get the following results:
    //
    // len |   total   |   %
    // --- | --------- | -----
    //  2  |  15083590 |  48.1
    //  3  |   7540067 |  24.0
    //  1  |   5300377 |  16.9
    //  4  |   1351897 |   4.3
    //  0  |   1256849 |   4.0
    //
    // I've tried it with some private repositories and got
    // close to the same result, with 4 and 0 swapping places
    // sometimes.
    switch (self.length) {
      case 2: {
        const param0 = fold_Ty.try_fold_with(self[0]!, folder);
        if (param0.$ === "Err") return param0;
        const param1 = fold_Ty.try_fold_with(self[1]!, folder);
        if (param1.$ === "Err") return param1;
        if (param0._0 === self[0] && param1._0 === self[1]) {
          return Ok(self);
        } else {
          return Ok(folder.cx().mk_type_list([param0._0, param1._0]));
        }
      }
      default:
        return ty_util().try_fold_list(self, folder, (tcx, v) => tcx.mk_type_list(v), fold_Ty);
    }
  },

  // rustc: compiler/rustc_middle/src/ty/generic_args.rs:697 fold_with
  fold_with(self: List<Ty>, folder: TypeFolder): List<Ty> {
    // See comment justifying behavior in `try_fold_with`.
    switch (self.length) {
      case 2: {
        const param0 = fold_Ty.fold_with(self[0]!, folder);
        const param1 = fold_Ty.fold_with(self[1]!, folder);
        if (param0 === self[0] && param1 === self[1]) {
          return self;
        } else {
          return folder.cx().mk_type_list([param0, param1]);
        }
      }
      default:
        return ty_util().fold_list(self, folder, (tcx, v) => tcx.mk_type_list(v), fold_Ty);
    }
  },

  visit_with<R>(self: List<Ty>, visitor: TypeVisitor<R>): R {
    // PORT: (perf) the descriptor is made once (`visit_List` is stateless).
    return (visit_List_Ty ??= visit_List(fold_Ty)).visit_with(self, visitor);
  },
};

var visit_List_GenericArg: TypeVisitable<List<GenericArg>> | undefined;
var visit_List_Ty: TypeVisitable<List<Ty>> | undefined;

/** PORT: (perf) `visit_List(d_T)` per `d_T`: the descriptor is stateless, so it is built once per element descriptor. */
const VISIT_LIST_CACHE = new Map<TypeVisitable<unknown>, TypeVisitable<List<unknown>>>();

/** D4 descriptor: `impl<T: TypeVisitable> TypeVisitable for &List<T>`, given the descriptor of `T`. */
export function visit_List<T>(d_T: TypeVisitable<T>): TypeVisitable<List<T>> {
  let d = VISIT_LIST_CACHE.get(d_T as TypeVisitable<unknown>) as TypeVisitable<List<T>> | undefined;
  if (d === undefined) {
    d = make_visit_List(d_T);
    VISIT_LIST_CACHE.set(d_T as TypeVisitable<unknown>, d as TypeVisitable<List<unknown>>);
  }
  return d;
}

function make_visit_List<T>(d_T: TypeVisitable<T>): TypeVisitable<List<T>> {
  return {
    // #[inline]
    // rustc: compiler/rustc_middle/src/ty/generic_args.rs:716 visit_with
    visit_with<R>(self: List<T>, visitor: TypeVisitor<R>): R {
      // walk_visitable_list!(visitor, self.iter());
      let r: R | undefined;
      for (const elem of self) {
        if ((r = try_visit(visitor.Result, d_T.visit_with(elem, visitor))) !== undefined) return r;
      }
      return visitor.Result.output();
    },
  };
}

// ---- tools/codegen's view of the impls above (merge-w13) ----
// PORT: generated code calls `visit_with_<T>` / `try_fold_with_<T>` / `fold_with_<T>` free fns (type_fold.json); for the
// interned types they are the methods of the D4 descriptors above. `I::Tys` = `&List<Ty>`, `I::GenericArgsSlice` =
// `&[GenericArg]` (TyCtxt's `Interner` associated types, rustc_type_ir/interner.ts header).
export type Tys = List<Ty>;
export type GenericArgsSlice = readonly GenericArg[];

export function visit_with_GenericArg<R>(self: GenericArg, visitor: TypeVisitor<R>): R {
  return fold_GenericArg.visit_with(self, visitor);
}
export function try_fold_with_GenericArg<E>(self: GenericArg, folder: FallibleTypeFolder<E>): Result<GenericArg, E> {
  return fold_GenericArg.try_fold_with(self, folder);
}
export function fold_with_GenericArg(self: GenericArg, folder: TypeFolder): GenericArg {
  return fold_GenericArg.fold_with(self, folder);
}
export function visit_with_GenericArgs<R>(self: GenericArgs, visitor: TypeVisitor<R>): R {
  return fold_GenericArgs.visit_with(self, visitor);
}
export function try_fold_with_GenericArgs<E>(self: GenericArgs, folder: FallibleTypeFolder<E>): Result<GenericArgs, E> {
  return fold_GenericArgs.try_fold_with(self, folder);
}
export function fold_with_GenericArgs(self: GenericArgs, folder: TypeFolder): GenericArgs {
  return fold_GenericArgs.fold_with(self, folder);
}
export function visit_with_Tys<R>(self: Tys, visitor: TypeVisitor<R>): R {
  return fold_List_Ty.visit_with(self, visitor);
}
export function try_fold_with_Tys<E>(self: Tys, folder: FallibleTypeFolder<E>): Result<Tys, E> {
  return fold_List_Ty.try_fold_with(self, folder);
}
export function fold_with_Tys(self: Tys, folder: TypeFolder): Tys {
  return fold_List_Ty.fold_with(self, folder);
}
/** `impl TypeVisitable for &[T]` (visit.rs:171 `&T` + :213 `[T]`) with `T = GenericArg`; no TypeFoldable impl. */
export function visit_with_GenericArgsSlice<R>(self: GenericArgsSlice, visitor: TypeVisitor<R>): R {
  return visit_with_slice(self, visitor, visit_with_GenericArg);
}
/** `Debug for &List<GenericArg>`: `RawList`'s Debug (list.rs:192). */
export function debug_GenericArgs(v: GenericArgs, f: Fmt): string {
  return debug_RawList(v, f, debug_GenericArg);
}
/** `Debug for &List<Ty>`: `RawList`'s Debug (list.rs:192). */
export function debug_Tys(v: Tys, f: Fmt): string {
  return debug_RawList(v, f, debug_Ty);
}
/** `Debug for &[GenericArg]`: the slice's Debug. */
export function debug_GenericArgsSlice(v: GenericArgsSlice, f: Fmt): string {
  return debug_list(f, v.map((x) => debug_GenericArg(x, f)));
}
