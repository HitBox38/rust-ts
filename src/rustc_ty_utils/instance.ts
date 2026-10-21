// Port of compiler/rustc_ty_utils/src/instance.rs (lane instance-vtable).
//
// PORT: `debug!` (tracing) is dropped. `cfg!(debug_assertions)` is false (rustc ships without debug assertions), so
// that block of the `Fn*` arm is a comment. `codegen_select_candidate`'s value is `ImplSource<'tcx, ()>`
// (`ImplSource<null>`). `?` on `ancestors(..)` / `compare_impl_item` returns the `Err`.
import type { Providers } from "../rustc_middle/queries.gen.ts";
import type { CodegenObligationError, ImplSource } from "../rustc_middle/traits/mod.ts";
import type { CodegenFnAttrs } from "../rustc_middle/middle/codegen_fn_attrs.ts";
import { AssocItem } from "../rustc_middle/ty/assoc.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { AdtDef } from "../rustc_middle/ty/decls.ts";
import { GenericClauses } from "../rustc_middle/ty/generics.ts";
import { display_Ty } from "../rustc_middle/ty/print/pretty.ts";
import { PLAIN } from "../std/fmt.ts";
import { Instance, type InstanceKind } from "../rustc_middle/ty/instance.ts";
import type { GenericArgs } from "../rustc_middle/ty/generic_args.ts";
import { fold_GenericArgs } from "../rustc_middle/ty/generic_args.ts";
import type { PseudoCanonicalInput, Ty, TypingEnv } from "../rustc_middle/ty/mod.ts";
import type { TraitDef } from "../rustc_middle/ty/trait_def.ts";
import { Defaultness } from "../rustc_hir/hir.ts";
import type { DefId } from "../rustc_span/def_id.ts";
import { DefId_eq, debug_DefId } from "../rustc_span/def_id.ts";
import type { ErrorGuaranteed } from "../rustc_span/lib.ts";
import { bug } from "../rustc_span/macros.ts";
import { Symbol, sym } from "../rustc_span/symbol.ts";
import { TypeVisitableExt } from "../rustc_type_ir/visit.ts";
import { TypingMode } from "../rustc_type_ir/infer_ctxt.ts";
import { CoroutineClosureArgs } from "../rustc_type_ir/ty_kind/closure.ts";
import { TraitClause, TraitRef, as_interner, fold_with_TraitRef, try_fold_with_TraitRef, visit_with_TraitRef } from "../rustc_type_ir/predicate.ts";
import { display_TraitRef } from "../rustc_type_ir/ir_print.ts";
import { Unnormalized, UnnormalizedClause, UnnormalizedPolyTraitClause } from "../rustc_type_ir/unnormalized.ts";
import type { TypeFoldable } from "../rustc_type_ir/fold.ts";
import { translate_args } from "../rustc_trait_selection/traits/mod.ts";
import { assert, assert_eq, panic, unreachable } from "../std/panic.ts";
import { Err, Ok, type Result } from "../std/result.ts";

type GenericArgsRef = GenericArgs;

const d_TraitRef: TypeFoldable<TraitRef> = { visit_with: visit_with_TraitRef, try_fold_with: try_fold_with_TraitRef, fold_with: fold_with_TraitRef };

// rustc: compiler/rustc_ty_utils/src/instance.rs:17 resolve_instance_raw
function resolve_instance_raw(tcx: TyCtxt, key: PseudoCanonicalInput<[DefId, GenericArgsRef]>): Result<Instance | undefined, ErrorGuaranteed> {
  const {
    typing_env,
    value: [def_id, args],
  } = key;

  let result: Result<Instance | undefined, ErrorGuaranteed>;
  const trait_def_id = tcx.trait_of_assoc(def_id);
  if (trait_def_id !== undefined) {
    // debug!(" => associated item, attempting to find impl in typing_env {:#?}", typing_env);
    result = resolve_associated_item(tcx, def_id, typing_env, trait_def_id, tcx.normalize_erasing_regions(typing_env, Unnormalized.new_wip(args), fold_GenericArgs));
  } else {
    let def: InstanceKind;
    if (tcx.intrinsic(def_id) !== undefined) {
      // debug!(" => intrinsic");
      def = { $: "Intrinsic", _0: def_id };
    } else if (tcx.is_lang_item(def_id, "DropGlue")) {
      const ty = args.type_at(0);

      let shim: InstanceKind & { $: "Shim" };
      if (ty.needs_drop(tcx, typing_env)) {
        // debug!(" => nontrivial drop glue");
        const k = ty.kind();
        switch (k.$) {
          case "Coroutine": {
            const coroutine_def_id = k._0;
            // FIXME: sync drop of coroutine with async drop (generate both versions?)
            // Currently just ignored
            if ((tcx.optimized_mir(coroutine_def_id) as { coroutine_drop_async(): unknown }).coroutine_drop_async() !== undefined) {
              shim = { $: "Shim", _0: { $: "DropGlue", _0: def_id, _1: undefined } };
            } else {
              shim = { $: "Shim", _0: { $: "DropGlue", _0: def_id, _1: ty } };
            }
            break;
          }
          case "Closure":
          case "CoroutineClosure":
          case "Tuple":
          case "Adt":
          case "Dynamic":
          case "Array":
          case "Slice":
          case "UnsafeBinder":
            shim = { $: "Shim", _0: { $: "DropGlue", _0: def_id, _1: ty } };
            break;
          // Drop shims can only be built from ADTs.
          default:
            return Ok(undefined);
        }
      } else {
        // debug!(" => trivial drop glue");
        shim = { $: "Shim", _0: { $: "DropGlue", _0: def_id, _1: undefined } };
      }
      def = shim;
    } else if (tcx.is_lang_item(def_id, "AsyncDropInPlace")) {
      const ty = args.type_at(0);

      if (ty.needs_async_drop(tcx, typing_env)) {
        switch (ty.kind().$) {
          case "Closure":
          case "CoroutineClosure":
          case "Coroutine":
          case "Tuple":
          case "Adt":
          case "Dynamic":
          case "Array":
          case "Slice":
            break;
          // Async destructor ctor shims can only be built from ADTs.
          default:
            return Ok(undefined);
        }
        // debug!(" => nontrivial async drop glue ctor");
        def = { $: "Shim", _0: { $: "AsyncDropGlueCtor", _0: def_id, _1: ty } };
      } else {
        // debug!(" => trivial async drop glue ctor");
        def = { $: "Shim", _0: { $: "AsyncDropGlueCtor", _0: def_id, _1: ty } };
      }
    } else if (tcx.is_async_drop_in_place_coroutine(def_id)) {
      const ty = args.type_at(0);
      def = { $: "Shim", _0: { $: "AsyncDropGlue", _0: def_id, _1: ty } };
    } else if (tcx.def_kind(def_id).$ === "Fn" && llvm_symbol_name(tcx, def_id)) {
      // debug!(" => LLVM intrinsic");
      def = { $: "LlvmIntrinsic", _0: def_id };
    } else {
      // debug!(" => free item");
      def = { $: "Item", _0: def_id };
    }

    result = Ok({ def, args });
  }
  // debug!("resolve_instance: result={:?}", result);
  return result;
}

/** `let Some(name) = tcx.codegen_fn_attrs(def_id).symbol_name && name.as_str().starts_with("llvm.")` */
function llvm_symbol_name(tcx: TyCtxt, def_id: DefId): boolean {
  const name = (tcx.codegen_fn_attrs(def_id) as CodegenFnAttrs).symbol_name;
  return name !== undefined && Symbol.as_str(name).startsWith("llvm.");
}

// rustc: compiler/rustc_ty_utils/src/instance.rs:109 resolve_associated_item
function resolve_associated_item(
  tcx: TyCtxt,
  trait_item_id: DefId,
  typing_env: TypingEnv,
  trait_id: DefId,
  rcvr_args: GenericArgsRef,
): Result<Instance | undefined, ErrorGuaranteed> {
  // debug!(?trait_item_id, ?typing_env, ?trait_id, ?rcvr_args, "resolve_associated_item");

  const trait_ref = TraitRef.from_assoc(as_interner(tcx), trait_id, rcvr_args);

  const input = typing_env.as_query_input(trait_ref);
  const r = tcx.codegen_select_candidate(input) as Result<ImplSource<null>, CodegenObligationError>;
  let vtbl: ImplSource<null>;
  if (r.$ === "Ok") {
    vtbl = r._0;
  } else if (r._0.$ === "Ambiguity" || r._0.$ === "Unimplemented") {
    return Ok(undefined);
  } else {
    const guar = r._0._0;
    return Err(guar);
  }

  // Now that we know which impl is being used, we can dispatch to
  // the actual function:
  switch (vtbl.$) {
    case "UserDefined": {
      const impl_data = vtbl._0;
      // debug!("resolving ImplSource::UserDefined: {:?}, {:?}, {:?}, {:?}", typing_env, trait_item_id, rcvr_args, impl_data);
      assert(!TypeVisitableExt.has_infer(rcvr_args, fold_GenericArgs), "assertion failed: !rcvr_args.has_infer()");
      assert(!TypeVisitableExt.has_infer(trait_ref, d_TraitRef), "assertion failed: !trait_ref.has_infer()");

      const trait_def_id = tcx.impl_trait_id(impl_data.impl_def_id);
      const trait_def = tcx.trait_def(trait_def_id) as TraitDef;
      const ancestors = trait_def.ancestors(tcx, impl_data.impl_def_id);
      if (ancestors.$ === "Err") return ancestors;
      const leaf_def_ = ancestors._0.leaf_def(tcx, trait_item_id);
      const leaf_def =
        leaf_def_ ??
        bug(`${debug_DefId(trait_item_id, PLAIN)} not found in ${debug_DefId(impl_data.impl_def_id, PLAIN)}`);

      // Since this is a trait item, we need to see if the item is either a trait
      // default item or a specialization because we can't resolve those until we're
      // in `TypingMode::PostAnalysis`.
      //
      // NOTE: This should be kept in sync with the similar code in
      // `rustc_trait_selection::traits::project::assemble_candidates_from_impls()`.
      let eligible: boolean;
      if (leaf_def.is_final()) {
        // Non-specializable items are always projectable.
        eligible = true;
      } else {
        // Only reveal a specializable default if we're past type-checking
        // and the obligation is monomorphic, otherwise passes such as
        // transmute checking and polymorphic MIR optimizations could
        // get a result which isn't correct for all monomorphizations.
        const mode = TypingMode.assert_not_erased(typing_env.typing_mode());
        switch (mode.$) {
          case "Coherence":
          case "Typeck":
          case "PostTypeckUntilBorrowck":
          case "Reflection":
          case "PostBorrowck":
            eligible = false;
            break;
          case "PostAnalysis":
          case "Codegen":
            eligible = !TypeVisitableExt.still_further_specializable(trait_ref, d_TraitRef);
            break;
          default:
            // PORT: `ErasedNotCoherence(CantBeErased)` is uninhabited (no arm upstream).
            return unreachable();
        }
      }
      if (!eligible) {
        return Ok(undefined);
      }

      const typing_env_ = typing_env.with_post_analysis_normalized(tcx);
      const [infcx, param_env] = tcx.infer_ctxt().build_with_typing_env(typing_env_);
      const args0 = rcvr_args.rebase_onto(tcx, trait_def_id, impl_data.args);
      const args1 = translate_args(infcx, param_env, impl_data.impl_def_id, args0, leaf_def.defining_node);
      const args = infcx.tcx.erase_and_anonymize_regions(args1, fold_GenericArgs);

      // HACK: We may have overlapping `dyn Trait` built-in impls and
      // user-provided blanket impls. Detect that case here, and return
      // ambiguity.
      //
      // This should not affect totally monomorphized contexts, only
      // resolve calls that happen polymorphically, such as the mir-inliner
      // and const-prop (and also some lints).
      const self_ty = rcvr_args.type_at(0);
      if (!self_ty.is_known_rigid()) {
        const clauses = GenericClauses.instantiate(tcx.clauses_of(impl_data.impl_def_id) as GenericClauses, tcx, impl_data.args).clauses;
        const sized_def_id = tcx.lang_items().sized_trait();
        // If we find a `Self: Sized` bound on the item, then we know
        // that `dyn Trait` can certainly never apply here.
        let any = false;
        for (const p of clauses) {
          const clause = UnnormalizedClause.as_trait_clause(p);
          if (clause === undefined) continue;
          if (
            sized_def_id !== undefined &&
            DefId_eq(UnnormalizedPolyTraitClause.def_id(clause), sized_def_id) &&
            TraitClause.self_ty(Unnormalized.skip_binder(clause)) === self_ty
          ) {
            any = true;
            break;
          }
        }
        if (!any) {
          return Ok(undefined);
        }
      }

      // Any final impl is required to define all associated items.
      if (!Defaultness.has_value(AssocItem.defaultness(leaf_def.item, tcx))) {
        const guar = tcx.dcx().span_delayed_bug(tcx.def_span(leaf_def.item.def_id), "missing value for assoc item in impl");
        return Err(guar);
      }

      // Make sure that we're projecting to an item that has compatible args.
      // This may happen if we are resolving an instance before codegen, such
      // as during inlining. This check is also done in projection.
      if (!tcx.check_args_compatible(leaf_def.item.def_id, args)) {
        const guar = tcx.dcx().span_delayed_bug(tcx.def_span(leaf_def.item.def_id), "missing value for assoc item in impl");
        return Err(guar);
      }

      // We check that the impl item is compatible with the trait item
      // because otherwise we may ICE in const eval due to type mismatches,
      // signature incompatibilities, etc.
      // NOTE: We could also only enforce this in `PostAnalysis`, which
      // is what CTFE and MIR inlining would care about anyways.
      let leaf_def_item;
      if (!DefId_eq(trait_item_id, leaf_def.item.def_id) && (leaf_def_item = leaf_def.item.def_id.as_local()) !== undefined) {
        const c = tcx.ensure_result().compare_impl_item(leaf_def_item);
        if (c.$ === "Err") return c;
      }

      return Ok(Instance.new_raw(leaf_def.item.def_id, args));
    }
    case "Builtin": {
      const source = vtbl._0;
      if (source.$ === "Object") {
        const trait_ref = TraitRef.from_assoc(as_interner(tcx), trait_id, rcvr_args);

        // `final` methods should be called directly.
        if (Defaultness.is_final(tcx.defaultness(trait_item_id) as Defaultness)) {
          return Ok(Instance.new_raw(trait_item_id, rcvr_args));
        }

        if (TypeVisitableExt.has_non_region_infer(trait_ref, d_TraitRef) || TypeVisitableExt.has_non_region_param(trait_ref, d_TraitRef)) {
          // We only resolve totally substituted vtable entries.
          return Ok(undefined);
        } else {
          const vtable_base = tcx.first_method_vtable_slot(trait_ref);
          const offset = tcx.own_existential_vtable_entries(trait_id).findIndex((def_id) => DefId_eq(def_id, trait_item_id));
          return Ok(offset === -1 ? undefined : { def: { $: "Virtual", _0: trait_item_id, _1: vtable_base + offset }, args: rcvr_args });
        }
      } else if (source.$ === "Misc" || source.$ === "Trivial") {
        let fn_kind;
        if (tcx.is_lang_item(trait_ref.def_id, "Clone")) {
          // FIXME(eddyb) use lang items for methods instead of names.
          const name = tcx.item_name(trait_item_id);
          if (name === sym.clone) {
            const self_ty = TraitRef.self_ty(trait_ref);
            switch (self_ty.kind().$) {
              case "FnDef":
              case "FnPtr":
                break;
              case "Coroutine":
              case "CoroutineWitness":
              case "Closure":
              case "CoroutineClosure":
              case "Tuple":
                break;
              default:
                return Ok(undefined);
            }

            return Ok({ def: { $: "Shim", _0: { $: "Clone", _0: trait_item_id, _1: self_ty } }, args: rcvr_args });
          } else {
            assert_eq(name, sym.clone_from, (s) => Symbol.as_str(s));

            // Use the default `fn clone_from` from `trait Clone`.
            const args = tcx.erase_and_anonymize_regions(rcvr_args, fold_GenericArgs);
            return Ok(Instance.new_raw(trait_item_id, args));
          }
        } else if (tcx.is_lang_item(trait_ref.def_id, "FnPtrTrait")) {
          const self_ty = TraitRef.self_ty(trait_ref);
          if (!(self_ty.kind().$ === "FnPtr")) {
            return Ok(undefined);
          }
          if (tcx.is_lang_item(trait_item_id, "FnPtrAsPtr")) {
            return Ok({ def: { $: "Shim", _0: { $: "FnPtrAsPtr", _0: trait_item_id, _1: self_ty } }, args: rcvr_args });
          } else if (tcx.is_lang_item(trait_item_id, "FnPtrFromPtr")) {
            return Ok({ def: { $: "Shim", _0: { $: "FnPtrFromPtr", _0: trait_item_id, _1: self_ty } }, args: rcvr_args });
          } else {
            return Ok({ def: { $: "Item", _0: trait_item_id }, args: rcvr_args });
          }
        } else if ((fn_kind = tcx.fn_trait_kind_from_def_id(trait_ref.def_id)) !== undefined) {
          const target_kind = fn_kind;
          // FIXME: This doesn't check for malformed libcore that defines, e.g.,
          // `trait Fn { fn call_once(&self) { .. } }`. This is mostly for extension
          // methods.
          // if cfg!(debug_assertions) && ![sym::call, sym::call_mut, sym::call_once].contains(&tcx.item_name(trait_item_id)) {
          //     // For compiler developers who'd like to add new items to `Fn`/`FnMut`/`FnOnce`,
          //     // you either need to generate a shim body, or perhaps return
          //     // `InstanceKind::Item` pointing to a trait default method body if
          //     // it is given a default implementation by the trait.
          //     bug!("no definition for `{trait_ref}::{}` for built-in callable type", tcx.item_name(trait_item_id))
          // }
          const k = rcvr_args.type_at(0).kind();
          switch (k.$) {
            case "Closure": {
              const closure_def_id = k._0;
              const args = k._1;
              return Ok(Instance.resolve_closure(tcx, closure_def_id, args, target_kind));
            }
            case "FnDef":
            case "FnPtr":
              return Ok({ def: { $: "Shim", _0: { $: "FnPtr", _0: trait_item_id, _1: rcvr_args.type_at(0) } }, args: rcvr_args });
            case "CoroutineClosure": {
              const coroutine_closure_def_id = k._0;
              const args = k._1;
              // When a coroutine-closure implements the `Fn` traits, then it
              // always dispatches to the `FnOnce` implementation. This is to
              // ensure that the `closure_kind` of the resulting closure is in
              // sync with the built-in trait implementations (since all of the
              // implementations return `FnOnce::Output`).
              if ("FnOnce" === CoroutineClosureArgs.kind(args.as_coroutine_closure())) {
                return Ok(Instance.new_raw(coroutine_closure_def_id, args));
              } else {
                return Ok({
                  def: {
                    $: "Shim",
                    _0: { $: "ConstructCoroutineInClosure", coroutine_closure_def_id, receiver_by_ref: target_kind !== "FnOnce" },
                  },
                  args,
                });
              }
            }
            default:
              return bug(`no built-in definition for \`${display_TraitRef(trait_ref)}::${Symbol.as_str(tcx.item_name(trait_item_id))}\` for non-fn type`);
          }
        } else if ((fn_kind = tcx.async_fn_trait_kind_from_def_id(trait_ref.def_id)) !== undefined) {
          const target_kind = fn_kind;
          const k = rcvr_args.type_at(0).kind();
          switch (k.$) {
            case "CoroutineClosure": {
              const coroutine_closure_def_id = k._0;
              const args = k._1;
              if (target_kind === "FnOnce" && CoroutineClosureArgs.kind(args.as_coroutine_closure()) !== "FnOnce") {
                // If we're computing `AsyncFnOnce` for a by-ref closure then
                // construct a new body that has the right return types.
                return Ok({
                  def: { $: "Shim", _0: { $: "ConstructCoroutineInClosure", coroutine_closure_def_id, receiver_by_ref: false } },
                  args,
                });
              } else {
                return Ok(Instance.new_raw(coroutine_closure_def_id, args));
              }
            }
            case "Closure": {
              const closure_def_id = k._0;
              const args = k._1;
              return Ok(Instance.resolve_closure(tcx, closure_def_id, args, target_kind));
            }
            case "FnDef":
            case "FnPtr":
              return Ok({ def: { $: "Shim", _0: { $: "FnPtr", _0: trait_item_id, _1: rcvr_args.type_at(0) } }, args: rcvr_args });
            default:
              return bug(
                `no built-in definition for \`${display_TraitRef(trait_ref)}::${Symbol.as_str(tcx.item_name(trait_item_id))}\` for non-lending-closure type`,
              );
          }
        } else if (tcx.is_lang_item(trait_ref.def_id, "TransmuteTrait")) {
          const name = tcx.item_name(trait_item_id);
          assert_eq(name, sym.transmute, (s) => Symbol.as_str(s));
          const args = tcx.erase_and_anonymize_regions(rcvr_args, fold_GenericArgs);
          return Ok(Instance.new_raw(trait_item_id, args));
        } else if (tcx.is_lang_item(trait_ref.def_id, "Field")) {
          if (tcx.is_lang_item(trait_item_id, "FieldOffset")) {
            const self_ty = TraitRef.self_ty(trait_ref);
            const sk = self_ty.kind();
            if (!(sk.$ === "Adt" && (sk._0 as AdtDef).is_field_representing_type())) {
              return bug(`expected field representing type, found ${display_Ty(self_ty)}`);
            }
            const field_offset = tcx.lang_items().get("FieldOffset");
            if (field_offset === undefined) return panic("called `Option::unwrap()` on a `None` value");
            return Ok({ def: { $: "Item", _0: field_offset }, args: rcvr_args });
          } else {
            return bug("unexpected associated associated item");
          }
        } else {
          return Ok(Instance.try_resolve_item_for_coroutine(tcx, trait_item_id, trait_id, rcvr_args));
        }
      } else {
        // BuiltinImplSource::TraitUpcasting { .. }
        return Ok(undefined);
      }
    }
    case "Param":
      return Ok(undefined);
  }
}

// rustc: compiler/rustc_ty_utils/src/instance.rs:440 provide
export function provide(providers: Providers): void {
  providers.resolve_instance_raw = resolve_instance_raw as Providers["resolve_instance_raw"];
}

// ---- helpers ---------------------------------------------------------------------------------------------------------
