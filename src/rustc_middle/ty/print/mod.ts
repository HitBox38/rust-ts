// Port of compiler/rustc_middle/src/ty/print/mod.rs (lane ty-print-a, docs/plan-m3.md D7).
//
// PORT decisions (docs/handoff/ty-print-a.md):
// - `PrintError` is `std::fmt::Error` (a unit struct): `{ $: "Error" }`. `Result<(), PrintError>` is `PrintResult`.
// - `trait Print<P>` is a descriptor: `Print<T, P>` is a function `(self: T, p: P) => PrintResult`; the impl for a
//   type `X` is the function `print_X` (as `debug_X` for `Debug`). A generic impl takes the descriptors of its type
//   parameters as extra arguments, last (`print_Binder(value, p, print_T)`, as `debug_Binder(v, f, debug_T)`).
//   `x.print(p)` is `print_X(x, p)`.
// - `trait Printer` is the abstract class `Printer`: provided methods are its methods, required methods are
//   `abstract` (as rustc_ast_pretty's `PrintState`). The closures `impl FnOnce(&mut Self) -> ..` are
//   `(p: this) => PrintResult`.
// - `pub use self::pretty::*;` is the `export *` below. pretty.ts's `PrettyPrinter` extends `Printer`, so pretty.ts
//   must be evaluated after this module's body: load both through rustc_middle/lib.ts, which imports pretty.ts
//   (pretty.ts imports this module first). Loading this module first (as an entry point) is a TDZ error.
import type { Namespace } from "../../../rustc_hir/def.ts";
import { DisambiguatedDefPathData, type DefKey } from "../../../rustc_hir_id/definitions.ts";
import { type CoroutineKind } from "../../../rustc_hir/hir.ts";
import { type CrateNum, DefId, DefId_eq } from "../../../rustc_span/def_id.ts";
import { assert, panic, unported, unwrap } from "../../../std/panic.ts";
import { Ok, type Result } from "../../../std/result.ts";
import { type Fmt } from "../../../std/fmt.ts";
import type { PolyExistentialPredicate } from "../../../rustc_type_ir/decls.ts";
import { EarlyBinder } from "../../../rustc_type_ir/binder.ts";
import { standin_fold_Ty, type TypeFoldable } from "../../../rustc_type_ir/fold.ts";
import { as_interner, fold_with_TraitRef, TraitRef, try_fold_with_TraitRef, visit_with_TraitRef } from "../../../rustc_type_ir/predicate.ts";
import { Unnormalized } from "../../../rustc_type_ir/unnormalized.ts";
import type { Const, Region } from "../../../rustc_type_ir/sty/mod.ts";
import type { TyCtxt } from "../context.ts";
import { with_ } from "../context/tls.ts";
import { GenericArg } from "../generic_args.ts";
import type { Generics } from "../generics.ts";
import type { List } from "../list.ts";
import type { Instance, InstanceKind, Ty } from "../decls.ts";
import { display_Ty, FmtPrinter, type PrettyPrinter, with_no_trimmed_paths } from "./pretty.ts";
import {
  print_AliasTerm as pretty_print_AliasTerm,
  print_AliasTy as pretty_print_AliasTy,
  print_CoercePredicate as pretty_print_CoercePredicate,
  print_ExistentialProjection as pretty_print_ExistentialProjection,
  print_ExistentialTraitRef as pretty_print_ExistentialTraitRef,
  print_FnSig as pretty_print_FnSig,
  print_HostEffectClause as pretty_print_HostEffectClause,
  print_NormalizesTo as pretty_print_NormalizesTo,
  print_ProjectionClause as pretty_print_ProjectionClause,
  print_SubtypePredicate as pretty_print_SubtypePredicate,
  print_TraitClause as pretty_print_TraitClause,
  print_TraitRef as pretty_print_TraitRef,
} from "./pretty.ts";
import { IR_PRINT, type IrPrint } from "../../../rustc_type_ir/ir_print.ts";

// `pretty` is a separate module only for organization.
// mod pretty;
// pub use self::pretty::*;
export * from "./pretty.ts";
// use super::Lift;

/** `std::fmt::Error`. */
export type PrintError = { readonly $: "Error" };
/** `Result<(), PrintError>`. */
export type PrintResult = Result<undefined, PrintError>;
/** `Ok(())`. */
export const PRINT_OK: PrintResult = Ok(undefined);

/** `P: Printer<'tcx> + std::fmt::Write`. */
export type PrinterWrite = Printer & { write_str(s: string): PrintResult };

// rustc: compiler/rustc_middle/src/ty/print/mod.rs:19 print
/** `pub trait Print<P> { fn print(&self, p: &mut P) -> Result<(), PrintError>; }`: the impl for `T` is a function. */
export type Print<T, P extends Printer = PrettyPrinter> = (self: T, p: P) => PrintResult;

/// A trait that "prints" user-facing type system entities: paths, types, lifetimes, constants,
/// etc. "Printing" here means building up a representation of the entity's path, usually as a
/// `String` (e.g. "std::io::Read") or a `Vec<Symbol>` (e.g. `[sym::std, sym::io, sym::Read]`). The
/// representation is built up by appending one or more pieces. The specific details included in
/// the built-up representation depend on the purpose of the printer. The more advanced printers
/// also rely on the `PrettyPrinter` sub-trait.
export abstract class Printer {
  // rustc: compiler/rustc_middle/src/ty/print/mod.rs:29 tcx
  abstract tcx(): TyCtxt;

  /// Appends a representation of an entity with a normal path, e.g. "std::io::Read".
  // rustc: compiler/rustc_middle/src/ty/print/mod.rs:32 print_def_path
  print_def_path(def_id: DefId, args: readonly GenericArg[]): PrintResult {
    return this.default_print_def_path(def_id, args);
  }

  /// Like `print_def_path`, but for `DefPathData::Impl`.
  // rustc: compiler/rustc_middle/src/ty/print/mod.rs:41 print_impl_path
  print_impl_path(impl_def_id: DefId, args: readonly GenericArg[]): PrintResult {
    const tcx = this.tcx();
    // PORT: the `type_of` query value is `unknown` in queries.gen.ts.
    const self_ty_ = tcx.type_of(impl_def_id) as EarlyBinder<Ty>;
    const impl_trait_ref = tcx.impl_opt_trait_ref(impl_def_id);
    let self_ty: Ty;
    let impl_trait_ref_: TraitRef | undefined;
    if ((tcx.generics_of(impl_def_id) as Generics).count() <= args.length) {
      [self_ty, impl_trait_ref_] = [
        Unnormalized.skip_norm_wip(EarlyBinder.instantiate(self_ty_, tcx, args, standin_fold_Ty)),
        impl_trait_ref === undefined ? undefined : Unnormalized.skip_norm_wip(EarlyBinder.instantiate(impl_trait_ref, tcx, args, d_TraitRef)),
      ];
    } else {
      // We are probably printing a nested item inside of an impl.
      // Use the identity substitutions for the impl.
      [self_ty, impl_trait_ref_] = [
        Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(self_ty_)),
        impl_trait_ref === undefined ? undefined : Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(impl_trait_ref)),
      ];
    }

    return this.default_print_impl_path(impl_def_id, self_ty, impl_trait_ref_);
  }

  /// Appends a representation of a region.
  // rustc: compiler/rustc_middle/src/ty/print/mod.rs:69 print_region
  abstract print_region(region: Region): PrintResult;

  /// Appends a representation of a type.
  // rustc: compiler/rustc_middle/src/ty/print/mod.rs:72 print_type
  abstract print_type(ty: Ty): PrintResult;

  /// Appends a representation of a list of `PolyExistentialPredicate`s.
  // rustc: compiler/rustc_middle/src/ty/print/mod.rs:75 print_dyn_existential
  abstract print_dyn_existential(predicates: List<PolyExistentialPredicate>): PrintResult;

  /// Appends a representation of a const.
  // rustc: compiler/rustc_middle/src/ty/print/mod.rs:81 print_const
  abstract print_const(ct: Const): PrintResult;

  /// Appends a representation of a crate name, e.g. `std`, or even ``.
  // rustc: compiler/rustc_middle/src/ty/print/mod.rs:84 print_crate_name
  abstract print_crate_name(cnum: CrateNum): PrintResult;

  /// Appends a representation of a (full or partial) simple path, in two parts. `print_prefix`,
  /// when called, appends the representation of the leading segments. The rest of the method
  /// appends the representation of the final segment, the details of which are in
  /// `disambiguated_data`.
  ///
  /// E.g. `std::io` + `Read` -> `std::io::Read`.
  // rustc: compiler/rustc_middle/src/ty/print/mod.rs:92 print_path_with_simple
  abstract print_path_with_simple(print_prefix: (p: this) => PrintResult, disambiguated_data: DisambiguatedDefPathData): PrintResult;

  /// Similar to `print_path_with_simple`, but the final segment is an `impl` segment.
  ///
  /// E.g. `slice` + `<impl [T]>` -> `slice::<impl [T]>`, which may then be further appended to,
  /// giving a longer path representation such as `slice::<impl [T]>::to_vec_in::ConvertVec`.
  // rustc: compiler/rustc_middle/src/ty/print/mod.rs:102 print_path_with_impl
  abstract print_path_with_impl(print_prefix: (p: this) => PrintResult, self_ty: Ty, trait_ref: TraitRef | undefined): PrintResult;

  /// Appends a representation of a path ending in generic args, in two parts. `print_prefix`,
  /// when called, appends the leading segments. The rest of the method appends the
  /// representation of the generic args. (Some printers choose to skip appending the generic
  /// args.)
  ///
  /// E.g. `ImplementsTraitForUsize` + `<usize>` -> `ImplementsTraitForUsize<usize>`.
  // rustc: compiler/rustc_middle/src/ty/print/mod.rs:115 print_path_with_generic_args
  abstract print_path_with_generic_args(print_prefix: (p: this) => PrintResult, args: readonly GenericArg[]): PrintResult;

  /// Appends a representation of a qualified path segment, e.g. `<OsString as From<&T>>`.
  /// If `trait_ref` is `None`, it may fall back to simpler forms, e.g. `<Vec<T>>` or just `Foo`.
  // rustc: compiler/rustc_middle/src/ty/print/mod.rs:123 print_path_with_qualified
  abstract print_path_with_qualified(self_ty: Ty, trait_ref: TraitRef | undefined): PrintResult;

  // rustc: compiler/rustc_middle/src/ty/print/mod.rs:129 print_coroutine_with_kind
  print_coroutine_with_kind(def_id: DefId, parent_args: readonly GenericArg[], kind: Ty): PrintResult {
    return this.print_path_with_generic_args((p) => p.print_def_path(def_id, parent_args), [kind]);
  }

  // rustc: compiler/rustc_middle/src/ty/print/mod.rs:138 reset_path
  reset_path(): PrintResult {
    return PRINT_OK;
  }

  // rustc: compiler/rustc_middle/src/ty/print/mod.rs:142 should_omit_parent_def_path
  should_omit_parent_def_path(_parent_def_id: DefId): boolean {
    return false;
  }

  // Defaults (should not be overridden):
  // #[instrument(skip(self), level = "debug")]
  // rustc: compiler/rustc_middle/src/ty/print/mod.rs:148 default_print_def_path
  default_print_def_path(def_id: DefId, args: readonly GenericArg[]): PrintResult {
    const key: DefKey = this.tcx().def_key(def_id);
    // debug!(?key);

    switch (key.disambiguated_data.data.$) {
      case "CrateRoot": {
        assert(key.parent === undefined, "assertion failed: key.parent.is_none()");
        return this.print_crate_name(def_id.krate);
      }

      case "Impl":
        return this.print_impl_path(def_id, args);

      default: {
        const parent_def_id = new DefId(unwrap(key.parent), def_id.krate);

        let parent_args = args;
        let trait_qualify_parent = false;
        if (args.length !== 0) {
          // PORT: the `generics_of` query value is `unknown` in queries.gen.ts.
          const generics = this.tcx().generics_of(def_id) as Generics;
          parent_args = args.slice(0, Math.min(generics.parent_count, args.length));

          switch (key.disambiguated_data.data.$) {
            case "Closure": {
              // We need to additionally print the `kind` field of a coroutine if
              // it is desugared from a coroutine-closure.
              // PORT: the `coroutine_kind` query value is `unknown` in queries.gen.ts.
              const coroutine_kind = this.tcx().coroutine_kind(def_id) as CoroutineKind | undefined;
              if (coroutine_kind !== undefined && coroutine_kind.$ === "Desugared" && coroutine_kind._1 === "Closure" && args.length > parent_args.length) {
                return this.print_coroutine_with_kind(def_id, parent_args, GenericArg.expect_ty(args[parent_args.length]!));
              } else {
                // Closures' own generics are only captures, don't print them.
              }
              break;
            }
            case "SyntheticCoroutineBody": {
              // Synthetic coroutine bodies have no distinct generics, since like
              // closures they're all just internal state of the coroutine.
              break;
            }
            // This covers both `DefKind::AnonConst` and `DefKind::InlineConst`.
            // Anon consts doesn't have their own generics, and inline consts' own
            // generics are their inferred types, so don't print them.
            case "AnonConst":
              break;

            // If we have any generic arguments to print, we do that
            // on top of the same path, but without its own generics.
            default: {
              if (!generics.is_own_empty() && args.length >= generics.count()) {
                const args_ = Generics_own_args_no_defaults(generics, this.tcx(), args);
                return this.print_path_with_generic_args((p) => p.print_def_path(def_id, parent_args), args_);
              }
            }
          }

          // FIXME(eddyb) try to move this into the parent's printing
          // logic, instead of doing it when printing the child.
          trait_qualify_parent =
            generics.has_self &&
            generics.parent !== undefined &&
            DefId_eq(generics.parent, parent_def_id) &&
            parent_args.length === generics.parent_count &&
            (this.tcx().generics_of(parent_def_id) as Generics).parent_count === 0;
        }

        const omit_parent = key.disambiguated_data.data.$ === "TypeNs" && this.should_omit_parent_def_path(parent_def_id);

        return this.print_path_with_simple((p: this) => {
          if (omit_parent) {
            const r = p.reset_path();
            if (r.$ === "Err") return r;
            return PRINT_OK;
          } else if (trait_qualify_parent) {
            const trait_ref = TraitRef.new(as_interner(p.tcx()), parent_def_id, parent_args);
            return p.print_path_with_qualified(TraitRef.self_ty(trait_ref), trait_ref);
          } else {
            return p.print_def_path(parent_def_id, parent_args);
          }
        }, key.disambiguated_data);
      }
    }
  }

  // rustc: compiler/rustc_middle/src/ty/print/mod.rs:247 default_print_impl_path
  default_print_impl_path(impl_def_id: DefId, self_ty: Ty, impl_trait_ref: TraitRef | undefined): PrintResult {
    // debug!(
    //     "default_print_impl_path: impl_def_id={:?}, self_ty={}, impl_trait_ref={:?}",
    //     impl_def_id, self_ty, impl_trait_ref
    // );

    const key = this.tcx().def_key(impl_def_id);
    const parent_def_id = new DefId(unwrap(key.parent), impl_def_id.krate);

    // Decide whether to print the parent path for the impl.
    // Logically, since impls are global, it's never needed, but
    // users may find it useful. Currently, we omit the parent if
    // the impl is either in the same module as the self-type or
    // as the trait.
    const ty_def_id = characteristic_def_id_of_type(self_ty);
    const in_self_mod = ty_def_id === undefined ? false : DefId_eq(this.tcx().parent(ty_def_id), parent_def_id);
    const in_trait_mod = impl_trait_ref === undefined ? false : DefId_eq(this.tcx().parent(impl_trait_ref.def_id), parent_def_id);

    if (!in_self_mod && !in_trait_mod) {
      // If the impl is not co-located with either self-type or
      // trait-type, then fallback to a format that identifies
      // the module more clearly.
      return this.print_path_with_impl((p) => p.print_def_path(parent_def_id, []), self_ty, impl_trait_ref);
    } else {
      // Otherwise, try to give a good form that would be valid language
      // syntax. Preferably using associated item notation.
      return this.print_path_with_qualified(self_ty, impl_trait_ref);
    }
  }
}

/// As a heuristic, when we see an impl, if we see that the
/// 'self type' is a type defined in the same module as the impl,
/// we can omit including the path to the impl itself. This
/// function tries to find a "characteristic `DefId`" for a
/// type. It's just a heuristic so it makes some questionable
/// decisions and we may want to adjust it later.
///
/// Visited set is needed to avoid full iteration over
/// deeply nested tuples that have no DefId.
// rustc: compiler/rustc_middle/src/ty/print/mod.rs:301 characteristic_def_id_of_type_cached
function characteristic_def_id_of_type_cached(ty: Ty, visited: Set<Ty>): DefId | undefined {
  const kind = ty.kind();
  switch (kind.$) {
    case "Adt":
      return AdtDef_did(kind._0);

    case "Dynamic":
      return kind._0.principal_def_id();

    case "Pat":
    case "Array":
      return characteristic_def_id_of_type_cached(kind._0, visited);
    case "Slice":
      return characteristic_def_id_of_type_cached(kind._0, visited);

    case "RawPtr":
      return characteristic_def_id_of_type_cached(kind._0, visited);

    case "Ref":
      return characteristic_def_id_of_type_cached(kind._1, visited);

    case "Tuple": {
      const tys = kind._0;
      for (const ty of tys) {
        let r: DefId | undefined;
        if (!visited.has(ty)) {
          visited.add(ty);
          r = characteristic_def_id_of_type_cached(ty, visited);
        } else {
          r = undefined;
        }
        if (r !== undefined) return r;
      }
      return undefined;
    }

    case "FnDef":
    case "Closure":
    case "CoroutineClosure":
    case "Coroutine":
    case "CoroutineWitness":
    case "Foreign":
      return kind._0;

    case "Bool":
    case "Char":
    case "Int":
    case "Uint":
    case "Str":
    case "FnPtr":
    case "UnsafeBinder":
    case "Alias":
    case "Placeholder":
    case "Param":
    case "Infer":
    case "Bound":
    case "Error":
    case "Never":
    case "Float":
      return undefined;
  }
}
// rustc: compiler/rustc_middle/src/ty/print/mod.rs:349 characteristic_def_id_of_type
export function characteristic_def_id_of_type(ty: Ty): DefId | undefined {
  // PORT: `SsoHashSet<Ty>`: `Ty` is hash-consed (PORTING §5), so a `Set` keyed on the object.
  return characteristic_def_id_of_type_cached(ty, new Set());
}

// impl<'tcx, P: Printer<'tcx>> Print<P> for ty::Region<'tcx>
// rustc: compiler/rustc_middle/src/ty/print/mod.rs:354 print
export function print_Region(self: Region, p: Printer): PrintResult {
  return p.print_region(self);
}

// impl<'tcx, P: Printer<'tcx>> Print<P> for Ty<'tcx>
// rustc: compiler/rustc_middle/src/ty/print/mod.rs:360 print
export function print_Ty(self: Ty, p: Printer): PrintResult {
  return p.print_type(self);
}

// impl<'tcx, P: Printer<'tcx> + std::fmt::Write> Print<P> for ty::Instance<'tcx>
// rustc: compiler/rustc_middle/src/ty/print/mod.rs:366 print
export function print_Instance(self: Instance, cx: PrinterWrite): PrintResult {
  const self_ = self as unknown as InstanceView;
  let r = cx.print_def_path(Instance_def_id(self), self_.args);
  if (r.$ === "Err") return r;
  const def = self_.def as unknown as InstanceKindView;
  switch (def.$) {
    case "Item":
      break;
    case "Intrinsic":
      r = cx.write_str(" - intrinsic");
      if (r.$ === "Err") return r;
      break;
    case "LlvmIntrinsic":
      r = cx.write_str(" - LLVM intrinsic");
      if (r.$ === "Err") return r;
      break;
    case "Virtual": {
      const num = def._1;
      r = cx.write_str(` - virtual#${num}`);
      if (r.$ === "Err") return r;
      break;
    }
    case "Shim": {
      const shim = def._0;
      r = cx.write_str(" - ");
      if (r.$ === "Err") return r;
      r = print_ShimKind(shim, cx);
      if (r.$ === "Err") return r;
      break;
    }
  }
  return PRINT_OK;
}

// impl<'tcx, P: Printer<'tcx> + std::fmt::Write> Print<P> for ty::ShimKind<'tcx>
// rustc: compiler/rustc_middle/src/ty/print/mod.rs:383 print
export function print_ShimKind(self: ShimKindView, cx: PrinterWrite): PrintResult {
  switch (self.$) {
    case "VTable":
      return cx.write_str("shim(vtable)");
    case "Reify":
      if (self._1 === undefined) return cx.write_str("shim(reify)");
      if (self._1 === "FnPtr") return cx.write_str("shim(reify-fnptr)");
      return cx.write_str("shim(reify-vtable)");
    case "ThreadLocal":
      return cx.write_str("shim(tls)");
    case "FnPtr":
      return cx.write_str(`shim(${display_Ty(self._1)})`);
    case "ClosureOnce":
      return cx.write_str("shim");
    case "ConstructCoroutineInClosure":
      return cx.write_str("shim");
    case "DropGlue":
      if (self._1 === undefined) return cx.write_str("shim(None)");
      return cx.write_str(`shim(Some(${display_Ty(self._1)}))`);
    case "Clone":
      return cx.write_str(`shim(${display_Ty(self._1)})`);
    case "FnPtrAsPtr":
      return cx.write_str(`shim(${display_Ty(self._1)})`);
    case "FnPtrFromPtr":
      return cx.write_str(`shim(${display_Ty(self._1)})`);
    case "FutureDropPoll":
      return cx.write_str(`dropshim(${display_Ty(self._1)}-${display_Ty(self._2)})`);
    case "AsyncDropGlue":
      return cx.write_str(`shim(${display_Ty(self._1)})`);
    case "AsyncDropGlueCtor":
      return cx.write_str(`shim(Some(${display_Ty(self._1)}))`);
  }
}

// impl<'tcx, P: Printer<'tcx>> Print<P> for &'tcx ty::List<ty::PolyExistentialPredicate<'tcx>>
// rustc: compiler/rustc_middle/src/ty/print/mod.rs:412 print
export function print_List_PolyExistentialPredicate(self: List<PolyExistentialPredicate>, p: Printer): PrintResult {
  return p.print_dyn_existential(self);
}

// impl<'tcx, P: Printer<'tcx>> Print<P> for ty::Const<'tcx>
// rustc: compiler/rustc_middle/src/ty/print/mod.rs:418 print
export function print_Const(self: Const, p: Printer): PrintResult {
  return p.print_const(self);
}

// impl<T> rustc_type_ir::ir_print::IrPrint<T> for TyCtxt<'_>
// where
//     T: Copy + for<'a, 'tcx> Lift<TyCtxt<'tcx>, Lifted: Print<FmtPrinter<'a, 'tcx>>>,
// PORT: `IrPrint::print(t, fmt)` is `IrPrint_print(t, fmt, print_T)` returning the written text (the `Display`
// convention of std/fmt.ts); `tcx.lift(*t)` is the identity (`Lift` impls are skipped, PORTING §3). A
// `fmt::Error` from the printer has no string form: it panics as `ToString::to_string` does.
// rustc: compiler/rustc_middle/src/ty/print/mod.rs:427 print
export function IrPrint_print<T>(t: T, _fmt: Fmt, print_T: Print<T, FmtPrinter>): string {
  return with_((tcx) => {
    const p = FmtPrinter.new(tcx, "TypeNS" satisfies Namespace);
    const r = print_T(t, p);
    if (r.$ === "Err") panic("a Display implementation returned an error unexpectedly: Error");
    return p.into_buffer();
  });
}

// rustc: compiler/rustc_middle/src/ty/print/mod.rs:436 print_debug
export function IrPrint_print_debug<T>(t: T, fmt: Fmt, print_T: Print<T, FmtPrinter>): string {
  return with_no_trimmed_paths(() => IrPrint_print(t, fmt, print_T));
}

// PORT(merge-w15a): the blanket impl above serves every non-generic `X` of rustc_type_ir's `IR_PRINT` registry
// (ir_print.ts header) whose `Print` impl is ported: `IR_PRINT.X = { print, print_debug }` over `print_X`. The entries
// read `print_X` at call time (pretty.ts is evaluated after this module). `PatternKind`'s impl is ty/pattern.rs's
// own (not ported), so its slot stays empty.
function ir_print_impl<T>(print_T: () => Print<T, FmtPrinter>): IrPrint<T> {
  return {
    print: (t, fmt) => IrPrint_print(t, fmt, print_T()),
    print_debug: (t, fmt) => IrPrint_print_debug(t, fmt, print_T()),
  };
}
IR_PRINT.TraitRef = ir_print_impl(() => pretty_print_TraitRef);
IR_PRINT.TraitClause = ir_print_impl(() => pretty_print_TraitClause);
IR_PRINT.ExistentialTraitRef = ir_print_impl(() => pretty_print_ExistentialTraitRef);
IR_PRINT.ExistentialProjection = ir_print_impl(() => pretty_print_ExistentialProjection);
IR_PRINT.ProjectionClause = ir_print_impl(() => pretty_print_ProjectionClause);
IR_PRINT.NormalizesTo = ir_print_impl(() => pretty_print_NormalizesTo);
IR_PRINT.SubtypePredicate = ir_print_impl(() => pretty_print_SubtypePredicate);
IR_PRINT.CoercePredicate = ir_print_impl(() => pretty_print_CoercePredicate);
IR_PRINT.HostEffectClause = ir_print_impl(() => pretty_print_HostEffectClause);
IR_PRINT.AliasTy = ir_print_impl(() => pretty_print_AliasTy);
IR_PRINT.AliasTerm = ir_print_impl(() => pretty_print_AliasTerm);
IR_PRINT.FnSig = ir_print_impl(() => pretty_print_FnSig);
IR_PRINT.Region = ir_print_impl(() => print_Region);
IR_PRINT.Const = ir_print_impl(() => print_Const);

/** PORT: the `TypeFoldable` impl fns of `TraitRef` (generated) as a D4 descriptor (merge-w15a). */
const d_TraitRef: TypeFoldable<TraitRef> = { visit_with: visit_with_TraitRef, try_fold_with: try_fold_with_TraitRef, fold_with: fold_with_TraitRef };

// ---- PORT(stand-in): upstream fns and types of files not ported yet that this file calls. ----
// Each is replaced by a call to the real port when its file lands (docs/handoff/ty-print-a.md).

/** `ty::Instance` (ty/instance.rs:33; `Pending` in ty/decls.ts): the fields `print` reads. */
interface InstanceView {
  def: InstanceKind;
  args: GenericArg[];
}
/** `ty::InstanceKind` (ty/instance.rs:62) in its PORTING §5 shape. */
type InstanceKindView =
  | { readonly $: "Item"; _0: DefId }
  | { readonly $: "Intrinsic"; _0: DefId }
  | { readonly $: "LlvmIntrinsic"; _0: DefId }
  | { readonly $: "Virtual"; _0: DefId; _1: number }
  | { readonly $: "Shim"; _0: ShimKindView };
/** `ty::ShimKind` (ty/instance.rs:100) in its PORTING §5 shape (`ReifyReason` is fieldless). */
export type ShimKindView =
  | { readonly $: "VTable"; _0: DefId }
  | { readonly $: "Reify"; _0: DefId; _1: "FnPtr" | "Vtable" | undefined }
  | { readonly $: "FnPtr"; _0: DefId; _1: Ty }
  | { readonly $: "ClosureOnce"; call_once: DefId; closure: DefId; track_caller: boolean }
  | { readonly $: "ConstructCoroutineInClosure"; coroutine_closure_def_id: DefId; receiver_by_ref: boolean }
  | { readonly $: "ThreadLocal"; _0: DefId }
  | { readonly $: "DropGlue"; _0: DefId; _1: Ty | undefined }
  | { readonly $: "Clone"; _0: DefId; _1: Ty }
  | { readonly $: "FnPtrAsPtr"; _0: DefId; _1: Ty }
  | { readonly $: "FnPtrFromPtr"; _0: DefId; _1: Ty }
  | { readonly $: "FutureDropPoll"; _0: DefId; _1: Ty; _2: Ty }
  | { readonly $: "AsyncDropGlue"; _0: DefId; _1: Ty }
  | { readonly $: "AsyncDropGlueCtor"; _0: DefId; _1: Ty };

/** `Instance::def_id` (ty/instance.rs; not ported). */
function Instance_def_id(_self: Instance): DefId {
  return unported("rustc_middle::ty::instance::Instance::def_id (ty/instance.rs)");
}
/** `AdtDef::did` (ty/adt.rs; `AdtDef` is `Pending`). */
function AdtDef_did(_adt_def: unknown): DefId {
  return unported("rustc_middle::ty::adt::AdtDef::did (ty/adt.rs)");
}
/** `Generics::own_args_no_defaults` (ty/generics.rs:322; not ported). */
function Generics_own_args_no_defaults(_self: Generics, _tcx: TyCtxt, _args: readonly GenericArg[]): readonly GenericArg[] {
  return unported("rustc_middle::ty::generics::Generics::own_args_no_defaults (ty/generics.rs)");
}
