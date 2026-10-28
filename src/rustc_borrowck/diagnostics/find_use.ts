// Port of compiler/rustc_borrowck/src/diagnostics/find_use.rs (lane borrowck-contract: declarations; fill lane bck-diag-c, plan-m4 wave 23).
// Conventions: docs/handoff/borrowck-contract.md ("Conventions"; lib.ts's header repeats them).
import { type Body, type Local, Location } from "../../rustc_middle/mir/mod.ts";
import { type PlaceContext, Visitor } from "../../rustc_middle/mir/visit.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import { fold_Ty } from "../../rustc_middle/ty/structural_impls.ts";
import type { RegionVid } from "../../rustc_type_ir/region_kind.ts";
import { KeyedSet } from "../../rust_ts/keyed.ts";
import { panic } from "../../std/panic.ts";
import { Location_key } from "../borrow_set.ts";
import { categorize } from "../def_use.ts";
import type { Cause } from "../region_infer/mod.gen.ts";
import type { RegionInferenceContext } from "../region_infer/region_context.gen.ts";
import { DefUseResult, UseFinder } from "./find_use.gen.ts";

export * from "./find_use.gen.ts";

declare module "./find_use.gen.ts" {
  interface UseFinder {
    // find_use.rs:32
    find(): Cause | undefined;
  }
}

// rustc: compiler/rustc_borrowck/src/diagnostics/find_use.rs:11 find
export function find(body: Body, regioncx: RegionInferenceContext, tcx: TyCtxt, region_vid: RegionVid, start_point: Location): Cause | undefined {
  const uf = new UseFinder(body, regioncx, tcx, region_vid, start_point);

  return uf.find();
}

// rustc: compiler/rustc_borrowck/src/diagnostics/find_use.rs:32 find
UseFinder.prototype.find = function (this: UseFinder): Cause | undefined {
  // PORT: `VecDeque` is an array with a read cursor; `FxIndexSet<Location>` is a `KeyedSet` (derived `Eq`).
  const queue: Location[] = [];
  let queue_front = 0;
  const visited = new KeyedSet<Location>(Location_key);

  queue.push(this.start_point);
  while (queue_front < queue.length) {
    const p = queue[queue_front++]!;
    if (!this.regioncx.region_contains_point(this.region_vid, p)) {
      continue;
    }

    if (visited.has(p)) {
      continue;
    }
    visited.add(p);

    const block_data = this.body.basic_blocks.deref()[p.block]!;

    const visitor = new DefUseVisitor(this.body, this.tcx, this.region_vid, undefined);

    const is_statement = p.statement_index < block_data.statements.length;

    if (is_statement) {
      visitor.visit_statement(block_data.statements[p.statement_index]!, p);
    } else {
      const terminator = block_data.terminator;
      if (terminator === undefined) return panic("called `Option::unwrap()` on a `None` value");
      visitor.visit_terminator(terminator, p);
    }

    const def_use_result = visitor.def_use_result;
    if (def_use_result === undefined) {
      if (is_statement) {
        queue.push(p.successor_within_block());
      } else {
        const unwind = block_data.terminator_().unwind();
        queue.push(
          ...[...block_data.terminator_().successors()]
            .filter((bb) => !(unwind !== undefined && unwind.$ === "Cleanup" && unwind._0 === bb))
            .map((bb) => new Location(bb, 0)),
        );
      }
    } else {
      switch (def_use_result.$) {
        case "Def":
          break;

        case "UseLive": {
          return { $: "LiveVar", _0: def_use_result.local, _1: p };
        }

        case "UseDrop": {
          return { $: "DropVar", _0: def_use_result.local, _1: p };
        }
      }
    }
  }

  return undefined;
};

// rustc-type: compiler/rustc_borrowck/src/diagnostics/find_use.rs:97 DefUseVisitor
export class DefUseVisitor extends Visitor {
  constructor(
    public body: Body,
    public tcx: TyCtxt,
    public region_vid: RegionVid,
    public def_use_result: DefUseResult | undefined,
  ) {
    super();
  }

  // impl<'a, 'tcx> Visitor<'tcx> for DefUseVisitor<'a, 'tcx>
  // rustc: compiler/rustc_borrowck/src/diagnostics/find_use.rs:111 visit_local
  override visit_local(local: Local, context: PlaceContext, _2: Location): void {
    const local_ty = this.body.local_decls[local]!.ty;

    let found_it = false;
    this.tcx.for_each_free_region(
      local_ty,
      (r) => {
        if (r.as_var() === this.region_vid) {
          found_it = true;
        }
      },
      fold_Ty,
    );

    if (found_it) {
      const c = categorize(context);
      this.def_use_result =
        c === "Def"
          ? DefUseResult.Def
          : c === "Use"
            ? { $: "UseLive", local }
            : c === "Drop"
              ? { $: "UseDrop", local }
              : undefined;
    }
  }
}
