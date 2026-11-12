//! An analysis to determine which locals require allocas and
//! which do not.
// Port of compiler/rustc_codegen_ssa/src/mir/analyze.rs (lane ssa-mir-core, plan-m7 wave 41).
//
// PORT: `LocalAnalyzer` implements `Visitor` as a subclass (rustc_middle mir/visit.ts D4). `debug!` events are compiled
// out of rustc (STATIC_MAX_LEVEL = INFO, rust_ts/tracing.ts) and stay comments. The nested fns of `cleanup_kinds`
// (`discover_masters`, `propagate`) are module-level fns placed where upstream nests them.
// PORT: `self.fx.monomorphized_place_ty(..)` (mir/place.rs, lane ssa-operand-place) goes through mod.ts's `xlane` stub
// table until that lane lands; the import of mod.ts is a run-time cycle that is safe, as neither module touches the
// other's bindings at load time.
import type { Dominators } from "../../rustc_data_structures/graph/dominators/mod.ts";
import { DenseBitSet } from "../../rustc_index/bit_set.ts";
import {
  type BasicBlock,
  type BasicBlockData,
  type Body,
  DefLocation,
  type Local,
  type Location,
  type Place,
  Operand,
  type PlaceRef as mir_PlaceRef,
  PlaceRef_from_Local,
  type Rvalue,
  type StmtDebugInfo,
  traversal,
} from "../../rustc_middle/mir/mod.ts";
import { MutatingUseContext, NonMutatingUseContext, PlaceContext, Visitor } from "../../rustc_middle/mir/visit.ts";
import { bug, span_bug } from "../../rustc_span/macros.ts";
import { debug_BasicBlock } from "../../rustc_middle/mir/mod.ts";
import { PLAIN } from "../../std/fmt.ts";
import { FieldIdx } from "../../rustc_abi/lib.ts";
import type { TyAndLayout } from "../../rustc_middle/ty/layout.ts";
import type { BackendTypes } from "../traits/backend.ts";
import type { BuilderMethods } from "../traits/builder.ts";
import type { CodegenMethods } from "../traits/mod.ts";
import { type FunctionCx, xlane } from "./mod.ts";
import { fold_Ty } from "../../rustc_middle/ty/structural_impls.ts";

// rustc: compiler/rustc_codegen_ssa/src/mir/analyze.rs:18 non_ssa_locals
export function non_ssa_locals<B extends BackendTypes, Cx extends CodegenMethods<B>, Bx extends BuilderMethods<B, Cx>>(
  fx: FunctionCx<B, Cx, Bx>,
  traversal_order: readonly BasicBlock[],
): DenseBitSet<Local> {
  const mir = fx.mir;
  const dominators = mir.basic_blocks.dominators();
  const locals: LocalKind[] = mir.local_decls.map((decl) => {
    const ty = fx.monomorphize(decl.ty, fold_Ty);
    const layout = fx.cx.spanned_layout_of(ty, decl.source_info.span);
    if (layout.is_zst()) {
      return LocalKind.ZST;
    } else {
      return LocalKind.Unused;
    }
  });

  const analyzer = new LocalAnalyzer<B, Cx, Bx>(fx, dominators, locals);

  // Arguments get assigned to by means of the function being called
  for (const arg of mir.args_iter()) {
    analyzer.define(arg, DefLocation.Argument);
  }

  // If there exists a local definition that dominates all uses of that local,
  // the definition should be visited first. Traverse blocks in an order that
  // is a topological sort of dominance partial order.
  for (const bb of traversal_order) {
    const data = mir.basic_blocks.deref()[bb]!;
    analyzer.visit_basic_block_data(bb, data);
  }

  const non_ssa_locals = DenseBitSet.new_empty<Local>(analyzer.locals.length);
  for (let local = 0; local < analyzer.locals.length; local++) {
    const kind = analyzer.locals[local]!;
    if (kind.$ === "Memory") {
      non_ssa_locals.insert(local as Local);
    }
  }

  return non_ssa_locals;
}

// #[derive(Debug, Copy, Clone, PartialEq, Eq)]
export type LocalKind =
  | { readonly $: "ZST" }
  /// A local that requires an alloca.
  | { readonly $: "Memory" }
  /// A scalar or a scalar pair local that is neither defined nor used.
  | { readonly $: "Unused" }
  /// A scalar or a scalar pair local with a single definition that dominates all uses.
  | { readonly $: "SSA"; readonly _0: DefLocation };
export const LocalKind = {
  ZST: Object.freeze({ $: "ZST" }) as { readonly $: "ZST" },
  Memory: Object.freeze({ $: "Memory" }) as { readonly $: "Memory" },
  Unused: Object.freeze({ $: "Unused" }) as { readonly $: "Unused" },
} as const;

class LocalAnalyzer<B extends BackendTypes, Cx extends CodegenMethods<B>, Bx extends BuilderMethods<B, Cx>> extends Visitor {
  constructor(
    public fx: FunctionCx<B, Cx, Bx>,
    public dominators: Dominators<BasicBlock>,
    public locals: LocalKind[],
  ) {
    super();
  }

  // rustc: compiler/rustc_codegen_ssa/src/mir/analyze.rs:77 define
  define(local: Local, location: DefLocation): void {
    const fx = this.fx;
    const kind = this.locals[local]!;
    const decl = fx.mir.local_decls[local]!;
    switch (kind.$) {
      case "ZST":
        break;
      case "Memory":
        break;
      case "Unused": {
        const ty = fx.monomorphize(decl.ty, fold_Ty);
        const layout = fx.cx.spanned_layout_of(ty, decl.source_info.span);
        this.locals[local] = layout.backend_repr.$ === "Memory" ? LocalKind.Memory : { $: "SSA", _0: location };
        break;
      }
      case "SSA":
        this.locals[local] = LocalKind.Memory;
        break;
    }
  }

  // rustc: compiler/rustc_codegen_ssa/src/mir/analyze.rs:97 process_place
  process_place(place_ref: mir_PlaceRef, context: PlaceContext, location: Location): void {
    if (place_ref.projection.length !== 0) {
      const COPY_CONTEXT: PlaceContext = { $: "NonMutatingUse", _0: NonMutatingUseContext.Copy };

      // `PlaceElem::Index` is the only variant that can mention other `Local`s,
      // so check for those up-front before any potential short-circuits.
      for (const elem of place_ref.projection) {
        if (elem.$ === "Index") {
          const index_local = elem._0;
          this.visit_local(index_local, COPY_CONTEXT, location);
        }
      }

      // If our local is already memory, nothing can make it *more* memory
      // so we don't need to bother checking the projections further.
      if (this.locals[place_ref.local]!.$ === "Memory") {
        return;
      }

      if (place_ref.is_indirect_first_projection()) {
        // If this starts with a `Deref`, we only need to record a read of the
        // pointer being dereferenced, as all the subsequent projections are
        // working on a place which is always supported. (And because we're
        // looking at codegen MIR, it can only happen as the first projection.)
        this.visit_local(place_ref.local, COPY_CONTEXT, location);
        return;
      }

      if (PlaceContext.is_mutating_use(context)) {
        // If it's a mutating use it doesn't matter what the projections are,
        // if there are *any* then we need a place to write. (For example,
        // `_1 = Foo()` works in SSA but `_2.0 = Foo()` does not.)
        const mut_projection: PlaceContext = { $: "MutatingUse", _0: MutatingUseContext.Projection };
        this.visit_local(place_ref.local, mut_projection, location);
        return;
      }

      // Scan through to ensure the only projections are those which
      // `FunctionCx::maybe_codegen_consume_direct` can handle.
      const base_ty = this.fx.monomorphized_place_ty(PlaceRef_from_Local(place_ref.local));
      let layout: TyAndLayout = this.fx.cx.layout_of(base_ty);
      for (const elem of place_ref.projection) {
        if (elem.$ === "Field") {
          const fidx = elem._0;
          layout = layout.field(this.fx.cx, FieldIdx.as_usize(fidx));
        } else if (elem.$ === "Downcast" && layout.variants.$ === "Single" && elem._1 === layout.variants.index) {
          const vidx = elem._1;
          layout = layout.for_variant(this.fx.cx, vidx);
        } else {
          this.locals[place_ref.local] = LocalKind.Memory;
          return;
        }
      }
      // debug_assert!(
      //     layout.is_ssa_standalone(),
      //     "Post-projection {place_ref:?} layout should be non-Ref, but it's {layout:?}",
      // );
    }

    // Even with supported projections, we still need to have `visit_local`
    // check for things that can't be done in SSA (like `SharedBorrow`).
    this.visit_local(place_ref.local, context, location);
  }

  // impl Visitor for LocalAnalyzer
  // rustc: compiler/rustc_codegen_ssa/src/mir/analyze.rs:172 visit_assign
  override visit_assign(place: Place, rvalue: Rvalue, location: Location): void {
    // debug!("visit_assign(place={:?}, rvalue={:?})", place, rvalue);

    const local = place.as_local();
    if (local !== undefined) {
      this.define(local, { $: "Assignment", _0: location });
    } else {
      this.visit_place(place, { $: "MutatingUse", _0: MutatingUseContext.Store }, location);
    }

    this.visit_rvalue(rvalue, location);
  }

  // rustc: compiler/rustc_codegen_ssa/src/mir/analyze.rs:189 visit_place
  override visit_place(place: Place, context: PlaceContext, location: Location): void {
    // debug!("visit_place(place={:?}, context={:?})", place, context);
    this.process_place(place.as_ref(), context, location);
  }

  // rustc: compiler/rustc_codegen_ssa/src/mir/analyze.rs:194 visit_local
  override visit_local(local: Local, context: PlaceContext, location: Location): void {
    if (context.$ === "MutatingUse" && context._0 === "Call") {
      const call = location.block;
      const kind = this.fx.mir.basic_blocks.deref()[call]!.terminator_().kind;
      if (kind.$ !== "Call") {
        bug();
      }
      const { target, func } = kind;
      const tcx = this.fx.cx.tcx_();
      const func_ty = Operand.ty(func, this.fx.mir.local_decls, tcx);
      const func_kind = func_ty.kind();
      let intrinsic;
      if (
        func_kind.$ === "FnDef" &&
        (intrinsic = tcx.intrinsic(func_kind._0)) !== undefined &&
        this.fx.cx.intrinsic_call_expects_place_always(intrinsic.name)
      ) {
        this.locals[local] = LocalKind.Memory;
      }
      this.define(local, { $: "CallReturn", call, target });
    } else if (context.$ === "NonUse" || (context.$ === "NonMutatingUse" && context._0 === "PlaceMention")) {
      // nothing
    } else if (
      context.$ === "NonMutatingUse" &&
      (context._0 === "Copy" ||
        context._0 === "Move" ||
        // Inspect covers things like `PtrMetadata` and `Discriminant`
        // which we can treat similar to `Copy` use for the purpose of
        // whether we can use SSA variables for things.
        context._0 === "Inspect")
    ) {
      const kind = this.locals[local]!;
      if (kind.$ === "ZST") {
      } else if (kind.$ === "Memory") {
      } else if (kind.$ === "SSA" && DefLocation.dominates(kind._0, location, this.dominators)) {
      }
      // Reads from uninitialized variables (e.g., in dead code, after
      // optimizations) require locals to be in (uninitialized) memory.
      // N.B., there can be uninitialized reads of a local visited after
      // an assignment to that local, if they happen on disjoint paths.
      else {
        // kind @ (LocalKind::Unused | LocalKind::SSA(_))
        this.locals[local] = LocalKind.Memory;
      }
    } else if (
      (context.$ === "MutatingUse" &&
        (context._0 === "Store" ||
          context._0 === "SetDiscriminant" ||
          context._0 === "AsmOutput" ||
          context._0 === "Borrow" ||
          context._0 === "RawBorrow" ||
          context._0 === "Projection")) ||
      (context.$ === "NonMutatingUse" &&
        (context._0 === "SharedBorrow" || context._0 === "FakeBorrow" || context._0 === "RawBorrow" || context._0 === "Projection"))
    ) {
      this.locals[local] = LocalKind.Memory;
    } else if (context.$ === "MutatingUse" && context._0 === "Drop") {
      const kind = this.locals[local]!;
      if (kind.$ !== "Memory") {
        let ty = this.fx.mir.local_decls[local]!.ty;
        ty = this.fx.monomorphize(ty, fold_Ty);
        if (this.fx.cx.type_needs_drop(ty)) {
          // Only need the place if we're actually dropping it.
          this.locals[local] = LocalKind.Memory;
        }
      }
    } else if (context.$ === "MutatingUse" && context._0 === "Yield") {
      bug();
    }
  }

  // rustc: compiler/rustc_codegen_ssa/src/mir/analyze.rs:270 visit_statement_debuginfo
  override visit_statement_debuginfo(_: StmtDebugInfo, _location: Location): void {
    // Debuginfo does not generate actual code.
  }
}

// #[derive(Copy, Clone, Debug, PartialEq, Eq)]
export type CleanupKind = { readonly $: "NotCleanup" } | { readonly $: "Funclet" } | { readonly $: "Internal"; readonly funclet: BasicBlock };
export const CleanupKind = {
  NotCleanup: Object.freeze({ $: "NotCleanup" }) as { readonly $: "NotCleanup" },
  Funclet: Object.freeze({ $: "Funclet" }) as { readonly $: "Funclet" },

  // rustc: compiler/rustc_codegen_ssa/src/mir/analyze.rs:283 funclet_bb
  funclet_bb(self: CleanupKind, for_bb: BasicBlock): BasicBlock | undefined {
    switch (self.$) {
      case "NotCleanup":
        return undefined;
      case "Funclet":
        return for_bb;
      case "Internal":
        return self.funclet;
    }
  },
} as const;

/// MSVC requires unwinding code to be split to a tree of *funclets*, where each funclet can only
/// branch to itself or to its parent. Luckily, the code we generates matches this pattern.
/// Recover that structure in an analyze pass.
// rustc: compiler/rustc_codegen_ssa/src/mir/analyze.rs:295 cleanup_kinds
export function cleanup_kinds(mir: Body, nop_landing_pads: DenseBitSet<BasicBlock>): CleanupKind[] {
  const result: CleanupKind[] = mir.basic_blocks.deref().map(() => CleanupKind.NotCleanup);

  discover_masters(result, mir, nop_landing_pads);
  propagate(result, mir);
  // debug!("cleanup_kinds: result={:?}", result);
  return result;
}

// rustc: compiler/rustc_codegen_ssa/src/mir/analyze.rs:299 discover_masters
function discover_masters(result: CleanupKind[], mir: Body, nop_landing_pads: DenseBitSet<BasicBlock>): void {
  const blocks = mir.basic_blocks.deref();
  for (let bb = 0; bb < blocks.length; bb++) {
    const data: BasicBlockData = blocks[bb]!;
    const kind = data.terminator_().kind;
    switch (kind.$) {
      case "Goto":
      case "UnwindResume":
      case "UnwindTerminate":
      case "Return":
      case "TailCall":
      case "CoroutineDrop":
      case "Unreachable":
      case "SwitchInt":
      case "Yield":
      case "FalseEdge":
      case "FalseUnwind":
        /* nothing to do */
        break;
      case "Call":
      case "InlineAsm":
      case "Assert":
      case "Drop": {
        const unwind = kind.unwind;
        if (unwind.$ === "Cleanup" && !nop_landing_pads.contains(unwind._0)) {
          // debug!(
          //     "cleanup_kinds: {:?}/{:?} registering {:?} as funclet",
          //     bb, data, unwind
          // );
          result[unwind._0] = CleanupKind.Funclet;
        }
        break;
      }
    }
  }
}

// rustc: compiler/rustc_codegen_ssa/src/mir/analyze.rs:335 propagate
function propagate(result: CleanupKind[], mir: Body): void {
  const funclet_succs: (BasicBlock | undefined)[] = mir.basic_blocks.deref().map(() => undefined);

  const set_successor = (funclet: BasicBlock, succ: BasicBlock): void => {
    const s = funclet_succs[funclet];
    if (s === undefined) {
      // debug!("set_successor: updating successor of {:?} to {:?}", funclet, succ);
      funclet_succs[funclet] = succ;
    } else {
      if (s !== succ) {
        span_bug(
          mir.span,
          `funclet ${debug_BasicBlock(funclet, PLAIN)} has 2 parents - ${debug_BasicBlock(s, PLAIN)} and ${debug_BasicBlock(succ, PLAIN)}`,
        );
      }
    }
  };

  for (const [bb, data] of traversal.reverse_postorder(mir)) {
    const r = result[bb]!;
    let funclet: BasicBlock;
    switch (r.$) {
      case "NotCleanup":
        continue;
      case "Funclet":
        funclet = bb;
        break;
      case "Internal":
        funclet = r.funclet;
        break;
    }

    // debug!(
    //     "cleanup_kinds: {:?}/{:?}/{:?} propagating funclet {:?}",
    //     bb, data, result[bb], funclet
    // );

    for (const succ of data.terminator_().successors()) {
      const kind = result[succ]!;
      // debug!("cleanup_kinds: propagating {:?} to {:?}/{:?}", funclet, succ, kind);
      switch (kind.$) {
        case "NotCleanup":
          result[succ] = { $: "Internal", funclet };
          break;
        case "Funclet":
          if (funclet !== succ) {
            set_successor(funclet, succ);
          }
          break;
        case "Internal": {
          const succ_funclet = kind.funclet;
          if (funclet !== succ_funclet) {
            // `succ` has 2 different funclet going into it, so it must
            // be a funclet by itself.

            // debug!(
            //     "promoting {:?} to a funclet and updating {:?}",
            //     succ, succ_funclet
            // );
            result[succ] = CleanupKind.Funclet;
            set_successor(succ_funclet, succ);
            set_successor(funclet, succ);
          }
          break;
        }
      }
    }
  }
}
