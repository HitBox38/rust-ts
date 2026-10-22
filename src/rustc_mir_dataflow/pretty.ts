// Port of compiler/rustc_mir_dataflow/src/pretty.rs (declared by lane dataflow-contract, filled by lane dataflow-impls):
// the `mir_pretty_extra_data` hook (`#[rustc_mir(pretty_live_locals, ..)]` annotations in `-Zunpretty=mir` /
// `-Zdump-mir=dataflow`), installed by lib.ts `provide`. Notes:
// - `PassWhere` is mir/pretty.rs's; `&mut dyn io::Write` is vendor/anstream's `Write` (as in rustc_middle mir/pretty.ts).
//   `ExtraDataFn` is a closure; `Option<Box<ExtraDataFn>>` is `ExtraDataFn | undefined`.
// - `FxIndexMap<PassWhere, Vec<String>>` is a `KeyedMap` keyed by `PassWhere_key` (derived `Hash` + `Eq`).
// - `Annotator` implements `ResultsVisitor` for two analyses (`MaybeLiveLocals`, `MaybeTransitiveLiveLocals`) with the
//   same method names: the two impls are the classes `Annotator_MaybeLiveLocals` / `Annotator_MaybeTransitiveLiveLocals`
//   (both extend `ResultsVisitorBase` and hold the `annotations` field of `Annotator`).
// - `find_attr!(tcx, def_id, RustcMir(kind) => kind)` is `find_attr(HasAttrs_DefId.get_attrs(def_id, tcx), ..)`.
// - The hook slot in rustc_middle hooks.ts is typed `(tcx, body: unknown) => unknown`; lib.ts installs this fn there.

import { find_attr } from "../rustc_attr_ir/lib.ts";
import type { DenseBitSet } from "../rustc_index/bit_set.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { HasAttrs_DefId } from "../rustc_middle/ty/mod.ts";
import { KeyedMap } from "../rust_ts/keyed.ts";
import { debug_vec, PLAIN } from "../std/fmt.ts";
import type { IoResult } from "../std/io.ts";
import { Ok } from "../std/result.ts";
import { debuginfo_locals } from "./debuginfo.ts";
import { ResultsVisitorBase, visit_results } from "./framework/visitor.ts";
import { borrowed_locals } from "./impls/borrowed_locals.ts";
import { MaybeLiveLocals, MaybeTransitiveLiveLocals } from "./impls/liveness.ts";
import { liveness_matrix, SplitPointIndex } from "./impls/precise_liveness.ts";
import { DenseLocationMap } from "./points.ts";
import { type BasicBlock, type Body, debug_Local, type Local, Location, type Statement, type Terminator, traversal } from "../rustc_middle/mir/mod.ts";
import { MirDumper } from "../rustc_middle/mir/pretty.ts";
import type { PassWhere } from "../rustc_middle/mir/pretty.gen.ts";
import type { Write } from "../vendor/anstream/stream.ts";

// rustc-type: compiler/rustc_mir_dataflow/src/pretty.rs:17 ExtraDataFn
type ExtraDataFn = (pass_where: PassWhere, out: Write) => IoResult<void>;

// rustc: compiler/rustc_mir_dataflow/src/pretty.rs:19 mir_pretty_extra_data
export function mir_pretty_extra_data(tcx: TyCtxt, body: Body): ExtraDataFn | undefined {
  const def_id = body.source.def_id();
  const kinds = find_attr(HasAttrs_DefId.get_attrs(def_id, tcx), (k) => (k.$ === "RustcMir" ? k._0 : undefined));
  if (kinds === undefined) {
    return undefined;
  }
  const annotations = new Annotations(new KeyedMap<PassWhere, string[]>(PassWhere_key));
  for (const kind of kinds) {
    switch (kind.$) {
      case "PrettyLiveLocals": {
        const results = new MaybeLiveLocals().iterate_to_fixpoint(tcx, body, undefined);
        const blocks = map_blocks(traversal.reachable(body));
        visit_results(body, blocks, results, new Annotator_MaybeLiveLocals(annotations));
        break;
      }
      case "PrettyPreciseLiveness": {
        const points = DenseLocationMap.new(body);
        const matrix = liveness_matrix(tcx, body, points, undefined);
        const blocks = body.basic_blocks.deref();
        for (let block_ = 0; block_ < blocks.length; block_++) {
          const block = block_ as BasicBlock;
          const data = blocks[block_]!;
          for (let statement_index = 0; statement_index <= data.statements.length; statement_index++) {
            const location = new Location(block, statement_index);
            const point = points.point_from_location(location);
            const locals_live_at = (effect: "Early" | "Late"): Local[] => {
              const split_point = SplitPointIndex.new(point, effect);
              return [...matrix.rows()].filter((r) => matrix.contains(r, split_point));
            };
            const early = locals_live_at("Early");
            annotations.add({ $: "BeforeLocation", _0: location }, `early: ${debug_vec(early, PLAIN, debug_Local)}`);
            const late = locals_live_at("Late");
            annotations.add({ $: "BeforeLocation", _0: location }, `late: ${debug_vec(late, PLAIN, debug_Local)}`);
          }
        }
        break;
      }
      case "PrettyTransitiveLiveLocals": {
        const borrowed_locals_ = borrowed_locals(body);
        const debuginfo_locals_ = debuginfo_locals(body);
        const results = MaybeTransitiveLiveLocals.new(borrowed_locals_, debuginfo_locals_).iterate_to_fixpoint(tcx, body, undefined);
        const blocks = map_blocks(traversal.reachable(body));
        visit_results(body, blocks, results, new Annotator_MaybeTransitiveLiveLocals(annotations));
        break;
      }
      default:
        break;
    }
  }
  const extra_data = annotations.into_extra_data();
  if (extra_data === undefined) return undefined;
  const dumper = MirDumper.new(tcx, "dataflow", body);
  if (dumper !== undefined) {
    dumper.set_extra_data(extra_data).dump_mir(body);
  }
  return extra_data;
}

/** `traversal::reachable(body).map(|(bb, _)| bb)`. */
function* map_blocks(it: Iterable<[BasicBlock, unknown]>): Generator<BasicBlock> {
  for (const [bb, _] of it) yield bb;
}

/** The key of a `PassWhere` in an `FxIndexMap` (derived `Hash` + `Eq`). */
function PassWhere_key(pw: PassWhere): string {
  switch (pw.$) {
    case "BeforeCFG":
    case "AfterCFG":
      return pw.$;
    case "BeforeBlock":
    case "AfterTerminator":
      return `${pw.$}:${pw._0}`;
    case "BeforeLocation":
    case "AfterLocation":
      return `${pw.$}:${pw._0.block}:${pw._0.statement_index}`;
  }
}

// #[derive(Default)]
// rustc-type: compiler/rustc_mir_dataflow/src/pretty.rs:87 Annotations
class Annotations {
  constructor(public entries: KeyedMap<PassWhere, string[]>) {}

  // rustc: compiler/rustc_mir_dataflow/src/pretty.rs:92 add
  add(pass_where: PassWhere, s: string): void {
    let v = this.entries.get(pass_where);
    if (v === undefined) {
      v = [];
      this.entries.set(pass_where, v);
    }
    v.push(s);
  }

  // rustc: compiler/rustc_mir_dataflow/src/pretty.rs:96 into_extra_data
  into_extra_data(): ExtraDataFn | undefined {
    if (this.entries.size === 0) {
      return undefined;
    }
    return (pass_where: PassWhere, out: Write): IoResult<void> => {
      const notes = this.entries.get(pass_where);
      if (notes === undefined) {
        return Ok(undefined);
      }
      for (const s of notes) {
        const r = out.write_fmt([`        // ${s}\n`]);
        if (r.$ === "Err") return r;
      }
      return Ok(undefined);
    };
  }
}

/// Examines dataflow results and collects extra annotations for inclusion in MIR pretty printing.
// rustc-type: compiler/rustc_mir_dataflow/src/pretty.rs:113 Annotator
/** `impl<'tcx> ResultsVisitor<'tcx, MaybeLiveLocals> for Annotator<'_>`. */
class Annotator_MaybeLiveLocals extends ResultsVisitorBase<DenseBitSet<Local>, MaybeLiveLocals> {
  constructor(public annotations: Annotations) {
    super();
  }

  // rustc: compiler/rustc_mir_dataflow/src/pretty.rs:118 visit_after_primary_statement_effect
  override visit_after_primary_statement_effect(state: DenseBitSet<Local>, _statement: Statement, location: Location): void {
    const live: Local[] = [...state.iter()];
    this.annotations.add({ $: "BeforeLocation", _0: location }, `live: ${debug_vec(live, PLAIN, debug_Local)}`);
  }

  // rustc: compiler/rustc_mir_dataflow/src/pretty.rs:128 visit_after_primary_terminator_effect
  override visit_after_primary_terminator_effect(state: DenseBitSet<Local>, _terminator: Terminator, location: Location): void {
    const live: Local[] = [...state.iter()];
    this.annotations.add({ $: "BeforeLocation", _0: location }, `live: ${debug_vec(live, PLAIN, debug_Local)}`);
  }
}

/** `impl<'tcx> ResultsVisitor<'tcx, MaybeTransitiveLiveLocals<'_>> for Annotator<'_>`. */
class Annotator_MaybeTransitiveLiveLocals extends ResultsVisitorBase<DenseBitSet<Local>, MaybeTransitiveLiveLocals> {
  constructor(public annotations: Annotations) {
    super();
  }

  // rustc: compiler/rustc_mir_dataflow/src/pretty.rs:140 visit_after_primary_statement_effect
  override visit_after_primary_statement_effect(state: DenseBitSet<Local>, _statement: Statement, location: Location): void {
    const live: Local[] = [...state.iter()];
    this.annotations.add({ $: "BeforeLocation", _0: location }, `live: ${debug_vec(live, PLAIN, debug_Local)}`);
  }

  // rustc: compiler/rustc_mir_dataflow/src/pretty.rs:150 visit_after_primary_terminator_effect
  override visit_after_primary_terminator_effect(state: DenseBitSet<Local>, _terminator: Terminator, location: Location): void {
    const live: Local[] = [...state.iter()];
    this.annotations.add({ $: "BeforeLocation", _0: location }, `live: ${debug_vec(live, PLAIN, debug_Local)}`);
  }
}
