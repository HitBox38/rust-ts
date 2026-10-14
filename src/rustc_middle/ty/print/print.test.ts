// Unit tests of lane ty-print-a (ty/print/mod.rs, pretty.rs:1..1704) on a `TyCtxt` over fresh interners (as
// rustc_type_ir/tyir_kind.test.ts). The printing of real types and def paths against the oracle is
// print.oracle.test.ts; this file covers the thread-local guards, region highlighting, the `PrettyPrinter` helpers,
// `characteristic_def_id_of_type` and the trimmed-path decisions of `try_print_trimmed_def_path`, whose expected values
// follow from the upstream code cited in each test.
import { describe, expect, test } from "bun:test";
import "../../lib.ts";
import { CrateNum, DefId, DefIndex } from "../../../rustc_span/def_id.ts";
import { create_default_session_globals_then } from "../../../rustc_span/lib.ts";
import { Symbol } from "../../../rustc_span/symbol.ts";
import type { BoundRegionKind } from "../../../rustc_type_ir/decls.ts";
import { Panic } from "../../../std/panic.ts";
import { Err, Ok } from "../../../std/result.ts";
import { CommonLifetimes, CommonTypes, CtxtInterners, type GlobalCtxt, TyCtxt } from "../context.ts";
import type { Ty } from "../mod.ts";
import { characteristic_def_id_of_type, PRINT_OK, type PrintResult, print_Ty } from "./mod.ts";
import {
  RegionHighlightMode,
  WrapBinderMode,
  with_crate_prefix,
  with_forced_impl_filename_line,
  with_forced_trimmed_paths,
  with_no_queries,
  with_no_trimmed_paths,
  with_no_visible_paths,
  with_no_visible_paths_if_doc_hidden,
  with_reduced_queries,
  with_resolve_crate_name,
} from "./pretty.ts";
import { FmtPrinter } from "./pretty.ts";
import { Limit } from "../../../rustc_structures/limit.ts";

// merge-w15a: the tests print with ty-print-b's `FmtPrinter` (ty-print-a's reduced `TestPrinter` is gone). Printers are
// made with `new_with_limit(.., 2^24)` because `FmtPrinter::new` reads the `limits` query (rustc_interface/limits.ts's
// `hir_krate_attrs` stand-in, see ty-print-b's handoff).
const new_printer = (tcx: TyCtxt): FmtPrinter => FmtPrinter.new_with_limit(tcx, "TypeNS", Limit.new(2 ** 24));

interface FakeOpts {
  trim_diagnostic_paths: boolean;
  trimmed_def_paths: boolean;
}

/** A `TyCtxt` over fresh interners; `sess` and the `trimmed_def_paths` query are fakes for the trimmed-path tests. */
function mk_tcx(opts: FakeOpts = { trim_diagnostic_paths: true, trimmed_def_paths: true }, trimmed = new Map<number, Symbol>()): TyCtxt {
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
    sess: {
      opts: { trimmed_def_paths: opts.trimmed_def_paths, unstable_opts: { trim_diagnostic_paths: opts.trim_diagnostic_paths } },
      verbose_internals: () => false,
    },
  };
  const tcx = new TyCtxt(gcx as unknown as GlobalCtxt);
  // The `trimmed_def_paths` provider is lane ty-print-b's (pretty.rs:3528): the tests give its result.
  Object.defineProperty(tcx, "trimmed_def_paths", { value: () => ({ get: (d: DefId) => trimmed.get(DefIndex.as_u32(d.index)) }) });
  return tcx;
}

const def = (i: number): DefId => new DefId(DefIndex.from_u32(i), 3 as CrateNum);

describe("define_helper! thread-locals", () => {
  const helpers = [
    with_reduced_queries,
    with_forced_impl_filename_line,
    with_resolve_crate_name,
    with_crate_prefix,
    with_no_trimmed_paths,
    with_forced_trimmed_paths,
    with_no_visible_paths,
    with_no_visible_paths_if_doc_hidden,
  ];

  test("each flag is false outside its guard, true inside, and restored after", () => {
    for (const h of helpers) {
      expect(h()).toBe(false);
      expect(h(() => h())).toBe(true);
      expect(h()).toBe(false);
      // The guard keeps the old value: nested guards restore `true`, then `false`.
      expect(h(() => [h(() => h()), h()])).toEqual([true, true]);
      expect(h()).toBe(false);
    }
  });

  test("the guard's Drop restores the flag when the body panics", () => {
    expect(() =>
      with_no_trimmed_paths(() => {
        throw new Panic("boom");
      }),
    ).toThrow("boom");
    expect(with_no_trimmed_paths()).toBe(false);
  });

  test("the flags are independent", () => {
    expect(with_crate_prefix(() => [with_crate_prefix(), with_no_trimmed_paths(), with_resolve_crate_name()])).toEqual([true, false, false]);
  });

  test("with_no_queries! sets reduced queries, forced impl filename/line, no trimmed paths and no visible paths", () => {
    expect(
      with_no_queries(() => [
        with_reduced_queries(),
        with_forced_impl_filename_line(),
        with_no_trimmed_paths(),
        with_no_visible_paths(),
        with_forced_trimmed_paths(),
        with_crate_prefix(),
      ]),
    ).toEqual([true, true, true, true, false, false]);
    expect([with_reduced_queries(), with_forced_impl_filename_line(), with_no_trimmed_paths(), with_no_visible_paths()]).toEqual([false, false, false, false]);
  });
});

test("WrapBinderMode::start_str", () => {
  expect(WrapBinderMode.start_str("ForAll")).toBe("for<");
  expect(WrapBinderMode.start_str("Unsafe")).toBe("unsafe<");
});

describe("RegionHighlightMode", () => {
  test("highlighting_region fills the three slots in order, then is a bug", () => {
    const tcx = mk_tcx();
    const [re_static, re_erased] = [tcx.lifetimes.re_static, tcx.lifetimes.re_erased];
    const h = RegionHighlightMode.default();
    expect(h.keep_regions).toBe(false);
    expect(h.region_highlighted(re_static)).toBeUndefined();
    h.highlighting_region(re_static, 4);
    expect(h.keep_regions).toBe(true);
    h.highlighting_region(re_erased, 7);
    // The first matching slot wins.
    h.highlighting_region(re_static, 9);
    expect([h.region_highlighted(re_static), h.region_highlighted(re_erased)]).toEqual([4, 7]);
    expect(() => h.highlighting_region(re_erased, 1)).toThrow("can only highlight 3 placeholders at a time");
  });

  test("maybe_highlighting_region keeps regions even without a highlight", () => {
    const tcx = mk_tcx();
    const h = RegionHighlightMode.default();
    h.maybe_highlighting_region(tcx.lifetimes.re_static, undefined);
    expect(h.keep_regions).toBe(true);
    expect(h.highlight_regions).toEqual([undefined, undefined, undefined]);
    h.maybe_highlighting_region(tcx.lifetimes.re_static, 2);
    expect(h.region_highlighted(tcx.lifetimes.re_static)).toBe(2);
  });

  test("only one bound region can be highlighted", () => {
    const h = RegionHighlightMode.default();
    const br: BoundRegionKind = { $: "Anon" } as BoundRegionKind;
    h.highlighting_bound_region(br, 1);
    expect(h.highlight_bound_region).toEqual([br, 1]);
    expect(() => h.highlighting_bound_region(br, 2)).toThrow("assertion failed");
  });

  test("a copy does not share the slots", () => {
    const tcx = mk_tcx();
    const h = RegionHighlightMode.default();
    const c = h.clone();
    c.highlighting_region(tcx.lifetimes.re_static, 0);
    expect(h.region_highlighted(tcx.lifetimes.re_static)).toBeUndefined();
  });
});

describe("characteristic_def_id_of_type", () => {
  test("primitives and tuples of them have none; foreign types, refs, pointers, slices and tuples find one", () => {
    const tcx = mk_tcx();
    const t = tcx.types;
    const mk = tcx.mk_ty_from_kind.bind(tcx);
    const foreign = mk({ $: "Foreign", _0: def(5) });
    const tup = (ts: Ty[]): Ty => mk({ $: "Tuple", _0: tcx.mk_type_list(ts) });
    expect(characteristic_def_id_of_type(t.bool)).toBeUndefined();
    expect(characteristic_def_id_of_type(tup([t.u8, t.str_]))).toBeUndefined();
    expect(characteristic_def_id_of_type(foreign)).toEqual(def(5));
    expect(characteristic_def_id_of_type(mk({ $: "Ref", _0: tcx.lifetimes.re_static, _1: foreign, _2: "Not" }))).toEqual(def(5));
    expect(characteristic_def_id_of_type(mk({ $: "RawPtr", _0: foreign, _1: "Mut" }))).toEqual(def(5));
    expect(characteristic_def_id_of_type(mk({ $: "Slice", _0: foreign }))).toEqual(def(5));
    // `find_map` over the tuple: the first element with a characteristic `DefId`.
    expect(characteristic_def_id_of_type(tup([t.bool, foreign, mk({ $: "Foreign", _0: def(6) })]))).toEqual(def(5));
    // A repeated element is visited once (`visited.insert`), so a later copy cannot answer.
    const inner = tup([t.char]);
    expect(characteristic_def_id_of_type(tup([inner, inner, foreign]))).toEqual(def(5));
  });
});

describe("PrettyPrinter helpers", () => {
  const print = (tcx: TyCtxt, f: (p: FmtPrinter) => PrintResult): string => {
    const p = new_printer(tcx);
    if (f(p).$ === "Err") throw new Error("ERROR: fmt::Error");
    return p.into_buffer();
  };

  test("comma_sep, typed_value, parenthesized, maybe_parenthesized", () => {
    const tcx = mk_tcx();
    const t = tcx.types;
    expect(print(tcx, (p) => p.comma_sep([t.u8, t.bool, t.str_], print_Ty))).toBe("u8, bool, str");
    expect(print(tcx, (p) => p.comma_sep([], print_Ty))).toBe("");
    expect(print(tcx, (p) => p.typed_value((p) => p.write_str("1"), (p) => print_Ty(t.u8, p), ": "))).toBe("{1: u8}");
    expect(print(tcx, (p) => p.parenthesized((p) => print_Ty(t.i32, p)))).toBe("(i32)");
    expect(print(tcx, (p) => p.maybe_parenthesized((p) => print_Ty(t.i32, p), false))).toBe("i32");
    expect(print(tcx, (p) => p.maybe_parenthesized((p) => print_Ty(t.i32, p), true))).toBe("(i32)");
  });

  test("pretty_print_fn_sig: splatted argument index, C variadic with and without inputs", () => {
    const tcx = mk_tcx();
    const t = tcx.types;
    // pretty.rs:1504: the first `index` inputs, `, #[rustc_splat]`, then the rest.
    expect(print(tcx, (p) => p.pretty_print_fn_sig([t.u8, t.i32, t.bool], false, 1, t.unit))).toBe("(u8, #[rustc_splat]i32, bool)");
    expect(print(tcx, (p) => p.pretty_print_fn_sig([t.u8], false, 0, t.char))).toBe("(, #[rustc_splat]u8) -> char");
    expect(print(tcx, (p) => p.pretty_print_fn_sig([], true, undefined, t.unit))).toBe("(...)");
    expect(print(tcx, (p) => p.pretty_print_fn_sig([t.u8], true, undefined, t.never))).toBe("(u8, ...) -> !");
  });

  test("a fmt::Error from write_str stops printing and propagates", () => {
    const tcx = mk_tcx();
    const t = tcx.types;
    const p = new_printer(tcx);
    let writes = 0;
    p.write_str = (s: string) => (++writes === 2 ? Err({ $: "Error" as const }) : ((p._0.fmt += s), PRINT_OK));
    expect(p.comma_sep([t.u8, t.bool, t.char], print_Ty)).toEqual(Err({ $: "Error" }));
    expect([p.into_buffer(), writes]).toEqual(["u8", 2]);
  });
});

describe("try_print_trimmed_def_path / try_print_visible_def_path", () => {
  // `Symbol::intern` needs the session globals.
  const sg_test = (name: string, f: () => void) => test(name, () => create_default_session_globals_then(f));

  sg_test("a def with a trimmed name prints the name (an `Ident`, so keywords print raw)", () => {
    const vec = Symbol.intern("Vec");
    // `fn` is reserved in every edition (`async` only from 2018; the default session edition is 2015).
    const kw_fn = Symbol.intern("fn");
    const tcx = mk_tcx(undefined, new Map([[1, vec], [2, kw_fn]]));
    const p = new_printer(tcx);
    expect(p.try_print_trimmed_def_path(def(1))).toEqual(Ok(true));
    expect(p.try_print_trimmed_def_path(def(2))).toEqual(Ok(true));
    expect(p.into_buffer()).toBe("Vecr#fn");
    // Not in the map: nothing is printed.
    expect(p.try_print_trimmed_def_path(def(3))).toEqual(Ok(false));
    expect(p.into_buffer()).toBe("Vecr#fn");
  });

  sg_test("trimming is off under with_no_trimmed_paths!, with_crate_prefix!, or either option off", () => {
    const vec = Symbol.intern("Vec");
    const map = new Map([[1, vec]]);
    for (const [tcx, wrap] of [
      [mk_tcx(undefined, map), with_no_trimmed_paths],
      [mk_tcx(undefined, map), with_crate_prefix],
      [mk_tcx({ trim_diagnostic_paths: false, trimmed_def_paths: true }, map), (f: () => unknown) => f()],
      [mk_tcx({ trim_diagnostic_paths: true, trimmed_def_paths: false }, map), (f: () => unknown) => f()],
    ] as const) {
      const p = new_printer(tcx);
      expect(wrap(() => p.try_print_trimmed_def_path(def(1)))).toEqual(Ok(false));
      expect(p.into_buffer()).toBe("");
    }
  });

  test("with_no_visible_paths! disables visible paths", () => {
    const p = new_printer(mk_tcx());
    expect(with_no_visible_paths(() => p.try_print_visible_def_path(def(1)))).toEqual(Ok(false));
    expect(p.into_buffer()).toBe("");
  });
});

