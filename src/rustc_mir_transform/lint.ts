// Port of compiler/rustc_mir_transform/src/lint.rs (lane ctfe-util; replaces lane mt-skeleton's stub module).
//
//! This pass statically detects code which has undefined behaviour or is likely to be erroneous.
//! It can be used to locate problems in MIR building or optimizations. It assumes that all code
//! can be executed, so it has false positives.
//
// PORT: `Lint` is a class extending rustc_middle mir/visit.ts's `Visitor` (D4); `#[track_caller]` (the delayed bug's
// source location) has no JS equivalent. `FxHashSet<PlaceRef>` is a `KeyedSet` over `intern_key` (the derived
// `Hash + Eq`). `Cow::Borrowed(always_live_locals)` is the bit set itself (the analyses only read it).
// PORT: this module is read lazily by pass_manager.ts (`lint_body`); it never imports lib.ts.
import type { DenseBitSet } from "../rustc_index/bit_set.ts";
import { type Body, debug_Local, debug_Location, type Local, type Location, type Place, type PlaceRef, type Statement, type Terminator } from "../rustc_middle/mir/mod.ts";
import { debug_Statement } from "../rustc_middle/mir/statement.ts";
import { debug_TerminatorKind } from "../rustc_middle/mir/syntax.ts";
import * as traversal from "../rustc_middle/mir/traversal.ts";
import { PlaceContext, VisitPlacesWith, Visitor } from "../rustc_middle/mir/visit.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { debug_InstanceKind } from "../rustc_middle/ty/instance.ts";
import { DefKind } from "../rustc_hir/def.ts";
import type { ResultsCursor } from "../rustc_mir_dataflow/framework/cursor.ts";
import { always_storage_live_locals, MaybeStorageDead, MaybeStorageLive } from "../rustc_mir_dataflow/impls/mod.ts";
import { intern_key } from "../rust_ts/intern_key.ts";
import { KeyedSet } from "../rust_ts/keyed.ts";
import { PLAIN } from "../std/fmt.ts";

// rustc: compiler/rustc_mir_transform/src/lint.rs:15 lint_body
export function lint_body(tcx: TyCtxt, body: Body, when: string): void {
  const always_live_locals = always_storage_live_locals(body);

  const maybe_storage_live = MaybeStorageLive.new(always_live_locals).iterate_to_fixpoint(tcx, body, undefined).into_results_cursor(body);

  const maybe_storage_dead = MaybeStorageDead.new(always_live_locals).iterate_to_fixpoint(tcx, body, undefined).into_results_cursor(body);

  const lint = new Lint(
    tcx,
    when,
    body,
    DefKind.is_fn_like(tcx.def_kind(body.source.def_id())),
    always_live_locals,
    maybe_storage_live,
    maybe_storage_dead,
    new KeyedSet<PlaceRef>(intern_key),
  );
  for (const [bb, data] of traversal.reachable(body)) {
    lint.visit_basic_block_data(bb, data);
  }
}

// rustc-type: compiler/rustc_mir_transform/src/lint.rs:41 Lint
class Lint extends Visitor {
  constructor(
    public tcx: TyCtxt,
    public when: string,
    public body: Body,
    public is_fn_like: boolean,
    public always_live_locals: DenseBitSet<Local>,
    public maybe_storage_live: ResultsCursor<DenseBitSet<Local>, MaybeStorageLive>,
    public maybe_storage_dead: ResultsCursor<DenseBitSet<Local>, MaybeStorageDead>,
    public places: KeyedSet<PlaceRef>,
  ) {
    super();
  }

  // #[track_caller]
  // rustc: compiler/rustc_mir_transform/src/lint.rs:54 fail
  fail(location: Location, msg: string): void {
    const span = this.body.source_info(location).span;
    this.tcx.sess
      .dcx()
      .span_delayed_bug(span, `broken MIR in ${debug_InstanceKind(this.body.source.instance, PLAIN)} (${this.when}) at ${debug_Location(location, PLAIN)}:\n${msg}`);
  }

  // ---- impl Visitor for Lint ----

  // rustc: compiler/rustc_mir_transform/src/lint.rs:76 visit_local
  override visit_local(local: Local, context: PlaceContext, location: Location): void {
    if (PlaceContext.is_use(context)) {
      this.maybe_storage_dead.seek_after_primary_effect(location);
      if (this.maybe_storage_dead.get().contains(local)) {
        this.fail(location, `use of local ${debug_Local(local, PLAIN)}, which has no storage here`);
      }
    }
  }

  // rustc: compiler/rustc_mir_transform/src/lint.rs:85 visit_statement
  override visit_statement(statement: Statement, location: Location): void {
    const kind = statement.kind;
    switch (kind.$) {
      case "Assign": {
        const [dest, rvalue] = kind._0;
        let forbid_aliasing: boolean;
        switch (rvalue.$) {
          case "Use":
          case "CopyForDeref":
          case "Repeat":
          case "Aggregate":
          case "Cast":
          case "WrapUnsafeBinder":
            forbid_aliasing = true;
            break;
          case "ThreadLocalRef":
          case "UnaryOp":
          case "BinaryOp":
          case "Ref":
          case "Reborrow":
          case "RawPtr":
          case "Discriminant":
            forbid_aliasing = false;
            break;
        }
        // The sides of an assignment must not alias.
        if (forbid_aliasing) {
          new VisitPlacesWith((src: Place, _: PlaceContext) => {
            if (places_conflict_for_assignment(dest, src)) {
              this.fail(location, `encountered \`${debug_Statement(statement, PLAIN)}\` statement with overlapping memory`);
            }
          }).visit_rvalue(rvalue, location);
        }
        break;
      }
      case "StorageLive": {
        const local = kind._0;
        this.maybe_storage_live.seek_before_primary_effect(location);
        if (this.maybe_storage_live.get().contains(local)) {
          this.fail(location, `StorageLive(${debug_Local(local, PLAIN)}) which already has storage here`);
        }
        break;
      }
      default:
        break;
    }

    this.super_statement(statement, location);
  }

  // rustc: compiler/rustc_mir_transform/src/lint.rs:133 visit_terminator
  override visit_terminator(terminator: Terminator, location: Location): void {
    const kind = terminator.kind;
    switch (kind.$) {
      case "Return": {
        if (this.is_fn_like) {
          this.maybe_storage_live.seek_after_primary_effect(location);
          for (const local of this.maybe_storage_live.get().iter()) {
            if (!this.always_live_locals.contains(local)) {
              this.fail(location, `local ${debug_Local(local, PLAIN)} still has storage when returning from function`);
            }
          }
        }
        break;
      }
      case "Call": {
        const { args, destination } = kind;
        // The call destination place and Operand::Move place used as an argument might be
        // passed by a reference to the callee. Consequently they must be non-overlapping.
        // Currently this simply checks for duplicate places.
        this.places.clear();
        this.places.add(destination.as_ref());
        let has_duplicates = false;
        for (const arg of args) {
          if (arg.node.$ === "Move") {
            const place = arg.node._0;
            // PORT: `!set.insert(x)` is "was already present".
            const ref = place.as_ref();
            const present = this.places.has(ref);
            this.places.add(ref);
            has_duplicates = has_duplicates || present;
          }
        }
        if (has_duplicates) {
          this.fail(location, `encountered overlapping memory in \`Move\` arguments to \`Call\` terminator: ${debug_TerminatorKind(terminator.kind, PLAIN)}`);
        }
        break;
      }
      default:
        break;
    }

    this.super_terminator(terminator, location);
  }
}

// PORT: upstream places this free fn between `impl Lint` (`fail`) and `impl Visitor for Lint`; both impls are the class.
/// Checks whether reading `src` while assigning to `dest` would violate MIR's
/// non-overlap requirement for assignments.
// rustc: compiler/rustc_mir_transform/src/lint.rs:71 places_conflict_for_assignment
function places_conflict_for_assignment(dest: Place, src: Place): boolean {
  // PORT: the derived `PartialEq` of `Place` (`local` and the interned projection list).
  return (dest.local === src.local && dest.projection === src.projection) || (dest.local === src.local && !dest.is_indirect() && !src.is_indirect());
}
