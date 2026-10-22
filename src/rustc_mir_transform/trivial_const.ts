// Port of compiler/rustc_mir_transform/src/trivial_const.rs (lane mt-skeleton).
import { type Body, type ConstValue, Place_from_Local, RETURN_PLACE, START_BLOCK, visit_with_Body } from "../rustc_middle/mir/mod.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { Ty } from "../rustc_middle/ty/decls.ts";
import type { AnonConstKind } from "../rustc_type_ir/const_kind.gen.ts";
import { type TypeVisitable, TypeVisitableExt } from "../rustc_type_ir/visit.ts";
import { LocalDefId } from "../rustc_span/def_id.ts";
import { has_impossible_clauses } from "./impossible_clauses.ts";

/** `Body: TypeVisitable` (for `body.has_opaque_types()`). */
const Body_visitable: TypeVisitable<Body> = { visit_with: (self, visitor) => visit_with_Body(self, visitor) };

/// If the given def is a trivial const, returns the value and type the const evaluates to.
///
/// A "trivial const" is a const which can be easily proven to evaluate successfully, and the value
/// that it evaluates to can be easily found without going through the usual MIR phases for a const.
///
/// Currently, we support two forms of trivial const.
///
/// The base case is this:
/// ```
/// const A: usize = 0;
/// ```
/// which has this MIR:
/// ```text
/// const A: usize = {
///     let mut _0: usize;
///
///     bb0: {
///         _0 = const 0_usize;
///         return;
///     }
/// }
/// ```
/// Which we recognize by looking for a Body which has a single basic block with a return
/// terminator and a single statement which assigns an `Operand::Constant(Const::Val)` to the
/// return place.
/// This scenario meets the required criteria because:
/// * Control flow cannot panic, we don't have any calls or assert terminators
/// * The value of the const is already computed, so it cannot fail
///
/// In addition to assignment of literals, assignments of trivial consts are also considered
/// trivial consts. In this case, both `A` and `B` are trivial:
/// ```
/// const A: usize = 0;
/// const B: usize = A;
/// ```
// PORT: `body_provider: F` with `F: FnOnce() -> B, B: Deref<Target = Body>` is a `() => Body`.
// rustc: compiler/rustc_mir_transform/src/trivial_const.rs:46 trivial_const
export function trivial_const(tcx: TyCtxt, def: LocalDefId, body_provider: () => Body): [ConstValue, Ty] | undefined {
  const def_kind = tcx.def_kind(def);
  switch (def_kind.$) {
    case "AssocConst":
    case "Const":
      break;
    case "AnonConst":
      // PORT: the `anon_const_kind` query value is `unknown` in queries.gen.ts.
      if ((tcx.anon_const_kind(def) as AnonConstKind) !== "NonTypeSystemInline") {
        break;
      }
      return undefined;
    default:
      return undefined;
  }

  // If there are impossible clauses then MIR passes will replace the body with
  // `unreachable` causing const eval errors when trying to evaluate the body. For
  // now we avoid using trivial consts for such bodies so that the behaviour doesn't
  // change.
  if (has_impossible_clauses(tcx, LocalDefId.to_def_id(def))) {
    return undefined;
  }

  // PORT: the `opaque_types_defined_by` query value is `unknown` in queries.gen.ts (a list of `LocalDefId`).
  if (!((tcx.opaque_types_defined_by(def) as readonly LocalDefId[]).length === 0)) {
    return undefined;
  }

  const body = body_provider();

  if (TypeVisitableExt.has_opaque_types(body, Body_visitable)) {
    return undefined;
  }

  if (body.basic_blocks.deref().length !== 1) {
    return undefined;
  }

  const block = body.basic_blocks.deref()[START_BLOCK]!;
  if (block.statements.length !== 1) {
    return undefined;
  }

  // `block.terminator_().kind != TerminatorKind::Return`
  if (block.terminator_().kind.$ !== "Return") {
    return undefined;
  }

  const kind = block.statements[0]!.kind;
  if (kind.$ !== "Assign") {
    return undefined;
  }
  const [place, rvalue] = kind._0;

  // `*place != Place::from(RETURN_PLACE)` (derived `PartialEq`: the local and the interned projection list)
  const return_place = Place_from_Local(RETURN_PLACE);
  if (!(place.local === return_place.local && place.projection === return_place.projection)) {
    return undefined;
  }

  if (!(rvalue.$ === "Use" && rvalue._0.$ === "Constant")) {
    return undefined;
  }
  const c = rvalue._0._0;
  const const_ = c.const_;
  switch (const_.$) {
    case "Ty":
      return undefined;
    case "Unevaluated": {
      const { def, args } = const_._0;
      if (!(args.length === 0)) {
        return undefined;
      }
      return tcx.trivial_const(def);
    }
    case "Val":
      return [const_._0, const_._1];
  }
}

// The query provider is based on calling the free function trivial_const, which calls mir_built,
// which internally has a fast-path for trivial consts so it too calls trivial_const. This isn't
// recursive, but we are checking if the const is trivial twice. A better design might detect
// trivial consts before getting to MIR, which would hopefully straighten this out.
// rustc: compiler/rustc_mir_transform/src/trivial_const.rs:119 trivial_const_provider
export function trivial_const_provider(tcx: TyCtxt, def: LocalDefId): [ConstValue, Ty] | undefined {
  return trivial_const(tcx, def, () => tcx.mir_built(def).borrow());
}
