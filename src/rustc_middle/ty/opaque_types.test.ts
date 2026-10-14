// Lane assoc-opaque: `ReverseMapper` (ty/opaque_types.rs) on regions, over a bare `TyCtxt` of fresh interners (as
// interning.test.ts). Expected values read off opaque_types.rs:97 `fold_region` and :36 / :44.
import { describe, expect, test } from "bun:test";
import "../lib.ts";
import { kw } from "../../rustc_span/symbol.ts";
import type { RegionVid } from "../../rustc_type_ir/decls.ts";
import { Region } from "../../rustc_type_ir/sty/mod.ts";
import { Panic } from "../../std/panic.ts";
import { CommonLifetimes, CommonTypes, CtxtInterners, type GlobalCtxt, TyCtxt } from "./context.ts";
import { GenericArg } from "./generic_args.ts";
import { ReverseMapper } from "./opaque_types.ts";
import { DUMMY_SP } from "../../rustc_span/lib.ts";

/** A `TyCtxt` over a fresh `CtxtInterners` (the interning methods read only `interners` / `types` / `lifetimes`). */
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

describe("ReverseMapper::fold_region", () => {
  test("'static, erased and bound regions are returned as they are", () => {
    const tcx = mk_tcx();
    const m = ReverseMapper.new(tcx, new Map(), DUMMY_SP);
    expect(m.fold_region(tcx.lifetimes.re_static)).toBe(tcx.lifetimes.re_static);
    expect(m.fold_region(tcx.lifetimes.re_erased)).toBe(tcx.lifetimes.re_erased);
    const bound = tcx.lifetimes.anon_re_bounds[0]![0]!;
    expect(m.fold_region(bound)).toBe(bound);
  });

  test("an early-bound region in the map is replaced by its mapped lifetime", () => {
    const tcx = mk_tcx();
    const from = Region.new_early_param(tcx, { index: 0, name: kw.UnderscoreLifetime });
    const to = Region.new_early_param(tcx, { index: 3, name: kw.UnderscoreLifetime });
    const m = ReverseMapper.new(tcx, new Map([[GenericArg.from_Region(from), GenericArg.from_Region(to)]]), DUMMY_SP);
    expect(m.fold_region(from)).toBe(to);
  });

  test("a missing region is 'static while `do_not_error` is set", () => {
    const tcx = mk_tcx();
    const r = Region.new_early_param(tcx, { index: 1, name: kw.UnderscoreLifetime });
    const m = ReverseMapper.new(tcx, new Map(), DUMMY_SP);
    m.do_not_error = true;
    expect(m.fold_region(r)).toBe(tcx.lifetimes.re_static);
  });

  test("inference and placeholder regions are a bug", () => {
    const tcx = mk_tcx();
    const m = ReverseMapper.new(tcx, new Map(), DUMMY_SP);
    expect(() => m.fold_region(tcx.intern_region({ $: "ReVar", _0: 3 as RegionVid }))).toThrow(Panic);
  });

  test("fold_kind_no_missing_regions_error asserts it is not nested", () => {
    const tcx = mk_tcx();
    const m = ReverseMapper.new(tcx, new Map(), DUMMY_SP);
    m.do_not_error = true;
    expect(() => m.fold_kind_no_missing_regions_error(GenericArg.from_Region(tcx.lifetimes.re_static))).toThrow(Panic);
    expect(() => m.fold_kind_normally(GenericArg.from_Region(tcx.lifetimes.re_static))).toThrow(Panic);
  });
});
