// Port of compiler/rustc_ty_utils/src/needs_drop.rs (lane ty-utils).
//! Check whether a type has (potentially) non-trivial drop glue.
//
// PORT: query values typed `unknown` in queries.gen.ts (`type_of`, `adt_drop_tys`) are cast
// to their upstream types at the read site; the query keys typed `unknown` (`PseudoCanonicalInput<Ty>`) likewise.
// PORT: `NeedsDropTypes` is an `Iterator`; `drop_tys_helper` returns it and the callers drive it with `next()`
// (`.filter(..).next()`, `.collect::<Result<Vec<_>, _>>()`, `.filter_map(..).collect()`), so it is exactly as lazy as
// upstream: a `.filter(..).next()` stops at the first kept item.
// PORT: tracing (`#[instrument]`, `debug!`) is left out.
import { find_attr } from "../rustc_attr_ir/lib.ts";
import type { Providers } from "../rustc_middle/queries.gen.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { AdtDef } from "../rustc_middle/ty/decls.ts";
import { GenericArg, type GenericArgs } from "../rustc_middle/ty/generic_args.ts";
import type { List } from "../rustc_middle/ty/list.ts";
import { HasAttrs_DefId, type PseudoCanonicalInput, type Ty, TypingEnv } from "../rustc_middle/ty/mod.ts";
import { display_Ty } from "../rustc_middle/ty/print/pretty.ts";
import { fold_Ty } from "../rustc_middle/ty/structural_impls.ts";
import { AlwaysRequiresDrop, needs_drop_components } from "../rustc_middle/ty/util.ts";
import { EarlyBinder } from "../rustc_type_ir/binder.ts";
import { ClosureArgs, CoroutineArgs, CoroutineClosureArgs } from "../rustc_type_ir/ty_kind/closure.ts";
import { UnsafeBinderInner } from "../rustc_type_ir/ty_kind.ts";
import { Unnormalized } from "../rustc_type_ir/unnormalized.ts";
import type { DefId } from "../rustc_span/def_id.ts";
import { bug } from "../rustc_span/macros.ts";
import type { Limit } from "../rustc_structures/limit.ts";
import { debug_GenericArgsSlice } from "../rustc_middle/ty/generic_args.ts";
import { PLAIN } from "../std/fmt.ts";
import { unreachable } from "../std/panic.ts";
import { Err, Ok, type Result } from "../std/result.ts";
import { NeedsDropOverflow_diagnostic } from "./diagnostics.ts";

type NeedsDropResult<T> = Result<T, AlwaysRequiresDrop>;

// rustc: compiler/rustc_ty_utils/src/needs_drop.rs:17 needs_drop_raw
function needs_drop_raw(tcx: TyCtxt, query: PseudoCanonicalInput<Ty>): boolean {
  // If we don't know a type doesn't need drop, for example if it's a type
  // parameter without a `Copy` bound, then we conservatively return that it
  // needs drop.
  const adt_has_dtor = (adt_def: AdtDef): DtorType | undefined => (adt_def.destructor(tcx) !== undefined ? "Significant" : undefined);
  const res = filter_next(
    drop_tys_helper(tcx, query.value, query.typing_env, adt_has_dtor, DropTysOptions.default_()),
    filter_array_elements(tcx, query.typing_env),
  );

  // debug!("needs_drop_raw({:?}) = {:?}", query, res);
  return res;
}

// rustc: compiler/rustc_ty_utils/src/needs_drop.rs:41 needs_async_drop_raw
function needs_async_drop_raw(tcx: TyCtxt, query: PseudoCanonicalInput<Ty>): boolean {
  // If we don't know a type doesn't need async drop, for example if it's a
  // type parameter without a `Copy` bound, then we conservatively return that
  // it needs async drop.
  const adt_has_async_dtor = (adt_def: AdtDef): DtorType | undefined =>
    adt_def.async_destructor(tcx) !== undefined ? "Significant" : undefined;
  const res = filter_next(
    drop_tys_helper(tcx, query.value, query.typing_env, adt_has_async_dtor, DropTysOptions.recurse_into_box_for_async_drop(DropTysOptions.default_())),
    filter_array_elements_async(tcx, query.typing_env),
  );

  // debug!("needs_async_drop_raw({:?}) = {:?}", query, res);
  return res;
}

/// HACK: in order to not mistakenly assume that `[PhantomData<T>; N]` requires drop glue
/// we check the element type for drop glue. The correct fix would be looking at the
/// entirety of the code around `needs_drop_components` and this file and come up with
/// logic that is easier to follow while not repeating any checks that may thus diverge.
// rustc: compiler/rustc_ty_utils/src/needs_drop.rs:69 filter_array_elements
function filter_array_elements(tcx: TyCtxt, typing_env: TypingEnv): (ty: Result<Ty, AlwaysRequiresDrop>) => boolean {
  return (ty) => {
    if (ty.$ === "Ok") {
      const k = ty._0.kind();
      if (k.$ === "Array") {
        const elem = k._0;
        return tcx.needs_drop_raw(typing_env.as_query_input(elem));
      }
      return true;
    } else {
      return true;
    }
  };
}
// rustc: compiler/rustc_ty_utils/src/needs_drop.rs:81 filter_array_elements_async
function filter_array_elements_async(tcx: TyCtxt, typing_env: TypingEnv): (ty: Result<Ty, AlwaysRequiresDrop>) => boolean {
  return (ty) => {
    if (ty.$ === "Ok") {
      const k = ty._0.kind();
      if (k.$ === "Array") {
        const elem = k._0;
        return tcx.needs_async_drop_raw(typing_env.as_query_input(elem));
      }
      return true;
    } else {
      return true;
    }
  };
}

// rustc: compiler/rustc_ty_utils/src/needs_drop.rs:94 has_significant_drop_raw
function has_significant_drop_raw(tcx: TyCtxt, query: PseudoCanonicalInput<Ty>): boolean {
  const res = filter_next(
    drop_tys_helper(tcx, query.value, query.typing_env, adt_consider_insignificant_dtor(tcx), DropTysOptions.only_significant(DropTysOptions.default_())),
    filter_array_elements(tcx, query.typing_env),
  );
  // debug!("has_significant_drop_raw({:?}) = {:?}", query, res);
  return res;
}

/** `iter.filter(f).next().is_some()`. */
function filter_next(iter: NeedsDropTypes, f: (ty: Result<Ty, AlwaysRequiresDrop>) => boolean): boolean {
  for (;;) {
    const item = iter.next();
    if (item === undefined) return false;
    if (f(item)) return true;
  }
}

/** `F: Fn(ty::AdtDef<'tcx>, GenericArgsRef<'tcx>) -> NeedsDropResult<I>`, `I: Iterator<Item = Ty<'tcx>>`. */
type AdtComponents = (adt_def: AdtDef, args: GenericArgs) => NeedsDropResult<Iterable<Ty>>;

// rustc-type: compiler/rustc_ty_utils/src/needs_drop.rs:112 NeedsDropTypes
class NeedsDropTypes {
  constructor(
    readonly tcx: TyCtxt,
    readonly typing_env: TypingEnv,
    readonly query_ty: Ty,
    readonly seen_tys: Set<Ty>,
    /// A stack of types left to process, and the recursion depth when we
    /// pushed that type. Each round, we pop something from the stack and check
    /// if it needs drop. If the result depends on whether some other types
    /// need drop we push them onto the stack.
    readonly unchecked_tys: [Ty, number][],
    readonly recursion_limit: Limit,
    readonly adt_components: AdtComponents,
    /// Set this to true if an exhaustive list of types involved in
    /// drop obligation is requested.
    // FIXME: Calling this bool `exhaustive` is confusing and possibly a footgun,
    // since it does two things: It makes the iterator yield *all* of the types
    // that need drop, and it also affects the computation of the drop components
    // on `Coroutine`s. The latter is somewhat confusing, and probably should be
    // a function of `typing_env`. See the HACK comment below for why this is
    // necessary. If this isn't possible, then we probably should turn this into
    // a `NeedsDropMode` so that we can have a variant like `CollectAllSignificantDrops`,
    // which will more accurately indicate that we want *all* of the *significant*
    // drops, which are the two important behavioral changes toggled by this bool.
    readonly exhaustive: boolean,
  ) {}

  // rustc: compiler/rustc_ty_utils/src/needs_drop.rs:139 new
  static new(tcx: TyCtxt, typing_env: TypingEnv, ty: Ty, exhaustive: boolean, adt_components: AdtComponents): NeedsDropTypes {
    const seen_tys = new Set<Ty>();
    seen_tys.add(ty);
    return new NeedsDropTypes(tcx, typing_env, ty, seen_tys, [[ty, 0]], tcx.recursion_limit(), adt_components, exhaustive);
  }

  /// Called when `ty` is found to always require drop.
  /// If the exhaustive flag is true, then `Ok(ty)` is returned like any other type.
  /// Otherwise, `Err(AlwaysRequireDrop)` is returned, which will cause iteration to abort.
  // rustc: compiler/rustc_ty_utils/src/needs_drop.rs:163 always_drop_component
  always_drop_component(ty: Ty): NeedsDropResult<Ty> {
    if (this.exhaustive) {
      return Ok(ty);
    } else {
      return Err(AlwaysRequiresDrop);
    }
  }

  // ---- impl<'tcx, F, I> Iterator for NeedsDropTypes<'tcx, F> ----

  // #[instrument(level = "debug", skip(self), ret)]
  // rustc: compiler/rustc_ty_utils/src/needs_drop.rs:176 next
  next(): NeedsDropResult<Ty> | undefined {
    const tcx = this.tcx;

    for (;;) {
      const popped = this.unchecked_tys.pop();
      if (popped === undefined) break;
      const [ty, level] = popped;
      // debug!(?ty, "needs_drop_components: inspect");
      if (!this.recursion_limit.value_within_limit(level)) {
        // Not having a `Span` isn't great. But there's hopefully some other
        // recursion limit error as well.
        // debug!("needs_drop_components: recursion limit exceeded");
        tcx.dcx().emit_err(NeedsDropOverflow_diagnostic({ query_ty: this.query_ty }));
        return this.always_drop_component(ty);
      }

      const r = needs_drop_components(tcx, ty);
      if (r.$ === "Err") return this.always_drop_component(ty);
      const components = r._0;
      // debug!("needs_drop_components({:?}) = {:?}", ty, components);

      const queue_type = (this_: NeedsDropTypes, component: Ty): void => {
        if (!this_.seen_tys.has(component)) {
          this_.seen_tys.add(component);
          this_.unchecked_tys.push([component, level + 1]);
        }
      };

      for (const component of components) {
        const k = component.kind();
        // The information required to determine whether a coroutine has drop is
        // computed on MIR, while this very method is used to build MIR.
        // To avoid cycles, we consider that coroutines always require drop.
        //
        // HACK: Because we erase regions contained in the coroutine witness, we
        // have to conservatively assume that every region captured by the
        // coroutine has to be live when dropped. This results in a lot of
        // undesirable borrowck errors. During borrowck, we call `needs_drop`
        // for the coroutine witness and check whether any of the contained types
        // need to be dropped, and only require the captured types to be live
        // if they do.
        if (k.$ === "Coroutine") {
          const def_id = k._0;
          const args = k._1;
          // FIXME: See FIXME on `exhaustive` field above.
          if (this.exhaustive) {
            for (const upvar of CoroutineArgs.upvar_tys(args.as_coroutine())) {
              queue_type(this, upvar);
            }
            queue_type(this, CoroutineArgs.resume_ty(args.as_coroutine()));
            const witness = tcx.mir_coroutine_witnesses(def_id);
            if (witness !== undefined) {
              for (const field_ty of witness.field_tys) {
                queue_type(this, Unnormalized.skip_norm_wip(EarlyBinder.instantiate(EarlyBinder.bind(tcx, field_ty.ty, fold_Ty), tcx, args, fold_Ty)));
              }
            }
          } else {
            return this.always_drop_component(ty);
          }
        } else if (k.$ === "CoroutineWitness") {
          return unreachable("witness should be handled in parent");
        } else if (k.$ === "UnsafeBinder") {
          const bound_ty = k._0;
          const ty = this.tcx.instantiate_bound_regions_with_erased(UnsafeBinderInner.into_Binder(bound_ty), fold_Ty);
          queue_type(this, ty);
        } else if (tcx.type_is_copy_modulo_regions(this.typing_env, component)) {
          // `_ if tcx.type_is_copy_modulo_regions(self.typing_env, component) => {}`
        } else if (k.$ === "Closure") {
          const args = k._1;
          for (const upvar of ClosureArgs.upvar_tys(args.as_closure())) {
            queue_type(this, upvar);
          }
        } else if (k.$ === "CoroutineClosure") {
          const args = k._1;
          for (const upvar of CoroutineClosureArgs.upvar_tys(args.as_coroutine_closure())) {
            queue_type(this, upvar);
          }
        }
        // Check for a `Drop` impl and whether this is a union or
        // `ManuallyDrop`. If it's a struct or enum without a `Drop`
        // impl then check whether the field types need `Drop`.
        else if (k.$ === "Adt") {
          const adt_def = k._0;
          const args = k._1;
          const tys_r = this.adt_components(adt_def, args);
          if (tys_r.$ === "Err") {
            return this.always_drop_component(ty);
          }
          const tys = tys_r._0;
          for (const required_ty of tys) {
            const n = tcx.try_normalize_erasing_regions(this.typing_env, Unnormalized.new_wip(required_ty), fold_Ty);
            const required = n.$ === "Ok" ? n._0 : required_ty;

            queue_type(this, required);
          }
        } else if (k.$ === "Alias" || k.$ === "Array" || k.$ === "Placeholder" || k.$ === "Param") {
          if (ty === component) {
            // Return the type to the caller: they may be able
            // to normalize further than we can.
            return Ok(component);
          } else {
            // Store the type for later. We can't return here
            // because we would then lose any other components
            // of the type.
            queue_type(this, component);
          }
        } else if (k.$ === "Foreign" || k.$ === "Dynamic") {
          // debug!("needs_drop_components: foreign or dynamic");
          return this.always_drop_component(ty);
        } else {
          // ty::Bool | ty::Char | ty::Int(_) | ty::Uint(_) | ty::Float(_) | ty::Str | ty::Slice(_) | ty::Ref(..)
          // | ty::RawPtr(..) | ty::FnDef(..) | ty::Pat(..) | ty::FnPtr(..) | ty::Tuple(_) | ty::Bound(..) | ty::Never
          // | ty::Infer(_) | ty::Error(_)
          return bug(`unexpected type returned by \`needs_drop_components\`: ${display_Ty(component)}`);
        }
      }
    }

    return undefined;
  }
}

// rustc-type: compiler/rustc_ty_utils/src/needs_drop.rs:324 DtorType
type DtorType =
  /// Type has a `Drop` but it is considered insignificant.
  /// Check the query `adt_significant_drop_tys` for understanding
  /// "significant" / "insignificant".
  | "Insignificant"
  /// Type has a `Drop` implantation.
  | "Significant";

// #[derive(Copy, Clone, Default)]
// rustc-type: compiler/rustc_ty_utils/src/needs_drop.rs:335 DropTysOptions
interface DropTysOptions {
  readonly only_significant: boolean;
  readonly exhaustive: boolean;
  readonly async_drop_recurses_into_box: boolean;
}

// PORT: the methods of `DropTysOptions` live on the companion const (the field names equal the method names);
// `mut self` by value is a copy.
const DropTysOptions = {
  /** `#[derive(Default)]` */
  default_(): DropTysOptions {
    return { only_significant: false, exhaustive: false, async_drop_recurses_into_box: false };
  },

  // rustc: compiler/rustc_ty_utils/src/needs_drop.rs:342 only_significant
  only_significant(self: DropTysOptions): DropTysOptions {
    return { ...self, only_significant: true };
  },

  // rustc: compiler/rustc_ty_utils/src/needs_drop.rs:347 exhaustive
  exhaustive(self: DropTysOptions): DropTysOptions {
    return { ...self, exhaustive: true };
  },

  // rustc: compiler/rustc_ty_utils/src/needs_drop.rs:352 recurse_into_box_for_async_drop
  recurse_into_box_for_async_drop(self: DropTysOptions): DropTysOptions {
    return { ...self, async_drop_recurses_into_box: true };
  },
};

// This is a helper function for `adt_drop_tys` and `adt_significant_drop_tys`.
// Depending on the implantation of `adt_has_dtor`, it is used to check if the
// ADT has a destructor or if the ADT only has a significant destructor. For
// understanding significant destructor look at `adt_significant_drop_tys`.
// rustc: compiler/rustc_ty_utils/src/needs_drop.rs:362 drop_tys_helper
function drop_tys_helper(
  tcx: TyCtxt,
  ty: Ty,
  typing_env: TypingEnv,
  adt_has_dtor: (adt_def: AdtDef) => DtorType | undefined,
  options: DropTysOptions,
): NeedsDropTypes {
  // rustc: compiler/rustc_ty_utils/src/needs_drop.rs:369 with_query_cache
  function with_query_cache(tcx: TyCtxt, iter: Iterable<Ty>): NeedsDropResult<Ty[]> {
    const vec: Ty[] = [];
    for (const subty of iter) {
      const k = subty.kind();
      if (k.$ === "Adt") {
        const adt_id = k._0;
        const args = k._1;
        const r = tcx.adt_drop_tys(adt_id.did()) as Result<List<Ty>, AlwaysRequiresDrop>;
        if (r.$ === "Err") return r;
        for (const subty of r._0) {
          vec.push(Unnormalized.skip_norm_wip(EarlyBinder.instantiate(EarlyBinder.bind(tcx, subty, fold_Ty), tcx, args, fold_Ty)));
        }
      } else {
        vec.push(subty);
      }
    }
    return Ok(vec);
  }

  const adt_components = (adt_def: AdtDef, args: GenericArgs): NeedsDropResult<Iterable<Ty>> => {
    let r: NeedsDropResult<Ty[]>;
    if (adt_def.is_manually_drop()) {
      // debug!("drop_tys_helper: `{:?}` is manually drop", adt_def);
      r = Ok([]);
    } else if (options.async_drop_recurses_into_box && adt_def.is_box()) {
      let box_components: Ty[];
      if (args.length === 2) {
        const boxed_ty = GenericArg.expect_ty(args[0]!);
        const allocator_ty = GenericArg.expect_ty(args[1]!);
        const bk = boxed_ty.kind();
        // FIXME(async_drop): boxed dyn pointees are deliberately skipped here
        // because async drop glue does not yet dispatch through dyn metadata.
        // Once that is supported, this should include the boxed pointee too.
        if (bk.$ === "Dynamic" || bk.$ === "Error") {
          box_components = [allocator_ty];
        } else {
          box_components = [boxed_ty, allocator_ty];
        }
      } else {
        return bug(`drop_tys_helper: \`Box\` has unexpected generic args: ${debug_GenericArgsSlice(args, PLAIN)}`);
      }
      r = Ok(box_components);
    } else {
      const dtor_info = adt_has_dtor(adt_def);
      if (dtor_info !== undefined) {
        switch (dtor_info) {
          case "Significant":
            // debug!("drop_tys_helper: `{:?}` implements `Drop`", adt_def);
            r = Err(AlwaysRequiresDrop);
            break;
          case "Insignificant":
            // debug!("drop_tys_helper: `{:?}` drop is insignificant", adt_def);

            // Since the destructor is insignificant, we just want to make sure all of
            // the passed in type parameters are also insignificant.
            // Eg: Vec<T> dtor is insignificant when T=i32 but significant when T=Mutex.
            r = Ok([...args.types()]);
            break;
        }
      } else if (adt_def.is_union()) {
        // debug!("drop_tys_helper: `{:?}` is a union", adt_def);
        r = Ok([]);
      } else {
        const field_tys = (function* (): Generator<Ty> {
          for (const field of adt_def.all_fields()) {
            const r = Unnormalized.skip_norm_wip(EarlyBinder.instantiate(tcx.type_of(field.did) as EarlyBinder<Ty>, tcx, args, fold_Ty));
            // debug!("drop_tys_helper: Instantiate into {:?} with {:?} getting {:?}", field, args, r);
            yield r;
          }
        })();
        if (options.only_significant) {
          // We can't recurse through the query system here because we might induce a cycle
          r = Ok([...field_tys]);
        } else {
          // We can use the query system if we consider all drops significant. In that case,
          // ADTs are `needs_drop` exactly if they `impl Drop` or if any of their "transitive"
          // fields do. There can be no cycles here, because ADTs cannot contain themselves as
          // fields.
          r = with_query_cache(tcx, field_tys);
        }
      }
    }
    // `.map(|v| v.into_iter())`
    return r;
  };

  return NeedsDropTypes.new(tcx, typing_env, ty, options.exhaustive, adt_components);
}

// rustc: compiler/rustc_ty_utils/src/needs_drop.rs:454 adt_consider_insignificant_dtor
function adt_consider_insignificant_dtor(tcx: TyCtxt): (adt_def: AdtDef) => DtorType | undefined {
  return (adt_def: AdtDef): DtorType | undefined => {
    if (find_attr(HasAttrs_DefId.get_attrs(adt_def.did(), tcx), (k) => (k.$ === "RustcInsignificantDtor" ? null : undefined)) !== undefined) {
      // In some cases like `std::collections::HashMap` where the struct is a wrapper around
      // a type that is a Drop type, and the wrapped type (eg: `hashbrown::HashMap`) lies
      // outside stdlib, we might choose to still annotate the wrapper (std HashMap) with
      // `rustc_insignificant_dtor`, even if the type itself doesn't have a `Drop` impl.
      return "Insignificant";
    } else if (adt_def.destructor(tcx) !== undefined) {
      // There is a Drop impl and the type isn't marked insignificant, therefore Drop must be
      // significant.
      return "Significant";
    } else {
      // No destructor found nor the type is annotated with `rustc_insignificant_dtor`, we
      // treat this as the simple case of Drop impl for type.
      return undefined;
    }
  };
}

/** `.collect::<Result<Vec<_>, _>>()`: stops at the first `Err`. */
function collect_result(iter: NeedsDropTypes): Result<Ty[], AlwaysRequiresDrop> {
  const out: Ty[] = [];
  for (;;) {
    const item = iter.next();
    if (item === undefined) return Ok(out);
    if (item.$ === "Err") return item;
    out.push(item._0);
  }
}

// rustc: compiler/rustc_ty_utils/src/needs_drop.rs:476 adt_drop_tys
function adt_drop_tys(tcx: TyCtxt, def_id: DefId): Result<List<Ty>, AlwaysRequiresDrop> {
  // This is for the "adt_drop_tys" query, that considers all `Drop` impls, therefore all dtors are
  // significant.
  const adt_has_dtor = (adt_def: AdtDef): DtorType | undefined => (adt_def.destructor(tcx) !== undefined ? "Significant" : undefined);
  // `tcx.type_of(def_id)` identical to `tcx.make_adt(def, identity_args)`
  const r = collect_result(
    drop_tys_helper(
      tcx,
      Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.type_of(def_id) as EarlyBinder<Ty>)),
      TypingEnv.non_body_analysis(tcx, def_id),
      adt_has_dtor,
      DropTysOptions.default_(),
    ),
  );
  return r.$ === "Ok" ? Ok(tcx.mk_type_list(r._0)) : r;
}

// rustc: compiler/rustc_ty_utils/src/needs_drop.rs:496 adt_async_drop_tys
function adt_async_drop_tys(tcx: TyCtxt, def_id: DefId): Result<List<Ty>, AlwaysRequiresDrop> {
  // This is for the "adt_async_drop_tys" query, that considers all `AsyncDrop` impls.
  const adt_has_dtor = (adt_def: AdtDef): DtorType | undefined => (adt_def.async_destructor(tcx) !== undefined ? "Significant" : undefined);
  // `tcx.type_of(def_id)` identical to `tcx.make_adt(def, identity_args)`
  const r = collect_result(
    drop_tys_helper(
      tcx,
      Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.type_of(def_id) as EarlyBinder<Ty>)),
      TypingEnv.non_body_analysis(tcx, def_id),
      adt_has_dtor,
      DropTysOptions.recurse_into_box_for_async_drop(DropTysOptions.default_()),
    ),
  );
  return r.$ === "Ok" ? Ok(tcx.mk_type_list(r._0)) : r;
}

// If `def_id` refers to a generic ADT, the queries above and below act as if they had been handed
// a `tcx.make_ty(def, identity_args)` and as such it is legal to instantiate the generic parameters
// of the ADT into the outputted `ty`s.
// rustc: compiler/rustc_ty_utils/src/needs_drop.rs:518 adt_significant_drop_tys
function adt_significant_drop_tys(tcx: TyCtxt, def_id: DefId): Result<List<Ty>, AlwaysRequiresDrop> {
  const r = collect_result(
    drop_tys_helper(
      tcx,
      Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.type_of(def_id) as EarlyBinder<Ty>)), // identical to `tcx.make_adt(def, identity_args)`
      TypingEnv.non_body_analysis(tcx, def_id),
      adt_consider_insignificant_dtor(tcx),
      DropTysOptions.only_significant(DropTysOptions.default_()),
    ),
  );
  return r.$ === "Ok" ? Ok(tcx.mk_type_list(r._0)) : r;
}

// #[instrument(level = "debug", skip(tcx), ret)]
// rustc: compiler/rustc_ty_utils/src/needs_drop.rs:534 list_significant_drop_tys
function list_significant_drop_tys(tcx: TyCtxt, key: PseudoCanonicalInput<Ty>): List<Ty> {
  const iter = drop_tys_helper(
    tcx,
    key.value,
    key.typing_env,
    adt_consider_insignificant_dtor(tcx),
    DropTysOptions.exhaustive(DropTysOptions.only_significant(DropTysOptions.default_())),
  );
  const tys: Ty[] = [];
  for (;;) {
    const res = iter.next();
    if (res === undefined) break;
    if (res.$ === "Ok") tys.push(res._0);
  }
  return tcx.mk_type_list(tys);
}

// rustc: compiler/rustc_ty_utils/src/needs_drop.rs:551 provide
export function provide(providers: Providers): void {
  providers.needs_drop_raw = (tcx, query) => needs_drop_raw(tcx, query as PseudoCanonicalInput<Ty>);
  providers.needs_async_drop_raw = (tcx, query) => needs_async_drop_raw(tcx, query as PseudoCanonicalInput<Ty>);
  providers.has_significant_drop_raw = (tcx, query) => has_significant_drop_raw(tcx, query as PseudoCanonicalInput<Ty>);
  providers.adt_drop_tys = adt_drop_tys;
  providers.adt_async_drop_tys = adt_async_drop_tys;
  providers.adt_significant_drop_tys = adt_significant_drop_tys;
  providers.list_significant_drop_tys = (tcx, key) => list_significant_drop_tys(tcx, key as PseudoCanonicalInput<Ty>);
}
