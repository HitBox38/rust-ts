// Port of compiler/rustc_mir_dataflow/src/pretty.rs: DECLARED (lane dataflow-contract). Every fn is a stub for lane
// `dataflow-impls` (plan-m4 §5 wave 22): the `mir_pretty_extra_data` hook (`#[rustc_mir(pretty_live_locals, ..)]`
// annotations in `-Zunpretty=mir` / `-Zdump-mir`), installed by lib.ts `provide`.
//
// How to fill a stub: replace the body with the upstream logic and turn `// stub: <path>:<line> <name> (lane ..)` into
// the marker `// rustc: <path>:<line> <name>`. Notes:
// - `PassWhere` is mir/pretty.rs's; `&mut dyn io::Write` is vendor/anstream's `Write` (as in rustc_middle mir/pretty.ts).
//   `ExtraDataFn` is a closure; `Option<Box<ExtraDataFn>>` is `ExtraDataFn | undefined`.
// - `FxIndexMap<PassWhere, Vec<String>>` is a `KeyedMap` keyed by mir-pretty's `PassWhere` key (derived `Hash` + `Eq`).
// - `Annotator` implements `ResultsVisitor` for two analyses (`MaybeLiveLocals`, `MaybeTransitiveLiveLocals`) with the
//   same method names: the two impls are the classes `Annotator_MaybeLiveLocals` / `Annotator_MaybeTransitiveLiveLocals`
//   (both extend `ResultsVisitorBase` and hold the `annotations` field of `Annotator`).
// - The hook slot in rustc_middle hooks.ts is typed `(tcx, body: unknown) => unknown`; lib.ts installs this fn there.

import type { DenseBitSet } from "../rustc_index/bit_set.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { KeyedMap } from "../rust_ts/keyed.ts";
import type { IoResult } from "../std/io.ts";
import { unported } from "../std/panic.ts";
import { ResultsVisitorBase } from "./framework/visitor.ts";
import type { MaybeLiveLocals, MaybeTransitiveLiveLocals } from "./impls/liveness.ts";
import type { Body, Local, Location, Statement, Terminator } from "../rustc_middle/mir/mod.ts";
import type { PassWhere } from "../rustc_middle/mir/pretty.ts";
import type { Write } from "../vendor/anstream/stream.ts";


// rustc-type: compiler/rustc_mir_dataflow/src/pretty.rs:17 ExtraDataFn
type ExtraDataFn = (pass_where: PassWhere, out: Write) => IoResult<null>;

// stub: compiler/rustc_mir_dataflow/src/pretty.rs:19 mir_pretty_extra_data (lane dataflow-impls)
export function mir_pretty_extra_data(_tcx: TyCtxt, _body: Body): ExtraDataFn | undefined {
  return unported("rustc_mir_dataflow::pretty::mir_pretty_extra_data");
}

// #[derive(Default)]
// rustc-type: compiler/rustc_mir_dataflow/src/pretty.rs:87 Annotations
class Annotations {
  constructor(public entries: KeyedMap<PassWhere, string[]>) {}

  // stub: compiler/rustc_mir_dataflow/src/pretty.rs:92 add (lane dataflow-impls)
  add(_pass_where: PassWhere, _s: string): void {
    return unported("rustc_mir_dataflow::pretty::Annotations::add");
  }

  // stub: compiler/rustc_mir_dataflow/src/pretty.rs:96 into_extra_data (lane dataflow-impls)
  into_extra_data(): ExtraDataFn | undefined {
    return unported("rustc_mir_dataflow::pretty::Annotations::into_extra_data");
  }
}

/// Examines dataflow results and collects extra annotations for inclusion in MIR pretty printing.
// rustc-type: compiler/rustc_mir_dataflow/src/pretty.rs:113 Annotator
/** `impl<'tcx> ResultsVisitor<'tcx, MaybeLiveLocals> for Annotator<'_>`. */
class Annotator_MaybeLiveLocals extends ResultsVisitorBase<DenseBitSet<Local>, MaybeLiveLocals> {
  constructor(public annotations: Annotations) {
    super();
  }

  // stub: compiler/rustc_mir_dataflow/src/pretty.rs:118 visit_after_primary_statement_effect (lane dataflow-impls)
  override visit_after_primary_statement_effect(_state: DenseBitSet<Local>, _statement: Statement, _location: Location): void {
    return unported("rustc_mir_dataflow::pretty::Annotator::visit_after_primary_statement_effect (MaybeLiveLocals)");
  }

  // stub: compiler/rustc_mir_dataflow/src/pretty.rs:128 visit_after_primary_terminator_effect (lane dataflow-impls)
  override visit_after_primary_terminator_effect(_state: DenseBitSet<Local>, _terminator: Terminator, _location: Location): void {
    return unported("rustc_mir_dataflow::pretty::Annotator::visit_after_primary_terminator_effect (MaybeLiveLocals)");
  }
}

/** `impl<'tcx> ResultsVisitor<'tcx, MaybeTransitiveLiveLocals<'_>> for Annotator<'_>`. */
class Annotator_MaybeTransitiveLiveLocals extends ResultsVisitorBase<DenseBitSet<Local>, MaybeTransitiveLiveLocals> {
  constructor(public annotations: Annotations) {
    super();
  }

  // stub: compiler/rustc_mir_dataflow/src/pretty.rs:140 visit_after_primary_statement_effect (lane dataflow-impls)
  override visit_after_primary_statement_effect(_state: DenseBitSet<Local>, _statement: Statement, _location: Location): void {
    return unported("rustc_mir_dataflow::pretty::Annotator::visit_after_primary_statement_effect (MaybeTransitiveLiveLocals)");
  }

  // stub: compiler/rustc_mir_dataflow/src/pretty.rs:150 visit_after_primary_terminator_effect (lane dataflow-impls)
  override visit_after_primary_terminator_effect(_state: DenseBitSet<Local>, _terminator: Terminator, _location: Location): void {
    return unported("rustc_mir_dataflow::pretty::Annotator::visit_after_primary_terminator_effect (MaybeTransitiveLiveLocals)");
  }
}

/** Keeps the module-private declarations referenced for the fill lane. */
export const _pretty_decls = { Annotations, Annotator_MaybeLiveLocals, Annotator_MaybeTransitiveLiveLocals };
