// Port of compiler/rustc_mir_transform/src/shim.rs (lane mt-shim, wave 24): the `mir_shims` provider (`make_shim`)
// and the shim builders (drop glue, clone, call / vtable / fn-ptr / closure-once shims, ADT constructors, fn-ptr
// `as_ptr` / `from_ptr`, coroutine-closure by-move constructors, thread-local accessors).
// (`build_adt_ctor` with `local_decls_for_sig` / `new_body` was ported ahead of the lane by merge-w22b.)
//
// PORT: `crate::elaborate_drop::{DropElaborator, DropFlagMode, DropStyle, Unwind, elaborate_drop}` (lane mt-drops) and
// `crate::deref_separator::deref_finder` (lane mt-cleanup) are not ported at this lane's base: they are module-local
// stand-ins at the end of this file (not markers; `elaborate_drop` / `deref_finder` stop UNPORTED with their upstream
// path) that those lanes repoint at their ports. shim/async_destructor_ctor.ts (`use super::*;`) imports them from here.
// PORT: `DropShimElaborator` is a class (struct with a trait impl, PORTING §5). Its trait methods whose names are also
// fields (`patch`, `body`, `tcx`, `typing_env`) get a trailing `_` (`patch_()`, `body_()`, `tcx_()`, `typing_env_()`;
// precedent mir/mod.ts "names", `HasTyCtxt::tcx_()`). `type Path = ()` is `null`; `Option<()>`'s `Some(())` is `null`
// and `None` is `undefined`.
// PORT: `crate::run_optimization_passes` (lib.rs) is `require`d inside `make_shim`: pass modules must not import lib.ts
// (pass_manager.ts header; precedent `pass_manager.ts` `PASS_NAMES`).
// PORT: a `SourceInfo` (`Copy`) used by value more than once is copied with `clone_SourceInfo` (PORTING §8).
// PORT: `debug!` / `#[instrument]` are comments (no tracing subscriber for debug).
import { panic, unported, unreachable, unwrap, assert, assert_eq } from "../std/panic.ts";
import type { Providers } from "../rustc_middle/util/mod.ts";
import { type DefId, DefId_eq, debug_DefId } from "../rustc_span/def_id.ts";
import type { Ty } from "../rustc_middle/ty/decls.ts";
import { Ty as TyC, TypingEnv } from "../rustc_middle/ty/mod.ts";
import {
  BasicBlock,
  BasicBlockData,
  Body,
  clone_SourceInfo,
  Const,
  ConstOperand,
  Local,
  LocalDecl,
  type MirSource,
  MirSource as MirSourceC,
  type Operand,
  Operand as OperandC,
  type Place,
  Place as PlaceC,
  Place_from_Local,
  RETURN_PLACE,
  SourceInfo,
  SourceScopeData,
  START_BLOCK,
  Statement,
  type StatementKind,
  SwitchTargets,
  Terminator,
  TerminatorKind,
  UnwindAction,
  fold_with_Body,
  try_fold_with_Body,
  visit_with_Body,
  clone_Body,
} from "../rustc_middle/mir/mod.ts";
import { MirDumper } from "../rustc_middle/mir/pretty.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { debug_Ty, fold_Ty } from "../rustc_middle/ty/structural_impls.ts";
import { display_Ty } from "../rustc_middle/ty/print/pretty.ts";
import { debug_ShimKind, type ShimKind, ShimKind as ShimKindC } from "../rustc_middle/ty/instance.ts";
import { GenericArg } from "../rustc_middle/ty/generic_args.ts";
import { RawList } from "../rustc_middle/ty/list.ts";
import { AssocItem, AssocItems } from "../rustc_middle/ty/assoc.ts";
import { CoroutineArgsExt } from "../rustc_middle/ty/sty.ts";
import { FieldIdx, FIRST_VARIANT, VariantIdx } from "../rustc_abi/layout.ts";
import { LangItem } from "../rustc_attr_ir/lang_items.ts";
import { Mutability } from "../rustc_ast_ir/lib.ts";
import type { Movability } from "../rustc_ast_ir/lib.ts";
import { DUMMY_SP, type Span, type Spanned } from "../rustc_span/lib.ts";
import { bug, span_bug } from "../rustc_span/macros.ts";
import { Binder, EarlyBinder, fold_Binder } from "../rustc_type_ir/binder.ts";
import type { TypeFoldable } from "../rustc_type_ir/fold.ts";
import type { ClosureKind } from "../rustc_type_ir/lib.ts";
import { type FnSig, FnSig as FnSigC, fold_FnSig } from "../rustc_type_ir/ty_kind.ts";
import {
  type CoroutineArgs,
  CoroutineArgs as CoroutineArgsC,
  ClosureArgs,
  CoroutineClosureArgs,
  CoroutineClosureSignature,
} from "../rustc_type_ir/ty_kind/closure.ts";
import { Unnormalized } from "../rustc_type_ir/unnormalized.ts";
import { debug_struct_non_exhaustive, type Fmt, PLAIN } from "../std/fmt.ts";
import type { MirPatch as MirPatchT } from "./patch.ts";
import { MirPatch } from "./patch.ts";
import * as abort_unwinding_calls from "./abort_unwinding_calls.ts";
import * as add_call_guards from "./add_call_guards.ts";
import * as add_moves_for_packed_drops from "./add_moves_for_packed_drops.ts";
import * as inline from "./inline.ts";
import * as instsimplify from "./instsimplify.ts";
import * as mentioned_items from "./mentioned_items.ts";
import * as pm from "./pass_manager.ts";
import { run_passes_no_validate } from "./pass_manager.ts";
import * as remove_noop_landing_pads from "./remove_noop_landing_pads.ts";
import * as simplify from "./simplify.ts";
import * as coroutine from "./coroutine/mod.ts";

// mod async_destructor_ctor;
import * as async_destructor_ctor from "./shim/async_destructor_ctor.ts";

/** PORT: `impl TypeFoldable for Body` (derived, mod.gen.ts) as a D4 descriptor, for `EarlyBinder::bind(tcx, body)`. */
const Body_foldable: TypeFoldable<Body> = {
  visit_with: (self, visitor) => visit_with_Body(self, visitor),
  try_fold_with: (self, folder) => try_fold_with_Body(self, folder),
  fold_with: (self, folder) => fold_with_Body(self, folder),
};
export { Body_foldable };

// rustc: compiler/rustc_mir_transform/src/shim.rs:28 provide
export function provide(providers: Providers["queries"]): void {
  // PORT: the `mir_shims` key is `unknown` in queries.gen.ts (`ty::ShimKind`); the arena allocation is the value.
  providers.mir_shims = (tcx: TyCtxt, shim: unknown) => make_shim(tcx, shim as ShimKind);
}

// rustc: compiler/rustc_mir_transform/src/shim.rs:32 make_shim
function make_shim(tcx: TyCtxt, shim: ShimKind): Body {
  // debug!("make_shim({:?})", shim);

  let result: Body;
  switch (shim.$) {
    case "VTable": {
      const def_id = shim._0;
      const adjustment: Adjustment = { $: "Deref", source: "MutPtr" };
      result = build_call_shim(tcx, shim, adjustment, { $: "Direct", _0: def_id });
      break;
    }
    case "FnPtr": {
      const def_id = shim._0;
      const ty = shim._1;
      const trait_ = tcx.parent(def_id);
      // Supports `Fn` or `async Fn` traits.
      let adjustment: Adjustment;
      let kind: ClosureKind | undefined = tcx.fn_trait_kind_from_def_id(trait_);
      if (kind === undefined) kind = tcx.async_fn_trait_kind_from_def_id(trait_);
      switch (kind) {
        case "FnOnce":
          adjustment = Adjustment.Identity;
          break;
        case "Fn":
          adjustment = { $: "Deref", source: "ImmRef" };
          break;
        case "FnMut":
          adjustment = { $: "Deref", source: "MutRef" };
          break;
        case undefined:
          return bug(`fn pointer ${debug_Ty(ty, PLAIN)} is not an fn`);
      }

      result = build_call_shim(tcx, shim, adjustment, { $: "Indirect", _0: ty });
      break;
    }
    // We are generating a call back to our def-id, which the
    // codegen backend knows to turn to an actual call, be it
    // a virtual call, or a direct call to a function for which
    // indirect calls must be codegen'd differently than direct ones
    // (such as `#[track_caller]`).
    case "Reify": {
      const def_id = shim._0;
      result = build_call_shim(tcx, shim, undefined, { $: "Direct", _0: def_id });
      break;
    }
    case "ClosureOnce": {
      const fn_mut = tcx.require_lang_item(LangItem.FnMut, DUMMY_SP);
      let found: DefId | undefined;
      for (const it of AssocItems.in_definition_order(tcx.associated_items(fn_mut) as AssocItems)) {
        if (AssocItem.is_fn(it)) {
          found = it.def_id;
          break;
        }
      }
      const call_mut = unwrap(found);

      result = build_call_shim(tcx, shim, Adjustment.RefMut, { $: "Direct", _0: call_mut });
      break;
    }

    case "ConstructCoroutineInClosure": {
      const { coroutine_closure_def_id, receiver_by_ref } = shim;
      result = build_construct_coroutine_by_move_shim(tcx, coroutine_closure_def_id, receiver_by_ref);
      break;
    }

    case "DropGlue": {
      const def_id = shim._0;
      const ty = shim._1;
      // FIXME(#91576): Drop shims for coroutines aren't subject to the MIR passes at the end
      // of this function. Is this intentional?
      const ty_kind = ty === undefined ? undefined : ty.kind();
      if (ty_kind !== undefined && ty_kind.$ === "Coroutine") {
        const coroutine_def_id = ty_kind._0;
        const args = ty_kind._1;
        const coroutine_body = tcx.optimized_mir(coroutine_def_id);

        const id_kind = EarlyBinder.skip_binder(tcx.type_of(coroutine_def_id) as EarlyBinder<Ty>).kind();
        if (id_kind.$ !== "Coroutine") {
          return bug();
        }
        const id_args = id_kind._1;

        // If this is a regular coroutine, grab its drop shim. If this is a coroutine
        // that comes from a coroutine-closure, and the kind ty differs from the "maximum"
        // kind that it supports, then grab the appropriate drop shim. This ensures that
        // the future returned by `<[coroutine-closure] as AsyncFnOnce>::call_once` will
        // drop the coroutine-closure's upvars.
        let body: Body;
        if (CoroutineArgsC.kind_ty(id_args.as_coroutine()) === CoroutineArgsC.kind_ty(args.as_coroutine())) {
          body = unwrap(coroutine_body.coroutine_drop());
        } else {
          assert_eq<ClosureKind>(
            unwrap(CoroutineArgsC.kind_ty(args.as_coroutine()).to_opt_closure_kind()),
            "FnOnce",
            (k) => k,
          );
          body = unwrap(tcx.optimized_mir(tcx.coroutine_by_move_body_def_id(coroutine_def_id)).coroutine_drop());
        }

        const body_ = Unnormalized.skip_norm_wip(
          EarlyBinder.instantiate(EarlyBinder.bind(tcx, clone_Body(body), Body_foldable), tcx, args, Body_foldable),
        );
        // debug!("make_shim({:?}) = {:?}", shim, body);

        pm.run_passes(
          tcx,
          body_,
          [
            new mentioned_items.MentionedItems(),
            new abort_unwinding_calls.AbortUnwindingCalls(),
            add_call_guards.CriticalCallEdges,
          ],
          { $: "Runtime", _0: "Optimized" },
        );

        return body_;
      }

      result = build_drop_shim(tcx, def_id, ty, TypingEnv.post_analysis(tcx, def_id));
      break;
    }
    case "ThreadLocal":
      result = build_thread_local_shim(tcx, shim);
      break;
    case "Clone":
      result = build_clone_shim(tcx, shim._0, shim._1);
      break;
    case "FnPtrAsPtr":
      result = build_fn_ptr_as_ptr_shim(tcx, shim._0, shim._1);
      break;
    case "FnPtrFromPtr":
      result = build_fn_ptr_from_ptr_shim(tcx, shim._0, shim._1);
      break;
    case "FutureDropPoll": {
      const body = async_destructor_ctor.build_future_drop_poll_shim(tcx, shim._0, shim._1, shim._2);

      pm.run_passes(
        tcx,
        body,
        [
          new mentioned_items.MentionedItems(),
          new abort_unwinding_calls.AbortUnwindingCalls(),
          add_call_guards.CriticalCallEdges,
        ],
        { $: "Runtime", _0: "PostCleanup" },
      );
      run_optimization_passes(tcx, body);
      // debug!("make_shim({:?}) = {:?}", shim, body);
      return body;
    }
    case "AsyncDropGlue": {
      const body = async_destructor_ctor.build_async_drop_shim(tcx, shim._0, shim._1);

      // Main pass required here is StateTransform to convert sync drop ladder
      // into coroutine.
      // Others are minimal passes as for sync drop glue shim
      pm.run_passes_no_validate(
        tcx,
        body,
        [
          new mentioned_items.MentionedItems(),
          new abort_unwinding_calls.AbortUnwindingCalls(),
          add_call_guards.CriticalCallEdges,
          simplify.SimplifyCfg.MakeShim,
          new coroutine.StateTransform(),
        ],
        { $: "Runtime", _0: "PostCleanup" },
      );
      run_optimization_passes(tcx, body);
      // debug!("make_shim({:?}) = {:?}", shim, body);
      return body;
    }

    case "AsyncDropGlueCtor": {
      const body = async_destructor_ctor.build_async_destructor_ctor_shim(tcx, shim._0, shim._1);
      // debug!("make_shim({:?}) = {:?}", shim, body);
      return body;
    }
  }
  // debug!("make_shim({:?}) = untransformed {:?}", shim, result);

  deref_finder(tcx, result, false);

  // We don't validate MIR here because the shims may generate code that's
  // only valid in a `PostAnalysis` param-env. However, since we do initial
  // validation with the MirBuilt phase, which uses a user-facing param-env.
  // This causes validation errors when TAITs are involved.
  pm.run_passes_no_validate(
    tcx,
    result,
    [
      new mentioned_items.MentionedItems(),
      new add_moves_for_packed_drops.AddMovesForPackedDrops(),
      new remove_noop_landing_pads.RemoveNoopLandingPads(),
      simplify.SimplifyCfg.MakeShim,
      instsimplify.InstSimplify.BeforeInline,
      // Perform inlining of `#[rustc_force_inline]`-annotated callees.
      new inline.ForceInline(),
      new abort_unwinding_calls.AbortUnwindingCalls(),
      add_call_guards.CriticalCallEdges,
    ],
    { $: "Runtime", _0: "Optimized" },
  );

  // debug!("make_shim({:?}) = {:?}", shim, result);

  return result;
}

/** PORT: `crate::run_optimization_passes` (lib.rs), `require`d lazily (see the header). */
function run_optimization_passes(tcx: TyCtxt, body: Body): void {
  (require("./lib.ts") as typeof import("./lib.ts")).run_optimization_passes(tcx, body);
}

// #[derive(Copy, Clone, Debug, PartialEq)]
// rustc-type: compiler/rustc_mir_transform/src/shim.rs:209 DerefSource
type DerefSource =
  /// `fn shim(&self) { inner(*self )}`.
  | "ImmRef"
  /// `fn shim(&mut self) { inner(*self )}`.
  | "MutRef"
  /// `fn shim(*mut self) { inner(*self )}`.
  | "MutPtr";

// #[derive(Copy, Clone, Debug, PartialEq)]
// rustc-type: compiler/rustc_mir_transform/src/shim.rs:219 Adjustment
type Adjustment =
  /// Pass the receiver as-is.
  | { readonly $: "Identity" }
  /// We get passed a reference or a raw pointer to `self` and call the target with `*self`.
  ///
  /// This either copies `self` (if `Self: Copy`, eg. for function items), or moves out of it
  /// (for `VTableShim`, which effectively is passed `&own Self`).
  | { readonly $: "Deref"; source: DerefSource }
  /// We get passed `self: Self` and call the target with `&mut self`.
  ///
  /// In this case we need to ensure that the `Self` is dropped after the call, as the callee
  /// won't do it for us.
  | { readonly $: "RefMut" };
const Adjustment = {
  Identity: Object.freeze({ $: "Identity" as const }),
  RefMut: Object.freeze({ $: "RefMut" as const }),
};

// #[derive(Copy, Clone, Debug, PartialEq)]
// rustc-type: compiler/rustc_mir_transform/src/shim.rs:237 CallKind
type CallKind =
  /// Call the `FnPtr` that was passed as the receiver.
  | { readonly $: "Indirect"; _0: Ty }
  /// Call a known `FnDef`.
  | { readonly $: "Direct"; _0: DefId };

// rustc: compiler/rustc_mir_transform/src/shim.rs:245 local_decls_for_sig
export function local_decls_for_sig(sig: FnSig, span: Span): LocalDecl[] {
  return [LocalDecl.new(FnSigC.output(sig), span), ...FnSigC.inputs(sig).map((ity) => LocalDecl.new(ity, span).immutable())];
}

/// Builds the drop glue for the provided type. The `def_id` is that of `core::ptr::drop_glue`.
///
/// Inside rustc this is only called on a monomorphic type, but we expose the function for
/// rustc_driver writers to be able to generate drop glue for a polymorphic type.
// rustc: compiler/rustc_mir_transform/src/shim.rs:258 build_drop_shim
export function build_drop_shim(tcx: TyCtxt, def_id: DefId, ty: Ty | undefined, typing_env: TypingEnv): Body {
  // debug!("build_drop_shim(def_id={:?}, ty={:?})", def_id, ty);

  assert(!(ty !== undefined && ty.is_coroutine()), "assertion failed: !matches!(ty, Some(ty) if ty.is_coroutine())");

  const args = ty !== undefined ? tcx.mk_args([GenericArg.from_Ty(ty)]) : RawList.identity_for_item(tcx, def_id);
  const sig_ = Unnormalized.skip_norm_wip(
    EarlyBinder.instantiate(tcx.fn_sig(def_id) as EarlyBinder<Binder<FnSig>>, tcx, args, fold_Binder(fold_FnSig)),
  );
  const sig = tcx.instantiate_bound_regions_with_erased(sig_, fold_FnSig);
  const span = tcx.def_span(def_id);

  const source_info = SourceInfo.outermost(span);

  const return_block = BasicBlock.new(1);
  const blocks: BasicBlockData[] = [];
  const block = (blocks: BasicBlockData[], kind: TerminatorKind): BasicBlock => {
    blocks.push(BasicBlockData.new(new Terminator(clone_SourceInfo(source_info), kind), false));
    return BasicBlock.new(blocks.length - 1);
  };
  if (ty !== undefined) {
    block(blocks, TerminatorKind.goto(return_block));
  }
  block(blocks, TerminatorKind.Return);

  const source = MirSourceC.from_shim({ $: "DropGlue", _0: def_id, _1: ty });
  const body = new_body(source, blocks, local_decls_for_sig(sig, span), FnSigC.inputs(sig).length, span);

  if (ty === undefined) {
    return body;
  }

  const dropee_ptr = Place_from_Local(Local.arg(0));

  const ty_kind = ty.kind();
  if (ty_kind.$ === "Array") {
    const ety = ty_kind._0;
    // Don't write out the elaboration for each array type.
    // Instead, just delegate to the slice version.
    const slice_ty = TyC.new_slice(tcx, ety);
    const mut_slice_ty = TyC.new_ref(tcx, tcx.lifetimes.re_erased, slice_ty, Mutability.Mut);
    const erased_local = Local.new(body.local_decls.length);
    body.local_decls.push(LocalDecl.new(mut_slice_ty, span));

    const start = body.basic_blocks_mut()[START_BLOCK]!;
    start.statements.push(
      Statement.new(clone_SourceInfo(source_info), {
        $: "Assign",
        _0: [
          Place_from_Local(erased_local),
          {
            $: "Cast",
            _0: { $: "PointerCoercion", _0: { $: "Unsize" }, _1: "Implicit" },
            _1: { $: "Move", _0: dropee_ptr },
            _2: mut_slice_ty,
          },
        ],
      }),
    );
    start.terminator = new Terminator(clone_SourceInfo(source_info), {
      $: "Call",
      func: OperandC.function_handle(tcx, def_id, [GenericArg.from_Ty(slice_ty)], span),
      args: [{ span, node: { $: "Move", _0: Place_from_Local(erased_local) } }],
      destination: Place_from_Local(RETURN_PLACE),
      target: return_block,
      unwind: UnwindAction.Continue,
      call_source: "Misc",
      fn_span: span,
    });
  } else {
    let patch: MirPatchT;
    {
      const elaborator = new DropShimElaborator(body, MirPatch.new(body), tcx, typing_env, false);
      const dropee = tcx.mk_place_deref(dropee_ptr);
      const resume_block = elaborator.patch.resume_block_();
      elaborate_drop(
        elaborator,
        clone_SourceInfo(source_info),
        dropee,
        null,
        return_block,
        { $: "To", _0: resume_block },
        START_BLOCK,
        undefined,
      );
      patch = elaborator.patch;
    }
    patch.apply(body);
  }

  return body;
}

// rustc: compiler/rustc_mir_transform/src/shim.rs:367 new_body
export function new_body(source: MirSource, basic_blocks: BasicBlockData[], local_decls: LocalDecl[], arg_count: number, span: Span): Body {
  const body = Body.new(
    source,
    basic_blocks,
    [new SourceScopeData(span, undefined, undefined, undefined, { $: "Clear" })],
    local_decls,
    [],
    arg_count,
    [],
    span,
    undefined,
    // FIXME(compiler-errors): is this correct?
    undefined,
  );
  // Shims do not directly mention any consts.
  body.set_required_consts([]);
  return body;
}

// rustc-type: compiler/rustc_mir_transform/src/shim.rs:401 DropShimElaborator
export class DropShimElaborator {
  constructor(
    public body: Body,
    public patch: MirPatchT,
    public tcx: TyCtxt,
    public typing_env: TypingEnv,
    public produce_async_drops: boolean,
  ) {}

  // ---- impl<'a, 'tcx> DropElaborator<'a, 'tcx> for DropShimElaborator<'a, 'tcx> ----
  // type Path = ();

  // rustc: compiler/rustc_mir_transform/src/shim.rs:418 patch_ref
  patch_ref(): MirPatchT {
    return this.patch;
  }
  // rustc: compiler/rustc_mir_transform/src/shim.rs:421 patch
  patch_(): MirPatchT {
    return this.patch;
  }
  // rustc: compiler/rustc_mir_transform/src/shim.rs:424 body
  body_(): Body {
    return this.body;
  }
  // rustc: compiler/rustc_mir_transform/src/shim.rs:427 tcx
  tcx_(): TyCtxt {
    return this.tcx;
  }
  // rustc: compiler/rustc_mir_transform/src/shim.rs:430 typing_env
  typing_env_(): TypingEnv {
    return this.typing_env;
  }

  // rustc: compiler/rustc_mir_transform/src/shim.rs:434 allow_async_drops
  allow_async_drops(): boolean {
    return this.produce_async_drops;
  }

  // rustc: compiler/rustc_mir_transform/src/shim.rs:438 drop_style
  drop_style(_path: null, mode: DropFlagMode): DropStyle {
    switch (mode) {
      case "Shallow":
        // Drops for the contained fields are "shallow" and "static" - they will simply call
        // the field's own drop glue.
        return "Static";
      case "Deep":
        // The top-level drop is "deep" and "open" - it will be elaborated to a drop ladder
        // dropping each field contained in the value.
        return "Open";
    }
  }

  // rustc: compiler/rustc_mir_transform/src/shim.rs:453 get_drop_flag
  get_drop_flag(_path: null): Operand | undefined {
    return undefined;
  }

  // rustc: compiler/rustc_mir_transform/src/shim.rs:457 drop_flags_for
  drop_flags_for(_path: null, _mode: DropFlagMode): Place[] {
    return [];
  }

  // rustc: compiler/rustc_mir_transform/src/shim.rs:461 field_subpath
  field_subpath(_path: null, _field: FieldIdx): null | undefined {
    return undefined;
  }
  // rustc: compiler/rustc_mir_transform/src/shim.rs:464 deref_subpath
  deref_subpath(_path: null): null | undefined {
    return undefined;
  }
  // rustc: compiler/rustc_mir_transform/src/shim.rs:467 downcast_subpath
  downcast_subpath(_path: null, _variant: VariantIdx): null | undefined {
    return null;
  }
  // rustc: compiler/rustc_mir_transform/src/shim.rs:470 array_subpath
  array_subpath(_path: null, _index: number, _size: number): null | undefined {
    return undefined;
  }
}

// rustc: compiler/rustc_mir_transform/src/shim.rs:410 fmt
export const debug_DropShimElaborator = (_v: DropShimElaborator, f: Fmt): string => debug_struct_non_exhaustive(f, "DropShimElaborator", []);

// rustc: compiler/rustc_mir_transform/src/shim.rs:475 build_thread_local_shim
function build_thread_local_shim(tcx: TyCtxt, shim: ShimKind): Body {
  const def_id = ShimKindC.def_id(shim);

  const span = tcx.def_span(def_id);
  const source_info = SourceInfo.outermost(span);

  const blocks = [
    BasicBlockData.new_stmts(
      [
        Statement.new(clone_SourceInfo(source_info), {
          $: "Assign",
          _0: [PlaceC.return_place(), { $: "ThreadLocalRef", _0: def_id }],
        }),
      ],
      new Terminator(clone_SourceInfo(source_info), TerminatorKind.Return),
      false,
    ),
  ];

  return new_body(MirSourceC.from_shim(shim), blocks, [LocalDecl.new(tcx.thread_local_ptr_ty(def_id), span)], 0, span);
}

/// Builds a `Clone::clone` shim for `self_ty`. Here, `def_id` is `Clone::clone`.
// rustc: compiler/rustc_mir_transform/src/shim.rs:503 build_clone_shim
function build_clone_shim(tcx: TyCtxt, def_id: DefId, self_ty: Ty): Body {
  // debug!("build_clone_shim(def_id={:?})", def_id);

  const builder = CloneShimBuilder.new(tcx, def_id, self_ty);

  const dest = PlaceC.return_place();
  const src = tcx.mk_place_deref(Place_from_Local(Local.arg(0)));

  const kind = self_ty.kind();
  switch (kind.$) {
    case "FnDef":
    case "FnPtr":
      builder.copy_shim();
      break;
    case "Closure":
      builder.tuple_like_shim(dest, src, ClosureArgs.upvar_tys(kind._1.as_closure()));
      break;
    case "CoroutineClosure":
      builder.tuple_like_shim(dest, src, CoroutineClosureArgs.upvar_tys(kind._1.as_coroutine_closure()));
      break;
    case "Tuple":
      builder.tuple_like_shim(dest, src, self_ty.tuple_fields());
      break;
    case "Coroutine": {
      const coroutine_def_id = kind._0;
      assert_eq<Movability>(tcx.coroutine_movability(coroutine_def_id), "Movable", (m) => m);
      builder.coroutine_shim(dest, src, coroutine_def_id, kind._1.as_coroutine());
      break;
    }
    default:
      return bug(`clone shim for \`${debug_Ty(self_ty, PLAIN)}\` which is not \`Copy\` and is not an aggregate`);
  }

  return builder.into_mir();
}

// rustc-type: compiler/rustc_mir_transform/src/shim.rs:528 CloneShimBuilder
class CloneShimBuilder {
  constructor(
    public tcx: TyCtxt,
    public def_id: DefId,
    public local_decls: LocalDecl[],
    public blocks: BasicBlockData[],
    public span: Span,
    public sig: FnSig,
  ) {}

  // rustc: compiler/rustc_mir_transform/src/shim.rs:538 new
  static new(tcx: TyCtxt, def_id: DefId, self_ty: Ty): CloneShimBuilder {
    // we must instantiate the self_ty because it's
    // otherwise going to be TySelf and we can't index
    // or access fields of a Place of type TySelf.
    const sig_ = Unnormalized.skip_norm_wip(
      EarlyBinder.instantiate(tcx.fn_sig(def_id) as EarlyBinder<Binder<FnSig>>, tcx, [GenericArg.from_Ty(self_ty)], fold_Binder(fold_FnSig)),
    );
    const sig = tcx.instantiate_bound_regions_with_erased(sig_, fold_FnSig);
    const span = tcx.def_span(def_id);

    return new CloneShimBuilder(tcx, def_id, local_decls_for_sig(sig, span), [], span, sig);
  }

  // rustc: compiler/rustc_mir_transform/src/shim.rs:556 into_mir
  into_mir(): Body {
    const source = MirSourceC.from_shim({ $: "Clone", _0: this.def_id, _1: this.sig.inputs_and_output[0]! });
    return new_body(source, this.blocks, this.local_decls, FnSigC.inputs(this.sig).length, this.span);
  }

  // rustc: compiler/rustc_mir_transform/src/shim.rs:562 source_info
  source_info(): SourceInfo {
    return SourceInfo.outermost(this.span);
  }

  // rustc: compiler/rustc_mir_transform/src/shim.rs:566 block
  block(statements: Statement[], kind: TerminatorKind, is_cleanup: boolean): BasicBlock {
    const source_info = this.source_info();
    this.blocks.push(BasicBlockData.new_stmts(statements, new Terminator(source_info, kind), is_cleanup));
    return BasicBlock.new(this.blocks.length - 1);
  }

  /// Gives the index of an upcoming BasicBlock, with an offset.
  /// offset=0 will give you the index of the next BasicBlock,
  /// offset=1 will give the index of the next-to-next block,
  /// offset=-1 will give you the index of the last-created block
  // rustc: compiler/rustc_mir_transform/src/shim.rs:584 block_index_offset
  block_index_offset(offset: number): BasicBlock {
    return BasicBlock.new(this.blocks.length + offset);
  }

  // rustc: compiler/rustc_mir_transform/src/shim.rs:588 make_statement
  make_statement(kind: StatementKind): Statement {
    return Statement.new(this.source_info(), kind);
  }

  // rustc: compiler/rustc_mir_transform/src/shim.rs:592 copy_shim
  copy_shim(): void {
    const rcvr = this.tcx.mk_place_deref(Place_from_Local(Local.arg(0)));
    const ret_statement = this.make_statement({
      $: "Assign",
      _0: [PlaceC.return_place(), { $: "Use", _0: { $: "Copy", _0: rcvr }, _1: "Yes" }],
    });
    this.block([ret_statement], TerminatorKind.Return, false);
  }

  // rustc: compiler/rustc_mir_transform/src/shim.rs:601 make_place
  make_place(mutability: Mutability, ty: Ty): Place {
    const span = this.span;
    let local = LocalDecl.new(ty, span);
    if (Mutability.is_not(mutability)) {
      local = local.immutable();
    }
    const idx = Local.new(this.local_decls.length);
    this.local_decls.push(local);
    return Place_from_Local(idx);
  }

  // rustc: compiler/rustc_mir_transform/src/shim.rs:610 make_clone_call
  make_clone_call(dest: Place, src: Place, ty: Ty, next: BasicBlock, cleanup: BasicBlock): void {
    const tcx = this.tcx;

    // `func == Clone::clone(&ty) -> ty`
    const func_ty = Unnormalized.skip_norm_wip(
      EarlyBinder.instantiate(tcx.type_of(this.def_id) as EarlyBinder<Ty>, tcx, [GenericArg.from_Ty(ty)], fold_Ty),
    );
    const func: Operand = {
      $: "Constant",
      _0: new ConstOperand(this.span, undefined, Const.zero_sized(func_ty)),
    };

    const ref_loc = this.make_place("Not", TyC.new_imm_ref(tcx, tcx.lifetimes.re_erased, ty));

    // `let ref_loc: &ty = &src;`
    const statement = this.make_statement({
      $: "Assign",
      _0: [ref_loc, { $: "Ref", _0: tcx.lifetimes.re_erased, _1: { $: "Shared" }, _2: src }],
    });

    // `let loc = Clone::clone(ref_loc);`
    this.block(
      [statement],
      {
        $: "Call",
        func,
        args: [{ node: { $: "Move", _0: ref_loc }, span: DUMMY_SP }],
        destination: dest,
        target: next,
        unwind: { $: "Cleanup", _0: cleanup },
        call_source: "Normal",
        fn_span: this.span,
      },
      false,
    );
  }

  // rustc: compiler/rustc_mir_transform/src/shim.rs:653 clone_fields
  clone_fields(dest: Place, src: Place, target: BasicBlock, unwind: BasicBlock, tys: Iterable<Ty>): BasicBlock {
    // For an iterator of length n, create 2*n + 1 blocks.
    let i = 0;
    for (const ity of tys) {
      // Each iteration creates two blocks, referred to here as block 2*i and block 2*i + 1.
      //
      // Block 2*i attempts to clone the field. If successful it branches to 2*i + 2 (the
      // next clone block). If unsuccessful it branches to the previous unwind block, which
      // is initially the `unwind` argument passed to this function.
      //
      // Block 2*i + 1 is the unwind block for this iteration. It drops the cloned value
      // created by block 2*i. We store this block in `unwind` so that the next clone block
      // will unwind to it if cloning fails.

      const field = FieldIdx.new(i);
      const src_field = this.tcx.mk_place_field(src, field, ity);

      const dest_field = this.tcx.mk_place_field(dest, field, ity);

      const next_unwind = this.block_index_offset(1);
      const next_block = this.block_index_offset(2);
      this.make_clone_call(dest_field, src_field, ity, next_block, unwind);
      this.block(
        [],
        {
          $: "Drop",
          place: dest_field,
          target: unwind,
          unwind: { $: "Terminate", _0: "InCleanup" },
          replace: false,
          drop: undefined,
        },
        /* is_cleanup */ true,
      );
      unwind = next_unwind;
      i++;
    }
    // If all clones succeed then we end up here.
    this.block([], TerminatorKind.goto(target), false);
    return unwind;
  }

  // rustc: compiler/rustc_mir_transform/src/shim.rs:702 tuple_like_shim
  tuple_like_shim(dest: Place, src: Place, tys: Iterable<Ty>): void {
    this.block([], TerminatorKind.goto(this.block_index_offset(3)), false);
    const unwind = this.block([], TerminatorKind.UnwindResume, true);
    const target = this.block([], TerminatorKind.Return, false);

    const _final_cleanup_block = this.clone_fields(dest, src, target, unwind, tys);
  }

  // rustc: compiler/rustc_mir_transform/src/shim.rs:713 coroutine_shim
  coroutine_shim(dest: Place, src: Place, coroutine_def_id: DefId, args: CoroutineArgs): void {
    this.block([], TerminatorKind.goto(this.block_index_offset(3)), false);
    let unwind = this.block([], TerminatorKind.UnwindResume, true);
    // This will get overwritten with a switch once we know the target blocks
    const switch_ = this.block([], TerminatorKind.Unreachable, false);
    unwind = this.clone_fields(dest, src, switch_, unwind, CoroutineArgsC.upvar_tys(args));
    const target = this.block([], TerminatorKind.Return, false);
    const unreachable_ = this.block([], TerminatorKind.Unreachable, false);
    const state_tys = [...CoroutineArgsExt.state_tys(args, coroutine_def_id, this.tcx)];
    const cases: [bigint, BasicBlock][] = [];
    for (let index = 0; index < state_tys.length; index++) {
      const variant_index = VariantIdx.new(index);
      const dest_ = this.tcx.mk_place_downcast_unnamed(dest, variant_index);
      const src_ = this.tcx.mk_place_downcast_unnamed(src, variant_index);
      const clone_block = this.block_index_offset(1);
      const start_block = this.block(
        [this.make_statement({ $: "SetDiscriminant", place: PlaceC.return_place(), variant_index })],
        TerminatorKind.goto(clone_block),
        false,
      );
      cases.push([BigInt(index), start_block]);
      const _final_cleanup_block = this.clone_fields(dest_, src_, target, unwind, state_tys[index]!);
    }
    const discr_ty = CoroutineArgsExt.discr_ty(args, this.tcx);
    const temp = this.make_place("Mut", discr_ty);
    const rvalue = { $: "Discriminant" as const, _0: src };
    const statement = this.make_statement({ $: "Assign", _0: [temp, rvalue] });
    const data = this.blocks[switch_]!;
    if (data.terminator !== undefined) {
      data.statements.push(statement);
      data.terminator.kind = {
        $: "SwitchInt",
        discr: { $: "Move", _0: temp },
        targets: SwitchTargets.new(cases, unreachable_),
      };
    } else {
      unreachable();
    }
  }
}

/// Builds a "call" shim for `instance`. The shim calls the function specified by `call_kind`,
/// first adjusting its first argument according to `rcvr_adjustment`.
// #[instrument(level = "debug", skip(tcx), ret)]
// rustc: compiler/rustc_mir_transform/src/shim.rs:764 build_call_shim
function build_call_shim(tcx: TyCtxt, shim: ShimKind, rcvr_adjustment: Adjustment | undefined, call_kind: CallKind): Body {
  // `FnPtrShim` contains the fn pointer type that a call shim is being built for - this is used
  // to instantiate into the signature of the shim. It is not necessary for users of this
  // MIR body to perform further instantiations (see `InstanceKind::has_polymorphic_mir_body`).
  let sig_args: [GenericArg, GenericArg] | undefined;
  let untuple_args: readonly Ty[] | undefined;
  if (shim.$ === "FnPtr") {
    const ty = shim._1;
    const sig = tcx.instantiate_bound_regions_with_erased(ty.fn_sig(tcx), fold_FnSig);

    const untuple_args_ = FnSigC.inputs(sig);

    // Create substitutions for the `Self` and `Args` generic parameters of the shim body.
    const arg_tup = TyC.new_tup(tcx, untuple_args_);

    [sig_args, untuple_args] = [[GenericArg.from_Ty(ty), GenericArg.from_Ty(arg_tup)], untuple_args_];
  } else {
    [sig_args, untuple_args] = [undefined, undefined];
  }

  const def_id = ShimKindC.def_id(shim);

  const sig_ = tcx.fn_sig(def_id) as EarlyBinder<Binder<FnSig>>;
  const sig__ = EarlyBinder.map_bound(sig_, (sig) => tcx.instantiate_bound_regions_with_erased(sig, fold_FnSig));

  assert_eq(sig_args !== undefined, !ShimKindC.has_polymorphic_mir_body(shim), (b) => `${b}`);
  let sig: FnSig;
  if (sig_args !== undefined) {
    sig = Unnormalized.skip_norm_wip(EarlyBinder.instantiate(sig__, tcx, sig_args, fold_FnSig));
  } else {
    sig = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(sig__));
  }

  if (call_kind.$ === "Indirect") {
    const fnty = call_kind._0;
    // `sig` determines our local decls, and thus the callee type in the `Call` terminator. This
    // can only be an `FnDef` or `FnPtr`, but currently will be `Self` since the types come from
    // the implemented `FnX` trait.

    // Apply the opposite adjustment to the MIR input.
    const inputs_and_output = [...sig.inputs_and_output];

    // Initial signature is `fn(&? Self, Args) -> Self::Output` where `Args` is a tuple of the
    // fn arguments. `Self` may be passed via (im)mutable reference or by-value.
    assert_eq(inputs_and_output.length, 3, (n) => `${n}`);

    // `Self` is always the original fn type `ty`. The MIR call terminator is only defined for
    // `FnDef` and `FnPtr` callees, not the `Self` type param.
    const adj = unwrap(rcvr_adjustment);
    switch (adj.$) {
      case "Identity":
        inputs_and_output[0] = fnty;
        break;
      case "Deref":
        switch (adj.source) {
          case "ImmRef":
            inputs_and_output[0] = TyC.new_imm_ref(tcx, tcx.lifetimes.re_erased, fnty);
            break;
          case "MutRef":
            inputs_and_output[0] = TyC.new_mut_ref(tcx, tcx.lifetimes.re_erased, fnty);
            break;
          case "MutPtr":
            inputs_and_output[0] = TyC.new_mut_ptr(tcx, fnty);
            break;
        }
        break;
      case "RefMut":
        return bug(`\`RefMut\` is never used with indirect calls: ${debug_ShimKind(shim, PLAIN)}`);
    }
    // PORT: `FnSig` is `Copy`: the write goes to this function's copy.
    sig = { inputs_and_output: tcx.mk_type_list(inputs_and_output), fn_sig_kind: sig.fn_sig_kind };
  }

  // FIXME: Avoid having to adjust the signature both here and in
  // `fn_sig_for_fn_abi`.
  if (shim.$ === "VTable") {
    // Modify fn(self, ...) to fn(self: *mut Self, ...)
    const inputs_and_output = [...sig.inputs_and_output];
    // debug_assert!(tcx.generics_of(def_id).has_self && *self_arg == tcx.types.self_param);
    inputs_and_output[0] = TyC.new_mut_ptr(tcx, inputs_and_output[0]!);
    sig = { inputs_and_output: tcx.mk_type_list(inputs_and_output), fn_sig_kind: sig.fn_sig_kind };
  }

  const span = tcx.def_span(def_id);

  // debug!(?sig);

  const local_decls = local_decls_for_sig(sig, span);
  const source_info = SourceInfo.outermost(span);

  const destination = PlaceC.return_place();

  const rcvr_place = (): Place => {
    assert(rcvr_adjustment !== undefined, "assertion failed: rcvr_adjustment.is_some()");
    return Place_from_Local(Local.arg(0));
  };
  const statements: Statement[] = [];

  let rcvr: Operand | undefined;
  if (rcvr_adjustment !== undefined) {
    switch (rcvr_adjustment.$) {
      case "Identity":
        rcvr = { $: "Move", _0: rcvr_place() };
        break;
      case "Deref":
        rcvr = { $: "Move", _0: tcx.mk_place_deref(rcvr_place()) };
        break;
      case "RefMut": {
        // let rcvr = &mut rcvr;
        const ref_rcvr = Local.new(local_decls.length);
        local_decls.push(LocalDecl.new(TyC.new_mut_ref(tcx, tcx.lifetimes.re_erased, FnSigC.inputs(sig)[0]!), span).immutable());
        const borrow_kind = { $: "Mut" as const, kind: "Default" as const };
        statements.push(
          Statement.new(clone_SourceInfo(source_info), {
            $: "Assign",
            _0: [Place_from_Local(ref_rcvr), { $: "Ref", _0: tcx.lifetimes.re_erased, _1: borrow_kind, _2: rcvr_place() }],
          }),
        );
        rcvr = { $: "Move", _0: Place_from_Local(ref_rcvr) };
        break;
      }
    }
  }

  let callee: Operand;
  let args: Operand[];
  switch (call_kind.$) {
    // `FnPtr` call has no receiver. Args are untupled below.
    case "Indirect":
      [callee, args] = [unwrap(rcvr), []];
      break;

    // `FnDef` call with optional receiver.
    case "Direct": {
      const ty = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.type_of(call_kind._0) as EarlyBinder<Ty>));
      [callee, args] = [
        {
          $: "Constant",
          _0: new ConstOperand(span, undefined, Const.zero_sized(ty)),
        },
        rcvr !== undefined ? [rcvr] : [],
      ];
      break;
    }
  }

  const arg_range = { start: 0, end: FnSigC.inputs(sig).length };

  // Take the `self` ("receiver") argument out of the range (it's adjusted above).
  if (rcvr_adjustment !== undefined) {
    arg_range.start += 1;
  }

  // Take the last argument, if we need to untuple it (handled below).
  if (untuple_args !== undefined) {
    arg_range.end -= 1;
  }

  // Pass all of the non-special arguments directly.
  for (let i = arg_range.start; i < arg_range.end; i++) {
    args.push({ $: "Move", _0: Place_from_Local(Local.arg(i)) });
  }

  // Untuple the last argument, if we have to.
  if (untuple_args !== undefined) {
    const tuple_arg = Local.arg(FnSigC.inputs(sig).length - 1);
    untuple_args.forEach((ity, i) => {
      args.push({ $: "Move", _0: tcx.mk_place_field(Place_from_Local(tuple_arg), FieldIdx.new(i), ity) });
    });
  }

  // let n_blocks = if let Some(Adjustment::RefMut) = rcvr_adjustment { 5 } else { 2 };
  const blocks: BasicBlockData[] = [];
  const block = (blocks: BasicBlockData[], statements: Statement[], kind: TerminatorKind, is_cleanup: boolean): BasicBlock => {
    blocks.push(BasicBlockData.new_stmts(statements, new Terminator(clone_SourceInfo(source_info), kind), is_cleanup));
    return BasicBlock.new(blocks.length - 1);
  };

  // BB #0
  const args_: Spanned<Operand>[] = args.map((a) => ({ node: a, span: DUMMY_SP }));
  block(
    blocks,
    statements,
    {
      $: "Call",
      func: callee,
      args: args_,
      destination,
      target: BasicBlock.new(1),
      unwind: rcvr_adjustment !== undefined && rcvr_adjustment.$ === "RefMut" ? { $: "Cleanup", _0: BasicBlock.new(3) } : UnwindAction.Continue,
      call_source: "Misc",
      fn_span: span,
    },
    false,
  );

  if (rcvr_adjustment !== undefined && rcvr_adjustment.$ === "RefMut") {
    // BB #1 - drop for Self
    block(
      blocks,
      [],
      {
        $: "Drop",
        place: rcvr_place(),
        target: BasicBlock.new(2),
        unwind: UnwindAction.Continue,
        replace: false,
        drop: undefined,
      },
      false,
    );
  }
  // BB #1/#2 - return
  const stmts: Statement[] = [];
  block(blocks, stmts, TerminatorKind.Return, false);
  if (rcvr_adjustment !== undefined && rcvr_adjustment.$ === "RefMut") {
    // BB #3 - drop if closure panics
    block(
      blocks,
      [],
      {
        $: "Drop",
        place: rcvr_place(),
        target: BasicBlock.new(4),
        unwind: { $: "Terminate", _0: "InCleanup" },
        replace: false,
        drop: undefined,
      },
      /* is_cleanup */ true,
    );

    // BB #4 - resume
    block(blocks, [], TerminatorKind.UnwindResume, true);
  }

  const body = new_body(MirSourceC.from_shim(shim), blocks, local_decls, FnSigC.inputs(sig).length, span);

  if (FnSigC.abi(sig).$ === "RustCall") {
    body.spread_arg = Local.new(FnSigC.inputs(sig).length);
  }

  return body;
}

// rustc: compiler/rustc_mir_transform/src/shim.rs:994 build_adt_ctor
export function build_adt_ctor(tcx: TyCtxt, ctor_id: DefId): Body {
  // debug_assert!(tcx.is_constructor(ctor_id));

  const typing_env = TypingEnv.post_analysis(tcx, ctor_id);

  // Normalize the sig.
  // PORT: the `fn_sig` query value is `unknown` in queries.gen.ts (`EarlyBinder<Binder<FnSig>>`).
  const sig_ = Binder.no_bound_vars(
    Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.fn_sig(ctor_id) as EarlyBinder<Binder<FnSig>>)),
    fold_FnSig,
  );
  if (sig_ === undefined) panic("LBR in ADT constructor signature");
  const sig = tcx.normalize_erasing_regions(typing_env, Unnormalized.new_wip(sig_), fold_FnSig);

  const output_kind = FnSigC.output(sig).kind();
  if (output_kind.$ !== "Adt") {
    return bug(`unexpected type for ADT ctor ${debug_Ty(FnSigC.output(sig), PLAIN)}`);
  }
  const adt_def = output_kind._0;
  const args = output_kind._1;

  // debug!("build_ctor: ctor_id={:?} sig={:?}", ctor_id, sig);

  const span = tcx.def_span(ctor_id);

  const local_decls = local_decls_for_sig(sig, span);

  const source_info = SourceInfo.outermost(span);

  const variant_index = adt_def.is_enum() ? adt_def.variant_index_with_ctor_id(ctor_id) : FIRST_VARIANT;

  // Generate the following MIR:
  //
  // (return as Variant).field0 = arg0;
  // (return as Variant).field1 = arg1;
  //
  // return;
  // debug!("build_ctor: variant_index={:?}", variant_index);

  const variant = adt_def.variant(variant_index);
  const statement = Statement.new(source_info, {
    $: "Assign",
    _0: [
      PlaceC.return_place(),
      {
        $: "Aggregate",
        _0: { $: "Adt", _0: adt_def.did(), _1: variant_index, _2: args, _3: undefined, _4: undefined },
        _1: variant.fields.map((_f, idx) => ({ $: "Move" as const, _0: Place_from_Local(Local.arg(idx)) })),
      },
    ],
  });

  const start_block = BasicBlockData.new_stmts([statement], new Terminator(source_info, { $: "Return" }), false);

  const source = MirSourceC.item(ctor_id);
  const body = new_body(source, [start_block], local_decls, FnSigC.inputs(sig).length, span);
  // A constructor doesn't mention any other items (and we don't run the usual optimization passes
  // so this would otherwise not get filled).
  body.set_mentioned_items([]);

  // We don't pass any passes here, we just force a phase change to `Optimized`.
  // Otherwise this bit of MIR will trigger assertions trying to detect MIR with an invalid phase.
  run_passes_no_validate(tcx, body, [], { $: "Runtime", _0: "Optimized" });

  return body;
}

/// ```ignore (pseudo-impl)
/// impl FnPtr for fn(u32) {
///     fn addr(self) -> NonNull<Code> {
///         unsafe { transmute(self as *const Code)}
///     }
/// }
/// ```
// rustc: compiler/rustc_mir_transform/src/shim.rs:1083 build_fn_ptr_as_ptr_shim
function build_fn_ptr_as_ptr_shim(tcx: TyCtxt, def_id: DefId, self_ty: Ty): Body {
  assert_fn_ptr(self_ty);

  const span = tcx.def_span(def_id);
  const nonnull_did = tcx.require_lang_item(LangItem.NonNull, span);
  const code_did = tcx.require_lang_item(LangItem.Code, span);
  const nonnull_ty = Unnormalized.skip_norm_wip(
    EarlyBinder.instantiate(
      tcx.type_of(nonnull_did) as EarlyBinder<Ty>,
      tcx,
      [GenericArg.from_Ty(Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.type_of(code_did) as EarlyBinder<Ty>)))],
      fold_Ty,
    ),
  );

  const sig = Binder.no_bound_vars(
    Unnormalized.skip_norm_wip(
      EarlyBinder.instantiate(tcx.fn_sig(def_id) as EarlyBinder<Binder<FnSig>>, tcx, [GenericArg.from_Ty(self_ty)], fold_Binder(fold_FnSig)),
    ),
    fold_FnSig,
  );
  if (sig === undefined) {
    return span_bug(span, `FnPtr::as_ptr with bound vars for \`${display_Ty(self_ty)}\``);
  }
  const locals = local_decls_for_sig(sig, span);

  const source_info = SourceInfo.outermost(span);

  const statements: Statement[] = [];
  // FIXME: use `expose_provenance` once we figure out whether function pointers have meaningful
  // provenance.
  const raw_unit_ptr = TyC.new_imm_ptr(tcx, tcx.types.unit);
  const cast_to_raw_rvalue = {
    $: "Cast" as const,
    _0: { $: "FnPtrToPtr" as const },
    _1: { $: "Move" as const, _0: Place_from_Local(Local.arg(0)) },
    _2: raw_unit_ptr,
  };
  const raw_ptr_local = Local.new(locals.length);
  locals.push(LocalDecl.with_source_info(raw_unit_ptr, clone_SourceInfo(source_info)));
  const raw_ptr = Place_from_Local(raw_ptr_local);
  statements.push(Statement.new(clone_SourceInfo(source_info), { $: "Assign", _0: [raw_ptr, cast_to_raw_rvalue] }));

  const transmute_to_nonnull = {
    $: "Cast" as const,
    _0: { $: "Transmute" as const },
    _1: { $: "Move" as const, _0: raw_ptr },
    _2: nonnull_ty,
  };
  statements.push(Statement.new(clone_SourceInfo(source_info), { $: "Assign", _0: [PlaceC.return_place(), transmute_to_nonnull] }));

  const start_block = BasicBlockData.new_stmts(statements, new Terminator(clone_SourceInfo(source_info), TerminatorKind.Return), false);
  const source = MirSourceC.from_shim({ $: "FnPtrAsPtr", _0: def_id, _1: self_ty });
  return new_body(source, [start_block], locals, FnSigC.inputs(sig).length, span);
}

// rustc: compiler/rustc_mir_transform/src/shim.rs:1138 build_fn_ptr_from_ptr_shim
function build_fn_ptr_from_ptr_shim(tcx: TyCtxt, def_id: DefId, self_ty: Ty): Body {
  assert_fn_ptr(self_ty);

  const span = tcx.def_span(def_id);

  const sig = Binder.no_bound_vars(
    Unnormalized.skip_norm_wip(
      EarlyBinder.instantiate(tcx.fn_sig(def_id) as EarlyBinder<Binder<FnSig>>, tcx, [GenericArg.from_Ty(self_ty)], fold_Binder(fold_FnSig)),
    ),
    fold_FnSig,
  );
  if (sig === undefined) {
    return span_bug(span, `FnPtr::as_ptr with bound vars for \`${display_Ty(self_ty)}\``);
  }
  const locals = local_decls_for_sig(sig, span);

  const source_info = SourceInfo.outermost(span);

  const statements: Statement[] = [];
  const transmute_to_self = {
    $: "Cast" as const,
    _0: { $: "Transmute" as const },
    _1: { $: "Move" as const, _0: Place_from_Local(Local.arg(0)) },
    _2: self_ty,
  };
  statements.push(Statement.new(clone_SourceInfo(source_info), { $: "Assign", _0: [PlaceC.return_place(), transmute_to_self] }));

  const start_block = BasicBlockData.new_stmts(statements, new Terminator(clone_SourceInfo(source_info), TerminatorKind.Return), false);
  const source = MirSourceC.from_shim({ $: "FnPtrFromPtr", _0: def_id, _1: self_ty });
  return new_body(source, [start_block], locals, FnSigC.inputs(sig).length, span);
}

/** PORT: `assert_matches!(self_ty.kind(), ty::FnPtr(..), "expected fn ptr, found {self_ty}")` (core's message with
 *  args: `assertion \`left matches right\` failed: {args}` + the two sides; `left` is the kind's `{:?}`, which is the
 *  `Ty`'s `{:?}` without `with_no_trimmed_paths!`). */
function assert_fn_ptr(self_ty: Ty): void {
  if (self_ty.kind().$ !== "FnPtr") {
    panic(
      `assertion \`left matches right\` failed: expected fn ptr, found ${display_Ty(self_ty)}\n  left: ${debug_Ty(self_ty, PLAIN)}\n right: ty::FnPtr(..)`,
    );
  }
}

// rustc: compiler/rustc_mir_transform/src/shim.rs:1173 build_construct_coroutine_by_move_shim
function build_construct_coroutine_by_move_shim(tcx: TyCtxt, coroutine_closure_def_id: DefId, receiver_by_ref: boolean): Body {
  let self_ty = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.type_of(coroutine_closure_def_id) as EarlyBinder<Ty>));
  let self_local: Place = Place_from_Local(Local.arg(0));
  const self_kind = self_ty.kind();
  if (self_kind.$ !== "CoroutineClosure") {
    return bug();
  }
  const args = self_kind._1;

  // We use `&Self` here because we only need to emit an ABI-compatible shim body,
  // rather than match the signature exactly (which might take `&mut self` instead).
  //
  // We adjust the `self_local` to be a deref since we want to copy fields out of
  // a reference to the closure.
  if (receiver_by_ref) {
    self_local = tcx.mk_place_deref(self_local);
    self_ty = TyC.new_imm_ref(tcx, tcx.lifetimes.re_erased, self_ty);
  }

  const cc_args = args.as_coroutine_closure();
  const poly_sig = Binder.map_bound(CoroutineClosureArgs.coroutine_closure_sig(cc_args), (sig) =>
    tcx.mk_fn_sig(
      [self_ty, ...sig.tupled_inputs_ty.tuple_fields()],
      CoroutineClosureSignature.to_coroutine_given_kind_and_upvars(
        sig,
        tcx,
        CoroutineClosureArgs.parent_args(cc_args),
        tcx.coroutine_for_closure(coroutine_closure_def_id),
        "FnOnce",
        tcx.lifetimes.re_erased,
        CoroutineClosureArgs.tupled_upvars_ty(cc_args),
        CoroutineClosureArgs.coroutine_captures_by_ref_ty(cc_args),
      ),
      sig.fn_sig_kind,
    ),
  );
  const sig = tcx.liberate_late_bound_regions(coroutine_closure_def_id, poly_sig, fold_FnSig);
  const out_kind = FnSigC.output(sig).kind();
  if (out_kind.$ !== "Coroutine") {
    return bug();
  }
  const coroutine_def_id = out_kind._0;
  const coroutine_args = out_kind._1;

  const span = tcx.def_span(coroutine_closure_def_id);
  const locals = local_decls_for_sig(sig, span);

  const fields: Operand[] = [];

  // Move all of the closure args.
  for (let idx = 1; idx < FnSigC.inputs(sig).length; idx++) {
    fields.push({ $: "Move", _0: Place_from_Local(Local.arg(idx)) });
  }

  CoroutineClosureArgs.upvar_tys(cc_args).forEach((ty, idx) => {
    if (receiver_by_ref) {
      // The only situation where it's possible is when we capture immuatable references,
      // since those don't need to be reborrowed with the closure's env lifetime. Since
      // references are always `Copy`, just emit a copy.
      const k = ty.kind();
      if (!(k.$ === "Ref" && k._2 === "Not")) {
        // This copy is only sound if it's a `&T`. This may be
        // reachable e.g. when eagerly computing the `Fn` instance
        // of an async closure that doesn't borrowck.
        tcx
          .dcx()
          .delayed_bug(`field should be captured by immutable ref if we have an \`Fn\` instance, but it was: ${display_Ty(ty)}`);
      }
      fields.push({ $: "Copy", _0: tcx.mk_place_field(self_local, FieldIdx.from_usize(idx), ty) });
    } else {
      fields.push({ $: "Move", _0: tcx.mk_place_field(self_local, FieldIdx.from_usize(idx), ty) });
    }
  });

  const source_info = SourceInfo.outermost(span);
  const rvalue = {
    $: "Aggregate" as const,
    _0: { $: "Coroutine" as const, _0: coroutine_def_id, _1: coroutine_args },
    _1: fields,
  };
  const stmt = Statement.new(clone_SourceInfo(source_info), { $: "Assign", _0: [PlaceC.return_place(), rvalue] });
  const statements = [stmt];
  const start_block = BasicBlockData.new_stmts(statements, new Terminator(clone_SourceInfo(source_info), TerminatorKind.Return), false);

  const source = MirSourceC.from_shim({ $: "ConstructCoroutineInClosure", coroutine_closure_def_id, receiver_by_ref });

  const body = new_body(source, [start_block], locals, FnSigC.inputs(sig).length, span);

  const pass_name = receiver_by_ref ? "coroutine_closure_by_ref" : "coroutine_closure_by_move";
  const dumper = MirDumper.new(tcx, pass_name, body);
  if (dumper !== undefined) {
    dumper.dump_mir(body);
  }

  return body;
}

// ---- PORT stand-ins for items of other files that are not ported yet ----------------------------------------------
// Not markers. The owning lanes repoint them at their ports (see the header).

/** PORT: stand-in for `elaborate_drop::DropFlagMode` (elaborate_drop.rs:43, lane mt-drops). */
export type DropFlagMode = "Shallow" | "Deep";
/** PORT: stand-in for `elaborate_drop::DropStyle` (elaborate_drop.rs:22, lane mt-drops). */
export type DropStyle = "Dead" | "Static" | "Conditional" | "Open";
/** PORT: stand-in for `elaborate_drop::Unwind` (elaborate_drop.rs:52, lane mt-drops). */
export type Unwind = { readonly $: "To"; _0: BasicBlock } | { readonly $: "InCleanup" };

/** PORT: stand-in for `elaborate_drop::elaborate_drop` (elaborate_drop.rs:166, lane mt-drops); `path` is `()` (`null`). */
export function elaborate_drop(
  _elaborator: DropShimElaborator,
  _source_info: SourceInfo,
  _place: Place,
  _path: null,
  _succ: BasicBlock,
  _unwind: Unwind,
  _bb: BasicBlock,
  _dropline: BasicBlock | undefined,
): void {
  return unported("rustc_mir_transform::elaborate_drop::elaborate_drop (lane mt-drops)");
}

/** PORT: stand-in for `deref_separator::deref_finder` (deref_separator.rs, lane mt-cleanup). */
export function deref_finder(_tcx: TyCtxt, _body: Body, _storage_to_remove: boolean): void {
  return unported("rustc_mir_transform::deref_separator::deref_finder (lane mt-cleanup)");
}
