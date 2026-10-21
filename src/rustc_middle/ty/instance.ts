// Port of compiler/rustc_middle/src/ty/instance.rs (lane instance-vtable). The types (`Instance`, `ReifyReason`,
// `InstanceKind`, `ShimKind`) with their derived Debug / TypeVisitable / TypeFoldable are generated into
// instance.gen.ts (set rustc_middle_ty_instance of tools/codegen/types.ts); this file holds the inherent methods, the
// free fns and `impl Display for Instance`, in upstream order.
//
// PORT: methods of the generated structs / enums live on a same-named companion const taking `self` first
// (`Instance.def_id(instance)`, `InstanceKind.def_id(kind)`), as rustc_type_ir's `TraitRef` (predicate.ts).
// PORT: `Instance` is `Copy`; `resolved.def = ..` on a local copy is a fresh object (`{ ...resolved, def }`).
// PORT: `#[instrument]` / `debug!` (tracing) are dropped.
// PORT: generic fns over `T: TypeFoldable` / `impl TypeVisitable` take the D4 descriptor `d_T` last.
// Init order: top-level code here touches only ./instance.gen.ts. queries.gen.ts imports this module early, so the
// `TyCtxt` extension modules ty/assoc.ts and ty/print/pretty.ts (and print/mod.ts, which imports pretty.ts) are reached
// lazily (`ty_assoc()`, `ty_print_pretty()`, `ty_print_mod()`), and so is rustc_session config.ts (`session_config()`).
import type { DefKind } from "../../rustc_hir/def.ts";
import { debug_DefKind, Namespace } from "../../rustc_hir/def.ts";
import { type DefId, DefId_eq, LOCAL_CRATE, debug_DefId } from "../../rustc_span/def_id.ts";
import { DUMMY_SP, Span } from "../../rustc_span/lib.ts";
import { type ErrorGuaranteed, debug_ErrorGuaranteed } from "../../rustc_span/lib.ts";
import { bug, span_bug } from "../../rustc_span/macros.ts";
import { VisitorResult } from "../../rustc_ast_ir/visit.ts";
import { InlineAttr } from "../../rustc_attr_ir/data_structures.ts";
import { type CoroutineKind, debug_CoroutineKind } from "../../rustc_hir/hir.ts";
import { Binder, EarlyBinder } from "../../rustc_type_ir/binder.ts";
import type { ClosureKind } from "../../rustc_type_ir/decls.ts";
import { type PredicateProxy, type TypeFoldable, fold_tuple2 } from "../../rustc_type_ir/fold.ts";
import { type Const, fold_Const } from "../../rustc_type_ir/sty/consts.ts";
import type { Region } from "../../rustc_type_ir/sty/mod.ts";
import { ClosureArgs, CoroutineArgs, CoroutineClosureArgs } from "../../rustc_type_ir/ty_kind/closure.ts";
import { PolyFnSig, FnSig } from "../../rustc_type_ir/ty_kind.ts";
import { Unnormalized } from "../../rustc_type_ir/unnormalized.ts";
import { type TypeVisitable, TypeVisitableExt, type TypeVisitor, TypeVisitor_provided } from "../../rustc_type_ir/visit.ts";
import { type Fmt, PLAIN, PRETTY, debug_option, format_debug } from "../../std/fmt.ts";
import { panic } from "../../std/panic.ts";
import { Ok, type Result, debug_result } from "../../std/result.ts";
import { CodegenFnAttrFlags, type CodegenFnAttrs } from "../middle/codegen_fn_attrs.ts";
import { with_ } from "./context/tls.ts";
import type { TyCtxt } from "./context.ts";
import type { AssocItem } from "./decls.ts";
import type { GenericParamDef, Generics } from "./generics.ts";
import { RawList } from "./list.ts";
import { TypeLengthLimit_diagnostic } from "../diagnostics.gen.ts";
import { GenericArg, type GenericArgs, debug_GenericArgs, fold_GenericArgs } from "./generic_args.ts";
import * as gen from "./instance.gen.ts";
import { type PseudoCanonicalInput, Ty, type TypingEnv, TypingEnv as TypingEnvC, fold_PseudoCanonicalInput } from "./mod.ts";
import type { NormalizationError } from "./normalize_erasing_regions.ts";
import { fold_Ty } from "./structural_impls.ts";

export * from "./instance.gen.ts";

export type Instance = gen.Instance;
export type InstanceKind = gen.InstanceKind;
export type ShimKind = gen.ShimKind;
type GenericArgsRef = GenericArgs;

export const Instance = {
  /// Returns the `Ty` corresponding to this `Instance`, with generic instantiations applied and
  /// lifetimes erased, allowing a `ParamEnv` to be specified for use during normalization.
  // rustc: compiler/rustc_middle/src/ty/instance.rs:210 ty
  ty(self: Instance, tcx: TyCtxt, typing_env: TypingEnv): Ty {
    const ty = tcx.type_of(InstanceKind.def_id(self.def)) as EarlyBinder<Ty>;
    return tcx.instantiate_and_normalize_erasing_regions(self.args, typing_env, ty, fold_Ty);
  },

  /// Finds a crate that contains a monomorphization of this instance that
  /// can be linked to from the local crate. A return value of `None` means
  /// no upstream crate provides such an exported monomorphization.
  ///
  /// This method already takes into account the global `-Zshare-generics`
  /// setting, always returning `None` if `share-generics` is off.
  // rustc: compiler/rustc_middle/src/ty/instance.rs:221 upstream_monomorphization
  upstream_monomorphization(self: Instance, tcx: TyCtxt): number | undefined {
    // If this is an item that is defined in the local crate, no upstream
    // crate can know about it/provide a monomorphization.
    if (Instance.def_id(self).is_local()) {
      return undefined;
    }

    // If we are not in share generics mode, we don't link to upstream
    // monomorphizations but always instantiate our own internal versions
    // instead.
    if (
      !session_config().Options_impl.share_generics(tcx.sess.opts) &&
      // However, if the def_id is marked inline(never), then it's fine to just reuse the
      // upstream monomorphization.
      (tcx.codegen_fn_attrs(Instance.def_id(self)) as CodegenFnAttrs).inline.$ !== InlineAttr.Never.$
    ) {
      return undefined;
    }

    // If this a non-generic instance, it cannot be a shared monomorphization.
    // PORT: `self.args.non_erasable_generics().next()?`
    if (self.args.non_erasable_generics()[Symbol.iterator]().next().done) return undefined;

    // compiler_builtins cannot use upstream monomorphizations.
    if (tcx.is_compiler_builtins(LOCAL_CRATE)) {
      return undefined;
    }

    const def = self.def;
    if (def.$ === "Item") {
      const monos = tcx.upstream_monomorphizations_for(def._0);
      return monos === undefined ? undefined : (monos.get(self.args) as number | undefined);
    } else if (def.$ === "Shim" && def._0.$ === "DropGlue" && def._0._1 !== undefined) {
      return tcx.upstream_drop_glue_for(self.args);
    } else if (def.$ === "Shim" && def._0.$ === "AsyncDropGlue") {
      return undefined;
    } else if (def.$ === "Shim" && def._0.$ === "FutureDropPoll") {
      return undefined;
    } else if (def.$ === "Shim" && def._0.$ === "AsyncDropGlueCtor") {
      return tcx.upstream_async_drop_glue_for(self.args);
    } else {
      return undefined;
    }
  },

  /// Creates a new [`InstanceKind::Item`] from the `def_id` and `args`.
  ///
  /// Note that this item corresponds to the body of `def_id` directly, which
  /// likely does not make sense for trait items which need to be resolved to an
  /// implementation, and which may not even have a body themselves. Usages of
  /// this function should probably use [`Instance::expect_resolve`], or if run
  /// in a polymorphic environment or within a lint (that may encounter ambiguity)
  /// [`Instance::try_resolve`] instead.
  // rustc: compiler/rustc_middle/src/ty/instance.rs:519 new_raw
  new_raw(def_id: DefId, args: GenericArgsRef): Instance {
    if (!(!TypeVisitableExt.has_escaping_bound_vars(args, fold_GenericArgs))) {
      panic(`args of instance ${debug_DefId(def_id, PLAIN)} has escaping bound vars: ${debug_GenericArgs(args, PLAIN)}`);
    }
    return { def: { $: "Item", _0: def_id }, args };
  },

  // rustc: compiler/rustc_middle/src/ty/instance.rs:527 mono
  mono(tcx: TyCtxt, def_id: DefId): Instance {
    const args = RawList.for_item(tcx, def_id, (param: GenericParamDef, _: readonly GenericArg[]) => {
      switch (param.kind.$) {
        case "Lifetime":
          return GenericArg.from_Region(tcx.lifetimes.re_erased);
        case "Type":
          return bug(`Instance::mono: ${debug_DefId(def_id, PLAIN)} has type parameters`);
        case "Const":
          return bug(`Instance::mono: ${debug_DefId(def_id, PLAIN)} has const parameters`);
      }
    });

    return Instance.new_raw(def_id, args);
  },

  // #[inline]
  // rustc: compiler/rustc_middle/src/ty/instance.rs:542 def_id
  def_id(self: Instance): DefId {
    return InstanceKind.def_id(self.def);
  },

  /// Resolves a `(def_id, args)` pair to an (optional) instance -- most commonly,
  /// this is used to find the precise code that will run for a trait method invocation,
  /// if known. This should only be used for functions and consts. If you want to
  /// resolve an associated type, use [`TyCtxt::try_normalize_erasing_regions`].
  ///
  /// Returns `Ok(None)` if we cannot resolve `Instance` to a specific instance.
  /// For example, in a context like this,
  ///
  /// ```ignore (illustrative)
  /// fn foo<T: Debug>(t: T) { ... }
  /// ```
  ///
  /// trying to resolve `Debug::fmt` applied to `T` will yield `Ok(None)`, because we do not
  /// know what code ought to run. This setting is also affected by the current `TypingMode`
  /// of the environment.
  ///
  /// Presuming that coherence and type-check have succeeded, if this method is invoked
  /// in a monomorphic context (i.e., like during codegen), then it is guaranteed to return
  /// `Ok(Some(instance))`, **except** for when the instance's inputs hit the type size limit,
  /// in which case it may bail out and return `Ok(None)`.
  ///
  /// Returns `Err(ErrorGuaranteed)` when the `Instance` resolution process
  /// couldn't complete due to errors elsewhere - this is distinct
  /// from `Ok(None)` to avoid misleading diagnostics when an error
  /// has already been/will be emitted, for the original cause
  // #[instrument(level = "debug", skip(tcx), ret)]
  // rustc: compiler/rustc_middle/src/ty/instance.rs:572 try_resolve
  try_resolve(tcx: TyCtxt, typing_env: TypingEnv, def_id: DefId, args: GenericArgsRef): Result<Instance | undefined, ErrorGuaranteed> {
    const def_kind: DefKind = tcx.def_kind(def_id);
    const k = def_kind;
    if (
      !(
        k.$ === "Fn" ||
        k.$ === "AssocFn" ||
        k.$ === "Const" ||
        k.$ === "AssocConst" ||
        k.$ === "AnonConst" ||
        k.$ === "Static" ||
        (k.$ === "Ctor" && k._1 === "Fn") ||
        k.$ === "Closure" ||
        k.$ === "SyntheticCoroutineBody"
      )
    ) {
      panic(
        "assertion `left matches right` failed: `Instance::try_resolve` should only be used to resolve instances of " +
          "functions, statics, and consts; to resolve associated types, use `try_normalize_erasing_regions`.\n" +
          `  left: ${debug_DefKind(def_kind, PLAIN)}\n` +
          " right: DefKind::Fn | DefKind::AssocFn | DefKind::Const | DefKind::AssocConst | DefKind::AnonConst |\n" +
          "DefKind::Static { .. } | DefKind::Ctor(_, CtorKind::Fn) | DefKind::Closure |\nDefKind::SyntheticCoroutineBody",
      );
    }

    // Rust code can easily create exponentially-long types using only a
    // polynomial recursion depth. Even with the default recursion
    // depth, you can easily get cases that take >2^60 steps to run,
    // which means that rustc basically hangs.
    //
    // Bail out in these cases to avoid that bad user experience.
    if (tcx.sess.opts.unstable_opts.enforce_type_length_limit && !tcx.type_length_limit().value_within_limit(type_length(args, fold_GenericArgs))) {
      return Ok(undefined);
    }

    // All regions in the result of this query are erased, so it's
    // fine to erase all of the input regions.
    return tcx.resolve_instance_raw(tcx.erase_and_anonymize_regions(typing_env.as_query_input<[DefId, GenericArgs]>([def_id, args]), d_query_input())) as Result<
      Instance | undefined,
      ErrorGuaranteed
    >;
  },

  // rustc: compiler/rustc_middle/src/ty/instance.rs:613 expect_resolve
  expect_resolve(tcx: TyCtxt, typing_env: TypingEnv, def_id: DefId, args: GenericArgsRef, span: Span): Instance {
    // We compute the span lazily, to avoid unnecessary query calls.
    // If `span` is a DUMMY_SP, and the def id is local, then use the
    // def span of the def id.
    const span_or_local_def_span = (): Span => (Span.is_dummy(span) && def_id.is_local() ? tcx.def_span(def_id) : span);

    const r = Instance.try_resolve(tcx, typing_env, def_id, args);
    if (r.$ === "Ok" && r._0 !== undefined) {
      return r._0;
    } else if (r.$ === "Ok") {
      const type_length_ = type_length(args, fold_GenericArgs);
      if (!tcx.type_length_limit().value_within_limit(type_length_)) {
        return tcx.dcx().emit_fatal(
          TypeLengthLimit_diagnostic({
            // We don't use `def_span(def_id)` so that diagnostics point
            // to the crate root during mono instead of to foreign items.
            // This is arguably better.
            span: span_or_local_def_span(),
            instance: Instance.new_raw(def_id, args),
            type_length: type_length_,
          }),
        );
      } else {
        return span_bug(span_or_local_def_span(), `failed to resolve instance for ${tcx.def_path_str_with_args(def_id, args)}`);
      }
    } else {
      const instance = r;
      return span_bug(
        span_or_local_def_span(),
        `failed to resolve instance for ${tcx.def_path_str_with_args(def_id, args)}: ${format_debug(instance, debug_resolve_result, PRETTY)}`,
      );
    }
  },

  // rustc: compiler/rustc_middle/src/ty/instance.rs:655 resolve_for_fn_ptr
  resolve_for_fn_ptr(tcx: TyCtxt, typing_env: TypingEnv, def_id: DefId, args: GenericArgsRef): Instance | undefined {
    // debug!("resolve(def_id={:?}, args={:?})", def_id, args);
    // Use either `resolve_closure` or `resolve_for_vtable`
    if (!!tcx.is_closure_like(def_id)) {
      panic(`Called \`resolve_for_fn_ptr\` on closure: ${debug_DefId(def_id, PLAIN)}`);
    }
    const reason: gen.ReifyReason | undefined = tcx.sess.is_sanitizer_kcfi_enabled() ? "FnPtr" : undefined;
    const r = Instance.try_resolve(tcx, typing_env, def_id, args);
    const opt = r.$ === "Ok" ? r._0 : undefined;
    if (opt === undefined) return undefined;
    let resolved: Instance = opt;
    const def = resolved.def;
    if (def.$ === "Item" && InstanceKind.requires_caller_location(resolved.def, tcx)) {
      // debug!(" => fn pointer created for function with #[track_caller]");
      resolved = { ...resolved, def: { $: "Shim", _0: { $: "Reify", _0: def._0, _1: reason } } };
    } else if (def.$ === "Virtual") {
      const def_id_ = def._0;
      // debug!(" => fn pointer created for virtual call");
      resolved = { ...resolved, def: { $: "Shim", _0: { $: "Reify", _0: def_id_, _1: reason } } };
    } else if (tcx.sess.is_sanitizer_kcfi_enabled()) {
      // Reify `::call`-like method implementations
      let assoc: AssocItem | undefined;
      if (tcx.is_closure_like(Instance.def_id(resolved))) {
        // Reroute through a reify via the *unresolved* instance. The resolved one can't
        // be directly reified because it's closure-like. The reify can handle the
        // unresolved instance.
        resolved = { def: { $: "Shim", _0: { $: "Reify", _0: def_id, _1: reason } }, args };
        // Reify `Trait::method` implementations if the trait is dyn-compatible.
      } else if (
        (assoc = tcx.opt_associated_item(def_id)) !== undefined &&
        (assoc.container.$ === "Trait" || (assoc.container.$ === "TraitImpl" && assoc.container._0.$ === "Ok")) &&
        tcx.is_dyn_compatible(ty_assoc().AssocItem.container_id(assoc, tcx))
      ) {
        // If this function could also go in a vtable, we need to `ReifyShim` it with
        // KCFI because it can only attach one type per function.
        resolved = { ...resolved, def: { $: "Shim", _0: { $: "Reify", _0: Instance.def_id(resolved), _1: reason } } };
      }
    }

    return resolved;
  },

  // rustc: compiler/rustc_middle/src/ty/instance.rs:704 expect_resolve_for_vtable
  expect_resolve_for_vtable(tcx: TyCtxt, typing_env: TypingEnv, def_id: DefId, args: GenericArgsRef, span: Span): Instance {
    // debug!("resolve_for_vtable(def_id={:?}, args={:?})", def_id, args);
    const fn_sig = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.fn_sig(def_id) as EarlyBinder<Binder<FnSig>>));
    const is_vtable_shim =
      !(Binder.skip_binder(PolyFnSig.inputs(fn_sig)).length === 0) &&
      Binder.skip_binder(PolyFnSig.input(fn_sig, 0)).is_param(0) &&
      (tcx.generics_of(def_id) as Generics).has_self;

    if (is_vtable_shim) {
      // debug!(" => associated item with unsizeable self: Self");
      return { def: { $: "Shim", _0: { $: "VTable", _0: def_id } }, args };
    }

    let resolved = Instance.expect_resolve(tcx, typing_env, def_id, args, span);

    const reason: gen.ReifyReason | undefined = tcx.sess.is_sanitizer_kcfi_enabled() ? "Vtable" : undefined;
    const rdef = resolved.def;
    if (rdef.$ === "Item") {
      const def = rdef._0;
      // We need to generate a shim when we cannot guarantee that
      // the caller of a trait object method will be aware of
      // `#[track_caller]` - this ensures that the caller
      // and callee ABI will always match.
      //
      // The shim is generated when all of these conditions are met:
      //
      // 1) The underlying method expects a caller location parameter
      // in the ABI
      let needs_track_caller_shim = InstanceKind.requires_caller_location(resolved.def, tcx);
      // 2) The caller location parameter comes from having `#[track_caller]`
      // on the implementation, and *not* on the trait method.
      needs_track_caller_shim &&= !tcx.should_inherit_track_caller(def);
      // If the method implementation comes from the trait definition itself
      // (e.g. `trait Foo { #[track_caller] my_fn() { /* impl */ } }`),
      // then we don't need to generate a shim. This check is needed because
      // `should_inherit_track_caller` returns `false` if our method
      // implementation comes from the trait block, and not an impl block
      if (needs_track_caller_shim) {
        const item = tcx.opt_associated_item(def);
        needs_track_caller_shim = !(item !== undefined && item.container.$ === "Trait");
      }
      if (needs_track_caller_shim) {
        if (tcx.is_closure_like(def)) {
          // debug!(" => vtable fn pointer created for closure with #[track_caller]: {:?} for method {:?} {:?}", def, def_id, args);

          // Create a shim for the `FnOnce/FnMut/Fn` method we are calling
          // - unlike functions, invoking a closure always goes through a
          // trait.
          resolved = { def: { $: "Shim", _0: { $: "Reify", _0: def_id, _1: reason } }, args };
        } else {
          // debug!(" => vtable fn pointer created for function with #[track_caller]: {:?}", def);
          resolved = { ...resolved, def: { $: "Shim", _0: { $: "Reify", _0: def, _1: reason } } };
        }
      }
    } else if (rdef.$ === "Virtual") {
      const def_id_ = rdef._0;
      // debug!(" => vtable fn pointer created for virtual call");
      resolved = { ...resolved, def: { $: "Shim", _0: { $: "Reify", _0: def_id_, _1: reason } } };
    }

    return resolved;
  },

  // rustc: compiler/rustc_middle/src/ty/instance.rs:785 resolve_closure
  resolve_closure(tcx: TyCtxt, def_id: DefId, args: GenericArgsRef, requested_kind: ClosureKind): Instance {
    const actual_kind = ClosureArgs.kind(args.as_closure());

    const r = needs_fn_once_adapter_shim(actual_kind, requested_kind);
    if (r.$ === "Ok" && r._0 === true) {
      return Instance.fn_once_adapter_instance(tcx, def_id, args);
    } else {
      return Instance.new_raw(def_id, args);
    }
  },

  // rustc: compiler/rustc_middle/src/ty/instance.rs:799 resolve_drop_glue
  resolve_drop_glue(tcx: TyCtxt, ty: Ty): Instance {
    const def_id = tcx.require_lang_item("DropGlue", DUMMY_SP);
    const args = tcx.mk_args([GenericArg.from_Ty(ty)]);
    const adt = ty.ty_adt_def();
    return Instance.expect_resolve(
      tcx,
      TypingEnvC.fully_monomorphized(),
      def_id,
      args,
      (adt !== undefined ? tcx.hir_span_if_local(adt.did()) : undefined) ?? DUMMY_SP,
    );
  },

  // rustc: compiler/rustc_middle/src/ty/instance.rs:811 resolve_async_drop_in_place
  resolve_async_drop_in_place(tcx: TyCtxt, ty: Ty): Instance {
    const def_id = tcx.require_lang_item("AsyncDropInPlace", DUMMY_SP);
    const args = tcx.mk_args([GenericArg.from_Ty(ty)]);
    const adt = ty.ty_adt_def();
    return Instance.expect_resolve(
      tcx,
      TypingEnvC.fully_monomorphized(),
      def_id,
      args,
      (adt !== undefined ? tcx.hir_span_if_local(adt.did()) : undefined) ?? DUMMY_SP,
    );
  },

  // rustc: compiler/rustc_middle/src/ty/instance.rs:823 resolve_async_drop_in_place_poll
  resolve_async_drop_in_place_poll(tcx: TyCtxt, def_id: DefId, ty: Ty): Instance {
    const args = tcx.mk_args([GenericArg.from_Ty(ty)]);
    return Instance.expect_resolve(tcx, TypingEnvC.fully_monomorphized(), def_id, args, DUMMY_SP);
  },

  // #[instrument(level = "debug", skip(tcx), ret)]
  // rustc: compiler/rustc_middle/src/ty/instance.rs:833 fn_once_adapter_instance
  fn_once_adapter_instance(tcx: TyCtxt, closure_did: DefId, args_: GenericArgsRef): Instance {
    const fn_once = tcx.require_lang_item("FnOnce", DUMMY_SP);
    let call_once_item: AssocItem | undefined;
    for (const it of ty_assoc().AssocItems.in_definition_order(tcx.associated_items(fn_once) as import("./assoc.ts").AssocItems)) {
      if (ty_assoc().AssocItem.is_fn(it)) {
        call_once_item = it;
        break;
      }
    }
    if (call_once_item === undefined) return panic("called `Option::unwrap()` on a `None` value");
    const call_once = call_once_item.def_id;
    const track_caller = CodegenFnAttrFlags.contains((tcx.codegen_fn_attrs(closure_did) as CodegenFnAttrs).flags, CodegenFnAttrFlags.TRACK_CALLER);
    const def: InstanceKind = { $: "Shim", _0: { $: "ClosureOnce", call_once, closure: closure_did, track_caller } };

    const self_ty = Ty.new_closure(tcx, closure_did, args_);

    const tupled_inputs_ty_ = Binder.map_bound(ClosureArgs.sig(args_.as_closure()), (sig) => FnSig.inputs(sig)[0]!);
    const tupled_inputs_ty = tcx.instantiate_bound_regions_with_erased(tupled_inputs_ty_, fold_Ty);
    const args = tcx.mk_args_trait(self_ty, [GenericArg.from_Ty(tupled_inputs_ty)]);

    // debug!(?self_ty, args=?tupled_inputs_ty.tuple_fields());
    return { def, args };
  },

  // rustc: compiler/rustc_middle/src/ty/instance.rs:863 try_resolve_item_for_coroutine
  try_resolve_item_for_coroutine(tcx: TyCtxt, trait_item_id: DefId, trait_id: DefId, rcvr_args: GenericArgsRef): Instance | undefined {
    const k0 = rcvr_args.type_at(0).kind();
    if (k0.$ !== "Coroutine") {
      return undefined;
    }
    const coroutine_def_id = k0._0;
    const args = k0._1;
    const coroutine_kind = tcx.coroutine_kind(coroutine_def_id) as CoroutineKind | undefined;
    if (coroutine_kind === undefined) return panic("called `Option::unwrap()` on a `None` value");

    let coroutine_callable_item: "FuturePoll" | "IteratorNext" | "AsyncIteratorPollNext" | "CoroutineResume";
    if (tcx.is_lang_item(trait_id, "Future")) {
      assert_coroutine_kind(coroutine_kind, coroutine_kind.$ === "Desugared" && coroutine_kind._0 === "Async", "hir::CoroutineKind::Desugared(hir::CoroutineDesugaring::Async, _)");
      coroutine_callable_item = "FuturePoll";
    } else if (tcx.is_lang_item(trait_id, "Iterator")) {
      assert_coroutine_kind(coroutine_kind, coroutine_kind.$ === "Desugared" && coroutine_kind._0 === "Gen", "hir::CoroutineKind::Desugared(hir::CoroutineDesugaring::Gen, _)");
      coroutine_callable_item = "IteratorNext";
    } else if (tcx.is_lang_item(trait_id, "AsyncIterator")) {
      assert_coroutine_kind(coroutine_kind, coroutine_kind.$ === "Desugared" && coroutine_kind._0 === "AsyncGen", "hir::CoroutineKind::Desugared(hir::CoroutineDesugaring::AsyncGen, _)");
      coroutine_callable_item = "AsyncIteratorPollNext";
    } else if (tcx.is_lang_item(trait_id, "Coroutine")) {
      assert_coroutine_kind(coroutine_kind, coroutine_kind.$ === "Coroutine", "hir::CoroutineKind::Coroutine(_)");
      coroutine_callable_item = "CoroutineResume";
    } else {
      return undefined;
    }

    if (tcx.is_lang_item(trait_item_id, coroutine_callable_item)) {
      if (tcx.is_async_drop_in_place_coroutine(coroutine_def_id)) {
        return resolve_async_drop_poll(rcvr_args.type_at(0));
      }
      const idk = EarlyBinder.skip_binder(tcx.type_of(coroutine_def_id) as EarlyBinder<Ty>).kind();
      if (idk.$ !== "Coroutine") {
        return bug();
      }
      const id_args = idk._1;

      // If the closure's kind ty disagrees with the identity closure's kind ty,
      // then this must be a coroutine generated by one of the `ConstructCoroutineInClosureShim`s.
      if (CoroutineArgs.kind_ty(args.as_coroutine()) === CoroutineArgs.kind_ty(id_args.as_coroutine())) {
        return { def: { $: "Item", _0: coroutine_def_id }, args };
      } else {
        return {
          def: { $: "Item", _0: tcx.coroutine_by_move_body_def_id(coroutine_def_id) },
          args,
        };
      }
    } else {
      // All other methods should be defaulted methods of the built-in trait.
      // This is important for `Iterator`'s combinators, but also useful for
      // adding future default methods to `Future`, for instance.
      // debug_assert!(tcx.defaultness(trait_item_id).has_value());
      return Instance.new_raw(trait_item_id, rcvr_args);
    }
  },

  /// Depending on the kind of `InstanceKind`, the MIR body associated with an
  /// instance is expressed in terms of the generic parameters of `self.def_id()`, and in other
  /// cases the MIR body is expressed in terms of the types found in the generic parameter array.
  /// In the former case, we want to instantiate those generic types and replace them with the
  /// values from the args when monomorphizing the function body. But in the latter case, we
  /// don't want to do that instantiation, since it has already been done effectively.
  ///
  /// This function returns `Some(args)` in the former case and `None` otherwise -- i.e., if
  /// this function returns `None`, then the MIR body does not require instantiation during
  /// codegen.
  // rustc: compiler/rustc_middle/src/ty/instance.rs:939 args_for_mir_body
  args_for_mir_body(self: Instance): GenericArgsRef | undefined {
    return InstanceKind.has_polymorphic_mir_body(self.def) ? self.args : undefined;
  },

  // rustc: compiler/rustc_middle/src/ty/instance.rs:943 instantiate_mir
  instantiate_mir<T>(self: Instance, tcx: TyCtxt, v: EarlyBinder<T>, d_T: TypeFoldable<T>): T {
    const args = Instance.args_for_mir_body(self);
    if (args !== undefined) {
      return Unnormalized.skip_norm_wip(EarlyBinder.instantiate(v, tcx, args, d_T));
    } else {
      return Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(v));
    }
  },

  // #[inline(always)]
  // Keep me in sync with try_instantiate_mir_and_normalize_erasing_regions
  // rustc: compiler/rustc_middle/src/ty/instance.rs:956 instantiate_mir_and_normalize_erasing_regions
  instantiate_mir_and_normalize_erasing_regions<T>(self: Instance, tcx: TyCtxt, typing_env: TypingEnv, v: EarlyBinder<T>, d_T: TypeFoldable<T>): T {
    const args = Instance.args_for_mir_body(self);
    if (args !== undefined) {
      return tcx.instantiate_and_normalize_erasing_regions(args, typing_env, v, d_T);
    } else {
      return tcx.normalize_erasing_regions(typing_env, EarlyBinder.instantiate_identity(v), d_T);
    }
  },

  // #[inline(always)]
  // Keep me in sync with instantiate_mir_and_normalize_erasing_regions
  // rustc: compiler/rustc_middle/src/ty/instance.rs:974 try_instantiate_mir_and_normalize_erasing_regions
  try_instantiate_mir_and_normalize_erasing_regions<T>(
    self: Instance,
    tcx: TyCtxt,
    typing_env: TypingEnv,
    v: EarlyBinder<T>,
    d_T: TypeFoldable<T>,
  ): Result<T, NormalizationError> {
    const args = Instance.args_for_mir_body(self);
    if (args !== undefined) {
      return tcx.try_instantiate_and_normalize_erasing_regions(args, typing_env, v, d_T);
    } else {
      // We're using `instantiate_identity` as e.g.
      // `FnPtrShim` is separately generated for every
      // instantiation of the `FnDef`, so the MIR body
      // is already instantiated. Any generic parameters it
      // contains are generic parameters from the caller.
      return tcx.try_normalize_erasing_regions(typing_env, EarlyBinder.instantiate_identity(v), d_T);
    }
  },
};

export const InstanceKind = {
  // #[inline]
  // rustc: compiler/rustc_middle/src/ty/instance.rs:266 def_id
  def_id(self: InstanceKind): DefId {
    switch (self.$) {
      case "Item":
      case "Virtual":
      case "Intrinsic":
      case "LlvmIntrinsic":
        return self._0;
      case "Shim":
        return ShimKind.def_id(self._0);
    }
  },

  /// Returns the `DefId` of instances which might not require codegen locally.
  // rustc: compiler/rustc_middle/src/ty/instance.rs:277 def_id_if_not_guaranteed_local_codegen
  def_id_if_not_guaranteed_local_codegen(self: InstanceKind): DefId | undefined {
    switch (self.$) {
      case "Item":
        return self._0;
      case "Virtual":
      case "Intrinsic":
      case "LlvmIntrinsic":
        return undefined;
      case "Shim":
        return ShimKind.def_id_if_not_guaranteed_local_codegen(self._0);
    }
  },

  /// Returns `true` if the LLVM version of this instance is unconditionally
  /// marked with `inline`. This implies that a copy of this instance is
  /// generated in every codegen unit.
  /// Note that this is only a hint. See the documentation for
  /// `generates_cgu_internal_copy` for more information.
  // rustc: compiler/rustc_middle/src/ty/instance.rs:292 requires_inline
  requires_inline(self: InstanceKind, tcx: TyCtxt): boolean {
    switch (self.$) {
      case "Item": {
        const data = tcx.def_key(self._0).disambiguated_data.data;
        return data.$ === "Ctor" || data.$ === "Closure";
      }
      case "Shim":
        return ShimKind.requires_inline(self._0);
      case "Virtual":
      case "Intrinsic":
      case "LlvmIntrinsic":
        return true;
    }
  },

  // rustc: compiler/rustc_middle/src/ty/instance.rs:306 requires_caller_location
  requires_caller_location(self: InstanceKind, tcx: TyCtxt): boolean {
    let def_id: DefId | undefined;
    if (self.$ === "Item" || self.$ === "Virtual") {
      def_id = self._0;
    } else if (self.$ === "Shim" && self._0.$ === "VTable") {
      def_id = self._0._0;
    }
    if (def_id !== undefined) {
      // PORT: context.ts types `body_codegen_attrs` with a local view of `CodegenFnAttrs` (only `target_features`).
      return CodegenFnAttrFlags.contains((tcx.body_codegen_attrs(def_id) as unknown as CodegenFnAttrs).flags, CodegenFnAttrFlags.TRACK_CALLER);
    } else if (self.$ === "Shim" && self._0.$ === "ClosureOnce") {
      return self._0.track_caller;
    } else {
      return false;
    }
  },

  /// Returns `true` when the MIR body associated with this instance should be monomorphized
  /// by its users (e.g. codegen or miri) by instantiating the `args` from `Instance` (see
  /// `Instance::args_for_mir_body`).
  ///
  /// Otherwise, returns `false` only for some kinds of shims where the construction of the MIR
  /// body should perform necessary instantiations.
  // rustc: compiler/rustc_middle/src/ty/instance.rs:328 has_polymorphic_mir_body
  has_polymorphic_mir_body(self: InstanceKind): boolean {
    switch (self.$) {
      case "Item":
      case "Intrinsic":
      case "LlvmIntrinsic":
      case "Virtual":
        return true;
      case "Shim":
        return ShimKind.has_polymorphic_mir_body(self._0);
    }
  },
};

export const ShimKind = {
  // #[inline]
  // rustc: compiler/rustc_middle/src/ty/instance.rs:341 def_id
  def_id(self: ShimKind): DefId {
    switch (self.$) {
      case "VTable":
      case "Reify":
      case "FnPtr":
      case "ThreadLocal":
        return self._0;
      case "ClosureOnce":
        return self.call_once;
      case "ConstructCoroutineInClosure":
        return self.coroutine_closure_def_id;
      case "DropGlue":
      case "Clone":
      case "FnPtrAsPtr":
      case "FnPtrFromPtr":
      case "FutureDropPoll":
      case "AsyncDropGlue":
      case "AsyncDropGlueCtor":
        return self._0;
    }
  },

  /// Returns the `DefId` of instances which might not require codegen locally.
  // rustc: compiler/rustc_middle/src/ty/instance.rs:363 def_id_if_not_guaranteed_local_codegen
  def_id_if_not_guaranteed_local_codegen(self: ShimKind): DefId | undefined {
    if (
      (self.$ === "DropGlue" && self._1 !== undefined) ||
      self.$ === "AsyncDropGlueCtor" ||
      self.$ === "AsyncDropGlue" ||
      self.$ === "FutureDropPoll" ||
      self.$ === "ThreadLocal"
    ) {
      return self._0;
    }
    // ShimKind::VTable(..) | Reify(..) | FnPtr(..) | ClosureOnce { .. } | ConstructCoroutineInClosure { .. }
    // | DropGlue(..) | Clone(..) | FnPtrAsPtr(..) | FnPtrFromPtr(..)
    return undefined;
  },

  // rustc: compiler/rustc_middle/src/ty/instance.rs:382 requires_inline
  requires_inline(self: ShimKind): boolean {
    if (self.$ === "DropGlue" && self._1 !== undefined) {
      return self._1.is_array();
    } else if (self.$ === "AsyncDropGlueCtor") {
      return self._1.is_coroutine();
    } else if (self.$ === "FutureDropPoll") {
      return false;
    } else if (self.$ === "AsyncDropGlue") {
      return false;
    } else if (self.$ === "ThreadLocal") {
      return false;
    } else {
      return true;
    }
  },

  // rustc: compiler/rustc_middle/src/ty/instance.rs:393 has_polymorphic_mir_body
  has_polymorphic_mir_body(self: ShimKind): boolean {
    if (
      self.$ === "Clone" ||
      self.$ === "ThreadLocal" ||
      self.$ === "FnPtr" ||
      self.$ === "FnPtrAsPtr" ||
      self.$ === "FnPtrFromPtr" ||
      (self.$ === "DropGlue" && self._1 !== undefined) ||
      self.$ === "FutureDropPoll" ||
      self.$ === "AsyncDropGlue"
    ) {
      return false;
    } else if (self.$ === "AsyncDropGlueCtor") {
      return false;
    } else {
      // ClosureOnce { .. } | ConstructCoroutineInClosure { .. } | DropGlue(..) | Reify(..) | VTable(..)
      return true;
    }
  },
};

// PORT: the fn-local `struct Visitor<'tcx>` of `type_length`, with its `TypeVisitor` impl (`type Result = ()`).
class TypeLengthVisitor implements TypeVisitor<undefined> {
  readonly Result = VisitorResult.unit;
  type_length = 0;
  cache: Map<Ty, number> = new Map();

  // rustc: compiler/rustc_middle/src/ty/instance.rs:419 visit_ty
  visit_ty(t: Ty): undefined {
    const value = this.cache.get(t);
    if (value !== undefined) {
      this.type_length += value;
      return;
    }

    const prev = this.type_length;
    this.type_length += 1;
    fold_Ty.super_visit_with(t, this);

    // We don't try to use the cache if the type is fairly small.
    if (this.type_length > 16) {
      this.cache.set(t, this.type_length - prev);
    }
  }

  // rustc: compiler/rustc_middle/src/ty/instance.rs:435 visit_const
  visit_const(ct: Const): undefined {
    this.type_length += 1;
    fold_Const.super_visit_with(ct, this);
  }

  // (provided) the methods `Visitor` does not override.
  visit_binder<T>(t: Binder<T>, d: TypeVisitable<T>): undefined {
    return TypeVisitor_provided.visit_binder(this, t, d);
  }
  visit_region(r: Region): undefined {
    return TypeVisitor_provided.visit_region(this, r);
  }
  visit_predicate<P>(p: P, d: PredicateProxy<P>): undefined {
    return TypeVisitor_provided.visit_predicate(this, p, d);
  }
  visit_clauses(c: import("./decls.ts").Clauses): undefined {
    return TypeVisitor_provided.visit_clauses(this, c);
  }
  visit_error(guar: ErrorGuaranteed): undefined {
    return TypeVisitor_provided.visit_error(this, guar);
  }
}

// rustc: compiler/rustc_middle/src/ty/instance.rs:413 type_length
function type_length<T>(item: T, d_T: TypeVisitable<T>): number {
  const visitor = new TypeLengthVisitor();
  d_T.visit_with(item, visitor);

  return visitor.type_length;
}

// impl<'tcx> fmt::Display for Instance<'tcx>
// rustc: compiler/rustc_middle/src/ty/instance.rs:447 fmt
export function display_Instance(self: Instance): string {
  return with_((tcx) => {
    const p = ty_print_pretty().FmtPrinter.new(tcx, Namespace.ValueNS);
    const r = ty_print_mod().print_Instance(/* tcx.lift */ self, p);
    // PORT: `?` turns a `PrintError` into `fmt::Error`, which `format!` reports as this panic.
    if (r.$ === "Err") panic("a Display implementation returned an error unexpectedly: Error");
    const s = p.into_buffer();
    return s;
  });
}

// async_drop_in_place<T>::coroutine.poll, when T is a standard coroutine,
// should be resolved to this coroutine's future_drop_poll (through FutureDropPollShim proxy).
// async_drop_in_place<async_drop_in_place<T>::coroutine>::coroutine.poll,
// when T is a standard coroutine, should be resolved to this coroutine's future_drop_poll.
// async_drop_in_place<async_drop_in_place<T>::coroutine>::coroutine.poll,
// when T is not a coroutine, should be resolved to the innermost
// async_drop_in_place<T>::coroutine's poll function (through FutureDropPollShim proxy)
// rustc: compiler/rustc_middle/src/ty/instance.rs:464 resolve_async_drop_poll
function resolve_async_drop_poll(cor_ty_: Ty): Instance {
  let cor_ty = cor_ty_;
  const first_cor = cor_ty;
  const fk = first_cor.kind();
  if (fk.$ !== "Coroutine") {
    return bug();
  }
  const poll_def_id = fk._0;
  const proxy_args = fk._1;
  let child_ty = cor_ty;
  for (;;) {
    const ck = child_ty.kind();
    if (ck.$ === "Coroutine") {
      const child_def = ck._0;
      const child_args = ck._1;
      cor_ty = child_ty;
      if (DefId_eq(child_def, poll_def_id)) {
        const first = child_args[0];
        if (first === undefined) return panic("called `Option::unwrap()` on a `None` value");
        child_ty = GenericArg.expect_ty(first);
        continue;
      } else {
        return {
          def: { $: "Shim", _0: { $: "FutureDropPoll", _0: poll_def_id, _1: first_cor, _2: cor_ty } },
          args: proxy_args,
        };
      }
    } else {
      const k = cor_ty.kind();
      if (k.$ !== "Coroutine") {
        return bug();
      }
      const child_args = k._1;
      if (first_cor !== cor_ty) {
        return {
          def: { $: "Shim", _0: { $: "FutureDropPoll", _0: poll_def_id, _1: first_cor, _2: cor_ty } },
          args: proxy_args,
        };
      } else {
        return {
          def: { $: "Shim", _0: { $: "AsyncDropGlue", _0: poll_def_id, _1: cor_ty } },
          args: child_args,
        };
      }
    }
  }
}

// rustc: compiler/rustc_middle/src/ty/instance.rs:996 needs_fn_once_adapter_shim
function needs_fn_once_adapter_shim(actual_closure_kind: ClosureKind, trait_closure_kind: ClosureKind): Result<boolean, null> {
  const a = actual_closure_kind;
  const t = trait_closure_kind;
  if ((a === "Fn" && t === "Fn") || (a === "FnMut" && t === "FnMut") || (a === "FnOnce" && t === "FnOnce")) {
    // No adapter needed.
    return Ok(false);
  } else if (a === "Fn" && t === "FnMut") {
    // The closure fn is a `fn(&self, ...)`, but we want a `fn(&mut self, ...)`.
    // At codegen time, these are basically the same, so we can just return the closure.
    return Ok(false);
  } else if ((a === "Fn" || a === "FnMut") && t === "FnOnce") {
    // The closure fn is a `fn(&self, ...)` or `fn(&mut self, ...)`, but
    // we want a `fn(self, ...)`. We can produce this by doing something like:
    //
    //     fn call_once(self, ...) { Fn::call(&self, ...) }
    //     fn call_once(mut self, ...) { FnMut::call_mut(&mut self, ...) }
    //
    // These are both the same at codegen time.
    return Ok(true);
  } else {
    // (ty::ClosureKind::FnMut | ty::ClosureKind::FnOnce, _)
    return { $: "Err", _0: null };
  }
}

// ---- helpers ---------------------------------------------------------------------------------------------------------

/** `assert_matches!(coroutine_kind, <pattern>)` (no message). */
function assert_coroutine_kind(k: CoroutineKind, matches: boolean, pattern: string): void {
  if (!matches) {
    panic(`assertion \`left matches right\` failed\n  left: ${debug_CoroutineKind(k, PLAIN)}\n right: ${pattern}`);
  }
}

/** `{:#?}` of `Result<Option<Instance>, ErrorGuaranteed>` (the `expect_resolve` span_bug message). */
function debug_resolve_result(v: Result<Instance | undefined, ErrorGuaranteed>, f: Fmt): string {
  return debug_result(v, f, (o, f) => debug_option(o, f, gen.debug_Instance), debug_ErrorGuaranteed);
}

/** `DefId`'s trivial traversal (`TrivialTypeTraversalAndLiftImpls!`, structural_impls.rs:239). */
const fold_DefId: TypeFoldable<DefId> = {
  try_fold_with: (self) => Ok(self),
  fold_with: (self) => self,
  visit_with: (_self, visitor) => visitor.Result.output(),
};
/** `TypeFoldable` of `PseudoCanonicalInput<(DefId, GenericArgsRef)>` (the derive of ty/mod.rs:1246 over the tuple);
 *  built on first use (init order: ./mod.ts). */
let d_query_input_: TypeFoldable<PseudoCanonicalInput<[DefId, GenericArgs]>> | undefined;
function d_query_input(): TypeFoldable<PseudoCanonicalInput<[DefId, GenericArgs]>> {
  return (d_query_input_ ??= fold_PseudoCanonicalInput(fold_tuple2(fold_DefId, fold_GenericArgs)));
}

/** PORT (init order, module comment): lazily reached modules. */
function session_config(): typeof import("../../rustc_session/config.ts") {
  return require("../../rustc_session/config.ts") as typeof import("../../rustc_session/config.ts");
}
function ty_assoc(): typeof import("./assoc.ts") {
  return require("./assoc.ts") as typeof import("./assoc.ts");
}
function ty_print_pretty(): typeof import("./print/pretty.ts") {
  return require("./print/pretty.ts") as typeof import("./print/pretty.ts");
}
function ty_print_mod(): typeof import("./print/mod.ts") {
  return require("./print/mod.ts") as typeof import("./print/mod.ts");
}
