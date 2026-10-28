// Port of compiler/rustc_mir_transform/src/single_use_consts.rs (lane mt-opt1).
//
// PORT: `std::mem::replace(&mut stmt.kind, StatementKind::Nop)` reads the statement's kind and stores `Nop`. `*operand =
// self.operand.take()..` replaces the visited operand object in place (`replace_in_place`); the taken operand is moved
// there. `*..constant().unwrap()` (a copy of the `Copy` `ConstOperand`) is `clone_ConstOperand` (PORTING §8).
// `#[derive(Debug)]` of `LocationPair` is `debug_LocationPair` (only read by the `bug!` message).
import { DenseBitSet } from "../rustc_index/bit_set.ts";
import { range_to } from "../rustc_index/idx.ts";
import { IndexVec } from "../rustc_index/vec.ts";
import {
  type Body,
  clone_ConstOperand,
  debug_Body,
  debug_Local,
  debug_Location,
  Local,
  type Location,
  Operand,
  type Place,
  type Rvalue,
  type Statement,
  StatementKind,
  type VarDebugInfo,
} from "../rustc_middle/mir/mod.ts";
import { MutVisitor, type PlaceContext, Visitor } from "../rustc_middle/mir/visit.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { bug } from "../rustc_span/macros.ts";
import { type Debug, debug_option, debug_struct, format_debug, PLAIN, PRETTY } from "../std/fmt.ts";
import { replace_in_place } from "../std/mut_ref.ts";
import { assert, unwrap } from "../std/panic.ts";
import { MirPass, type PassCtx, PassPolicy } from "./pass_manager.ts";
import { drop_invalid_debuginfos } from "./strip_debuginfo.ts";

/// Various parts of MIR building introduce temporaries that are commonly not needed.
///
/// Notably, `if CONST` and `match CONST` end up being used-once temporaries, which
/// obfuscates the structure for other passes and codegen, which would like to always
/// be able to just see the constant directly.
///
/// At higher optimization levels fancier passes like GVN will take care of this
/// in a more general fashion, but this handles the easy cases so can run in debug.
///
/// This only removes constants with a single-use because re-evaluating constants
/// isn't always an improvement, especially for large ones.
///
/// It also removes *never*-used constants, since it had all the information
/// needed to do that too, including updating the debug info.
// rustc-type: compiler/rustc_mir_transform/src/single_use_consts.rs:25 SingleUseConsts
export class SingleUseConsts extends MirPass {
  readonly type_name = "rustc_mir_transform::single_use_consts::SingleUseConsts";

  // rustc: compiler/rustc_mir_transform/src/single_use_consts.rs:28 policy
  policy(ctx: PassCtx): PassPolicy {
    return PassPolicy.optional(ctx.mir_opt_level() >= 1);
  }

  // rustc: compiler/rustc_mir_transform/src/single_use_consts.rs:32 run_pass
  run_pass(tcx: TyCtxt, body: Body): void {
    const finder = new SingleUseConstsFinder(
      DenseBitSet.new_empty<Local>(body.local_decls.length),
      IndexVec.from_elem(LocationPair.new(), body.local_decls, (p) => ({ ...p })),
      DenseBitSet.new_empty<Local>(body.local_decls.length),
    );

    finder.ineligible_locals.insert_range(range_to(Local.arg(body.arg_count)));

    finder.visit_body(body);

    for (let local_ = 0; local_ < finder.locations.length; local_++) {
      const local = local_ as Local;
      const locations = finder.locations[local]!;
      if (finder.ineligible_locals.contains(local)) {
        continue;
      }

      const init_loc = locations.init_loc;
      if (init_loc === undefined) {
        continue;
      }

      // We're only changing an operand, not the terminator kinds or successors
      const basic_blocks = body.basic_blocks.as_mut_preserves_cfg();
      const init_statement = basic_blocks[init_loc.block]!.statements[init_loc.statement_index]!;
      const init_statement_kind = init_statement.kind;
      init_statement.kind = StatementKind.Nop;
      if (init_statement_kind.$ !== "Assign") {
        return bug("No longer an assign?");
      }
      const [place, rvalue] = init_statement_kind._0;
      assert(place.as_local() === local, "assertion `left == right` failed");
      if (rvalue.$ !== "Use") return bug("No longer a use?");
      const operand = rvalue._0;

      const replacer = new LocalReplacer(tcx, local, operand);

      if (finder.locals_in_debug_info.contains(local)) {
        for (const var_debug_info of body.var_debug_info) {
          replacer.visit_var_debug_info(var_debug_info);
        }
      }

      const use_loc = locations.use_loc;
      if (use_loc === undefined) continue;

      const use_block = basic_blocks[use_loc.block]!;
      const use_statement = use_block.statements[use_loc.statement_index];
      if (use_statement !== undefined) {
        replacer.visit_statement(use_statement, use_loc);
      } else {
        replacer.visit_terminator(use_block.terminator_mut(), use_loc);
      }

      if (replacer.operand !== undefined) {
        return bug(
          `operand wasn't used replacing local ${format_debug(local, debug_Local, PLAIN)} with locations ${format_debug(locations, debug_LocationPair, PLAIN)} in body ${format_debug(body, debug_Body, PRETTY)}`,
        );
      }
    }

    drop_invalid_debuginfos(body);
  }
}

// rustc-type: compiler/rustc_mir_transform/src/single_use_consts.rs:94 LocationPair
// #[derive(Copy, Clone, Debug)]
interface LocationPair {
  init_loc: Location | undefined;
  use_loc: Location | undefined;
}
const LocationPair = {
  // rustc: compiler/rustc_mir_transform/src/single_use_consts.rs:100 new
  new(): LocationPair {
    return { init_loc: undefined, use_loc: undefined };
  },
};
const debug_LocationPair: Debug<LocationPair> = (v, f) =>
  debug_struct(f, "LocationPair", [
    ["init_loc", debug_option(v.init_loc, f, debug_Location)],
    ["use_loc", debug_option(v.use_loc, f, debug_Location)],
  ]);

// rustc-type: compiler/rustc_mir_transform/src/single_use_consts.rs:105 SingleUseConstsFinder
class SingleUseConstsFinder extends Visitor {
  constructor(
    public ineligible_locals: DenseBitSet<Local>,
    public locations: LocationPair[],
    public locals_in_debug_info: DenseBitSet<Local>,
  ) {
    super();
  }

  // rustc: compiler/rustc_mir_transform/src/single_use_consts.rs:112 visit_assign
  override visit_assign(place: Place, rvalue: Rvalue, location: Location): void {
    const local = place.as_local();
    if (local !== undefined && rvalue.$ === "Use" && rvalue._0.$ === "Constant") {
      const locations = this.locations[local]!;
      if (locations.init_loc !== undefined) {
        this.ineligible_locals.insert(local);
      } else {
        locations.init_loc = location;
      }
    } else {
      this.super_assign(place, rvalue, location);
    }
  }

  // rustc: compiler/rustc_mir_transform/src/single_use_consts.rs:128 visit_operand
  override visit_operand(operand: Operand, location: Location): void {
    const place = Operand.place(operand);
    const local = place?.as_local();
    if (place !== undefined && local !== undefined) {
      const locations = this.locations[local]!;
      if (locations.use_loc !== undefined) {
        this.ineligible_locals.insert(local);
      } else {
        locations.use_loc = location;
      }
    } else {
      this.super_operand(operand, location);
    }
  }

  // rustc: compiler/rustc_mir_transform/src/single_use_consts.rs:143 visit_statement
  override visit_statement(statement: Statement, location: Location): void {
    switch (statement.kind.$) {
      // Storage markers are irrelevant to this.
      case "StorageLive":
      case "StorageDead":
        break;
      default:
        this.super_statement(statement, location);
    }
  }

  // rustc: compiler/rustc_mir_transform/src/single_use_consts.rs:151 visit_var_debug_info
  override visit_var_debug_info(var_debug_info: VarDebugInfo): void {
    const value = var_debug_info.value;
    const local = value.$ === "Place" ? value._0.as_local() : undefined;
    if (local !== undefined) {
      this.locals_in_debug_info.insert(local);
    } else {
      this.super_var_debug_info(var_debug_info);
    }
  }

  // rustc: compiler/rustc_mir_transform/src/single_use_consts.rs:161 visit_local
  override visit_local(local: Local, _context: PlaceContext, _location: Location): void {
    // If there's any path that gets here, rather than being understood elsewhere,
    // then we'd better not do anything with this local.
    this.ineligible_locals.insert(local);
  }
}

// rustc-type: compiler/rustc_mir_transform/src/single_use_consts.rs:168 LocalReplacer
class LocalReplacer extends MutVisitor {
  constructor(
    /** PORT: the field `tcx` (the name of `MutVisitor::tcx`, which returns it). */
    public tcx_: TyCtxt,
    public local: Local,
    public operand: Operand | undefined,
  ) {
    super();
  }

  // rustc: compiler/rustc_mir_transform/src/single_use_consts.rs:175 tcx
  tcx(): TyCtxt {
    return this.tcx_;
  }

  // rustc: compiler/rustc_mir_transform/src/single_use_consts.rs:179 visit_operand
  override visit_operand(operand: Operand, _location: Location): void {
    if ((operand.$ === "Copy" || operand.$ === "Move") && operand._0.as_local() === this.local) {
      const taken = this.operand;
      this.operand = undefined;
      replace_in_place<Operand>(operand, taken ?? bug("there was a second use of the operand"));
    }
  }

  // rustc: compiler/rustc_mir_transform/src/single_use_consts.rs:190 visit_var_debug_info
  override visit_var_debug_info(var_debug_info: VarDebugInfo): void {
    const value = var_debug_info.value;
    if (value.$ === "Place" && value._0.as_local() === this.local) {
      const const_op = clone_ConstOperand(unwrap(Operand.constant(this.operand ?? bug("the operand was already stolen"))));
      var_debug_info.value = { $: "Const", _0: const_op };
    }
  }
}

