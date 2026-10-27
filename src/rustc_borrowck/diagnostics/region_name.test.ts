// Unit tests of diagnostics/region_name.ts and the context-free parts of region_errors.ts (lane bck-diag-e): the
// `'N` counter of `synthesize_region_name`, `give_region_a_name`'s memoization, `RegionName` accessors / Display /
// `IntoDiagArg`, and `ConstraintCategory::description` (the borrowck runtime path does not reach region error reporting
// yet). Expected values follow upstream's code (region_name.rs:72-217, region_errors.rs:42-101).
import { expect, test } from "bun:test";
import "../lib.ts";
import { create_default_session_globals_then, type Span } from "../../rustc_span/lib.ts";
import { kw, Symbol } from "../../rustc_span/symbol.ts";
import type { RegionVid } from "../../rustc_type_ir/region_kind.ts";
import { PLAIN } from "../../std/fmt.ts";
import { MirBorrowckCtxt } from "../lib.gen.ts";
import { ConstraintDescription_ConstraintCategory } from "./region_errors.ts";
import { display_RegionName, RegionName, type RegionNameSource, RegionName_into_diag_arg } from "./region_name.ts";
import { debug_RegionName } from "./region_name.gen.ts";

const sp = (n: number) => n as Span;

test("synthesize_region_name counts '1, '2, ... and give_region_a_name memoizes", () => {
  create_default_session_globals_then(() => {
    const mbcx = Object.create(MirBorrowckCtxt.prototype) as MirBorrowckCtxt;
    mbcx.next_region_name = 1;
    mbcx.region_names = new Map();
    expect(Symbol.as_str(mbcx.synthesize_region_name())).toBe("'1");
    expect(Symbol.as_str(mbcx.synthesize_region_name())).toBe("'2");
    expect(mbcx.next_region_name).toBe(3);

    // A memoized name is returned without consulting the naming strategies (or the counter).
    const named = new RegionName(Symbol.intern("'a"), { $: "NamedLateParamRegion", _0: sp(0) });
    (mbcx as unknown as { regioncx: unknown }).regioncx = { universal_regions: () => ({ is_universal_region: () => true }) };
    mbcx.region_names.set(7 as RegionVid, named);
    expect(mbcx.give_region_a_name(7 as RegionVid)).toBe(named);
    expect(mbcx.next_region_name).toBe(3);
  });
});

test("RegionName: was_named / span / Display / IntoDiagArg / Debug", () => {
  create_default_session_globals_then(() => {
    const name = Symbol.intern("'1");
    const cases: [RegionNameSource, boolean, Span | undefined][] = [
      [{ $: "NamedEarlyParamRegion", _0: sp(0) }, true, sp(0)],
      [{ $: "NamedLateParamRegion", _0: sp(0) }, true, sp(0)],
      [{ $: "Static" }, true, undefined],
      [{ $: "SynthesizedFreeEnvRegion", _0: sp(0), _1: "FnMut" }, false, sp(0)],
      [{ $: "AnonRegionFromArgument", _0: { $: "MatchedHirTy", _0: sp(0) } }, false, sp(0)],
      [{ $: "AnonRegionFromUpvar", _0: sp(0), _1: name }, false, sp(0)],
      [{ $: "AnonRegionFromOutput", _0: { $: "CannotMatchHirTy", _0: sp(0), _1: name }, _1: " of closure" }, false, sp(0)],
      [{ $: "AnonRegionFromYieldTy", _0: sp(0), _1: name }, false, sp(0)],
      [{ $: "AnonRegionFromAsyncFn", _0: sp(0) }, false, sp(0)],
      [{ $: "AnonRegionFromImplSignature", _0: sp(0), _1: "header" }, false, sp(0)],
    ];
    for (const [source, was_named, span] of cases) {
      const r = new RegionName(name, source);
      expect(`${source.$}: ${r.was_named()} ${r.span()}`).toBe(`${source.$}: ${was_named} ${span}`);
    }
    const r = new RegionName(kw.StaticLifetime, { $: "Static" });
    expect(display_RegionName(r)).toBe("'static");
    expect(RegionName_into_diag_arg(r, { value: undefined })).toEqual({ $: "Str", _0: "'static" });
    expect(debug_RegionName(new RegionName(kw.UnderscoreLifetime, { $: "Static" }), PLAIN)).toBe(`RegionName { name: "'_", source: Static }`);
  });
});

test("ConstraintCategory::description ends with a space (or is empty)", () => {
  const d = ConstraintDescription_ConstraintCategory.description;
  expect(d({ $: "Assignment" })).toBe("assignment ");
  expect(d({ $: "Return", _0: { $: "Normal" } })).toBe("returning this value ");
  expect(d({ $: "Cast", is_raw_ptr_dyn_type_cast: false, is_implicit_coercion: false, unsize_to: undefined })).toBe("cast ");
  expect(d({ $: "Cast", is_raw_ptr_dyn_type_cast: false, is_implicit_coercion: true, unsize_to: undefined })).toBe("coercion ");
  expect(d({ $: "CallArgument", _0: undefined })).toBe("argument ");
  expect(d({ $: "TypeAnnotation", _0: "GenericArg" })).toBe("generic argument ");
  expect(d({ $: "TypeAnnotation", _0: "Ascription" })).toBe("type annotation ");
  expect(d({ $: "SizedBound" })).toBe("proving this value is `Sized` ");
  expect(d({ $: "Boring" })).toBe("");
  expect(d({ $: "Internal" })).toBe("");
});
