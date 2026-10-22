// Not a port: the driver of rustc.test.ts (lane pat-c). It compiles a `#![no_core]` library with the ported driver up to
// type checking (src/rust_ts/tydump_dump.ts `run_required_analyses_prefix`, as the thirdump suite), then exercises
// `RustcPatCtxt` (rustc.ts) on the THIR of its bodies:
//   bun src/rustc_pattern_analysis/rustc_test_driver.ts <scenario> <file.rs>
// - `lower`: for every `match` of every body: the scrutinee's `ctors_for_ty`, and for every arm `lower_pat` (its
//   `Debug`, constructor, arity, `ctor_sub_tys` with `!` for `PrivateUninhabitedField(true)`) and the arm printed back
//   with `print_witness_pat` (the lowered pattern turned into witnesses: or-patterns give one per alternative, missing
//   fields are wildcards);
// - `witness`: hand-built witnesses (the ones usefulness reports for the `wN` fns of rustc.test.ts, on their scrutinee
//   types) printed with `print_witness_pat`, and the helpers around it;
// - `hooks`: the `PatCx` lint hooks called as usefulness calls them (`f`: overlapping endpoints, `g` / `h`: non-contiguous
//   endpoints), diagnostics on stderr;
// - `complexity`: `complexity_exceeded` on the first `match` of `k`.
// stdout gets the results, stderr the compiler's diagnostics; exit code as src/rust_ts/main.ts (70 = unported).
import { catch_with_exit_code, compiler_entrypoint } from "../rustc_driver_impl/lib.ts";
import type { Thir } from "../rustc_middle/thir.ts";
import type { AdtDef } from "../rustc_middle/ty/adt.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { TypingEnv } from "../rustc_middle/ty/mod.ts";
import { with_no_trimmed_paths } from "../rustc_middle/ty/print/pretty.ts";
import { LocalDefId } from "../rustc_span/def_id.ts";
import { display_Symbol } from "../rustc_span/symbol.ts";
import { run_required_analyses_prefix } from "../rust_ts/tydump_dump.ts";
import "../rustc_mir_build/lib.ts";
import { debug_ConstructorSet, IntRange, MaybeInfiniteInt, Slice } from "./constructor.ts";
import { debug_DeconstructedPat, debug_WitnessPat } from "./pat.ts";
import {
  Constructor,
  type DeconstructedPat,
  display_RevealedTy,
  type RevealedTy,
  RustcPatCtxt,
  RustcPatCtxtState,
  type RustcPatCtxtTypes,
  would_print_as_wildcard,
  WitnessPat,
} from "./rustc.ts";
import { PLAIN } from "../std/fmt.ts";
import { Panic, Unported } from "../std/panic.ts";

const [scenario, file] = process.argv.slice(2) as [string, string];
let out = "";

interface Body {
  cx: RustcPatCtxt;
  thir: Thir;
  /** the `match`es of the body: scrutinee type, arm patterns, the match's span */
  matches: { scrut_ty: RevealedTy; arms: DeconstructedPat[]; span: import("../rustc_span/lib.ts").Span }[];
}

/** The bodies by item name (`fn f` -> `f`), with a `RustcPatCtxt` set up as check_match's `new_cx` does. */
function bodies(tcx: TyCtxt): Map<string, Body> {
  const m = new Map<string, Body>();
  for (const did of tcx.hir_body_owners()) {
    const r = tcx.thir_body(did) as import("../std/result.ts").Result<[{ borrow(): Thir }, unknown], unknown>;
    if (r.$ === "Err") continue;
    const thir = r._0[0].borrow();
    const hir_id = tcx.local_def_id_to_hir_id(did);
    const cx = new RustcPatCtxt(
      tcx,
      tcx.typeck(did) as RustcPatCtxt["typeck_results"],
      tcx.parent_module(hir_id),
      TypingEnv.post_typeck_until_borrowck_for_mir_build(tcx, did),
      null,
      hir_id,
      undefined,
      thir.exprs[0]!.span,
      true,
      true,
      RustcPatCtxtState.default(),
    );
    const matches: Body["matches"] = [];
    for (const e of thir.exprs) {
      if (e.kind.$ !== "Match") continue;
      const scrut_ty = cx.reveal_opaque_ty(thir.exprs[e.kind.scrutinee]!.ty);
      matches.push({ scrut_ty, arms: e.kind.arms.map((a) => cx.lower_pat(thir.arms[a]!.pattern)), span: e.span });
    }
    // bodies without a `match` (anon consts of array lengths, ...) are not needed
    if (matches.length > 0) m.set(display_Symbol(tcx.item_name(LocalDefId.to_def_id(did))), { cx, thir, matches });
  }
  return m;
}

const dbg_pat = (p: DeconstructedPat) => debug_DeconstructedPat<RustcPatCtxtTypes>(RustcPatCtxt.prototype)(p, PLAIN);
const dbg_wit = (p: WitnessPat) => debug_WitnessPat<RustcPatCtxtTypes>(RustcPatCtxt.prototype)(p, PLAIN);

/** A lowered pattern as witnesses: one per alternative of its or-patterns; absent fields are wildcards. */
function to_witnesses(cx: RustcPatCtxt, p: DeconstructedPat): WitnessPat[] {
  const ctor = p.ctor();
  if (ctor.$ === "Or") return p.iter_fields().flatMap((ip) => to_witnesses(cx, ip.pat));
  if (ctor.$ === "Wildcard") return [WitnessPat.wildcard(cx, p.ty())];
  const sub_tys = cx.ctor_sub_tys(ctor, p.ty());
  let alts: WitnessPat[][] = [[]];
  for (let i = 0; i < p.arity(); i++) {
    const ip = p.iter_fields().find((f) => f.idx === i);
    const opts = ip === undefined ? [WitnessPat.wildcard(cx, sub_tys[i]![0])] : to_witnesses(cx, ip.pat);
    alts = alts.flatMap((a) => opts.map((o) => [...a, o]));
  }
  return alts.map((fs) => WitnessPat.new(ctor, fs, p.ty()));
}

function try_str(f: () => string): string {
  try {
    return f();
  } catch (e) {
    if (e instanceof Unported) return `<unported: ${e.what}>`;
    if (e instanceof Panic) return `<panic: ${e.message.split("\n")[0]}>`;
    throw e;
  }
}

function lower(tcx: TyCtxt): void {
  for (const [name, { cx, matches }] of bodies(tcx)) {
    if (matches.length === 0) continue;
    out += `${name}:\n`;
    for (const { scrut_ty, arms } of matches) {
      const set = cx.ctors_for_ty(scrut_ty);
      out += `  ${display_RevealedTy(scrut_ty)}: ${set.$ === "Ok" ? debug_ConstructorSet(set._0, PLAIN) : "Err"}\n`;
      for (const p of arms) {
        const ctor = p.ctor();
        const subs =
          ctor.$ === "Or"
            ? "-"
            : cx
                .ctor_sub_tys(ctor, p.ty())
                .map(([t, s]) => `${display_RevealedTy(t)}${s._0 ? "!" : ""}`)
                .join(", ");
        const printed = try_str(() => to_witnesses(cx, p).map((w) => cx.print_witness_pat(w)).join(" | "));
        out += `    ${dbg_pat(p)} | ${ctor.$}/${p.arity()} [${subs}] | ${printed}\n`;
      }
    }
  }
}

function witness(tcx: TyCtxt): void {
  const bs = bodies(tcx);
  const cx = bs.values().next().value!.cx;
  const ty = (f: string) => bs.get(f)!.matches[0]!.scrut_ty;
  /** `ctor` applied to `fields` (builders given the field's type; `undefined` = wildcard). */
  const mk = (ctor: Constructor, t: RevealedTy, ...fields: (((t: RevealedTy) => WitnessPat) | undefined)[]): WitnessPat => {
    const sub = cx.ctor_sub_tys(ctor, t);
    return WitnessPat.new(
      ctor,
      sub.map(([st], i) => (fields[i] !== undefined ? fields[i]!(st) : WitnessPat.wildcard(cx, st))),
      t,
    );
  };
  const b = (v: boolean) => (t: RevealedTy) => mk({ $: "Bool", _0: v }, t);
  const uint = (lo: bigint, hi: bigint | undefined) =>
    new IntRange(MaybeInfiniteInt.new_finite_uint(lo), hi === undefined ? MaybeInfiniteInt.PosInfinity : MaybeInfiniteInt.new_finite_uint(hi));
  /** `lo..=hi` of a signed type of `size` bits; `lo`/`hi` are the values' bits (`-1i8` is `0xff`), `undefined` the
   *  infinities (`IntRange { lo: NegInfinity, .. }`, or `hi` = `PosInfinity`) */
  const int = (lo: bigint | undefined, hi: bigint | undefined, size: number) =>
    hi === undefined
      ? new IntRange(MaybeInfiniteInt.new_finite_int(lo!, size), MaybeInfiniteInt.PosInfinity)
      : lo === undefined
        ? new IntRange(MaybeInfiniteInt.NegInfinity, MaybeInfiniteInt.plus_one(MaybeInfiniteInt.new_finite_int(hi, size))!)
        : IntRange.from_range(MaybeInfiniteInt.new_finite_int(lo, size), MaybeInfiniteInt.new_finite_int(hi, size), "Included");
  const range = (r: IntRange) => (t: RevealedTy) => mk({ $: "IntRange", _0: r }, t);
  const slice = (len: number | undefined, kind: Slice["kind"]): Constructor => ({ $: "Slice", _0: Slice.new(len, kind) });
  const cases: [string, () => WitnessPat][] = [
    ["w1", () => mk({ $: "Variant", _0: 0 as never }, ty("w1"))],
    ["w2", () => mk(Constructor.Struct, ty("w2"), b(false))],
    ["w3", () => mk(Constructor.Struct, ty("w3"), b(false))],
    ["w4", () => mk(Constructor.Ref, ty("w4"), (t) => mk({ $: "Variant", _0: 0 as never }, t))],
    ["w5", () => mk(Constructor.Ref, ty("w5"), (t) => mk(slice(undefined, { $: "VarLen", _0: 1, _1: 0 }), t, b(false)))],
    ["w6", () => mk(slice(4, { $: "VarLen", _0: 1, _1: 1 }), ty("w6"), b(false))],
    ["w7", () => mk(Constructor.Struct, ty("w7"), b(false))],
    ["w8", () => range(int(0x80n, 0xffn, 8))(ty("w8"))],
    ["w8", () => range(int(11n, 0x7fn, 8))(ty("w8"))],
    ["w9", () => range(uint(11n, undefined))(ty("w9"))],
    ["w10", () => range(uint(0n, 0x60n + 1n))(ty("w10"))],
    ["w10", () => range(uint(0x7bn, 0xd800n))(ty("w10"))],
    ["w10", () => range(uint(0xe000n, 0x110000n))(ty("w10"))],
    ["w12", () => range(int(undefined, (1n << 64n) - 1n, 64))(ty("w12"))],
    ["w13", () => mk(Constructor.Struct, ty("w13"), (t) => mk(Constructor.Struct, t, b(false)))],
    ["w14", () => mk(Constructor.Ref, ty("w14"), (t) => mk(slice(undefined, { $: "FixedLen", _0: 1 }), t))],
    // not from the oracle's E0004s (see rustc.test.ts)
    ["e_c", () => mk({ $: "Variant", _0: 2 as never }, ty("w1"), range(uint(3n, 6n)), (t) => mk(Constructor.Struct, t, b(true)))],
    ["e_c_wild", () => WitnessPat.wild_from_ctor(cx, { $: "Variant", _0: 2 as never }, ty("w1"))],
    ["e_b", () => mk({ $: "Variant", _0: 1 as never }, ty("w1"), b(true))],
    ["full_range", () => range(new IntRange(MaybeInfiniteInt.NegInfinity, MaybeInfiniteInt.PosInfinity))(ty("w12"))],
    ["usize_max_plus_one", () => range(uint(1n << 64n, undefined))(ty("w9"))],
    ["never", () => WitnessPat.new<RustcPatCtxtTypes>(Constructor.Never, [], ty("w2"))],
    ["non_exhaustive", () => WitnessPat.new<RustcPatCtxtTypes>(Constructor.NonExhaustive, [], ty("w1"))],
    ["hidden", () => WitnessPat.new<RustcPatCtxtTypes>(Constructor.Hidden, [], ty("w1"))],
    ["private_uninhabited", () => WitnessPat.new<RustcPatCtxtTypes>(Constructor.PrivateUninhabited, [], ty("w1"))],
    ["deref", () => WitnessPat.new<RustcPatCtxtTypes>({ $: "DerefPattern", _0: ty("w2") }, [WitnessPat.wildcard(cx, ty("w2"))], ty("w4"))],
    ["slice_merge", () => mk(slice(6, { $: "VarLen", _0: 2, _1: 2 }), ty("w15"), b(true), undefined, undefined, b(false))],
    ["slice_fixed", () => mk(slice(4, { $: "VarLen", _0: 2, _1: 2 }), ty("w6"), b(true), undefined, undefined, b(false))],
    ["slice_no_merge", () => mk(Constructor.Ref, ty("w5"), (t) => mk(slice(undefined, { $: "VarLen", _0: 2, _1: 2 }), t, b(true), undefined, undefined, b(false)))],
    ["str", () => bs.get("s")!.matches[0]!.arms[0]!.iter_fields().map((ip) => WitnessPat.new(ip.pat.ctor(), [], ip.pat.ty()))[0]!],
    ["missing", () => WitnessPat.new<RustcPatCtxtTypes>(Constructor.Missing, [], ty("w1"))],
  ];
  for (const [name, f] of cases) {
    out += `${name}: ${try_str(() => {
      const w = f();
      return `${cx.print_witness_pat(w)} (wildcard: ${would_print_as_wildcard(tcx, w)})`;
    })}\n`;
  }
  // `Debug` of a witness (pat.rs) goes through `write_variant_name` (rustc.rs:919)
  out += `debug e_c: ${dbg_wit(cases.find(([n]) => n === "e_c")![1]())}\n`;
  // the other `RustcPatCtxt` helpers
  const isize = ty("w12");
  const usize = ty("w9");
  const isize_neg_inf_to_min = new IntRange(MaybeInfiniteInt.NegInfinity, MaybeInfiniteInt.new_finite_int(1n << 63n, 64));
  out += `is_range_beyond_boundaries: isize ..MIN ${cx.is_range_beyond_boundaries(isize_neg_inf_to_min, isize)}`;
  out += `, isize ..=-1 ${cx.is_range_beyond_boundaries(int(undefined, (1n << 64n) - 1n, 64), isize)}`;
  out += `, isize 0.. ${cx.is_range_beyond_boundaries(int(0n, undefined, 64), isize)}`;
  out += `, usize MAX+1.. ${cx.is_range_beyond_boundaries(uint(1n << 64n, undefined), usize)}`;
  out += `, usize 11.. ${cx.is_range_beyond_boundaries(uint(11n, undefined), usize)}`;
  out += `, i8 ..=-1 ${cx.is_range_beyond_boundaries(int(undefined, 0xffn, 8), ty("w8"))}\n`;
  out += `is_exhaustive_patterns_feature_on: ${cx.is_exhaustive_patterns_feature_on()}`;
  out += `, match_may_contain_deref_pats: ${cx.match_may_contain_deref_pats()}`;
  out += `, is_foreign_non_exhaustive_enum(E): ${cx.is_foreign_non_exhaustive_enum(ty("w1"))}`;
  out += `, is_uninhabited(Void): ${cx.is_uninhabited(ty("v"))}, is_uninhabited(E): ${cx.is_uninhabited(ty("w1"))}\n`;
  out += `variant_index_for_adt: Variant(2) ${RustcPatCtxt.variant_index_for_adt({ $: "Variant", _0: 2 as never }, (ty("w1").kind() as unknown as { _0: AdtDef })._0)}`;
  out += `, Struct ${RustcPatCtxt.variant_index_for_adt(Constructor.Struct, (ty("w7").kind() as unknown as { _0: AdtDef })._0)}\n`;
  out += `write_variant_name: ${RustcPatCtxt.prototype.write_variant_name(PLAIN, { $: "Variant", _0: 1 as never }, ty("w1"))}`;
  out += ` ${RustcPatCtxt.prototype.write_variant_name(PLAIN, Constructor.Struct, ty("w7"))} "${RustcPatCtxt.prototype.write_variant_name(PLAIN, Constructor.Struct, ty("w2"))}"\n`;
}

function hooks(tcx: TyCtxt): void {
  const bs = bodies(tcx);
  const u8 = (n: bigint) => MaybeInfiniteInt.new_finite_uint(n);
  // usefulness.rs's `lint_overlapping_range_endpoints`: the later range, the overlap, the earlier ranges
  {
    const { cx, matches } = bs.get("f")!;
    const [a, b] = matches[0]!.arms as [DeconstructedPat, DeconstructedPat];
    cx.lint_overlapping_range_endpoints(b, IntRange.from_singleton(u8(10n)), [a]);
  }
  // usefulness.rs's `lint_non_contiguous_range_endpoints`: the exclusive range, the gap, the ranges after the gap
  {
    const { cx, matches } = bs.get("g")!;
    const [a, b] = matches[0]!.arms as [DeconstructedPat, DeconstructedPat];
    cx.lint_non_contiguous_range_endpoints(a, IntRange.from_singleton(u8(10n)), [b]);
    // an inclusive range: no lint
    cx.lint_non_contiguous_range_endpoints(b, IntRange.from_singleton(u8(21n)), []);
  }
  {
    const { cx, matches } = bs.get("h")!;
    const [a] = matches[0]!.arms as [DeconstructedPat];
    cx.lint_non_contiguous_range_endpoints(a, IntRange.from_singleton(u8(255n)), []);
  }
  out += "hooks done\n";
}

function complexity(tcx: TyCtxt): void {
  const { cx, matches } = bodies(tcx).get("k")!;
  cx.whole_match_span = matches[0]!.span;
  const r = cx.complexity_exceeded();
  out += `complexity_exceeded: ${r.$}\n`;
}

const code = catch_with_exit_code(() =>
  compiler_entrypoint(["rustc", file, "--edition", "2021", "--emit=metadata"], {
    config(): void {},
    after_expansion(_compiler: unknown, tcx: TyCtxt): "Stop" | "Continue" {
      run_required_analyses_prefix(tcx);
      tcx.dcx().abort_if_errors();
      // `print_witness_pat` runs inside diagnostics upstream; here the trimmed-paths machinery would expect one.
      with_no_trimmed_paths(() => {
        switch (scenario) {
          case "lower":
            return lower(tcx);
          case "witness":
            return witness(tcx);
          case "hooks":
            return hooks(tcx);
          case "complexity":
            return complexity(tcx);
          default:
            throw new Error(`unknown scenario ${scenario}`);
        }
      });
      return "Stop";
    },
  } as unknown as Parameters<typeof compiler_entrypoint>[1]),
);
process.stdout.write(out);
process.exitCode = code;
