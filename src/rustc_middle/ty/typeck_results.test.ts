// Lane ty-results (sub-lane ty-results-a): unit tests of ty/typeck_results.rs and the fns of ty/adjustment.rs.
import { describe, expect, test } from "bun:test";
import "../lib.ts";
import { HirId, ItemLocalId, OwnerId } from "../../rustc_hir_id/lib.ts";
import type { LocalDefId } from "../../rustc_span/def_id.ts";
import { PLAIN } from "../../std/fmt.ts";
import { Err, Ok } from "../../std/result.ts";
import { Adjustment, AutoBorrowMutability, Mutability_from_AutoBorrowMutability } from "./adjustment.ts";
import { CommonLifetimes, CommonTypes, CtxtInterners, type GlobalCtxt, TyCtxt } from "./context.ts";
import { enter_context, ImplicitCtxt } from "./context/tls.ts";
import type { DefKind } from "../../rustc_hir/def.ts";
import { ErrorGuaranteed } from "../../rustc_span/lib.ts";
import { DefId } from "../../rustc_span/def_id.ts";
import {
  debug_UserTypeAnnotationIndex,
  type SplattedDef,
  SplattedDef as SplattedDefC,
  TypeckResults,
  UserType,
  UserTypeAnnotationIndex,
  validate_hir_id_for_typeck_results,
} from "./typeck_results.ts";

/** A `TyCtxt` over a fresh `CtxtInterners` (as interning.test.ts). */
function mk_tcx(): TyCtxt {
  const interners = CtxtInterners.new(undefined);
  let types: CommonTypes | undefined;
  let lifetimes: CommonLifetimes | undefined;
  const gcx = {
    interners,
    get types() {
      return (types ??= CommonTypes.new(interners));
    },
    get lifetimes() {
      return (lifetimes ??= CommonLifetimes.new(interners));
    },
  };
  return new TyCtxt(gcx as unknown as GlobalCtxt);
}

const owner = (n: number): OwnerId => new OwnerId(n as LocalDefId);
const hir_id = (o: number, local: number): HirId => new HirId(owner(o), ItemLocalId.from_u32(local));

/** Runs `f` with an `ImplicitCtxt` whose `tcx` only answers `hir_id_to_string` (what the ICE messages read). */
function with_fake_tcx<R>(f: () => R): R {
  const tcx = { hir_id_to_string: (id: HirId) => `node#${id.local_id}` } as unknown as TyCtxt;
  return enter_context(new ImplicitCtxt(tcx, undefined, 0), f);
}

describe("TypeckResults", () => {
  test("new: every table empty, no errors", () => {
    const r = TypeckResults.new(owner(3));
    expect(r.hir_owner.def_id as number).toBe(3);
    expect(r.node_types_.size).toBe(0);
    expect(r.tainted_by_errors).toBeUndefined();
    expect(r.skipped_ref_pats().is_empty()).toBe(true);
    expect(r.coercion_casts().size).toBe(0);
    expect(r.transmutes_to_check).toEqual([]);
  });

  test("node_types_mut().insert / node_type / node_type_opt", () => {
    const tcx = mk_tcx();
    const r = TypeckResults.new(owner(1));
    const id = hir_id(1, 4);
    expect(r.node_type_opt(id)).toBeUndefined();
    expect(r.node_types_mut().insert(id, tcx.types.bool)).toBeUndefined();
    expect(r.node_types_mut().insert(id, tcx.types.u8)).toBe(tcx.types.bool);
    expect(r.node_type(id)).toBe(tcx.types.u8);
    expect(r.node_types().contains_key(id)).toBe(true);
    expect(r.node_types().index(id)).toBe(tcx.types.u8);
    expect(r.node_types_mut().remove(id)).toBe(tcx.types.u8);
    expect(r.node_types().get(id)).toBeUndefined();
  });

  test("node_type on a missing node is an ICE naming the node", () => {
    const r = TypeckResults.new(owner(1));
    expect(() => with_fake_tcx(() => r.node_type(hir_id(1, 7)))).toThrow("node_type: no type for node node#7");
  });

  test("node_args falls back to the empty list", () => {
    const r = TypeckResults.new(owner(1));
    const args = r.node_args(hir_id(1, 2));
    expect(args.length).toBe(0);
    expect(r.node_args_opt(hir_id(1, 2))).toBeUndefined();
  });

  test("type_dependent_def drops errors; qpath_res of a TypeRelative path", () => {
    const r = TypeckResults.new(owner(0));
    const def_id = new DefId(0 as never, 9 as never);
    const assoc_fn: DefKind = { $: "AssocFn" };
    r.type_dependent_defs_mut().insert(hir_id(0, 1), Ok([assoc_fn, def_id]));
    r.type_dependent_defs_mut().insert(hir_id(0, 2), Err(ErrorGuaranteed.unchecked_error_guaranteed()));
    expect(r.type_dependent_def_id(hir_id(0, 1))).toBe(def_id);
    expect(r.type_dependent_def(hir_id(0, 2))).toBeUndefined();
    const qpath = { $: "TypeRelative", _0: undefined as never, _1: undefined as never } as const;
    expect(r.qpath_res(qpath, hir_id(0, 1))).toEqual({ $: "Def", _0: assoc_fn, _1: def_id });
    expect(r.qpath_res(qpath, hir_id(0, 2))).toEqual({ $: "Err" });
  });

  test("field_index panics on a missing field", () => {
    const r = TypeckResults.new(owner(0));
    expect(() => r.field_index(hir_id(0, 1))).toThrow("no index for a field");
    expect(r.opt_field_index(hir_id(0, 1))).toBeUndefined();
  });

  test("items_in_stable_order sorts by ItemLocalId; entry is Occupied/Vacant", () => {
    const tcx = mk_tcx();
    const r = TypeckResults.new(owner(2));
    r.node_types_mut().insert(hir_id(2, 5), tcx.types.bool);
    r.node_types_mut().insert(hir_id(2, 1), tcx.types.u8);
    expect(r.node_types().items_in_stable_order().map(([k]) => k as number)).toEqual([1, 5]);
    expect(r.node_types_mut().entry(hir_id(2, 1)).$).toBe("Occupied");
    const vacant = r.node_types_mut().entry(hir_id(2, 3));
    expect(vacant.$).toBe("Vacant");
    vacant.insert(tcx.types.char);
    expect(r.node_type(hir_id(2, 3))).toBe(tcx.types.char);
  });

  test("coercion casts", () => {
    const r = TypeckResults.new(owner(0));
    r.set_coercion_cast(ItemLocalId.from_u32(3));
    expect(r.is_coercion_cast(hir_id(0, 3))).toBe(true);
    expect(r.is_coercion_cast(hir_id(0, 4))).toBe(false);
  });
});

describe("validate_hir_id_for_typeck_results", () => {
  test("same owner passes", () => {
    validate_hir_id_for_typeck_results(owner(1), hir_id(1, 0));
  });

  test("a foreign owner is an ICE", () => {
    expect(() => with_fake_tcx(() => validate_hir_id_for_typeck_results(owner(1), hir_id(2, 6)))).toThrow(
      "node node#6 cannot be placed in TypeckResults with hir_owner",
    );
    const r = TypeckResults.new(owner(1));
    expect(() => with_fake_tcx(() => r.node_types().get(hir_id(2, 6)))).toThrow("cannot be placed in TypeckResults");
  });
});

describe("LocalSetInContext(Mut)", () => {
  test("insert / contains / remove through the skipped_ref_pats views", () => {
    const r = TypeckResults.new(owner(4));
    const id = hir_id(4, 2);
    expect(r.skipped_ref_pats_mut().insert(id)).toBe(true);
    expect(r.skipped_ref_pats_mut().insert(id)).toBe(false);
    expect(r.skipped_ref_pats().contains(id)).toBe(true);
    expect(r.skipped_ref_pats().is_empty()).toBe(false);
    expect(r.skipped_ref_pats_mut().remove(id)).toBe(true);
    expect(r.skipped_ref_pats_mut().remove(id)).toBe(false);
    expect(r.skipped_ref_pats_mut().is_empty()).toBe(true);
  });
});

describe("small types", () => {
  test("SplattedDef accessors", () => {
    const def_id = new DefId(0 as never, 1 as never);
    const a: SplattedDef = { $: "FnDef", def_id, arg_index: 1, arg_count: 2 };
    expect(SplattedDefC.def_id(a)).toBe(def_id);
    expect(SplattedDefC.fn_ptr_type(a)).toBeUndefined();
    expect(SplattedDefC.arg_index(a)).toBe(1);
    expect(SplattedDefC.arg_count(a)).toBe(2);
  });

  test("UserTypeAnnotationIndex Debug and UserType::new", () => {
    expect(debug_UserTypeAnnotationIndex(UserTypeAnnotationIndex.from_u32(4), PLAIN)).toBe("UserType(4)");
    expect(UserTypeAnnotationIndex.START_INDEX as number).toBe(0);
    const tcx = mk_tcx();
    const u = UserType.new({ $: "Ty", _0: tcx.types.bool });
    expect(u.bounds.length).toBe(0);
  });

  test("AutoBorrowMutability::new and From for Mutability", () => {
    expect(AutoBorrowMutability.new("Not", "Yes")).toBe(AutoBorrowMutability.Not);
    expect(AutoBorrowMutability.new("Mut", "No")).toEqual({ $: "Mut", allow_two_phase_borrow: "No" });
    expect(Mutability_from_AutoBorrowMutability({ $: "Mut", allow_two_phase_borrow: "Yes" })).toBe("Mut");
    expect(Mutability_from_AutoBorrowMutability(AutoBorrowMutability.Not)).toBe("Not");
  });

  test("Adjustment::is_region_borrow", () => {
    const tcx = mk_tcx();
    const target = tcx.types.bool;
    expect(Adjustment.is_region_borrow({ kind: { $: "Borrow", _0: { $: "Ref", _0: AutoBorrowMutability.Not } }, target })).toBe(true);
    expect(Adjustment.is_region_borrow({ kind: { $: "Borrow", _0: { $: "RawPtr", _0: "Not" } }, target })).toBe(false);
    expect(Adjustment.is_region_borrow({ kind: { $: "NeverToAny" }, target })).toBe(false);
  });
});
