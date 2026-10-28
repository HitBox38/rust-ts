// Port of compiler/rustc_ty_utils/src/abi.rs (lane fn-abi): the `fn_abi_of_fn_ptr` / `fn_abi_of_instance_*`
// providers.
//
// PORT notes:
// - `#[tracing::instrument]` / `debug!` / `debug_span!` are dropped (comments): the default logger filters them.
// - `cfg(debug_assertions)` blocks are false (rustc ships without debug assertions): comments.
// - `tcx.arena.alloc(..)` is the value itself (arenas are erased, PORTING §5).
// - `FnAbiDesc` is data-only: an interface; its constructors are free functions with the upstream names
//   (`FnAbiDesc_for_fn_ptr` / `FnAbiDesc_for_instance`).
// - The `deduced_param_attrs` query value is `readonly unknown[]` in queries.gen.ts (`&[DeducedParamAttrs]`, the
//   provider is lane mt-opt2's): cast to `readonly DeducedParamAttrs[]`.
import { ExternAbi, debug_ExternAbi, display_ExternAbi } from "../rustc_abi/extern_abi.ts";
import { Align, Align_min, Scalar, type Size } from "../rustc_abi/lib.ts";
import { TyAndLayout as abi_TyAndLayout } from "../rustc_abi/layout/ty.ts";
import { find_attr } from "../rustc_attr_ir/lib.ts";
import { LangItem } from "../rustc_attr_ir/lang_items.ts";
import type { CoroutineKind } from "../rustc_hir/lib.ts";
import { DeducedParamAttrs } from "../rustc_middle/middle/deduced_param_attrs.ts";
import type { Providers } from "../rustc_middle/queries.gen.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { AdtDef } from "../rustc_middle/ty/decls.ts";
import { fold_GenericArgs } from "../rustc_middle/ty/generic_args.ts";
import { Instance, InstanceKind } from "../rustc_middle/ty/instance.ts";
import { type FnAbiError, LayoutCx, type TyAndLayout, debug_TyAndLayout_Ty, fn_can_unwind } from "../rustc_middle/ty/layout.ts";
import { type List } from "../rustc_middle/ty/list.ts";
import { HasAttrs_DefId, type PseudoCanonicalInput, Ty, TypingEnv } from "../rustc_middle/ty/mod.ts";
import { display_Ty } from "../rustc_middle/ty/print/pretty.ts";
import { debug_Ty } from "../rustc_middle/ty/structural_impls.ts";
import type { DefId } from "../rustc_span/def_id.ts";
import { DUMMY_SP } from "../rustc_span/lib.ts";
import { bug } from "../rustc_span/macros.ts";
import { callconv, spec } from "../rustc_target/lib.ts";
import type { ArgAbi, ArgAttributes, FnAbi } from "../rustc_target/callconv/mod.ts";
import { Binder, EarlyBinder, fold_Binder } from "../rustc_type_ir/binder.ts";
import { ClosureArgs, CoroutineArgs, CoroutineClosureArgs, CoroutineClosureSignature, type CoroutineClosureSignature as CoroutineClosureSignatureT } from "../rustc_type_ir/ty_kind/closure.ts";
import { fold_with_CoroutineClosureSignature, try_fold_with_CoroutineClosureSignature, visit_with_CoroutineClosureSignature } from "../rustc_type_ir/ty_kind/closure.gen.ts";
import type { TypeFoldable } from "../rustc_type_ir/fold.ts";
import { type FnSig, FnSig as FnSigC, fold_FnSig } from "../rustc_type_ir/ty_kind.ts";
import { Unnormalized } from "../rustc_type_ir/unnormalized.ts";
import { PLAIN, PRETTY, format_debug } from "../std/fmt.ts";
import { assert, assert_eq, panic, unwrap } from "../std/panic.ts";
import { Err, Ok, type Result } from "../std/result.ts";

type PolyFnSig = Binder<FnSig>;
const fold_PolyFnSig = fold_Binder(fold_FnSig);

// rustc: compiler/rustc_ty_utils/src/abi.rs:21 provide
export function provide(providers: Providers): void {
  // *providers = Providers { fn_abi_of_fn_ptr, fn_abi_of_instance_no_deduced_attrs, fn_abi_of_instance_raw, ..*providers };
  providers.fn_abi_of_fn_ptr = fn_abi_of_fn_ptr;
  providers.fn_abi_of_instance_no_deduced_attrs = fn_abi_of_instance_no_deduced_attrs;
  providers.fn_abi_of_instance_raw = fn_abi_of_instance_raw;
}

// NOTE(eddyb) this is private to avoid using it from outside of
// `fn_abi_of_instance` - any other uses are either too high-level
// for `Instance` (e.g. typeck would use `Ty::fn_sig` instead),
// or should go through `FnAbi` instead, to avoid losing any
// adjustments `fn_abi_of_instance` might be performing.
// #[tracing::instrument(level = "debug", skip(tcx, typing_env))]
// rustc: compiler/rustc_ty_utils/src/abi.rs:36 fn_sig_for_fn_abi
function fn_sig_for_fn_abi(tcx: TyCtxt, instance: Instance, typing_env: TypingEnv): FnSig {
  if (instance.def.$ === "Shim" && instance.def._0.$ === "ThreadLocal") {
    return tcx.mk_fn_sig_safe_rust_abi([], tcx.thread_local_ptr_ty(Instance.def_id(instance)));
  }

  const ty = Instance.ty(instance, tcx, typing_env);
  const kind = ty.kind();
  switch (kind.$) {
    case "FnDef": {
      const [def_id, args] = [kind._0, kind._1];
      // PORT: the `fn_sig` query value is `unknown` in queries.gen.ts (`EarlyBinder<PolyFnSig>`).
      const sig = tcx.instantiate_bound_regions_with_erased(
        Unnormalized.skip_norm_wip(
          EarlyBinder.instantiate(tcx.fn_sig(def_id) as EarlyBinder<PolyFnSig>, tcx, unwrap(Binder.no_bound_vars(args, fold_GenericArgs)), fold_PolyFnSig),
        ),
        fold_FnSig,
      );

      // Modify `fn(self, ...)` to `fn(self: *mut Self, ...)`.
      if (instance.def.$ === "Shim" && instance.def._0.$ === "VTable") {
        const inputs_and_output = [...sig.inputs_and_output];
        inputs_and_output[0] = Ty.new_mut_ptr(tcx, inputs_and_output[0]!);
        return { ...sig, inputs_and_output: tcx.mk_type_list(inputs_and_output) };
      }

      return sig;
    }
    case "Closure": {
      const [def_id, args] = [kind._0, kind._1];
      const sig = tcx.instantiate_bound_regions_with_erased(ClosureArgs.sig(args.as_closure()), fold_FnSig);
      const env_ty = tcx.closure_env_ty(Ty.new_closure(tcx, def_id, args), ClosureArgs.kind(args.as_closure()), tcx.lifetimes.re_erased);

      return tcx.mk_fn_sig([env_ty, ...FnSigC.inputs(sig)], FnSigC.output(sig), sig.fn_sig_kind);
    }
    case "CoroutineClosure": {
      const [def_id, args] = [kind._0, kind._1];
      const coroutine_ty = Ty.new_coroutine_closure(tcx, def_id, args);
      const sig_ = CoroutineClosureArgs.coroutine_closure_sig(args.as_coroutine_closure());

      // When this `CoroutineClosure` comes from a `ConstructCoroutineInClosureShim`,
      // make sure we respect the `target_kind` in that shim.
      // FIXME(async_closures): This shouldn't be needed, and we should be populating
      // a separate def-id for these bodies.
      let coroutine_kind = CoroutineClosureArgs.kind(args.as_coroutine_closure());

      let env_ty: Ty;
      if (instance.def.$ === "Shim" && instance.def._0.$ === "ConstructCoroutineInClosure") {
        const receiver_by_ref = instance.def._0.receiver_by_ref;
        coroutine_kind = "FnOnce";

        // Implementations of `FnMut` and `Fn` for coroutine-closures
        // still take their receiver by ref.
        if (receiver_by_ref) {
          env_ty = Ty.new_imm_ref(tcx, tcx.lifetimes.re_erased, coroutine_ty);
        } else {
          env_ty = coroutine_ty;
        }
      } else {
        env_ty = tcx.closure_env_ty(coroutine_ty, coroutine_kind, tcx.lifetimes.re_erased);
      }

      const sig = tcx.instantiate_bound_regions_with_erased(sig_, fold_CoroutineClosureSignature);

      return tcx.mk_fn_sig(
        [env_ty, sig.tupled_inputs_ty],
        CoroutineClosureSignature.to_coroutine_given_kind_and_upvars(
          sig,
          tcx,
          CoroutineClosureArgs.parent_args(args.as_coroutine_closure()),
          tcx.coroutine_for_closure(def_id),
          coroutine_kind,
          tcx.lifetimes.re_erased,
          CoroutineClosureArgs.tupled_upvars_ty(args.as_coroutine_closure()),
          CoroutineClosureArgs.coroutine_captures_by_ref_ty(args.as_coroutine_closure()),
        ),
        sig.fn_sig_kind,
      );
    }
    case "Coroutine": {
      const [did, args] = [kind._0, kind._1];
      // PORT: the `coroutine_kind` query value is `unknown` in queries.gen.ts (`Option<hir::CoroutineKind>`).
      const coroutine_kind = unwrap(tcx.coroutine_kind(did) as CoroutineKind | undefined);
      const sig = CoroutineArgs.sig(args.as_coroutine());

      const env_ty_ = Ty.new_mut_ref(tcx, tcx.lifetimes.re_erased, ty);

      const pin_did = tcx.require_lang_item(LangItem.Pin, DUMMY_SP);
      const pin_adt_ref = tcx.adt_def(pin_did) as AdtDef;
      const pin_args = tcx.mk_args([env_ty_]);
      let env_ty: Ty;
      if (coroutine_kind.$ === "Desugared" && coroutine_kind._0 === "Gen") {
        // Iterator::next doesn't accept a pinned argument,
        // unlike for all other coroutine kinds.
        env_ty = env_ty_;
      } else {
        // Desugared(Async | AsyncGen, _) | Coroutine(_)
        env_ty = Ty.new_adt(tcx, pin_adt_ref, pin_args);
      }

      // The `FnSig` and the `ret_ty` here is for a coroutines main
      // `Coroutine::resume(...) -> CoroutineState` function in case we
      // have an ordinary coroutine, the `Future::poll(...) -> Poll`
      // function in case this is a special coroutine backing an async construct
      // or the `Iterator::next(...) -> Option` function in case this is a
      // special coroutine backing a gen construct.
      let resume_ty: Ty | undefined;
      let ret_ty: Ty;
      if (coroutine_kind.$ === "Desugared" && coroutine_kind._0 === "Async") {
        // The signature should be `Future::poll(_, &mut Context<'_>) -> Poll<Output>`
        assert_eq(sig.yield_ty, tcx.types.unit, dbg_Ty);

        const poll_did = tcx.require_lang_item(LangItem.Poll, DUMMY_SP);
        const poll_adt_ref = tcx.adt_def(poll_did) as AdtDef;
        const poll_args = tcx.mk_args([sig.return_ty]);
        const ret_ty_ = Ty.new_adt(tcx, poll_adt_ref, poll_args);

        // We have to replace the `ResumeTy` that is used for type and borrow checking
        // with `&mut Context<'_>` which is used in codegen.
        // #[cfg(debug_assertions)] { .. assert_eq!(*resume_ty_adt, expected_adt) .. }  (cfg(debug_assertions) is false)
        const context_mut_ref = Ty.new_task_context(tcx);

        [resume_ty, ret_ty] = [context_mut_ref, ret_ty_];
      } else if (coroutine_kind.$ === "Desugared" && coroutine_kind._0 === "Gen") {
        // The signature should be `Iterator::next(_) -> Option<Yield>`
        const option_did = tcx.require_lang_item(LangItem.Option, DUMMY_SP);
        const option_adt_ref = tcx.adt_def(option_did) as AdtDef;
        const option_args = tcx.mk_args([sig.yield_ty]);
        const ret_ty_ = Ty.new_adt(tcx, option_adt_ref, option_args);

        assert_eq(sig.return_ty, tcx.types.unit, dbg_Ty);
        assert_eq(sig.resume_ty, tcx.types.unit, dbg_Ty);

        [resume_ty, ret_ty] = [undefined, ret_ty_];
      } else if (coroutine_kind.$ === "Desugared" && coroutine_kind._0 === "AsyncGen") {
        // The signature should be
        // `AsyncIterator::poll_next(_, &mut Context<'_>) -> Poll<Option<Output>>`
        assert_eq(sig.return_ty, tcx.types.unit, dbg_Ty);

        // Yield type is already `Poll<Option<yield_ty>>`
        const ret_ty_ = sig.yield_ty;

        // We have to replace the `ResumeTy` that is used for type and borrow checking
        // with `&mut Context<'_>` which is used in codegen.
        // #[cfg(debug_assertions)] { .. }  (cfg(debug_assertions) is false)
        const context_mut_ref = Ty.new_task_context(tcx);

        [resume_ty, ret_ty] = [context_mut_ref, ret_ty_];
      } else {
        // hir::CoroutineKind::Coroutine(_)
        // The signature should be `Coroutine::resume(_, Resume) -> CoroutineState<Yield, Return>`
        const state_did = tcx.require_lang_item(LangItem.CoroutineState, DUMMY_SP);
        const state_adt_ref = tcx.adt_def(state_did) as AdtDef;
        const state_args = tcx.mk_args([sig.yield_ty, sig.return_ty]);
        const ret_ty_ = Ty.new_adt(tcx, state_adt_ref, state_args);

        [resume_ty, ret_ty] = [sig.resume_ty, ret_ty_];
      }

      if (resume_ty !== undefined) {
        return tcx.mk_fn_sig_safe_rust_abi([env_ty, resume_ty], ret_ty);
      } else {
        // `Iterator::next` doesn't have a `resume` argument.
        return tcx.mk_fn_sig_safe_rust_abi([env_ty], ret_ty);
      }
    }
    default:
      return bug(`unexpected type ${dbg_Ty(ty)} in Instance::fn_sig`);
  }
}

/** `{:?}` of a `Ty` (messages of `bug!` / `assert_eq!`). */
function dbg_Ty(ty: Ty): string {
  return format_debug(ty, debug_Ty, PLAIN);
}

/** The (generated) `TypeFoldable` impl of `CoroutineClosureSignature` as a descriptor. */
const fold_CoroutineClosureSignature: TypeFoldable<CoroutineClosureSignatureT> = {
  visit_with: visit_with_CoroutineClosureSignature,
  try_fold_with: try_fold_with_CoroutineClosureSignature,
  fold_with: fold_with_CoroutineClosureSignature,
};

/// Describes a function for determination of its ABI.
interface FnAbiDesc {
  readonly layout_cx: LayoutCx;
  readonly sig: FnSig;

  /// The function's definition, if its body can be used to deduce parameter attributes.
  readonly determined_fn_def_id: DefId | undefined;
  readonly caller_location: Ty | undefined;
  readonly is_virtual_call: boolean;
  readonly extra_args: readonly Ty[];
}

// rustc: compiler/rustc_ty_utils/src/abi.rs:242 for_fn_ptr
function FnAbiDesc_for_fn_ptr(tcx: TyCtxt, query: PseudoCanonicalInput<[PolyFnSig, List<Ty>]>): FnAbiDesc {
  const {
    typing_env,
    value: [sig, extra_args],
  } = query;
  return {
    layout_cx: LayoutCx.new(tcx, typing_env),
    sig: tcx.normalize_erasing_regions(typing_env, Unnormalized.new_wip(tcx.instantiate_bound_regions_with_erased(sig, fold_FnSig)), fold_FnSig),
    // Parameter attributes can never be deduced for indirect calls, as there is no
    // function body available to use.
    determined_fn_def_id: undefined,
    caller_location: undefined,
    is_virtual_call: false,
    extra_args,
  };
}

// rustc: compiler/rustc_ty_utils/src/abi.rs:262 for_instance
function FnAbiDesc_for_instance(tcx: TyCtxt, query: PseudoCanonicalInput<[Instance, List<Ty>]>): FnAbiDesc {
  const {
    typing_env,
    value: [instance, extra_args],
  } = query;
  const is_virtual_call = instance.def.$ === "Virtual";
  const is_tls_shim_call = instance.def.$ === "Shim" && instance.def._0.$ === "ThreadLocal";
  return {
    layout_cx: LayoutCx.new(tcx, typing_env),
    sig: tcx.normalize_erasing_regions(typing_env, Unnormalized.new_wip(fn_sig_for_fn_abi(tcx, instance, typing_env)), fold_FnSig),
    // Parameter attributes can be deduced from the bodies of neither:
    // - virtual calls, as they might call other functions from the vtable; nor
    // - TLS shims, as they would refer to the underlying static.
    determined_fn_def_id: !is_virtual_call && !is_tls_shim_call ? Instance.def_id(instance) : undefined,
    caller_location: InstanceKind.requires_caller_location(instance.def, tcx) ? tcx.caller_location_ty() : undefined,
    is_virtual_call,
    extra_args,
  };
}

// rustc: compiler/rustc_ty_utils/src/abi.rs:291 fn_abi_of_fn_ptr
function fn_abi_of_fn_ptr(tcx: TyCtxt, query: PseudoCanonicalInput<[PolyFnSig, List<Ty>]>): Result<FnAbi<Ty>, FnAbiError> {
  const desc = FnAbiDesc_for_fn_ptr(tcx, query);
  return fn_abi_new_uncached(desc);
}

// rustc: compiler/rustc_ty_utils/src/abi.rs:299 fn_abi_of_instance_no_deduced_attrs
function fn_abi_of_instance_no_deduced_attrs(tcx: TyCtxt, query: PseudoCanonicalInput<[Instance, List<Ty>]>): Result<FnAbi<Ty>, FnAbiError> {
  const desc = FnAbiDesc_for_instance(tcx, query);
  return fn_abi_new_uncached(desc);
}

// rustc: compiler/rustc_ty_utils/src/abi.rs:307 fn_abi_of_instance_raw
function fn_abi_of_instance_raw(tcx: TyCtxt, query: PseudoCanonicalInput<[Instance, List<Ty>]>): Result<FnAbi<Ty>, FnAbiError> {
  // The `fn_abi_of_instance_no_deduced_attrs` query may have been called during CTFE, so we
  // delegate to it here in order to reuse (and, if necessary, augment) its result.
  const r = tcx.fn_abi_of_instance_no_deduced_attrs(query);
  if (r.$ === "Err") return r;
  const fn_abi = r._0;
  const params = FnAbiDesc_for_instance(tcx, query);
  // If the function's body can be used to deduce parameter attributes, then adjust such
  // "no deduced attrs" ABI; otherwise, return that ABI unadjusted.
  const fn_def_id = params.determined_fn_def_id;
  return Ok(fn_def_id === undefined ? fn_abi : fn_abi_adjust_for_deduced_attrs(params.layout_cx, fn_abi, FnSigC.abi(params.sig), fn_def_id));
}

/// Returns argument attributes for a scalar argument.
// rustc: compiler/rustc_ty_utils/src/abi.rs:324 arg_attrs_for_rust_scalar
function arg_attrs_for_rust_scalar(
  cx: LayoutCx,
  scalar: Scalar,
  layout: TyAndLayout,
  offset: Size,
  is_return: boolean,
  determined_fn_def_id: DefId | undefined,
): ArgAttributes {
  const ArgAttribute = callconv.ArgAttribute;
  const attrs = callconv.ArgAttributes.new();

  if (!Scalar.is_uninit_valid(scalar)) {
    attrs.set(ArgAttribute.NoUndef);
  }

  // Only pointer types handled below.
  // let Scalar::Initialized { value: Pointer(_), valid_range } = scalar else { return attrs };
  if (scalar.$ !== "Initialized" || scalar.value.$ !== "Pointer") {
    return attrs;
  }
  const valid_range = scalar.valid_range;

  // Set `nonnull` if the validity range excludes zero.
  if (!valid_range.contains(0n)) {
    attrs.set(ArgAttribute.NonNull);
  }

  const tcx = cx.tcx_();

  const pointee = layout.pointee_info_at(cx, offset);
  if (pointee !== undefined) {
    if (pointee.align.pow2 > Align.ONE.pow2) {
      attrs.pointee_align = Align_min(pointee.align, cx.tcx_().sess.target.max_reliable_alignment());
    }

    attrs.pointee_size = pointee.size;

    if (pointee.safe !== undefined) {
      const kind = pointee.safe;
      // The aliasing rules for `Box<T>` are still not decided, but currently we emit
      // `noalias` for it. This can be turned off using an unstable flag.
      // See https://github.com/rust-lang/unsafe-code-guidelines/issues/326
      const noalias_for_box = tcx.sess.opts.unstable_opts.box_noalias;

      // `&T` where `T` contains no `UnsafeCell<U>` is immutable, and can be marked as both
      // `readonly` and `noalias`, as LLVM's definition of `noalias` is based solely on memory
      // dependencies rather than pointer equality. However this only applies to arguments,
      // not return values.
      //
      // `&mut T` and `Box<T>` where `T: Unpin` are unique and hence `noalias`.
      let no_alias: boolean;
      switch (kind.$) {
        case "SharedRef":
          no_alias = kind.frozen;
          break;
        case "MutableRef":
          no_alias = kind.unpin;
          break;
        case "Box":
          no_alias = kind.unpin && kind.global && noalias_for_box;
          break;
      }
      // We can never add `noalias` in return position; that LLVM attribute has some very surprising semantics
      // (see <https://github.com/rust-lang/unsafe-code-guidelines/issues/385#issuecomment-1368055745>).
      if (no_alias && !is_return) {
        attrs.set(ArgAttribute.NoAlias);
      }

      // Set writable if no_alias is set, it's a mutable reference and the feature is enabled.
      if (tcx.sess.opts.unstable_opts.llvm_writable && kind.$ === "MutableRef" && kind.unpin === true && !is_return) {
        let rustc_no_writable: boolean;
        if (determined_fn_def_id !== undefined) {
          const def_id = determined_fn_def_id;
          rustc_no_writable = find_attr(HasAttrs_DefId.get_attrs(def_id, tcx), (k) => (k.$ === "RustcNoWritable" ? true : undefined)) !== undefined;
        } else {
          rustc_no_writable = true; // If no def_id exists, we make the conservative choice and disable the feature.
        }

        if (!rustc_no_writable) {
          attrs.set(ArgAttribute.Writable);
        }
      }

      // NoFree is not valid on return values. If it were, it would mean something like
      // "will not be freed until the end of the program", which is generally not valid for
      // references.
      let no_free: boolean;
      if (is_return) {
        no_free = false;
      } else {
        switch (kind.$) {
          // Non-frozen shared references are not necessarily dereferenceable for the
          // entire duration of the function
          // (see <https://github.com/rust-lang/rust/pull/98017>).
          case "SharedRef":
            no_free = kind.frozen;
            break;
          // Mutable references to potentially self-referential types are not necessarily
          // dereferenceable for the entire duration of the function
          // (see <https://github.com/rust-lang/unsafe-code-guidelines/issues/381>).
          case "MutableRef":
            no_free = kind.unpin;
            break;
          // Box may be deallocated during execution of the function.
          case "Box":
            no_free = false;
            break;
        }
      }
      if (no_free) {
        attrs.set(ArgAttribute.NoFree);
      }

      if (kind.$ === "SharedRef" && kind.frozen === true && !is_return) {
        attrs.set(ArgAttribute.ReadOnly);
        attrs.set(ArgAttribute.CapturesReadOnly);
      }
    }
  }

  return attrs;
}

/// Ensure that the ABI makes basic sense.
// rustc: compiler/rustc_ty_utils/src/abi.rs:425 fn_abi_sanity_check
function fn_abi_sanity_check(cx: LayoutCx, fn_abi: FnAbi<Ty>, spec_abi: ExternAbi): void {
  // rustc: compiler/rustc_ty_utils/src/abi.rs:430 fn_arg_attrs_sanity_check
  function fn_arg_attrs_sanity_check(attrs: ArgAttributes, is_ret: boolean): void {
    if (callconv.ArgAttribute.contains(attrs.regular, callconv.ArgAttribute.NoFree)) {
      assert(!is_ret, "NoFree not valid on return values");
    }
  }

  // rustc: compiler/rustc_ty_utils/src/abi.rs:436 fn_arg_sanity_check
  function fn_arg_sanity_check(cx: LayoutCx, spec_abi: ExternAbi, arg: ArgAbi<Ty>, is_ret: boolean): void {
    const tcx = cx.tcx_();

    if (ExternAbi.is_rustic_abi(spec_abi)) {
      if (arg.layout.is_zst()) {
        // Casting closures to function pointers depends on ZST closure types being
        // omitted entirely in the calling convention.
        assert(arg.is_ignore(), "assertion failed: arg.is_ignore()");
      }
      const m = arg.mode;
      if (m.$ === "Indirect" && !ExternAbi.eq(spec_abi, ExternAbi.RustTail)) {
        const mode = m.mode;
        assert(mode === "Pointer", "rust abi must use plain pointer mode");
      }
    } else if (arg.layout.pass_indirectly_in_non_rustic_abis(cx)) {
      if (!(arg.mode.$ === "Indirect" && arg.mode.mode === "Pointer")) {
        panic(
          `assertion \`left matches right\` failed: the ${display_ExternAbi(spec_abi)} ABI does not implement \`#[rustc_pass_indirectly_in_non_rustic_abis]\`\n` +
            `  left: ${format_debug(arg.mode, callconv.debug_PassMode, PLAIN)}\n right: PassMode::Indirect { mode: IndirectMode::Pointer, .. }`,
        );
      }
    }

    const mode = arg.mode;
    switch (mode.$) {
      case "Ignore":
        assert(arg.layout.is_zst(), "assertion failed: arg.layout.is_zst()");
        break;
      case "Direct": {
        const attrs = mode._0;
        // Here the Rust type is used to determine the actual ABI, so we have to be very
        // careful. Scalar/Vector is fine, since backends will generally use
        // `layout.backend_repr` and ignore everything else.
        switch (arg.layout.backend_repr.$) {
          case "Scalar":
          case "SimdVector":
          case "SimdScalableVector":
            break;
          case "ScalarPair":
            panic(`\`PassMode::Direct\` used for ScalarPair type ${display_Ty(arg.layout.ty)}`);
            break;
          case "Memory":
            panic(`\`PassMode::Direct\` for aggregates not allowed\nProblematic type: ${format_debug(arg.layout, debug_TyAndLayout_Ty, PRETTY)}`);
            break;
        }
        fn_arg_attrs_sanity_check(attrs, is_ret);
        break;
      }
      case "Pair": {
        const [attrs1, attrs2] = [mode._0, mode._1];
        // Similar to `Direct`, we need to make sure that backends use `layout.backend_repr`
        // and ignore the rest of the layout.
        assert(arg.layout.backend_repr.$ === "ScalarPair", () => `PassMode::Pair for type ${display_Ty(arg.layout.ty)}`);
        fn_arg_attrs_sanity_check(attrs1, is_ret);
        fn_arg_attrs_sanity_check(attrs2, is_ret);
        break;
      }
      case "Cast":
        // `Cast` means "transmute to `CastType`"; that only makes sense for sized types.
        assert(arg.layout.is_sized(), "assertion failed: arg.layout.is_sized()");
        break;
      case "Indirect": {
        const attrs = mode.attrs;
        // No metadata, must be sized.
        // Conceptually, unsized arguments must be copied around, which requires dynamically
        // determining their size, which we cannot do without metadata. Consult
        // t-opsem before removing this check.
        assert(arg.layout.is_sized(), "assertion failed: arg.layout.is_sized()");
        // Indirect returns are arguments from an ABI perspective.
        fn_arg_attrs_sanity_check(attrs, false);
        break;
      }
      case "IndirectUnsized": {
        const [attrs, meta_attrs] = [mode.attrs, mode.meta_attrs];
        // With metadata. Must be unsized.
        assert(arg.layout.is_unsized(), "assertion failed: arg.layout.is_unsized()");
        // And must not be a return value
        assert(!is_ret, "assertion failed: !is_ret");
        // Also, must not be `extern` type.
        const tail = tcx.struct_tail_for_codegen(arg.layout.ty, cx.typing_env);
        if (tail.kind().$ === "Foreign") {
          // These types do not have metadata, so having `meta_attrs` is bogus.
          // Conceptually, unsized arguments must be copied around, which requires dynamically
          // determining their size. Therefore, we cannot allow `extern` types here. Consult
          // t-opsem before removing this check.
          panic("unsized arguments must not be `extern` types");
        }
        // Indirect returns are arguments from an ABI perspective.
        fn_arg_attrs_sanity_check(attrs, false);
        fn_arg_attrs_sanity_check(meta_attrs, false);
        break;
      }
    }
  }

  for (const arg of fn_abi.args) {
    fn_arg_sanity_check(cx, spec_abi, arg, false);
  }
  fn_arg_sanity_check(cx, spec_abi, fn_abi.ret, true);
}

// #[tracing::instrument(level = "debug", skip(cx, caller_location, determined_fn_def_id, is_virtual_call))]
// rustc: compiler/rustc_ty_utils/src/abi.rs:543 fn_abi_new_uncached
function fn_abi_new_uncached(desc: FnAbiDesc): Result<FnAbi<Ty>, FnAbiError> {
  const { layout_cx: cx, sig, determined_fn_def_id, caller_location, is_virtual_call, extra_args: extra_args_ } = desc;
  const tcx = cx.tcx_();

  const abi_map = spec.AbiMap.from_target(tcx.sess.target);
  const conv = spec.AbiMapping.unwrap(abi_map.canonize_abi(FnSigC.abi(sig), FnSigC.c_variadic(sig)));

  let inputs: readonly Ty[] = FnSigC.inputs(sig);
  let extra_args: readonly Ty[];
  if (ExternAbi.eq(FnSigC.abi(sig), ExternAbi.RustCall)) {
    assert(!FnSigC.c_variadic(sig) && extra_args_.length === 0, "assertion failed: !sig.c_variadic() && extra_args.is_empty()");

    const input = FnSigC.inputs(sig)[FnSigC.inputs(sig).length - 1];
    const input_kind = input?.kind();
    if (input_kind !== undefined && input_kind.$ === "Tuple") {
      const tupled_arguments = input_kind._0;
      inputs = FnSigC.inputs(sig).slice(0, FnSigC.inputs(sig).length - 1);
      extra_args = tupled_arguments;
    } else {
      return bug('argument to function with "rust-call" ABI is not a tuple');
    }
  } else {
    assert(FnSigC.c_variadic(sig) || extra_args_.length === 0, "assertion failed: sig.c_variadic() || extra_args.is_empty()");
    extra_args = extra_args_;
  }

  const arg_of = (ty: Ty, arg_idx: number | undefined): Result<ArgAbi<Ty>, FnAbiError> => {
    // let span = tracing::debug_span!("arg_of"); let _entered = span.enter();
    const is_return = arg_idx === undefined;

    const layout_r = cx.layout_of(ty);
    if (layout_r.$ === "Err") return Err({ $: "Layout", _0: layout_r._0 });
    let layout = layout_r._0;
    if (is_virtual_call && arg_idx === 0) {
      // Don't pass the vtable, it's not an argument of the virtual fn.
      // Instead, pass just the data pointer, but give it the type `*const/mut dyn Trait`
      // or `&/&mut dyn Trait` because this is special-cased elsewhere in codegen
      layout = make_thin_self_ptr(cx, layout);
    }
    const layout_ = layout;

    return Ok(
      callconv.ArgAbi.new(layout_, (scalar, offset) => arg_attrs_for_rust_scalar(cx, scalar, layout_, offset, is_return, determined_fn_def_id)),
    );
  };

  const ret = arg_of(FnSigC.output(sig), undefined);
  if (ret.$ === "Err") return ret;
  const args: ArgAbi<Ty>[] = [];
  const arg_tys: Ty[] = [...inputs, ...extra_args, ...(caller_location !== undefined ? [caller_location] : [])];
  for (let i = 0; i < arg_tys.length; i++) {
    const a = arg_of(arg_tys[i]!, i);
    if (a.$ === "Err") return a;
    args.push(a._0);
  }
  const fn_abi = new callconv.FnAbi<Ty>(
    /* args */ args,
    /* ret */ ret._0,
    /* c_variadic */ FnSigC.c_variadic(sig),
    /* fixed_count */ inputs.length,
    /* conv */ conv,
    // FIXME return false for tls shim
    /* can_unwind */ fn_can_unwind(
      tcx,
      // Since `#[rustc_nounwind]` can change unwinding, we cannot infer unwinding by `fn_def_id` for a virtual call.
      determined_fn_def_id,
      FnSigC.abi(sig),
    ),
  );
  fn_abi_adjust_for_abi(cx, fn_abi, FnSigC.abi(sig));
  // debug!("fn_abi_new_uncached = {:?}", fn_abi);
  fn_abi_sanity_check(cx, fn_abi, FnSigC.abi(sig));
  return Ok(fn_abi);
}

// #[tracing::instrument(level = "trace", skip(cx))]
// rustc: compiler/rustc_ty_utils/src/abi.rs:626 fn_abi_adjust_for_abi
function fn_abi_adjust_for_abi(cx: LayoutCx, fn_abi: FnAbi<Ty>, abi: ExternAbi): void {
  if (ExternAbi.eq(abi, ExternAbi.LlvmIntrinsic)) {
    panic(
      `assertion \`left != right\` failed: fn_abi_of_instance should not be called on LLVM intrinsics\n  left: ${format_debug(abi, debug_ExternAbi, PLAIN)}\n right: ${format_debug(ExternAbi.LlvmIntrinsic, debug_ExternAbi, PLAIN)}`,
    );
  }

  if (ExternAbi.is_rustic_abi(abi)) {
    fn_abi.adjust_for_rust_abi(cx);
  } else {
    fn_abi.adjust_for_foreign_abi(cx, abi);
  }
}

// #[tracing::instrument(level = "trace", skip(cx))]
// rustc: compiler/rustc_ty_utils/src/abi.rs:645 fn_abi_adjust_for_deduced_attrs
function fn_abi_adjust_for_deduced_attrs(cx: LayoutCx, fn_abi: FnAbi<Ty>, abi: ExternAbi, fn_def_id: DefId): FnAbi<Ty> {
  const tcx = cx.tcx_();
  // Look up the deduced parameter attributes for this function, if we have its def ID.
  // We'll tag its parameters with those attributes as appropriate.
  const deduced: readonly DeducedParamAttrs[] = ExternAbi.is_rustic_abi(abi) ? (tcx.deduced_param_attrs(fn_def_id) as readonly DeducedParamAttrs[]) : [];
  if (deduced.length === 0) {
    return fn_abi;
  } else {
    const fn_abi_ = callconv.clone_FnAbi(fn_abi);
    apply_deduced_attributes(cx, deduced, 0, fn_abi_.ret);
    for (let arg_idx = 0; arg_idx < fn_abi_.args.length; arg_idx++) {
      apply_deduced_attributes(cx, deduced, arg_idx + 1, fn_abi_.args[arg_idx]!);
    }
    // debug!("fn_abi_adjust_for_deduced_attrs = {:?}", fn_abi);
    fn_abi_sanity_check(cx, fn_abi_, abi);
    return fn_abi_;
  }
}

/// Apply deduced optimization attributes to a parameter using an indirect pass mode.
///
/// `deduced` is a possibly truncated list of deduced attributes for a return place and arguments.
/// `idx` the index of the parameter on the list (0 for a return place, and 1.. for arguments).
// rustc: compiler/rustc_ty_utils/src/abi.rs:673 apply_deduced_attributes
function apply_deduced_attributes(cx: LayoutCx, deduced: readonly DeducedParamAttrs[], idx: number, arg: ArgAbi<Ty>): void {
  // Deduction is performed under the assumption of the indirection pass mode.
  const mode = arg.mode;
  if (mode.$ !== "Indirect") {
    return;
  }
  const attrs = mode.attrs;
  // The default values at the tail of the list are not encoded.
  const deduced_ = deduced[idx];
  if (deduced_ === undefined) {
    return;
  }
  if (DeducedParamAttrs.read_only(deduced_, cx.tcx_(), cx.typing_env, arg.layout.ty)) {
    // debug!("added deduced ReadOnly attribute");
    attrs.regular = callconv.ArgAttribute.insert(attrs.regular, callconv.ArgAttribute.ReadOnly);
  }
  if (DeducedParamAttrs.captures_none(deduced_, cx.tcx_(), cx.typing_env, arg.layout.ty)) {
    // debug!("added deduced CapturesNone attribute");
    attrs.regular = callconv.ArgAttribute.insert(attrs.regular, callconv.ArgAttribute.CapturesNone);
  }
}

// #[tracing::instrument(level = "debug", skip(cx))]
// rustc: compiler/rustc_ty_utils/src/abi.rs:698 make_thin_self_ptr
function make_thin_self_ptr(cx: LayoutCx, layout: TyAndLayout): TyAndLayout {
  const tcx = cx.tcx_();
  let wide_pointer_ty: Ty;
  if (layout.is_unsized()) {
    // unsized `self` is passed as a pointer to `self`
    // FIXME (mikeyhew) change this to use &own if it is ever added to the language
    wide_pointer_ty = Ty.new_mut_ptr(tcx, layout.ty);
  } else {
    switch (layout.backend_repr.$) {
      case "ScalarPair":
      case "Scalar":
        break;
      default:
        bug(`receiver type has unsupported layout: ${format_debug(layout, debug_TyAndLayout_Ty, PLAIN)}`);
    }

    // In the case of Rc<Self>, we need to explicitly pass a *mut RcInner<Self>
    // with a Scalar (not ScalarPair) ABI. This is a hack that is understood
    // elsewhere in the compiler as a method on a `dyn Trait`.
    // To get the type `*mut RcInner<Self>`, we just keep unwrapping newtypes until we
    // get a built-in pointer type
    let wide_pointer_layout = layout;
    while (!wide_pointer_layout.ty.is_raw_ptr() && !wide_pointer_layout.ty.is_ref()) {
      const f = wide_pointer_layout.non_1zst_field(cx);
      if (f === undefined) panic("not exactly one non-1-ZST field in a `DispatchFromDyn` type");
      wide_pointer_layout = f[1];
    }

    wide_pointer_ty = wide_pointer_layout.ty;
  }

  // we now have a type like `*mut RcInner<dyn Trait>`
  // change its layout to that of `*mut ()`, a thin pointer, but keep the same type
  // this is understood as a special case elsewhere in the compiler
  const unit_ptr_ty = Ty.new_mut_ptr(tcx, tcx.types.unit);

  // NOTE(eddyb) using an empty `ParamEnv`, and `unwrap`-ing the `Result`
  // should always work because the type is always `*mut ()`.
  const r = tcx.layout_of(TypingEnv.fully_monomorphized().as_query_input(unit_ptr_ty));
  if (r.$ === "Err") return panic("called `Result::unwrap()` on an `Err` value");
  return new abi_TyAndLayout(/* ty */ wide_pointer_ty, /* ..*/ r._0.layout);
}
