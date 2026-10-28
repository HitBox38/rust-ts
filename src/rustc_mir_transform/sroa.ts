// Port of compiler/rustc_mir_transform/src/sroa.rs (lane mt-opt2-d).
//
// PORT: the fn-local struct `EscapeVisitor` (in `escaping_locals`) is a module-level class extending mir/visit.ts's
// `Visitor`; `ReplacementVisitor` extends `MutVisitor` (field `tcx_`). `*place = repl` replaces the visited place object in
// place (`replace_in_place`).
// PORT: `IndexVec<Local, Option<IndexVec<FieldIdx, Option<(Ty, Local)>>>>` is `(([Ty, Local] | undefined)[] | undefined)[]`;
// `IndexVec::insert(field, v)` grows the inner array with `undefined` up to `field` (`ensure_contains_elem`).
// `place_fragments` returns the `filter_map`'d fragments as an array (its callers consume it at once and the iteration
// does not touch the map). `Vec::flat_map_in_place` is done on the JS array in place (rustc_data_structures
// flat_map_in_place.rs is not ported as a shared module; rustc_ast/mut_visit.ts keeps a private copy).
// PORT: every new statement gets its own `Place` (`new_local.into()` is `Place_from_Local`, `mk_place_field` builds a new
// place); the operands taken out of an aggregate (`std::mem::take`) move into the new statements.
import type { FieldIdx } from "../rustc_abi/layout.ts";
import { LangItem } from "../rustc_attr_ir/lang_items.ts";
import { range } from "../rustc_index/idx.ts";
import { DenseBitSet, GrowableBitSet } from "../rustc_index/bit_set.ts";
import {
  type BasicBlock,
  type Body,
  type Local,
  type Location,
  type Operand,
  Place,
  type PlaceElem,
  type Rvalue,
  type Statement,
  type VarDebugInfo,
  Local as LocalC,
  RETURN_PLACE,
  WithRetag,
  clone_LocalDecl,
  clone_VarDebugInfo,
} from "../rustc_middle/mir/mod.ts";
import { Place_from_Local, type PlaceRef } from "../rustc_middle/mir/statement.ts";
import { MutVisitor, type PlaceContext, Visitor } from "../rustc_middle/mir/visit.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { UserTypeAnnotationIndex } from "../rustc_middle/ty/typeck_results.ts";
import type { Ty, TypingEnv } from "../rustc_middle/ty/mod.ts";
import { excluded_locals, iter_fields } from "../rustc_mir_dataflow/value_analysis.ts";
import { bug } from "../rustc_span/macros.ts";
import { EarlyBinder } from "../rustc_type_ir/binder.ts";
import { Unnormalized } from "../rustc_type_ir/unnormalized.ts";
import { replace_in_place } from "../std/mut_ref.ts";
import { assert, panic } from "../std/panic.ts";
import { MirPass, type PassCtx, PassPolicy } from "./pass_manager.ts";
import { MirPatch } from "./patch.ts";

// rustc-type: compiler/rustc_mir_transform/src/sroa.rs:16 ScalarReplacementOfAggregates
export class ScalarReplacementOfAggregates extends MirPass {
  readonly type_name = "rustc_mir_transform::sroa::ScalarReplacementOfAggregates";

  // rustc: compiler/rustc_mir_transform/src/sroa.rs:19 policy
  policy(ctx: PassCtx): PassPolicy {
    return PassPolicy.optional(ctx.mir_opt_level() >= 2);
  }

  // #[instrument(level = "debug", skip(self, tcx, body))]
  // rustc: compiler/rustc_mir_transform/src/sroa.rs:24 run_pass
  run_pass(tcx: TyCtxt, body: Body): void {
    // debug!(def_id = ?body.source.def_id());

    // Avoid query cycles (coroutines require optimized MIR for layout).
    if (Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.type_of(body.source.def_id()) as EarlyBinder<Ty>)).is_coroutine()) {
      return;
    }

    const excluded = excluded_locals(body);
    const typing_env = body.typing_env(tcx);
    for (;;) {
      // debug!(?excluded);
      const escaping = escaping_locals(tcx, excluded, body);
      // debug!(?escaping);
      const replacements = compute_flattening(tcx, typing_env, body, escaping);
      // debug!(?replacements);
      const all_dead_locals = replace_flattened_locals(tcx, body, replacements);
      if (!all_dead_locals.is_empty()) {
        excluded.union(all_dead_locals);
      } else {
        break;
      }
    }
  }
}

/// Identify all locals that are not eligible for SROA.
///
/// There are 3 cases:
/// - the aggregated local is used or passed to other code (function parameters and arguments);
/// - the locals is a union or an enum;
/// - the local's address is taken, and thus the relative addresses of the fields are observable to
///   client code.
// rustc: compiler/rustc_mir_transform/src/sroa.rs:57 escaping_locals
function escaping_locals(tcx: TyCtxt, excluded: GrowableBitSet<Local>, body: Body): DenseBitSet<Local> {
  const is_excluded_ty = (ty: Ty): boolean => {
    if (ty.is_union() || ty.is_enum()) {
      return true;
    }
    const k = ty.kind();
    if (k.$ === "Adt") {
      const def = k._0;
      if (def.repr().simd() || def.repr().is_scalable() || tcx.is_lang_item(def.did(), LangItem.DynMetadata)) {
        // Exclude #[repr(simd)] types so that they are not de-optimized into an array
        // (MCP#838 banned projections into SIMD types, but if the value is unused
        // this pass sees "all the uses are of the fields" and expands it.)

        // codegen wants to see the `DynMetadata<T>`,
        // not the inner reference-to-opaque-type.
        return true;
      }
    }
    // Default for non-ADTs
    return false;
  };

  const set = DenseBitSet.new_empty<Local>(body.local_decls.length);
  set.insert_range(range(RETURN_PLACE, LocalC.arg(body.arg_count)));
  const local_decls = body.local_decls;
  for (let local = 0; local < local_decls.length; local++) {
    const decl = local_decls[local]!;
    if (excluded.contains(local as Local) || is_excluded_ty(decl.ty)) {
      set.insert(local as Local);
    }
  }
  const visitor = new EscapeVisitor(set);
  visitor.visit_body(body);
  return visitor.set;
}

// rustc-type: compiler/rustc_mir_transform/src/sroa.rs:94 EscapeVisitor
class EscapeVisitor extends Visitor {
  constructor(public set: DenseBitSet<Local>) {
    super();
  }

  // rustc: compiler/rustc_mir_transform/src/sroa.rs:99 visit_local
  override visit_local(local: Local, _1: PlaceContext, _2: Location): void {
    this.set.insert(local);
  }

  // rustc: compiler/rustc_mir_transform/src/sroa.rs:103 visit_place
  override visit_place(place: Place, context: PlaceContext, location: Location): void {
    // Mirror the implementation in PreFlattenVisitor.
    if (place.projection.length > 0 && place.projection[0]!.$ === "Field") {
      return;
    }
    this.super_place(place, context, location);
  }

  // rustc: compiler/rustc_mir_transform/src/sroa.rs:111 visit_assign
  override visit_assign(lvalue: Place, rvalue: Rvalue, location: Location): void {
    if (lvalue.as_local() !== undefined) {
      switch (rvalue.$) {
        // Aggregate assignments are expanded in run_pass.
        case "Aggregate":
        case "Use": {
          this.visit_rvalue(rvalue, location);
          return;
        }
        default:
          break;
      }
    }
    this.super_assign(lvalue, rvalue, location);
  }

  // rustc: compiler/rustc_mir_transform/src/sroa.rs:130 visit_statement
  override visit_statement(statement: Statement, location: Location): void {
    switch (statement.kind.$) {
      // Storage statements are expanded in run_pass.
      case "StorageLive":
      case "StorageDead":
        return;
      default:
        this.super_statement(statement, location);
    }
  }

  // We ignore anything that happens in debuginfo, since we expand it using
  // `VarDebugInfoFragment`.
  // rustc: compiler/rustc_mir_transform/src/sroa.rs:140 visit_var_debug_info
  override visit_var_debug_info(_: VarDebugInfo): void {}
}

/** `IndexVec<FieldIdx, Option<(Ty, Local)>>`. */
type Fragments = ([Ty, Local] | undefined)[];

/** PORT: `IndexVec` indexing (`fields[f]`), which panics out of bounds. */
function index<T>(v: readonly T[], i: number): T {
  if (i >= v.length) return panic(`index out of bounds: the len is ${v.length} but the index is ${i}`);
  return v[i]!;
}

// #[derive(Default, Debug)]
// rustc-type: compiler/rustc_mir_transform/src/sroa.rs:145 ReplacementMap
class ReplacementMap {
  constructor(
    /// Pre-computed list of all "new" locals for each "old" local. This is used to expand storage
    /// and deinit statement and debuginfo.
    public fragments: (Fragments | undefined)[],
  ) {}

  // rustc: compiler/rustc_mir_transform/src/sroa.rs:152 replace_place
  replace_place(tcx: TyCtxt, place: PlaceRef): Place | undefined {
    if (!(place.projection.length > 0 && place.projection[0]!.$ === "Field")) {
      return undefined;
    }
    const f = place.projection[0]._0;
    const rest = place.projection.slice(1);
    const fields = index(this.fragments, place.local);
    if (fields === undefined) return undefined;
    const fl = index(fields, f);
    if (fl === undefined) return undefined;
    const [, new_local] = fl;
    return new Place(new_local, tcx.mk_place_elems(rest));
  }

  // rustc: compiler/rustc_mir_transform/src/sroa.rs:161 place_fragments
  place_fragments(place: Place): [FieldIdx, Ty, Local][] | undefined {
    const local = place.as_local();
    if (local === undefined) return undefined;
    const fields = index(this.fragments, local);
    if (fields === undefined) return undefined;
    const out: [FieldIdx, Ty, Local][] = [];
    for (let field = 0; field < fields.length; field++) {
      const opt_ty_local = fields[field];
      if (opt_ty_local === undefined) continue;
      const [ty, local] = opt_ty_local;
      out.push([field as FieldIdx, ty, local]);
    }
    return out;
  }
}

/// Compute the replacement of flattened places into locals.
///
/// For each eligible place, we assign a new local to each accessed field.
/// The replacement will be done later in `ReplacementVisitor`.
// rustc: compiler/rustc_mir_transform/src/sroa.rs:178 compute_flattening
function compute_flattening(tcx: TyCtxt, typing_env: TypingEnv, body: Body, escaping: DenseBitSet<Local>): ReplacementMap {
  const fragments: (Fragments | undefined)[] = new Array<Fragments | undefined>(body.local_decls.length).fill(undefined);

  // `body.local_decls.indices()`: the range is taken before the loop pushes new locals.
  const num_locals = body.local_decls.length;
  for (let l = 0; l < num_locals; l++) {
    const local = l as Local;
    if (escaping.contains(local)) {
      continue;
    }
    const decl = clone_LocalDecl(body.local_decls[local]!);
    const ty = decl.ty;
    iter_fields(ty, tcx, typing_env, (variant, field, field_ty) => {
      if (variant !== undefined) {
        // Downcasts are currently not supported.
        return;
      }
      // `LocalDecl { ty: field_ty, user_ty: None, ..decl.clone() }`
      const new_decl = clone_LocalDecl(decl);
      new_decl.ty = field_ty;
      new_decl.user_ty = undefined;
      const new_local = body.local_decls.length as Local;
      body.local_decls.push(new_decl);
      // `fragments.get_or_insert_with(local, IndexVec::new).insert(field, (field_ty, new_local))`
      let fields = fragments[local];
      if (fields === undefined) {
        fields = [];
        fragments[local] = fields;
      }
      while (fields.length <= field) fields.push(undefined);
      fields[field] = [field_ty, new_local];
    });
  }
  return new ReplacementMap(fragments);
}

/// Perform the replacement computed by `compute_flattening`.
// rustc: compiler/rustc_mir_transform/src/sroa.rs:206 replace_flattened_locals
function replace_flattened_locals(tcx: TyCtxt, body: Body, replacements: ReplacementMap): GrowableBitSet<Local> {
  // Start with an empty GrowableBitSet, to avoid allocation if nothing is dead.
  // Then fill the set in descending order so that it allocates at most once.
  const all_dead_locals = GrowableBitSet.new_empty<Local>();
  for (let local = replacements.fragments.length - 1; local >= 0; local--) {
    if (replacements.fragments[local] !== undefined) {
      all_dead_locals.insert(local as Local);
    }
  }
  // debug!(?all_dead_locals);
  if (all_dead_locals.is_empty()) {
    return all_dead_locals;
  }

  const visitor = new ReplacementVisitor(tcx, body.local_decls, replacements, all_dead_locals, MirPatch.new(body));
  const blocks = body.basic_blocks.as_mut_preserves_cfg();
  for (let bb = 0; bb < blocks.length; bb++) {
    visitor.visit_basic_block_data(bb as BasicBlock, blocks[bb]!);
  }
  for (const scope of body.source_scopes) {
    visitor.visit_source_scope_data(scope);
  }
  const annotations = body.user_type_annotations;
  for (let index = 0; index < annotations.length; index++) {
    visitor.visit_user_type_annotation(index as UserTypeAnnotationIndex, annotations[index]!);
  }
  visitor.expand_var_debug_info(body.var_debug_info);
  const { patch } = visitor;
  patch.apply(body);
  return visitor.all_dead_locals;
}

// rustc-type: compiler/rustc_mir_transform/src/sroa.rs:246 ReplacementVisitor
class ReplacementVisitor extends MutVisitor {
  constructor(
    /** PORT: the field `tcx` (the name of `MutVisitor::tcx`, which returns it). */
    public tcx_: TyCtxt,
    /// This is only used to compute the type for `VarDebugInfoFragment`.
    public local_decls: Body["local_decls"],
    /// Work to do.
    public replacements: ReplacementMap,
    /// This is used to check that we are not leaving references to replaced locals behind.
    public all_dead_locals: GrowableBitSet<Local>,
    public patch: MirPatch,
  ) {
    super();
  }

  // #[instrument(level = "trace", skip(self))]
  // rustc: compiler/rustc_mir_transform/src/sroa.rs:259 expand_var_debug_info
  expand_var_debug_info(var_debug_info: VarDebugInfo[]): void {
    // `var_debug_info.flat_map_in_place(..)`: each element is replaced, in order, by the elements it maps to.
    const f = (var_debug_info: VarDebugInfo): VarDebugInfo[] => {
      const value = var_debug_info.value;
      if (value.$ === "Const") return [var_debug_info];
      const place = value._0;
  
      const repl = this.replacements.replace_place(this.tcx_, place.as_ref());
      if (repl !== undefined) {
        replace_in_place(place, repl);
        return [var_debug_info];
      }
  
      const parts = this.replacements.place_fragments(place);
      if (parts === undefined) {
        return [var_debug_info];
      }
  
      const ty = place.ty(this.local_decls, this.tcx_).ty;
  
      return parts.map(([field, field_ty, replacement_local]) => {
        const var_debug_info_ = clone_VarDebugInfo(var_debug_info);
        if (var_debug_info_.composite === undefined) {
          var_debug_info_.composite = { ty, projection: [] };
        }
        const composite = var_debug_info_.composite;
        const elem: PlaceElem = { $: "Field", _0: field, _1: field_ty };
        composite.projection.push(elem);
  
        var_debug_info_.value = { $: "Place", _0: Place_from_Local(replacement_local) };
        return var_debug_info_;
      });
    };
    const out: VarDebugInfo[] = [];
    for (const var_debug_info_ of var_debug_info) {
      out.push(...f(var_debug_info_));
    }
    var_debug_info.length = 0;
    var_debug_info.push(...out);
  }

  // rustc: compiler/rustc_mir_transform/src/sroa.rs:294 tcx
  tcx(): TyCtxt {
    return this.tcx_;
  }

  // rustc: compiler/rustc_mir_transform/src/sroa.rs:298 visit_place
  override visit_place(place: Place, context: PlaceContext, location: Location): void {
    const repl = this.replacements.replace_place(this.tcx_, place.as_ref());
    if (repl !== undefined) {
      replace_in_place(place, repl);
    } else {
      this.super_place(place, context, location);
    }
  }

  // #[instrument(level = "trace", skip(self))]
  // rustc: compiler/rustc_mir_transform/src/sroa.rs:307 visit_statement
  override visit_statement(statement: Statement, location: Location): void {
    const kind = statement.kind;
    switch (kind.$) {
      // Duplicate storage and deinit statements, as they pretty much apply to all fields.
      case "StorageLive": {
        const final_locals = this.replacements.place_fragments(Place_from_Local(kind._0));
        if (final_locals !== undefined) {
          for (const [, , fl] of final_locals) {
            this.patch.add_statement(location, { $: "StorageLive", _0: fl });
          }
          statement.make_nop(true);
        }
        return;
      }
      case "StorageDead": {
        const final_locals = this.replacements.place_fragments(Place_from_Local(kind._0));
        if (final_locals !== undefined) {
          for (const [, , fl] of final_locals) {
            this.patch.add_statement(location, { $: "StorageDead", _0: fl });
          }
          statement.make_nop(true);
        }
        return;
      }

      case "Assign": {
        const [place, rvalue] = kind._0;

        // We have `a = Struct { 0: x, 1: y, .. }`.
        // We replace it by
        // ```
        // a_0 = x
        // a_1 = y
        // ...
        // ```
        if (rvalue.$ === "Aggregate") {
          const local = place.as_local();
          const final_locals = local !== undefined ? index(this.replacements.fragments, local) : undefined;
          if (final_locals !== undefined) {
            // This is ok as we delete the statement later.
            const operands = rvalue._1;
            rvalue._1 = [];
            // `final_locals.iter().zip(operands)`
            const n = Math.min(final_locals.length, operands.length);
            for (let i = 0; i < n; i++) {
              const opt_ty_local = final_locals[i];
              const operand = operands[i]!;
              if (opt_ty_local !== undefined) {
                const [, new_local] = opt_ty_local;
                // Replace mentions of SROA'd locals that appear in the operand.
                this.visit_operand(operand, location);

                const rvalue_: Rvalue = { $: "Use", _0: operand, _1: WithRetag.Yes };
                this.patch.add_statement(location, { $: "Assign", _0: [Place_from_Local(new_local), rvalue_] });
              }
            }
            statement.make_nop(true);
            return;
          }
        }

        // We have `a = some constant`
        // We add the projections.
        // ```
        // a_0 = a.0
        // a_1 = a.1
        // ...
        // ```
        // ConstProp will pick up the pieces and replace them by actual constants.
        else if (rvalue.$ === "Use" && rvalue._0.$ === "Constant") {
          const retag = rvalue._1;
          const final_locals = this.replacements.place_fragments(place);
          if (final_locals !== undefined) {
            // Put the deaggregated statements *after* the original one.
            const location_ = location.successor_within_block();
            for (const [field, ty, new_local] of final_locals) {
              const rplace = this.tcx_.mk_place_field(place, field, ty);
              const rvalue_: Rvalue = { $: "Use", _0: { $: "Move", _0: rplace }, _1: retag };
              this.patch.add_statement(location_, { $: "Assign", _0: [Place_from_Local(new_local), rvalue_] });
            }
            // We still need `place.local` to exist, so don't make it nop.
            return;
          }
        }

        // We have `a = move? place`
        // We replace it by
        // ```
        // a_0 = move? place.0
        // a_1 = move? place.1
        // ...
        // ```
        else if (rvalue.$ === "Use" && (rvalue._0.$ === "Copy" || rvalue._0.$ === "Move")) {
          const lhs = place;
          const op: Operand = rvalue._0;
          const rplace = rvalue._0._0;
          const retag = rvalue._1;
          let copy: boolean;
          switch (op.$) {
            case "Copy":
              copy = true;
              break;
            case "Move":
              copy = false;
              break;
            default:
              return bug();
          }
          const final_locals = this.replacements.place_fragments(lhs);
          if (final_locals !== undefined) {
            for (const [field, ty, new_local] of final_locals) {
              const rplace_ = this.tcx_.mk_place_field(rplace, field, ty);
              // debug!(?rplace);
              const rplace__ = this.replacements.replace_place(this.tcx_, rplace_.as_ref()) ?? rplace_;
              // debug!(?rplace);
              const rvalue_: Rvalue = copy
                ? { $: "Use", _0: { $: "Copy", _0: rplace__ }, _1: retag }
                : { $: "Use", _0: { $: "Move", _0: rplace__ }, _1: retag };
              this.patch.add_statement(location, { $: "Assign", _0: [Place_from_Local(new_local), rvalue_] });
            }
            statement.make_nop(true);
            return;
          }
        }
        break;
      }

      default:
        break;
    }
    this.super_statement(statement, location);
  }

  // rustc: compiler/rustc_mir_transform/src/sroa.rs:429 visit_local
  override visit_local(local: { value: Local }, _1: PlaceContext, _2: Location): void {
    assert(!this.all_dead_locals.contains(local.value), "assertion failed: !self.all_dead_locals.contains(*local)");
  }
}
