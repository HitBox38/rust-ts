// Unit tests (lane typeck-pat-a) for the self-contained parts of pat.rs:1..1779: the helper impls of `AdjustMode`,
// `MutblCap` and `ResolvedPat`, `is_number`, and the binding-mode arithmetic of `FnCtxt::adjust_pat_info` /
// `FnCtxt::should_peel_ref` (called on a stand-in receiver: they only read `downgrade_mut_inside_shared`).
import { expect, test } from "bun:test";
import type { ByRef } from "../rustc_ast/lib.ts";
import { DefKind } from "../rustc_hir/def.ts";
import type { Ty } from "../rustc_middle/ty/mod.ts";
import { DefId } from "../rustc_span/def_id.ts";
import "./lib.ts";
import { FnCtxt } from "./decls.ts";
import { AdjustMode, is_number, MutblCap, type PatInfo, ResolvedPat } from "./pat.ts";

test("is_number: every char an ASCII digit", () => {
  expect(is_number("0123")).toBe(true);
  expect(is_number("")).toBe(true);
  expect(is_number("1a")).toBe(false);
  expect(is_number("١")).toBe(false); // ARABIC-INDIC DIGIT ONE is not ASCII
});

test("AdjustMode::peel_until_adt / peel_all", () => {
  expect(AdjustMode.peel_all()).toEqual({ $: "Peel", kind: { $: "Implicit", until_adt: undefined, pat_ref_layers: 0 } });
  const did = new DefId(7 as never, 0 as never);
  expect(AdjustMode.peel_until_adt(did)).toEqual({ $: "Peel", kind: { $: "Implicit", until_adt: did, pat_ref_layers: 0 } });
});

test("MutblCap::cap_to_weakly_not / as_mutbl", () => {
  expect(MutblCap.cap_to_weakly_not(MutblCap.Not, undefined)).toBe(MutblCap.Not);
  expect(MutblCap.cap_to_weakly_not(MutblCap.Mut, undefined)).toEqual({ $: "WeaklyNot", _0: undefined });
  expect(MutblCap.as_mutbl(MutblCap.Not)).toBe("Not");
  expect(MutblCap.as_mutbl({ $: "WeaklyNot", _0: undefined })).toBe("Not");
  expect(MutblCap.as_mutbl(MutblCap.Mut)).toBe("Mut");
});

test("ResolvedPat::adjust_mode: constants pass, other paths peel until their ADT", () => {
  const ty = { ty_adt_def: () => undefined } as unknown as Ty;
  const const_res = { $: "Def" as const, _0: DefKind.Const, _1: new DefId(1 as never, 0 as never) };
  const ctor_res = { $: "Def" as const, _0: { $: "Ctor" as const, _0: "Struct" as const, _1: "Const" as const }, _1: new DefId(2 as never, 0 as never) };
  expect(new ResolvedPat(ty, { $: "Path", res: const_res, pat_res: const_res, segments: [] }).adjust_mode()).toBe(AdjustMode.Pass);
  expect(new ResolvedPat(ty, { $: "Path", res: ctor_res, pat_res: ctor_res, segments: [] }).adjust_mode()).toEqual(AdjustMode.peel_all());
});

const pat_info = (binding_mode: ByRef): PatInfo =>
  ({
    binding_mode,
    max_pinnedness: "Not",
    max_ref_mutbl: MutblCap.Mut,
    top_info: undefined,
    decl_origin: undefined,
    current_depth: 3,
  }) as unknown as PatInfo;

test("FnCtxt::adjust_pat_info: default binding modes through & / &mut / &pin", () => {
  const fcx = { downgrade_mut_inside_shared: () => false } as unknown as FnCtxt;
  const adjust = (pin: "Not" | "Pinned", m: "Not" | "Mut", info: PatInfo): PatInfo => FnCtxt.prototype.adjust_pat_info.call(fcx, pin, m, info);

  // by-value through `&mut` -> `ref mut`, no cap
  let r = adjust("Not", "Mut", pat_info({ $: "No" }));
  expect(r.binding_mode).toEqual({ $: "Yes", _0: "Not", _1: "Mut" });
  expect(r.max_ref_mutbl).toBe(MutblCap.Mut);
  expect(r.current_depth).toBe(3);
  // by-value through `&` -> `ref`, mutability capped to `Not`
  r = adjust("Not", "Not", pat_info({ $: "No" }));
  expect(r.binding_mode).toEqual({ $: "Yes", _0: "Not", _1: "Not" });
  expect(r.max_ref_mutbl).toBe(MutblCap.Not);
  // once `ref`, always `ref`
  r = adjust("Not", "Mut", pat_info({ $: "Yes", _0: "Not", _1: "Not" }));
  expect(r.binding_mode).toEqual({ $: "Yes", _0: "Not", _1: "Not" });
  // `ref mut` through `&pin mut` -> `ref pin mut`, pinnedness capped
  r = adjust("Pinned", "Mut", pat_info({ $: "Yes", _0: "Not", _1: "Mut" }));
  expect(r.binding_mode).toEqual({ $: "Yes", _0: "Pinned", _1: "Mut" });
  expect(r.max_pinnedness).toBe("Pinned");
});

test("FnCtxt::should_peel_ref: patterns without reference layers always peel", () => {
  const fcx = {} as unknown as FnCtxt;
  expect(FnCtxt.prototype.should_peel_ref.call(fcx, { $: "ExplicitDerefPat" }, {} as Ty)).toBe(true);
  expect(FnCtxt.prototype.should_peel_ref.call(fcx, { $: "Implicit", until_adt: undefined, pat_ref_layers: 0 }, {} as Ty)).toBe(true);
});
