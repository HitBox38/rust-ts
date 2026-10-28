// Port of compiler/rustc_mir_transform/src/shim/async_destructor_ctor.rs (lane mt-shim, wave 24).
//
// PORT: `use super::*;` reaches shim.ts (`new_body`, `local_decls_for_sig`, `DropShimElaborator`, `Body_foldable`) and
// the `crate::elaborate_drop::elaborate_drop` shim.rs imports, which is imported from elaborate_drop.ts here.
// `crate::deref_separator::deref_finder` is imported from deref_separator.ts.
// PORT: `FixProxyFutureDropVisitor` (a fn-local struct of `build_adrop_for_coroutine_shim`) `extends MutVisitor`
// (mir/visit.ts, D4) at module level; `*place = ..` writes the caller's `Place` object in place.
// PORT: a `SourceInfo` (`Copy`) used by value more than once is copied with `clone_SourceInfo` (PORTING §8).
// PORT: `debug!` / `#[tracing::instrument]` are comments (no tracing subscriber for debug).
import { LangItem } from "../../rustc_attr_ir/lang_items.ts";
import type { DefId } from "../../rustc_span/def_id.ts";
import type { CoroutineKind } from "../../rustc_hir/hir.ts";
import {
  BasicBlock,
  BasicBlockData,
  type Body,
  clone_Body,
  clone_SourceInfo,
  CoroutineInfo,
  Local,
  LocalDecl,
  type Location,
  MirSource,
  Operand,
  type Place,
  Place as PlaceC,
  type PlaceElem,
  Place_from_Local,
  SourceInfo,
  START_BLOCK,
  Statement,
  Terminator,
  TerminatorKind,
  UnwindAction,
} from "../../rustc_middle/mir/mod.ts";
import { MutVisitor, type PlaceContext } from "../../rustc_middle/mir/visit.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { Ty } from "../../rustc_middle/ty/decls.ts";
import { GenericArg } from "../../rustc_middle/ty/generic_args.ts";
import { RawList } from "../../rustc_middle/ty/list.ts";
import type { AdtDef } from "../../rustc_middle/ty/decls.ts";
import { fold_Ty } from "../../rustc_middle/ty/structural_impls.ts";
import { TypeVisitableExt } from "../../rustc_type_ir/visit.ts";
import { debug_ShimKind, type ShimKind } from "../../rustc_middle/ty/instance.ts";
import { Ty as TyC, TypingEnv } from "../../rustc_middle/ty/mod.ts";
import { FieldIdx } from "../../rustc_abi/layout.ts";
import { DUMMY_SP, dummy_spanned, type Span } from "../../rustc_span/lib.ts";
import { bug } from "../../rustc_span/macros.ts";
import { Binder, EarlyBinder } from "../../rustc_type_ir/binder.ts";
import type { ClosureKind } from "../../rustc_type_ir/lib.ts";
import { FnSig as FnSigC, fold_FnSig } from "../../rustc_type_ir/ty_kind.ts";
import { CoroutineArgs } from "../../rustc_type_ir/ty_kind/closure.ts";
import { Unnormalized } from "../../rustc_type_ir/unnormalized.ts";
import { PLAIN } from "../../std/fmt.ts";
import { assert, assert_eq, unwrap } from "../../std/panic.ts";
import * as abort_unwinding_calls from "../abort_unwinding_calls.ts";
import * as add_call_guards from "../add_call_guards.ts";
import * as pm from "../pass_manager.ts";
import { MirPatch } from "../patch.ts";
import * as simplify from "../simplify.ts";
import { deref_finder } from "../deref_separator.ts";
import { elaborate_drop } from "../elaborate_drop.ts";
import { Body_foldable, DropShimElaborator, local_decls_for_sig, new_body } from "../shim.ts";

const SELF_ARG: Local = Local.arg(0);

// rustc: compiler/rustc_mir_transform/src/shim/async_destructor_ctor.rs:17 build_async_destructor_ctor_shim
export function build_async_destructor_ctor_shim(tcx: TyCtxt, def_id: DefId, ty: Ty): Body {
  // debug!("build_async_destructor_ctor_shim(def_id={:?}, ty={:?})", def_id, ty);
  // debug_assert_eq!(Some(def_id), tcx.lang_items().async_drop_in_place_fn());
  const generic_body = tcx.optimized_mir(def_id);
  const args = tcx.mk_args([GenericArg.from_Ty(ty)]);
  const body = Unnormalized.skip_norm_wip(
    EarlyBinder.instantiate(EarlyBinder.bind(tcx, clone_Body(generic_body), Body_foldable), tcx, args, Body_foldable),
  );

  // Minimal shim passes except MentionedItems,
  // it causes error "mentioned_items for DefId(...async_drop_in_place...) have already been set
  pm.run_passes(
    tcx,
    body,
    [simplify.SimplifyCfg.MakeShim, new abort_unwinding_calls.AbortUnwindingCalls(), add_call_guards.CriticalCallEdges],
    undefined,
  );
  return body;
}

// build_drop_shim analog for async drop glue (for generated coroutine poll function)
// #[tracing::instrument(level = "trace", skip(tcx), ret)]
// rustc: compiler/rustc_mir_transform/src/shim/async_destructor_ctor.rs:46 build_async_drop_shim
export function build_async_drop_shim(tcx: TyCtxt, def_id: DefId, ty: Ty): Body {
  const ty_kind = ty.kind();
  if (ty_kind.$ !== "Coroutine") {
    return bug();
  }
  const parent_args = ty_kind._1;
  const typing_env = TypingEnv.fully_monomorphized();

  const drop_ty = GenericArg.expect_ty(unwrap(parent_args[0]));
  const drop_ptr_ty = TyC.new_mut_ref(tcx, tcx.lifetimes.re_erased, drop_ty);

  assert(tcx.is_coroutine(def_id), "assertion failed: tcx.is_coroutine(def_id)");
  const coroutine_kind: CoroutineKind = unwrap(tcx.coroutine_kind(def_id) as CoroutineKind | undefined);

  assert(
    coroutine_kind.$ === "Desugared" && coroutine_kind._0 === "Async" && coroutine_kind._1 === "Fn",
    "assertion failed: matches!(coroutine_kind,\n    CoroutineKind::Desugared(CoroutineDesugaring::Async, CoroutineSource::Fn))",
  );

  const needs_async_drop = drop_ty.needs_async_drop(tcx, typing_env);
  const needs_sync_drop = !needs_async_drop && drop_ty.needs_drop(tcx, typing_env);

  const resume_adt = tcx.adt_def(tcx.require_lang_item(LangItem.ResumeTy, DUMMY_SP)) as AdtDef;
  const resume_ty = TyC.new_adt(tcx, resume_adt, RawList.empty());

  const fn_sig = Binder.dummy(tcx.mk_fn_sig_safe_rust_abi([ty, resume_ty], tcx.types.unit), fold_FnSig);
  const sig = tcx.instantiate_bound_regions_with_erased(fn_sig, fold_FnSig);

  assert(!drop_ty.is_coroutine(), "assertion failed: !drop_ty.is_coroutine()");
  const span = tcx.def_span(def_id);
  const source_info = SourceInfo.outermost(span);

  // The first argument (index 0) which will be local 1 (after the return value).
  const coroutine_layout = Place_from_Local(SELF_ARG);
  const coroutine_layout_dropee = tcx.mk_place_field(coroutine_layout, FieldIdx.new(0), drop_ptr_ty);

  const return_block = BasicBlock.new(1);
  const blocks: BasicBlockData[] = [];
  const block = (blocks: BasicBlockData[], kind: TerminatorKind): BasicBlock => {
    blocks.push(BasicBlockData.new(new Terminator(clone_SourceInfo(source_info), kind), false));
    return BasicBlock.new(blocks.length - 1);
  };
  block(
    blocks,
    needs_sync_drop
      ? {
          $: "Drop",
          place: tcx.mk_place_deref(coroutine_layout_dropee),
          target: return_block,
          unwind: UnwindAction.Continue,
          replace: false,
          drop: undefined,
        }
      : TerminatorKind.goto(return_block),
  );
  block(blocks, TerminatorKind.Return);

  const source = MirSource.from_shim({ $: "AsyncDropGlue", _0: def_id, _1: ty });
  const body = new_body(source, blocks, local_decls_for_sig(sig, span), FnSigC.inputs(sig).length, span);

  body.coroutine = CoroutineInfo.initial(
    coroutine_kind,
    CoroutineArgs.yield_ty(parent_args.as_coroutine()),
    CoroutineArgs.resume_ty(parent_args.as_coroutine()),
  );
  body.phase = { $: "Runtime", _0: "Initial" };

  // Returning noop body for types without `need async drop`
  // (or sync Drop in case of !`need async drop` && `need drop`).
  // And also for error types.
  if (needs_async_drop && !TypeVisitableExt.references_error(drop_ty, fold_Ty)) {
    const dropee_ptr_local = Local.new(body.local_decls.length);
    body.local_decls.push(LocalDecl.new(drop_ptr_ty, span));
    const dropee_ptr = Place_from_Local(dropee_ptr_local);
    body.basic_blocks_mut()[START_BLOCK]!.statements.push(
      Statement.new(clone_SourceInfo(source_info), {
        $: "Assign",
        _0: [dropee_ptr, { $: "Use", _0: { $: "Move", _0: coroutine_layout_dropee }, _1: "Yes" }],
      }),
    );

    const n_blocks = body.basic_blocks.deref().length;
    const dropline = n_blocks === 0 ? undefined : BasicBlock.new(n_blocks - 1);

    let patch: MirPatch;
    {
      const elaborator = new DropShimElaborator(body, MirPatch.new(body), tcx, typing_env, true);
      const dropee = tcx.mk_place_deref(dropee_ptr);
      const resume_block = elaborator.patch_.resume_block_();
      elaborate_drop(
        elaborator,
        clone_SourceInfo(source_info),
        dropee,
        null,
        return_block,
        { $: "To", _0: resume_block },
        START_BLOCK,
        dropline,
      );
      patch = elaborator.patch_;
    }
    patch.apply(body);
  }

  // We did not bother respecting deref separation, do it here.
  deref_finder(tcx, body, false);

  return body;
}

// * For async drop a "normal" coroutine:
// `async_drop_in_place<T>::{closure}.poll()` is converted into `T.future_drop_poll()`.
// Every coroutine has its `poll` (calculate yourself a little further)
// and its `future_drop_poll` (drop yourself a little further).
//
// * For async drop of "async drop coroutine" (`async_drop_in_place<T>::{closure}`):
// Correct drop of such coroutine means normal execution of nested async drop.
// async_drop(async_drop(T))::future_drop_poll() => async_drop(T)::poll().
// rustc: compiler/rustc_mir_transform/src/shim/async_destructor_ctor.rs:169 build_future_drop_poll_shim
export function build_future_drop_poll_shim(tcx: TyCtxt, def_id: DefId, proxy_ty: Ty, impl_ty: Ty): Body {
  const shim: ShimKind = { $: "FutureDropPoll", _0: def_id, _1: proxy_ty, _2: impl_ty };
  const impl_kind = impl_ty.kind();
  if (impl_kind.$ !== "Coroutine") {
    return bug(`build_future_drop_poll_shim not for coroutine impl type: (${debug_ShimKind(shim, PLAIN)})`);
  }
  const coroutine_def_id = impl_kind._0;

  const span = tcx.def_span(def_id);

  if (tcx.is_async_drop_in_place_coroutine(coroutine_def_id)) {
    return build_adrop_for_adrop_shim(tcx, proxy_ty, impl_ty, span, shim);
  } else {
    return build_adrop_for_coroutine_shim(tcx, proxy_ty, impl_ty, span, shim);
  }
}

// For async drop a "normal" coroutine:
// `async_drop_in_place<T>::{closure}.poll()` is converted into `T.future_drop_poll()`.
// Every coroutine has its `poll` (calculate yourself a little further)
// and its `future_drop_poll` (drop yourself a little further).
// rustc: compiler/rustc_mir_transform/src/shim/async_destructor_ctor.rs:193 build_adrop_for_coroutine_shim
function build_adrop_for_coroutine_shim(tcx: TyCtxt, proxy_ty: Ty, impl_ty: Ty, span: Span, shim: ShimKind): Body {
  const impl_kind = impl_ty.kind();
  if (impl_kind.$ !== "Coroutine") {
    return bug(`build_adrop_for_coroutine_shim not for coroutine impl type: (${debug_ShimKind(shim, PLAIN)})`);
  }
  const coroutine_def_id = impl_kind._0;
  const impl_args = impl_kind._1;
  const id_kind = EarlyBinder.skip_binder(tcx.type_of(coroutine_def_id) as EarlyBinder<Ty>).kind();
  if (id_kind.$ !== "Coroutine") {
    return bug();
  }
  const id_args = id_kind._1;
  const source_info = SourceInfo.outermost(span);

  // If the kind tys differ, we must use the by-move body
  let def_id: DefId;
  if (CoroutineArgs.kind_ty(id_args.as_coroutine()) === CoroutineArgs.kind_ty(impl_args.as_coroutine())) {
    def_id = coroutine_def_id;
  } else {
    assert_eq<ClosureKind>(unwrap(CoroutineArgs.kind_ty(impl_args.as_coroutine()).to_opt_closure_kind()), "FnOnce", (k) => k);

    def_id = tcx.coroutine_by_move_body_def_id(coroutine_def_id);
  }
  const body_ = unwrap(tcx.optimized_mir(def_id).future_drop_poll());
  const body: Body = Unnormalized.skip_norm_wip(
    EarlyBinder.instantiate(EarlyBinder.bind(tcx, clone_Body(body_), Body_foldable), tcx, impl_args, Body_foldable),
  );
  body.source.instance = { $: "Shim", _0: shim };
  body.phase = { $: "Runtime", _0: "Initial" };
  body.var_debug_info.length = 0;

  // converting `(_1: Pin<&mut CorLayout>, _2: &mut Context<'_>) -> Poll<()>`
  // into `(_1: Pin<&mut ProxyLayout>, _2: &mut Context<'_>) -> Poll<()>`
  // let mut _x: &mut CorLayout = &mut *_1.0.0;
  // Replace old _1.0 accesses into _x accesses;
  const proxy_ref = TyC.new_mut_ref(tcx, tcx.lifetimes.re_erased, proxy_ty);

  const pin_adt_ref = tcx.adt_def(tcx.require_lang_item(LangItem.Pin, span)) as AdtDef;
  const args = tcx.mk_args([GenericArg.from_Ty(proxy_ref)]);
  const pin_proxy_ref = TyC.new_adt(tcx, pin_adt_ref, args);

  const cor_ref = TyC.new_mut_ref(tcx, tcx.lifetimes.re_erased, impl_ty);
  const cor_ref_local = Local.new(body.local_decls.length);
  body.local_decls.push(LocalDecl.new(cor_ref, span));

  new FixProxyFutureDropVisitor(tcx, cor_ref_local).visit_body(body);

  // Now changing first arg from Pin<&mut ImplCoroutine> to Pin<&mut ProxyCoroutine>
  body.local_decls[SELF_ARG] = LocalDecl.new(pin_proxy_ref, span);

  // Build the projection to assign `cor_ref_local = _1.<projection>`.
  const pin_proxy_to_cor_projection: PlaceElem[] = [
    // _1.0 : Pin<&mut ProxyLayout> ==> &mut ProxyLayout
    { $: "Field", _0: FieldIdx.ZERO, _1: proxy_ref },
  ];

  // _cor_ref_tmp = (*(*_proxy).0).0...
  proxy_ty.find_async_drop_impl_coroutine(tcx, (ty) => {
    if (ty !== proxy_ty) {
      const ty_ref = TyC.new_mut_ref(tcx, tcx.lifetimes.re_erased, ty);
      pin_proxy_to_cor_projection.push({ $: "Deref" });
      pin_proxy_to_cor_projection.push({ $: "Field", _0: FieldIdx.ZERO, _1: ty_ref });
    }
  });

  // _cor_ref = cor_ref_tmp
  const projected_pin = Place_from_Local(SELF_ARG).project_deeper(pin_proxy_to_cor_projection, tcx);
  body.basic_blocks_mut()[START_BLOCK]!.statements.splice(
    0,
    0,
    Statement.new(clone_SourceInfo(source_info), {
      $: "Assign",
      _0: [Place_from_Local(cor_ref_local), { $: "Use", _0: { $: "Move", _0: projected_pin }, _1: "Yes" }],
    }),
  );

  // We did not bother respecting deref separation, do it here.
  deref_finder(tcx, body, false);

  return body;
}

/// Replace Pin<&mut ImplCoroutine> accesses (_1.0) into Pin<&mut ProxyCoroutine> accesses
// rustc-type: compiler/rustc_mir_transform/src/shim/async_destructor_ctor.rs:278 FixProxyFutureDropVisitor
class FixProxyFutureDropVisitor extends MutVisitor {
  constructor(
    public tcx_: TyCtxt,
    public replace_to: Local,
  ) {
    super();
  }

  // ---- impl<'tcx> MutVisitor<'tcx> for FixProxyFutureDropVisitor<'tcx> ----

  // rustc: compiler/rustc_mir_transform/src/shim/async_destructor_ctor.rs:284 tcx
  tcx(): TyCtxt {
    return this.tcx_;
  }

  // rustc: compiler/rustc_mir_transform/src/shim/async_destructor_ctor.rs:288 visit_place
  override visit_place(place: Place, _context: PlaceContext, _location: Location): void {
    if (place.local === SELF_ARG && place.projection.length > 0) {
      const first = place.projection[0]!;
      const rest = place.projection.slice(1);
      assert(
        first.$ === "Field" && first._0 === FieldIdx.ZERO,
        "assertion failed: matches!(first, ProjectionElem::Field(FieldIdx::ZERO, _))",
      );
      const replaced = Place_from_Local(this.replace_to).project_deeper(rest, this.tcx_);
      place.local = replaced.local;
      place.projection = replaced.projection;
    }
  }
}

// When dropping async drop coroutine, we continue its execution.
// async_drop(async_drop(T))::future_drop_poll() => async_drop(T)::poll()
// rustc: compiler/rustc_mir_transform/src/shim/async_destructor_ctor.rs:301 build_adrop_for_adrop_shim
function build_adrop_for_adrop_shim(tcx: TyCtxt, proxy_ty: Ty, impl_ty: Ty, span: Span, shim: ShimKind): Body {
  const source_info = SourceInfo.outermost(span);
  const proxy_ref = TyC.new_mut_ref(tcx, tcx.lifetimes.re_erased, proxy_ty);
  // taking _1.0 (impl from Pin)
  const proxy_ref_place = Place_from_Local(SELF_ARG).project_deeper([{ $: "Field", _0: FieldIdx.ZERO, _1: proxy_ref }], tcx);
  const cor_ref = TyC.new_mut_ref(tcx, tcx.lifetimes.re_erased, impl_ty);

  // ret_ty = `Poll<()>`
  const poll_adt_ref = tcx.adt_def(tcx.require_lang_item(LangItem.Poll, span)) as AdtDef;
  const ret_ty = TyC.new_adt(tcx, poll_adt_ref, tcx.mk_args([GenericArg.from_Ty(tcx.types.unit)]));
  // env_ty = `Pin<&mut proxy_ty>`
  const pin_adt_ref = tcx.adt_def(tcx.require_lang_item(LangItem.Pin, span)) as AdtDef;
  const env_ty = TyC.new_adt(tcx, pin_adt_ref, tcx.mk_args([GenericArg.from_Ty(proxy_ref)]));
  // sig = `fn (Pin<&mut proxy_ty>, &mut Context) -> Poll<()>`
  const sig = tcx.mk_fn_sig_safe_rust_abi([env_ty, TyC.new_task_context(tcx)], ret_ty);
  // This function will be called with pinned proxy coroutine layout.
  // We need to extract `Arg0.0` to get proxy layout, and then get `.0`
  // further to receive impl coroutine (may be needed)
  const locals = local_decls_for_sig(sig, span);
  const blocks: BasicBlockData[] = [];

  const proxy_ref_local = Local.new(locals.length);
  locals.push(LocalDecl.new(proxy_ref, span));

  const call_bb = BasicBlock.new(1);
  const return_bb = BasicBlock.new(2);

  const statements: Statement[] = [];

  statements.push(
    Statement.new(clone_SourceInfo(source_info), {
      $: "Assign",
      _0: [Place_from_Local(proxy_ref_local), { $: "Use", _0: { $: "Copy", _0: proxy_ref_place }, _1: "Yes" }],
    }),
  );

  let cor_ptr_local = proxy_ref_local;
  proxy_ty.find_async_drop_impl_coroutine(tcx, (ty) => {
    if (ty !== proxy_ty) {
      const ty_ptr = TyC.new_mut_ref(tcx, tcx.lifetimes.re_erased, ty);
      const impl_ptr_place = Place_from_Local(cor_ptr_local).project_deeper(
        [{ $: "Deref" }, { $: "Field", _0: FieldIdx.ZERO, _1: ty_ptr }],
        tcx,
      );
      cor_ptr_local = Local.new(locals.length);
      locals.push(LocalDecl.new(ty_ptr, span));
      // _cor_ptr = _proxy.0.0 (... .0)
      statements.push(
        Statement.new(clone_SourceInfo(source_info), {
          $: "Assign",
          _0: [Place_from_Local(cor_ptr_local), { $: "Use", _0: { $: "Copy", _0: impl_ptr_place }, _1: "Yes" }],
        }),
      );
    }
  });

  // convert impl coroutine ptr into ref
  const reborrow = {
    $: "Ref" as const,
    _0: tcx.lifetimes.re_erased,
    _1: { $: "Mut" as const, kind: "Default" as const },
    _2: tcx.mk_place_deref(Place_from_Local(cor_ptr_local)),
  };
  const cor_ref_local = Local.new(locals.length);
  locals.push(LocalDecl.new(cor_ref, span));
  const cor_ref_place = Place_from_Local(cor_ref_local);
  statements.push(Statement.new(clone_SourceInfo(source_info), { $: "Assign", _0: [cor_ref_place, reborrow] }));

  // cor_pin_ty = `Pin<&mut cor_ref>`
  const cor_pin_ty = TyC.new_adt(tcx, pin_adt_ref, tcx.mk_args([GenericArg.from_Ty(cor_ref)]));
  const cor_pin_local = Local.new(locals.length);
  locals.push(LocalDecl.new(cor_pin_ty, span));
  const cor_pin_place = Place_from_Local(cor_pin_local);

  const pin_fn = tcx.require_lang_item(LangItem.PinNewUnchecked, span);
  // call Pin<FutTy>::new_unchecked(&mut impl_cor)
  blocks.push(
    BasicBlockData.new_stmts(
      statements,
      new Terminator(clone_SourceInfo(source_info), {
        $: "Call",
        func: Operand.function_handle(tcx, pin_fn, [GenericArg.from_Ty(cor_ref)], span),
        args: [dummy_spanned({ $: "Move", _0: cor_ref_place })],
        destination: cor_pin_place,
        target: call_bb,
        unwind: UnwindAction.Continue,
        call_source: "Misc",
        fn_span: span,
      }),
      false,
    ),
  );
  // When dropping async drop coroutine, we continue its execution:
  // we call impl::poll (impl_layout, ctx)
  const poll_fn = tcx.require_lang_item(LangItem.FuturePoll, span);
  const resume_ctx = Place_from_Local(Local.new(2));
  blocks.push(
    BasicBlockData.new(
      new Terminator(clone_SourceInfo(source_info), {
        $: "Call",
        func: Operand.function_handle(tcx, poll_fn, [GenericArg.from_Ty(impl_ty)], span),
        args: [dummy_spanned({ $: "Move", _0: cor_pin_place }), dummy_spanned({ $: "Move", _0: resume_ctx })],
        destination: PlaceC.return_place(),
        target: return_bb,
        unwind: UnwindAction.Continue,
        call_source: "Misc",
        fn_span: span,
      }),
      false,
    ),
  );
  blocks.push(BasicBlockData.new(new Terminator(clone_SourceInfo(source_info), TerminatorKind.Return), false));

  const source = MirSource.from_shim(shim);
  const body = new_body(source, blocks, locals, FnSigC.inputs(sig).length, span);
  body.phase = { $: "Runtime", _0: "Initial" };
  return body;
}
