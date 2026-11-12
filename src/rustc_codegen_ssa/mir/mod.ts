// Port of compiler/rustc_codegen_ssa/src/mir/mod.rs (lane ssa-mir-core, plan-m7 wave 41): `FunctionCx`, `LocalRef`,
// `IntrinsicResult`, `codegen_mir`, `optimize_use_clone`, `arg_local_refs`, `find_cold_blocks`; plus locals.rs's
// `impl FunctionCx { initialize_locals, overwrite_local }` in the class body (locals.ts header).
//
// Conventions (ssa-contract, docs/handoff/ssa-contract.md):
// - `FunctionCx<'a, 'tcx, Bx: BuilderMethods>` is `FunctionCx<B, Cx, Bx>`: `Bx::Value` is `B["Value"]`, `Bx::CodegenCx` is
//   `Cx`. `HasTyCtxt::tcx()` / `HasTypingEnv::typing_env()` are `tcx_()` / `typing_env_()`.
// - PORT: `Bx::build` / `Bx::append_block` (no `self`) go through `Bx_: BuilderMethodsStatic<B, Cx, Bx>`, the builder
//   class's static side (ssa-contract PORT 4). `codegen_mir` takes it as its first parameter, and `FunctionCx` keeps it
//   as a trailing field `Bx_` (not upstream) because `codegen_block` (mir/block.rs) calls `Bx::build(self.cx, llbb)`.
// - PORT: `monomorphize<T>` takes the `TypeFoldable` table of `T` (`d_T`), as `instantiate_mir_and_normalize_erasing_regions`
//   does (plan-m4 D4).
// - `debug!` and `#[instrument(level = "debug")]` are compiled out of rustc (STATIC_MAX_LEVEL = INFO,
//   rust_ts/tracing.ts) and stay comments; locals.rs's `warn!` is live.
// - `IndexVec<BasicBlock, T>` / `IndexVec<Local, T>` are arrays indexed by the handle (PORTING §5).
//
// PORT (ssa-mir-core): calls into fill lanes that have not landed (ssa-operand-place, ssa-debuginfo, ssa-block, ssa-base,
// and retag.rs) go through the `xlane` table at the end of this file. Each entry is a typed stub that stops with
// `unported("<lane>: <upstream path> <fn>")`. They are not prototype methods or class statics, so they cannot collide
// with the owners' real ports at merge: root repoints each entry (or its call sites) when the owner lands. Tests may
// replace entries to drive `codegen_mir` over a mock backend.
// Load order: rustc_target through its crate root first. spec/mod.ts imports lib.ts, which evaluates spec/json.ts and
// target_features.ts, and both read spec/mod.ts's bindings at their top level: entered from spec/mod.ts, the cycle reads `Os`
// before it exists (as rustc_mir_transform remove_noop_landing_pads.ts).
import "../../rustc_target/lib.ts";
import { Size_cmp, TyAndLayout as abi_TyAndLayout } from "../../rustc_abi/lib.ts";
import { DenseBitSet } from "../../rustc_index/bit_set.ts";
import { CodegenFnAttrFlags, TyCtxt_codegen_instance_attrs } from "../../rustc_middle/middle/codegen_fn_attrs.ts";
import {
  type BasicBlock,
  type Body,
  clone_Body,
  clone_Place,
  fold_with_Body,
  type Local,
  Operand,
  type PlaceRef as mir_PlaceRef,
  RETURN_PLACE,
  START_BLOCK,
  Statement,
  TerminatorKind,
  traversal,
  try_fold_with_Body,
  type UnwindTerminateReason,
  visit_with_Body,
} from "../../rustc_middle/mir/mod.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { Ty } from "../../rustc_middle/ty/decls.ts";
import { fold_GenericArgs } from "../../rustc_middle/ty/generic_args.ts";
import { debug_Instance, Instance, InstanceKind } from "../../rustc_middle/ty/instance.ts";
import type { TyAndLayout } from "../../rustc_middle/ty/layout.ts";
import { RawList } from "../../rustc_middle/ty/list.ts";
import { debug_Ty, fold_Ty } from "../../rustc_middle/ty/structural_impls.ts";
import type { Size } from "../../rustc_abi/lib.ts";
import { bug, span_bug } from "../../rustc_span/macros.ts";
import type { ErrorGuaranteed } from "../../rustc_span/lib.ts";
import type { CastTarget, FnAbi, PassMode } from "../../rustc_target/callconv/mod.ts";
import { debug_PassMode } from "../../rustc_target/callconv/mod.ts";
import type { Target as TargetSpec } from "../../rustc_target/spec/mod.ts";
import { EarlyBinder } from "../../rustc_type_ir/binder.ts";
import type { TypeFoldable } from "../../rustc_type_ir/fold.ts";
import { TypeVisitableExt } from "../../rustc_type_ir/visit.ts";
import * as tracing from "../../rust_ts/tracing.ts";
import { PLAIN } from "../../std/fmt.ts";
import type { MutRef } from "../../std/mut_ref.ts";
import { assert, panic, unported, unwrap } from "../../std/panic.ts";
import type { BackendTypes } from "../traits/backend.ts";
import type { BuilderMethods, BuilderMethodsStatic } from "../traits/builder.ts";
import type { CodegenMethods } from "../traits/mod.ts";
import * as analyze from "./analyze.ts";
import { Locals } from "./locals.ts";
import { install_FunctionCx_operand, OperandRef, OperandValue } from "./operand.ts";
import { install_FunctionCx_place, PlaceRef } from "./place.ts";

// mod analyze; mod block; mod constant; mod coverageinfo; pub mod debuginfo; mod intrinsic; mod locals;
// pub mod naked_asm; pub mod operand; pub mod place; mod retag; mod rvalue; mod statement;
// pub use self::block::store_cast;   (PORT: re-exported by mir/block.ts's lane, ssa-block, once it exists)

// Used for tracking the state of generated basic blocks.
export type CachedLlbb<T> =
  /// Nothing created yet.
  | { readonly $: "None" }

  /// Has been created.
  | { readonly $: "Some"; readonly _0: T }

  /// Nothing created yet, and nothing should be.
  | { readonly $: "Skip" };
export const CachedLlbb = {
  None: Object.freeze({ $: "None" }) as { readonly $: "None" },
  Skip: Object.freeze({ $: "Skip" }) as { readonly $: "Skip" },
} as const;

// PORT (ssa-mir-core): `debuginfo::{FunctionDebugContext, PerLocalVarDebugInfo}` and `ConstDebugInfo` (mir/debuginfo.rs,
// lane ssa-debuginfo) are not in debuginfo.ts yet. They are opaque placeholders here, never constructed by this lane;
// ssa-debuginfo replaces them with imports of its types.
declare const __ssa_debuginfo: unique symbol;
export type FunctionDebugContext<_S, _L> = { readonly [__ssa_debuginfo]: "FunctionDebugContext" };
export type PerLocalVarDebugInfo<_D> = { readonly [__ssa_debuginfo]: "PerLocalVarDebugInfo" };
export type ConstDebugInfo<_B extends BackendTypes> = { readonly [__ssa_debuginfo]: "ConstDebugInfo" };

type PerLocalVarDebugInfoIndexVec<V> = PerLocalVarDebugInfo<V>[][];

/// Master context for codegenning from MIR.
export class FunctionCx<B extends BackendTypes, Cx extends CodegenMethods<B> = CodegenMethods<B>, Bx extends BuilderMethods<B, Cx> = BuilderMethods<B, Cx>> {
  constructor(
    public instance: Instance,

    public mir: Body,

    public debug_context: FunctionDebugContext<B["DIScope"], B["DILocation"]> | undefined,

    public llfn: B["Function"],

    public cx: Cx,

    public fn_abi: FnAbi<Ty>,

    /// When unwinding is initiated, we have to store this personality
    /// value somewhere so that we can load it and re-use it in the
    /// resume instruction. The personality is (afaik) some kind of
    /// value used for C++ unwinding, which must filter by type: we
    /// don't really care about it very much. Anyway, this value
    /// contains an alloca into which the personality is stored and
    /// then later loaded when generating the DIVERGE_BLOCK.
    public personality_slot: PlaceRef<B["Value"]> | undefined,

    /// A backend `BasicBlock` for each MIR `BasicBlock`, created lazily
    /// as-needed (e.g. RPO reaching it or another block branching to it).
    // FIXME(eddyb) rename `llbbs` and other `ll`-prefixed things to use a
    // more backend-agnostic prefix such as `cg` (i.e. this would be `cgbbs`).
    public cached_llbbs: CachedLlbb<B["BasicBlock"]>[],

    /// The funclet status of each basic block
    public cleanup_kinds: analyze.CleanupKind[] | undefined,

    /// When targeting MSVC, this stores the cleanup info for each funclet BB.
    /// This is initialized at the same time as the `landing_pads` entry for the
    /// funclets' head block, i.e. when needed by an unwind / `cleanup_ret` edge.
    public funclets: (B["Funclet"] | undefined)[],

    /// This stores the cached landing/cleanup pad block for a given BB.
    // FIXME(eddyb) rename this to `eh_pads`.
    public landing_pads: (B["BasicBlock"] | undefined)[],

    /// Cached unreachable block
    public unreachable_block: B["BasicBlock"] | undefined,

    /// Cached terminate upon unwinding block and its reason. For non-wasm
    /// targets, there is at most one such block per function, stored at index
    /// `START_BLOCK`. For wasm targets, each funclet needs its own terminate
    /// block, indexed by the cleanup block that is the funclet's head.
    public terminate_blocks: ([B["BasicBlock"], UnwindTerminateReason] | undefined)[],

    /// A bool flag for each basic block indicating whether it is a cold block.
    /// A cold block is a block that is unlikely to be executed at runtime.
    public cold_blocks: boolean[],

    public nop_landing_pads: DenseBitSet<BasicBlock>,

    /// The location where each MIR arg/var/tmp/ret is stored. This is
    /// usually an `PlaceRef` representing an alloca, but not always:
    /// sometimes we can skip the alloca and just store the value
    /// directly using an `OperandRef`, which makes for tighter LLVM
    /// IR. The conditions for using an `OperandRef` are as follows:
    ///
    /// - the type of the local must be judged "immediate" by `is_llvm_immediate`
    /// - the operand must never be referenced indirectly
    ///     - we should not take its address using the `&` operator
    ///     - nor should it appear in a place path like `tmp.a`
    /// - the operand must be defined by an rvalue that can generate immediate
    ///   values
    ///
    /// Avoiding allocs can also be important for certain intrinsics,
    /// notably `expect`.
    public locals: Locals<B["Value"]>,

    /// All `VarDebugInfo` from the MIR body, partitioned by `Local`.
    /// This is `None` if no variable debuginfo/names are needed.
    public per_local_var_debug_info: PerLocalVarDebugInfoIndexVec<B["DIVariable"]> | undefined,

    /// Caller location propagated if this function has `#[track_caller]`.
    public caller_location: OperandRef<B["Value"]> | undefined,

    /** PORT: not upstream; the static side of `Bx` (`Bx::build`, `Bx::append_block`), header. */
    public Bx_: BuilderMethodsStatic<B, Cx, Bx>,
  ) {}

  // rustc: compiler/rustc_codegen_ssa/src/mir/mod.rs:133 monomorphize
  monomorphize<T>(value: T, d_T: TypeFoldable<T>): T {
    // debug!("monomorphize: self.instance={:?}", self.instance);
    return Instance.instantiate_mir_and_normalize_erasing_regions(
      this.instance,
      this.cx.tcx_(),
      this.cx.typing_env_(),
      EarlyBinder.bind(this.cx.tcx_(), value, d_T),
      d_T,
    );
  }

  // ---- impl FunctionCx (locals.rs:40; PORTING §8 clarification 1, locals.ts header) ----

  // rustc: compiler/rustc_codegen_ssa/src/mir/locals.rs:41 initialize_locals
  initialize_locals(values: LocalRef<B["Value"]>[]): void {
    assert(this.locals.values.length === 0, "assertion failed: self.locals.values.is_empty()");
    this.locals.values = values;
    // FIXME(#115215): After #115025 get's merged this might not be necessary
    for (let local = 0; local < this.locals.values.length; local++) {
      const value = this.locals.values[local]!;
      switch (value.$) {
        case "Place":
        case "UnsizedPlace":
        case "PendingOperand":
          break;
        case "Operand": {
          const op = value._0;
          const expected_ty = this.monomorphize(this.mir.local_decls[local]!.ty, fold_Ty);
          if (expected_ty !== op.layout.ty) {
            tracing.warn(
              "rustc_codegen_ssa::mir::locals",
              () =>
                `Unexpected initial operand type:\nexpected ${debug_Ty_plain(expected_ty)},\nfound    ${debug_Ty_plain(op.layout.ty)}.\nSee <https://github.com/rust-lang/rust/issues/114858>.`,
            );
          }
          break;
        }
      }
    }
  }

  // rustc: compiler/rustc_codegen_ssa/src/mir/locals.rs:62 overwrite_local
  overwrite_local(local: Local, value: LocalRef<B["Value"]>): void {
    switch (value.$) {
      case "Place":
      case "UnsizedPlace":
      case "PendingOperand":
        break;
      case "Operand": {
        const op = value._0;
        const local_ty = this.monomorphize(this.mir.local_decls[local]!.ty, fold_Ty);
        if (local_ty !== op.layout.ty) {
          // FIXME(#112651): This can be changed to an ICE afterwards.
          // debug!("updating type of operand due to subtyping");
          // with_no_trimmed_paths!(debug!(?op.layout.ty));
          // with_no_trimmed_paths!(debug!(?local_ty));
          // PORT: `op.layout.ty = local_ty` on the local copy of the `Copy` `OperandRef`: a new `TyAndLayout` and
          // `OperandRef` (their fields are not written in place, docs/reviews/ssa-contract.md N5).
          value = {
            $: "Operand",
            _0: new OperandRef(op.val, new abi_TyAndLayout<Ty>(local_ty, op.layout.layout), op.move_annotation),
          };
        }
        break;
      }
    }

    this.locals.values[local] = value;
  }
}
// PORT (ssa-operand-place, root at integ-w53): place.rs's and operand.rs's `impl FunctionCx` blocks are installed here,
// right after the class, so that the methods exist whichever of the three files loads first.
install_FunctionCx_operand(FunctionCx);
install_FunctionCx_place(FunctionCx);

export type LocalRef<V> =
  | { readonly $: "Place"; readonly _0: PlaceRef<V> }
  /// `UnsizedPlace(p)`: `p` itself is a thin pointer (indirect place).
  /// `*p` is the wide pointer that references the actual unsized place.
  ///
  /// MIR only supports unsized args, not dynamically-sized locals, so
  /// new unsized temps don't exist and we must reuse the referred-to place.
  ///
  /// FIXME: Since the removal of unsized locals in <https://github.com/rust-lang/rust/pull/142911>,
  /// can we maybe use `Place` here? Or refactor it in another way? There are quite a few
  /// `UnsizedPlace => bug` branches now.
  | { readonly $: "UnsizedPlace"; readonly _0: PlaceRef<V> }
  /// The backend [`OperandValue`] has already been generated.
  | { readonly $: "Operand"; readonly _0: OperandRef<V> }
  /// Will be a `Self::Operand` once we get to its definition.
  | { readonly $: "PendingOperand" };

export type IntrinsicResult<V> =
  /// This intrinsic created an operand without using the `result_place` argument.
  ///
  /// `codegen_call_terminator` will handle writing the result into the place,
  /// if doing so is needed.
  ///
  /// The vast majority of intrinsics can do this, see MCP#970
  | { readonly $: "Operand"; _0: OperandValue<V> }

  /// The intrinsic wrote its result into the `result_place` argument.
  ///
  /// Most things don't need to do this, but there are some: `volatile_load`
  /// of a non-scalar type, for example, has to.
  | { readonly $: "WroteIntoPlace" }

  /// Another instance should be called instead. This is used to invoke intrinsic
  /// default bodies in case an intrinsic is not implemented by the backend.
  | { readonly $: "Fallback"; _0: Instance }

  /// Arguably this shouldn't exist, per MCP#620, but a bunch do it.
  | { readonly $: "Err"; _0: ErrorGuaranteed };
export const IntrinsicResult = {
  /** Shared frozen singleton of the unit variant (PORTING §5; docs/reviews/ssa-contract.md N2). */
  WroteIntoPlace: Object.freeze({ $: "WroteIntoPlace" }) as { readonly $: "WroteIntoPlace" },
} as const;

export const LocalRef = {
  /** Shared frozen singleton of the unit variant (PORTING §5). */
  PendingOperand: Object.freeze({ $: "PendingOperand" }) as { readonly $: "PendingOperand" },

  // impl<'tcx, V: CodegenObject> LocalRef<'tcx, V>
  // rustc: compiler/rustc_codegen_ssa/src/mir/mod.rs:188 new_operand
  new_operand<V>(layout: TyAndLayout): LocalRef<V> {
    if (layout.is_zst()) {
      // Zero-size temporaries aren't always initialized, which
      // doesn't matter because they don't contain data, but
      // we need something sufficiently aligned in the operand.
      return { $: "Operand", _0: OperandRef.zero_sized<V>(layout) };
    } else {
      return LocalRef.PendingOperand;
    }
  },
} as const;

///////////////////////////////////////////////////////////////////////////

// #[instrument(level = "debug", skip(cx))]
// rustc: compiler/rustc_codegen_ssa/src/mir/mod.rs:203 codegen_mir
export function codegen_mir<B extends BackendTypes, Cx extends CodegenMethods<B>, Bx extends BuilderMethods<B, Cx>>(
  Bx_: BuilderMethodsStatic<B, Cx, Bx>,
  cx: Cx,
  instance: Instance,
): void {
  assert(!TypeVisitableExt.has_infer(instance.args, fold_GenericArgs), "assertion failed: !instance.args.has_infer()");

  const tcx = cx.tcx_();
  const llfn = cx.get_fn(instance);

  let mir = tcx.instance_mir(instance.def);
  // Note that the ABI logic has deduced facts about the functions' parameters based on the MIR we
  // got here (`deduce_param_attrs`). That means we can *not* apply arbitrary further MIR
  // transforms as that may invalidate those deduced facts!

  const fn_abi = cx.fn_abi_of_instance(instance, RawList.empty());
  // debug!("fn_abi: {:?}", fn_abi);

  // PORT: hooks are typed `unknown` in rustc_middle/hooks.ts; this one returns `DenseBitSet<BasicBlock>`
  // (rustc_mir_transform remove_noop_landing_pads.ts).
  const nop_landing_pads = tcx.find_noop_landing_pads_for_instance(mir, instance, cx.typing_env_()) as DenseBitSet<BasicBlock>;

  if (tcx.features().ergonomic_clones()) {
    const monomorphized_mir = Instance.instantiate_mir_and_normalize_erasing_regions(
      instance,
      tcx,
      cx.typing_env_(),
      EarlyBinder.bind(tcx, clone_Body(mir), Body_foldable),
      Body_foldable,
    );
    // PORT: the arena allocation is the value.
    mir = optimize_use_clone<B, Cx>(cx, monomorphized_mir);
  }

  const start_llbb = Bx_.append_block(cx, llfn, "start");
  const start_bx = Bx_.build(cx, start_llbb);

  // PORT: `Iterator::any` over `mono_reachable`, stopping at the first match.
  let any = false;
  for (const it = traversal.mono_reachable(mir, tcx, instance); ; ) {
    const r = it.next();
    if (r.done) break;
    const [bb, block] = r.value;
    const unwind = block.terminator_().unwind();
    if ((block.is_cleanup && !nop_landing_pads.contains(bb)) || (unwind !== undefined && unwind.$ === "Terminate")) {
      any = true;
      break;
    }
  }
  if (any) {
    start_bx.set_personality_fn(cx.eh_personality());
  }

  const cleanup_kinds = xlane.wants_new_eh_instructions(tcx.sess.target) ? analyze.cleanup_kinds(mir, nop_landing_pads) : undefined;

  const cached_llbbs: CachedLlbb<B["BasicBlock"]>[] = mir.basic_blocks
    .deref()
    .map((_, bb) => (bb === START_BLOCK ? { $: "Some", _0: start_llbb } : CachedLlbb.None));

  // PORT: the struct literal's fields are evaluated in upstream's order (only `find_cold_blocks` has effects), then
  // passed in declaration order.
  const n_blocks = mir.basic_blocks.deref().length;
  const terminate_blocks: ([B["BasicBlock"], UnwindTerminateReason] | undefined)[] = new Array(n_blocks).fill(undefined);
  const landing_pads: (B["BasicBlock"] | undefined)[] = new Array(n_blocks).fill(undefined);
  const funclets: (B["Funclet"] | undefined)[] = Array.from({ length: n_blocks }, () => undefined);
  const cold_blocks = find_cold_blocks(tcx, mir);
  const fx = new FunctionCx<B, Cx, Bx>(
    /* instance */ instance,
    /* mir */ mir,
    /* debug_context */ undefined,
    /* llfn */ llfn,
    /* cx */ cx,
    /* fn_abi */ fn_abi,
    /* personality_slot */ undefined,
    /* cached_llbbs */ cached_llbbs,
    /* cleanup_kinds */ cleanup_kinds,
    /* funclets */ funclets,
    /* landing_pads */ landing_pads,
    /* unreachable_block */ undefined,
    /* terminate_blocks */ terminate_blocks,
    /* cold_blocks */ cold_blocks,
    /* nop_landing_pads */ nop_landing_pads,
    /* locals */ Locals.empty(),
    /* per_local_var_debug_info */ undefined,
    /* caller_location */ undefined,
    /* Bx_ */ Bx_,
  );

  // It may seem like we should iterate over `required_consts` to ensure they all successfully
  // evaluate; however, the `MirUsedCollector` already did that during the collection phase of
  // monomorphization, and if there is an error during collection then codegen never starts -- so
  // we don't have to do it again.

  xlane.fill_function_debug_context(fx, start_bx);

  const unzipped = xlane.compute_per_local_var_debug_info(fx, start_bx);
  const per_local_var_debug_info = unzipped === undefined ? undefined : unzipped[0];
  const consts_debug_info = unzipped === undefined ? undefined : unzipped[1];
  fx.per_local_var_debug_info = per_local_var_debug_info;

  let traversal_order: BasicBlock[] = traversal.mono_reachable_reverse_postorder(mir, tcx, instance);

  // Filter out blocks that won't be codegen'd because of nop_landing_pads optimization.
  // FIXME: We might want to integrate the nop_landing_pads analysis into mono reachability.
  {
    const reachable = DenseBitSet.new_empty<BasicBlock>(mir.basic_blocks.deref().length);
    const to_visit: BasicBlock[] = [START_BLOCK];
    for (;;) {
      const next = to_visit.pop();
      if (next === undefined) break;
      if (!reachable.insert(next)) {
        continue;
      }

      const block = mir.basic_blocks.deref()[next]!;
      const successors = block.mono_successors(tcx, instance);

      const unwind = block.terminator_().unwind();
      if (unwind !== undefined && unwind.$ === "Cleanup" && fx.nop_landing_pads.contains(unwind._0)) {
        const target = unwind._0;
        // This edge will not be followed when we actually codegen, so skip generating it here.
        //
        // It's guaranteed that the cleanup block (`target`) occurs only in
        // UnwindAction::Cleanup(...) -- i.e., we can't incorrectly filter too much here --
        // because cleanup transitions must happen via UnwindAction::Cleanup.
        for (const s of successors) if (s !== target) to_visit.push(s);
      } else {
        for (const s of successors) to_visit.push(s);
      }
    }

    traversal_order = traversal_order.filter((bb) => reachable.contains(bb));
  }

  const memory_locals = analyze.non_ssa_locals(fx, traversal_order);

  // Allocate variable and temp allocas
  let local_values: LocalRef<B["Value"]>[];
  {
    const args = arg_local_refs<B, Cx, Bx>(start_bx, fx, memory_locals);

    const allocate_local = (local: Local): LocalRef<B["Value"]> => {
      const decl = mir.local_decls[local]!;
      const layout = start_bx.layout_of(fx.monomorphize(decl.ty, fold_Ty));
      assert(!TypeVisitableExt.has_erasable_regions(layout.ty, fold_Ty), "assertion failed: !layout.ty.has_erasable_regions()");

      if (local === RETURN_PLACE) {
        const mode: PassMode = fx.fn_abi.ret.mode;
        switch (mode.$) {
          case "Indirect": {
            // debug!("alloc: {:?} (return place) -> place", local);
            const llretptr = start_bx.get_param(0);
            return { $: "Place", _0: PlaceRef.new_sized(llretptr, layout) };
          }
          case "Cast": {
            const cast: CastTarget = mode.cast;
            // debug!("alloc: {:?} (return place) -> place", local);
            const size = Ord_max_Size(cast.size(start_bx), layout.size);
            return { $: "Place", _0: PlaceRef.alloca_size(start_bx, size, layout) };
          }
          case "IndirectUnsized":
            bug("unsized returns are not supported");
          default:
            break;
        }
      }

      if (memory_locals.contains(local)) {
        // debug!("alloc: {:?} -> place", local);
        if (layout.is_unsized()) {
          return { $: "UnsizedPlace", _0: PlaceRef.alloca_unsized_indirect(start_bx, layout) };
        } else {
          return { $: "Place", _0: PlaceRef.alloca(start_bx, layout) };
        }
      } else {
        // debug!("alloc: {:?} -> operand", local);
        return LocalRef.new_operand(layout);
      }
    };

    const retptr = allocate_local(RETURN_PLACE);
    local_values = [retptr];
    for (const a of args) local_values.push(a);
    for (const local of mir.vars_and_temps_iter()) local_values.push(allocate_local(local));
  }
  fx.initialize_locals(local_values);

  // Apply debuginfo to the newly allocated locals.
  xlane.debug_introduce_locals(fx, start_bx, consts_debug_info ?? []);

  // The builders will be created separately for each basic block at `codegen_block`.
  // So drop the builder of `start_llbb` to avoid having two at the same time.
  // drop(start_bx);
  // PORT: the backend's `Drop` (cg_llvm `LLVMDisposeBuilder`) is not part of `BuilderMethods`; the generic code cannot
  // call it. The IR model's builder holds no resource that must be released here (llir-core); a backend that needs it
  // releases the builder when it is no longer referenced.

  const unreached_blocks = DenseBitSet.new_filled<BasicBlock>(mir.basic_blocks.deref().length);
  // Codegen the body of each reachable block using our reverse postorder list.
  for (const bb of traversal_order) {
    xlane.codegen_block(fx, bb);
    unreached_blocks.remove(bb);
  }

  // FIXME: These empty unreachable blocks are *mostly* a waste. They are occasionally
  // targets for a SwitchInt terminator, but the reimplementation of the mono-reachable
  // simplification in SwitchInt lowering sometimes misses cases that
  // mono_reachable_reverse_postorder manages to figure out.
  // The solution is to do something like post-mono GVN. But for now we have this hack.
  for (const bb of [...unreached_blocks.iter()]) {
    xlane.codegen_block_as_unreachable(fx, bb);
  }
}

/// Replace `clone` calls that come from `use` statements with direct copies if possible.
// FIXME: Move this function to mir::transform when post-mono MIR passes land.
// rustc: compiler/rustc_codegen_ssa/src/mir/mod.rs:391 optimize_use_clone
function optimize_use_clone<B extends BackendTypes, Cx extends CodegenMethods<B>>(cx: Cx, mir: Body): Body {
  const tcx = cx.tcx_();

  if (tcx.features().ergonomic_clones()) {
    for (const bb of mir.basic_blocks.as_mut()) {
      const kind = bb.terminator_().kind;
      if (!(kind.$ === "Call" && kind.call_source === "Use")) {
        continue;
      }
      const { args, destination, target } = kind;

      // CallSource::Use calls always use 1 argument.
      if (args.length !== 1) {
        panic(`assertion \`left == right\` failed\n  left: ${args.length}\n right: 1`);
      }
      const arg = args[0]!;

      // These types are easily available from locals, so check that before
      // doing DefId lookups to figure out what we're actually calling.
      const arg_ty = Operand.ty(arg.node, mir.local_decls, tcx);

      const arg_kind = arg_ty.kind();
      if (!(arg_kind.$ === "Ref" && arg_kind._2 === "Not")) {
        continue;
      }
      const inner_ty = arg_kind._1;

      if (!tcx.type_is_copy_modulo_regions(cx.typing_env_(), inner_ty)) {
        continue;
      }

      const arg_place = Operand.place(arg.node);
      if (arg_place === undefined) {
        continue;
      }

      const destination_block = unwrap(target);

      bb.statements.push(
        Statement.new(bb.terminator_().source_info, {
          $: "Assign",
          _0: [clone_Place(destination), { $: "Use", _0: { $: "Copy", _0: arg_place.project_deeper([{ $: "Deref" }], tcx) }, _1: "Yes" }],
        }),
      );

      bb.terminator_mut().kind = TerminatorKind.goto(destination_block);
    }
  }

  return mir;
}

/// Produces, for each argument, a `Value` pointing at the
/// argument's value. As arguments are places, these are always
/// indirect.
// rustc: compiler/rustc_codegen_ssa/src/mir/mod.rs:451 arg_local_refs
function arg_local_refs<B extends BackendTypes, Cx extends CodegenMethods<B>, Bx extends BuilderMethods<B, Cx>>(
  bx: Bx,
  fx: FunctionCx<B, Cx, Bx>,
  memory_locals: DenseBitSet<Local>,
): LocalRef<B["Value"]>[] {
  const mir = fx.mir;
  let idx = 0;
  // PORT: `llarg_idx` is passed as `&mut llarg_idx` to `store_fn_arg`, so it is a `MutRef<number>` throughout.
  const llarg_idx: MutRef<number> = { value: fx.fn_abi.ret.is_indirect() ? 1 : 0 };

  let num_untupled: number | undefined = undefined;

  const codegen_fn_attrs = TyCtxt_codegen_instance_attrs(bx.tcx_(), fx.instance.def);
  if (CodegenFnAttrFlags.contains(codegen_fn_attrs.flags, CodegenFnAttrFlags.NAKED)) {
    return [];
  }

  let args: LocalRef<B["Value"]>[] = mir.args_iter().map((local, arg_index): LocalRef<B["Value"]> => {
    const arg_decl = mir.local_decls[local]!;
    const arg_ty = fx.monomorphize(arg_decl.ty, fold_Ty);

    // FIXME(splat): re-tuple splatted arguments that were un-tupled in the ABI
    if (local === mir.spread_arg) {
      // This argument (e.g., the last argument in the "rust-call" ABI)
      // is a tuple that was spread at the ABI level and now we have
      // to reconstruct it into a tuple local variable, from multiple
      // individual LLVM function arguments.
      const arg_ty_kind = arg_ty.kind();
      if (arg_ty_kind.$ !== "Tuple") {
        bug("spread argument isn't a tuple?!");
      }
      const tupled_arg_tys = arg_ty_kind._0;

      const layout = bx.layout_of(arg_ty);

      // FIXME: support unsized params in "rust-call" ABI
      if (layout.is_unsized()) {
        span_bug(arg_decl.source_info.span, '"rust-call" ABI does not support unsized params');
      }

      const place = PlaceRef.alloca(bx, layout);
      for (let i = 0; i < tupled_arg_tys.length; i++) {
        const arg = fx.fn_abi.args[idx]!;
        idx += 1;
        if (arg.mode.$ === "Cast") {
          llarg_idx.value += arg.mode.pad_i32_count;
        }
        const pr_field = place.project_field(bx, i);
        bx.store_fn_arg(arg, llarg_idx, pr_field);
      }
      const replaced = num_untupled;
      num_untupled = tupled_arg_tys.length;
      if (replaced !== undefined) {
        panic(`assertion \`left == right\` failed: Replaced existing num_untupled\n  left: None\n right: Some(${replaced})`);
      }

      return { $: "Place", _0: place };
    }

    if (fx.fn_abi.c_variadic && arg_index === fx.fn_abi.args.length) {
      const va_list = PlaceRef.alloca(bx, bx.layout_of(arg_ty));

      // Explicitly start the lifetime of the `va_list`, improves LLVM codegen.
      bx.lifetime_start(va_list.val.llval, va_list.layout.size);

      bx.va_start(va_list.val.llval);

      return { $: "Place", _0: va_list };
    }

    const arg = fx.fn_abi.args[idx]!;
    idx += 1;
    if (arg.mode.$ === "Cast") {
      llarg_idx.value += arg.mode.pad_i32_count;
    }

    if (!memory_locals.contains(local)) {
      // We don't have to cast or keep the argument in the alloca.
      // FIXME(eddyb): We should figure out how to use llvm.dbg.value instead
      // of putting everything in allocas just so we can use llvm.dbg.declare.
      const local_ = (op: OperandRef<B["Value"]>): LocalRef<B["Value"]> => ({ $: "Operand", _0: op });
      switch (arg.mode.$) {
        case "Ignore": {
          return local_(OperandRef.zero_sized<B["Value"]>(arg.layout));
        }
        case "Direct": {
          const llarg = bx.get_param(llarg_idx.value);
          llarg_idx.value += 1;
          // debug_assert!(arg.layout.backend_repr.is_scalar_or_simd());
          return local_(new OperandRef<B["Value"]>({ $: "Immediate", _0: llarg }, arg.layout, undefined));
        }
        case "Pair": {
          const a = bx.get_param(llarg_idx.value);
          const b = bx.get_param(llarg_idx.value + 1);
          llarg_idx.value += 2;

          return local_(new OperandRef<B["Value"]>({ $: "Pair", _0: a, _1: b }, arg.layout, undefined));
        }
        default:
          break;
      }
    }

    const mode = arg.mode;
    switch (mode.$) {
      // Sized indirect arguments
      case "Indirect": {
        const attrs = mode.attrs;
        // Don't copy an indirect argument to an alloca, the caller already put it
        // in a temporary alloca and gave it up.
        // AmdgpuKernelArg/byref arguments must not be modified, so always create a
        // local alloca for them.
        // If the argument is underaligned, then we need to copy it to a higher-aligned
        // alloca.
        // FIXME: lifetimes
        let needs_alloca = mode.mode === "AmdgpuKernelArg";
        const pointee_align = attrs.pointee_align;
        // PORT: `Align`'s derived `Ord` compares its one field, `pow2`.
        if (pointee_align !== undefined && pointee_align.pow2 < arg.layout.align.abi.pow2) {
          needs_alloca = true;
        }
        if (needs_alloca) {
          const tmp = PlaceRef.alloca(bx, arg.layout);
          bx.store_fn_arg(arg, llarg_idx, tmp);
          return { $: "Place", _0: tmp };
        } else {
          const llarg = bx.get_param(llarg_idx.value);
          llarg_idx.value += 1;
          return { $: "Place", _0: PlaceRef.new_sized(llarg, arg.layout) };
        }
      }
      // Unsized indirect arguments
      case "IndirectUnsized": {
        // As the storage for the indirect argument lives during
        // the whole function call, we just copy the wide pointer.
        const llarg = bx.get_param(llarg_idx.value);
        llarg_idx.value += 1;
        const llextra = bx.get_param(llarg_idx.value);
        llarg_idx.value += 1;
        const indirect_operand: OperandValue<B["Value"]> = { $: "Pair", _0: llarg, _1: llextra };

        const tmp = PlaceRef.alloca_unsized_indirect(bx, arg.layout);
        OperandValue.store(indirect_operand, bx, tmp);
        return { $: "UnsizedPlace", _0: tmp };
      }
      default: {
        const tmp = PlaceRef.alloca(bx, arg.layout);
        bx.store_fn_arg(arg, llarg_idx, tmp);
        return { $: "Place", _0: tmp };
      }
    }
  });
  if (bx.tcx_().sess.opts.unstable_opts.codegen_emit_retag !== undefined) {
    args = args.map((arg): LocalRef<B["Value"]> => {
      switch (arg.$) {
        case "Place": {
          const place_ref = arg._0;
          xlane.codegen_retag_place(fx, bx, place_ref, true);
          return { $: "Place", _0: place_ref };
        }
        case "UnsizedPlace": {
          const place_ref = arg._0;
          const operand = bx.load_operand(place_ref);
          const retagged = xlane.codegen_retag_operand(fx, bx, operand, true);
          assert(retagged.val.$ === "Pair", "assertion failed: matches!(retagged.val, OperandValue::Pair(_, _))");
          OperandValue.store(retagged.val, bx, place_ref);
          return { $: "UnsizedPlace", _0: place_ref };
        }
        case "Operand": {
          const operand_ref = arg._0;
          const retagged = xlane.codegen_retag_operand(fx, bx, operand_ref, true);
          return { $: "Operand", _0: retagged };
        }
        case "PendingOperand":
          return LocalRef.PendingOperand;
      }
    });
    // If we branched during retagging, then we need to update the
    // start block to the new location.
    fx.cached_llbbs[START_BLOCK] = { $: "Some", _0: bx.llbb() };
  }

  if (InstanceKind.requires_caller_location(fx.instance.def, bx.tcx_())) {
    const mir_args =
      num_untupled !== undefined
        ? // Subtract off the tupled argument that gets 'expanded'
          args.length - 1 + num_untupled
        : args.length;
    if (fx.fn_abi.args.length !== mir_args + 1) {
      panic(
        `assertion \`left == right\` failed: #[track_caller] instance ${debug_Instance(fx.instance, PLAIN)} must have 1 more argument in their ABI than in their MIR\n  left: ${fx.fn_abi.args.length}\n right: ${mir_args + 1}`,
      );
    }

    const arg = unwrap(fx.fn_abi.args[fx.fn_abi.args.length - 1]);
    switch (arg.mode.$) {
      case "Direct":
        break;
      default:
        bug(`caller location must be PassMode::Direct, found ${debug_PassMode(arg.mode, PLAIN)}`);
    }

    fx.caller_location = new OperandRef<B["Value"]>({ $: "Immediate", _0: bx.get_param(llarg_idx.value) }, arg.layout, undefined);
  }

  return args;
}

// rustc: compiler/rustc_codegen_ssa/src/mir/mod.rs:668 find_cold_blocks
function find_cold_blocks(tcx: TyCtxt, mir: Body): boolean[] {
  const local_decls = mir.local_decls;

  const cold_blocks: boolean[] = mir.basic_blocks.deref().map(() => false);

  // Traverse all basic blocks from end of the function to the start.
  for (const [bb, bb_data] of traversal.postorder(mir)) {
    const terminator = bb_data.terminator_();

    const kind = terminator.kind;
    // If a BB ends with a call to a cold function, mark it as cold.
    if (kind.$ === "Call" || kind.$ === "TailCall") {
      const func_kind = Operand.ty(kind.func, local_decls, tcx).kind();
      if (func_kind.$ === "FnDef" && CodegenFnAttrFlags.contains(tcx.codegen_fn_attrs(func_kind._0).flags, CodegenFnAttrFlags.COLD)) {
        cold_blocks[bb] = true;
        continue;
      }
    }

    // If a BB ends with an `unreachable`, also mark it as cold.
    if (kind.$ === "Unreachable") {
      cold_blocks[bb] = true;
      continue;
    }

    // If all successors of a BB are cold and there's at least one of them, mark this BB as cold
    const succ = terminator.successors();
    const first = succ.next();
    if (!first.done && cold_blocks[first.value]) {
      let all = true;
      for (;;) {
        const s = succ.next();
        if (s.done) break;
        if (!cold_blocks[s.value]) {
          all = false;
          break;
        }
      }
      if (all) {
        cold_blocks[bb] = true;
      }
    }
  }

  return cold_blocks;
}

// ---- Helpers (not upstream) -------------------------------------------------------------------------------------------

/** PORT: `impl TypeFoldable for Body` (derived, mod.gen.ts) as a D4 table, for `EarlyBinder::bind(tcx, mir.clone())`
 *  (the same table as rustc_mir_transform shim.ts's `Body_foldable`, which this crate does not import). */
const Body_foldable: TypeFoldable<Body> = {
  visit_with: (self, visitor) => visit_with_Body(self, visitor),
  try_fold_with: (self, folder) => try_fold_with_Body(self, folder),
  fold_with: (self, folder) => fold_with_Body(self, folder),
};

/** `Ord::max` for `Size` (core: the second argument when equal). */
function Ord_max_Size(a: Size, b: Size): Size {
  return Size_cmp(a, b) === 1 ? a : b;
}

function debug_Ty_plain(ty: Ty): string {
  return debug_Ty(ty, PLAIN);
}

// ---- Cross-lane stubs (header) ---------------------------------------------------------------------------------------
// Each entry stands for one upstream fn of another fill lane and stops with `unported`. Methods take the receiver first.
export const xlane = {
  // ssa-base (base.rs)
  /** `base::wants_new_eh_instructions(&TargetSpec)` (base.rs:392). */
  wants_new_eh_instructions(_target: TargetSpec): boolean {
    return unported("ssa-base: compiler/rustc_codegen_ssa/src/base.rs wants_new_eh_instructions");
  },

  // retag.rs (plan-m7 §2d groups it with ssa-operand-place; docs/next.md assigns it to no lane yet)
  /** `fx.codegen_retag_place(bx, place, is_fn_entry)` (mir/retag.rs). */
  codegen_retag_place<B extends BackendTypes, Cx extends CodegenMethods<B>, Bx extends BuilderMethods<B, Cx>>(
    _fx: FunctionCx<B, Cx, Bx>,
    _bx: Bx,
    _place: PlaceRef<B["Value"]>,
    _is_fn_entry: boolean,
  ): void {
    return unported("retag: compiler/rustc_codegen_ssa/src/mir/retag.rs codegen_retag_place");
  },
  /** `fx.codegen_retag_operand(bx, operand, is_fn_entry)` (mir/retag.rs). */
  codegen_retag_operand<B extends BackendTypes, Cx extends CodegenMethods<B>, Bx extends BuilderMethods<B, Cx>>(
    _fx: FunctionCx<B, Cx, Bx>,
    _bx: Bx,
    _operand: OperandRef<B["Value"]>,
    _is_fn_entry: boolean,
  ): OperandRef<B["Value"]> {
    return unported("retag: compiler/rustc_codegen_ssa/src/mir/retag.rs codegen_retag_operand");
  },

  // ssa-debuginfo (mir/debuginfo.rs)
  /** `fx.fill_function_debug_context(&mut bx)` (mir/debuginfo.rs). */
  fill_function_debug_context<B extends BackendTypes, Cx extends CodegenMethods<B>, Bx extends BuilderMethods<B, Cx>>(
    _fx: FunctionCx<B, Cx, Bx>,
    _bx: Bx,
  ): void {
    return unported("ssa-debuginfo: compiler/rustc_codegen_ssa/src/mir/debuginfo.rs fill_function_debug_context");
  },
  /** `fx.compute_per_local_var_debug_info(&mut bx)` (mir/debuginfo.rs), `Option<(PerLocalVarDebugInfoIndexVec, Vec<ConstDebugInfo>)>`. */
  compute_per_local_var_debug_info<B extends BackendTypes, Cx extends CodegenMethods<B>, Bx extends BuilderMethods<B, Cx>>(
    _fx: FunctionCx<B, Cx, Bx>,
    _bx: Bx,
  ): [PerLocalVarDebugInfoIndexVec<B["DIVariable"]>, ConstDebugInfo<B>[]] | undefined {
    return unported("ssa-debuginfo: compiler/rustc_codegen_ssa/src/mir/debuginfo.rs compute_per_local_var_debug_info");
  },
  /** `fx.debug_introduce_locals(&mut bx, consts)` (mir/debuginfo.rs). */
  debug_introduce_locals<B extends BackendTypes, Cx extends CodegenMethods<B>, Bx extends BuilderMethods<B, Cx>>(
    _fx: FunctionCx<B, Cx, Bx>,
    _bx: Bx,
    _consts: ConstDebugInfo<B>[],
  ): void {
    return unported("ssa-debuginfo: compiler/rustc_codegen_ssa/src/mir/debuginfo.rs debug_introduce_locals");
  },

  // ssa-block (mir/block.rs)
  /** `fx.codegen_block(bb)` (mir/block.rs). */
  codegen_block<B extends BackendTypes, Cx extends CodegenMethods<B>, Bx extends BuilderMethods<B, Cx>>(_fx: FunctionCx<B, Cx, Bx>, _bb: BasicBlock): void {
    return unported("ssa-block: compiler/rustc_codegen_ssa/src/mir/block.rs codegen_block");
  },
  /** `fx.codegen_block_as_unreachable(bb)` (mir/block.rs). */
  codegen_block_as_unreachable<B extends BackendTypes, Cx extends CodegenMethods<B>, Bx extends BuilderMethods<B, Cx>>(
    _fx: FunctionCx<B, Cx, Bx>,
    _bb: BasicBlock,
  ): void {
    return unported("ssa-block: compiler/rustc_codegen_ssa/src/mir/block.rs codegen_block_as_unreachable");
  },
};
