// Lane ty-mod-a: rustc_middle ty/mod.rs lines 1-1112 on interned values and a real `TyCtxt` (interners only):
// `Asyncness`, `RestrictionKind`, `ImplTraitHeader::is_fully_generic_for_reflection`, the `Term` impls,
// `InstantiatedClauses`, `ParamEnv`, `TypingEnv`, and the derived Debug output.
import { describe, expect, test } from "bun:test";
import "../lib.ts";
import { DefId, DefIndex, LOCAL_CRATE, type CrateNum } from "../../rustc_span/def_id.ts";
import { DUMMY_SP, type Span } from "../../rustc_span/lib.ts";
import { kw } from "../../rustc_span/symbol.ts";
import { Constness } from "../../rustc_hir/lib.ts";
import type { ConstVid, TyVid } from "../../rustc_type_ir/decls.ts";
import { type TypeFolder, TypeFolder_provided } from "../../rustc_type_ir/fold.ts";
import { Const, type Region } from "../../rustc_type_ir/sty/mod.ts";
import { TypeVisitableExt } from "../../rustc_type_ir/visit.ts";
import { TypeFlags } from "../../rustc_type_ir/flags.ts";
import { TypeFlags_empty } from "../../rustc_type_ir/decls.ts";
import { PLAIN, PRETTY } from "../../std/fmt.ts";
import { Panic, Unported } from "../../std/panic.ts";
import { CommonLifetimes, CommonTypes, CtxtInterners, type GlobalCtxt, TyCtxt } from "./context.ts";
import { GenericArg } from "./generic_args.ts";
import { RawList } from "./list.ts";
import {
  Asyncness,
  debug_Asyncness,
  debug_DefiningScopeKind,
  debug_ParamEnv,
  debug_ParamEnvAnd,
  debug_RestrictionKind,
  debug_Term,
  debug_TypingEnv,
  decode_Term,
  fold_Term,
  flags_Clauses,
  ImplTraitHeader,
  InstantiatedClauses,
  ParamEnv,
  ParamEnv_eq,
  RestrictionKind,
  Term,
  Ty,
  TypingEnv,
} from "./mod.ts";

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

const tcx = mk_tcx();
const did = (index: number, krate: CrateNum = LOCAL_CRATE): DefId => new DefId(DefIndex.from_u32(index), krate);
const param = (index: number): Ty => tcx.mk_ty_from_kind({ $: "Param", _0: { index, name: kw.SelfUpper } });
const early_re = (index: number): Region => tcx.intern_region({ $: "ReEarlyParam", _0: { index, name: kw.UnderscoreLifetime } });
const ct_var = (vid: number): Const => tcx.mk_ct_from_kind({ $: "Infer", _0: { $: "Var", _0: vid as ConstVid } });
const ty_var = (vid: number): Ty => tcx.mk_ty_from_kind({ $: "Infer", _0: { $: "TyVar", _0: vid as TyVid } });
const alias_ty = (is_rigid: "Yes" | "No"): Ty =>
  tcx.mk_ty_from_kind({
    $: "Alias",
    _0: is_rigid,
    _1: { kind: { $: "Projection", def_id: did(7) }, args: RawList.empty(), _use_alias_new_instead: null },
  });
const header = (args: GenericArg[]): ImplTraitHeader =>
  new ImplTraitHeader(
    { value: { def_id: did(3), args: tcx.mk_args(args), _use_trait_ref_new_instead: null }, _tcx: undefined },
    "Positive",
    "Safe",
    Constness.NotConst,
  );

describe("Asyncness", () => {
  test("is_async / Default / Debug", () => {
    expect(Asyncness.is_async(Asyncness.Yes)).toBe(true);
    expect(Asyncness.is_async(Asyncness.No)).toBe(false);
    expect(Asyncness.default_()).toBe("No");
    expect(debug_Asyncness("Yes", PLAIN)).toBe("Yes");
  });
});

describe("RestrictionKind", () => {
  const span = 0 as Span;
  const r = (index: number): RestrictionKind => ({ $: "Restricted", _0: did(index), _1: span });

  test("Unrestricted is allowed everywhere; expect_span panics on it", () => {
    expect(RestrictionKind.is_allowed_in(RestrictionKind.Unrestricted, did(1), tcx)).toBe(true);
    expect(RestrictionKind.restriction_path(RestrictionKind.Unrestricted, tcx)).toBe("");
    expect(() => RestrictionKind.expect_span(RestrictionKind.Unrestricted)).toThrow(Panic);
    expect(RestrictionKind.expect_span(r(1))).toBe(span);
  });

  test("stricter_of: Unrestricted on either side gives the other", () => {
    const a = r(1);
    expect(RestrictionKind.stricter_of(RestrictionKind.Unrestricted, a, tcx)).toBe(a);
    expect(RestrictionKind.stricter_of(a, RestrictionKind.Unrestricted, tcx)).toBe(a);
    expect(RestrictionKind.stricter_of(RestrictionKind.Unrestricted, RestrictionKind.Unrestricted, tcx)).toBe(RestrictionKind.Unrestricted);
  });

  test("stricter_of: restrictions in different crates are a bug", () => {
    expect(() => RestrictionKind.stricter_of(r(1), { $: "Restricted", _0: did(1, 1 as CrateNum), _1: span }, tcx)).toThrow(Panic);
  });

  test("Debug", () => {
    expect(debug_RestrictionKind(RestrictionKind.Unrestricted, PLAIN)).toBe("Unrestricted");
  });
});

describe("ImplTraitHeader::is_fully_generic_for_reflection", () => {
  // merge-w15b: `TypeVisitable for GenericArgs` (lane ty-args) is ported, so the visitor runs.
  test("distinct generic lifetimes (or none) are fully generic", () => {
    expect(header([early_re(0), early_re(1)]).is_fully_generic_for_reflection()).toBe(true);
    expect(header([]).is_fully_generic_for_reflection()).toBe(true);
  });

  test("a repeated lifetime or 'static is not", () => {
    expect(header([early_re(0), early_re(0)]).is_fully_generic_for_reflection()).toBe(false);
    expect(header([tcx.lifetimes.re_static]).is_fully_generic_for_reflection()).toBe(false);
  });

  test("ReErased is a bug", () => {
    expect(() => header([tcx.lifetimes.re_erased]).is_fully_generic_for_reflection()).toThrow(Panic);
  });
});

describe("Term", () => {
  test("to_alias_term / is_non_rigid_alias", () => {
    const t = Term.from_Ty(alias_ty("No"));
    expect(Term.is_non_rigid_alias(t)).toBe(true);
    expect(Term.is_non_rigid_alias(Term.from_Ty(alias_ty("Yes")))).toBe(false);
    expect(Term.to_alias_term(t)).toEqual({ kind: { $: "ProjectionTy", def_id: did(7) }, args: RawList.empty(), _use_alias_new_instead: null });
    expect(Term.to_alias_term(Term.from_Ty(param(0)))).toBeUndefined();
    expect(Term.to_alias_term(Term.from_Const(ct_var(0)))).toBeUndefined();
    expect(Term.is_non_rigid_alias(Term.from_Const(ct_var(0)))).toBe(false);
  });

  test("is_infer on a const", () => {
    expect(Term.is_infer(Term.from_Const(ct_var(0)))).toBe(true);
  });

  test("Debug of a const term (write! uses a fresh, plain spec)", () => {
    expect(debug_Term(Term.from_Const(ct_var(3)), PLAIN)).toBe("Term::Const(?3c)");
    expect(debug_Term(Term.from_Const(ct_var(3)), PRETTY)).toBe("Term::Const(?3c)");
  });

  test("TypeFoldable dispatches to the folder's fold_ty / fold_const and repacks", () => {
    const target = param(9);
    const folder: TypeFolder = {
      cx: () => tcx,
      fold_binder(t, d) {
        return TypeFolder_provided.fold_binder(folder, t, d);
      },
      fold_ty: () => target,
      fold_region: (r) => r,
      fold_const: () => ct_var(42),
      fold_predicate(p, d) {
        return TypeFolder_provided.fold_predicate(folder, p, d);
      },
      fold_clauses: (c) => TypeFolder_provided.fold_clauses(folder, c),
    };
    expect(fold_Term.fold_with(Term.from_Ty(ty_var(0)), folder)).toBe(target);
    expect(fold_Term.fold_with(Term.from_Const(ct_var(0)), folder)).toBe(ct_var(42));
  });

  test("TypeVisitable: flags of the packed value", () => {
    expect(TypeVisitableExt.has_type_flags(Term.from_Ty(ty_var(0)), TypeFlags.HAS_TY_INFER, fold_Term)).toBe(true);
    expect(TypeVisitableExt.has_type_flags(Term.from_Const(ct_var(0)), TypeFlags.HAS_CT_INFER, fold_Term)).toBe(true);
    expect(TypeVisitableExt.has_type_flags(Term.from_Ty(param(0)), TypeFlags.HAS_TY_INFER, fold_Term)).toBe(false);
  });

  test("decode repacks the decoded kind", () => {
    const ty = param(1);
    expect(decode_Term({} as never, () => ({ $: "Ty", _0: ty }))).toBe(ty);
  });

  test("walk starts at the term", () => {
    const c = ct_var(5);
    const first = Term.walk(Term.from_Const(c))[globalThis.Symbol.iterator]().next();
    expect(first.value).toBe(GenericArg.from_Const(c));
  });
});

describe("InstantiatedClauses", () => {
  test("empty / iteration zips clauses and spans", () => {
    const e = InstantiatedClauses.empty();
    expect(e.is_empty()).toBe(true);
    expect([...e]).toEqual([]);
    const ic = new InstantiatedClauses([], [DUMMY_SP]);
    expect(ic.is_empty()).toBe(true);
    expect([...ic.iter()]).toEqual([]);
  });
});

describe("ParamEnv", () => {
  test("empty: the shared empty clause list", () => {
    const pe = ParamEnv.empty();
    expect(pe.is_empty()).toBe(true);
    expect([...pe.caller_bounds()]).toEqual([]);
    expect(pe.caller_bounds_).toBe(RawList.empty_with_type_info());
    expect(ParamEnv.new(tcx, []).caller_bounds_).toBe(pe.caller_bounds_);
    expect(ParamEnv_eq(pe, ParamEnv.new(tcx, []))).toBe(true);
    expect(flags_Clauses.flags(pe.caller_bounds_)).toBe(TypeFlags_empty);
  });

  test("and / Debug", () => {
    const pe = ParamEnv.empty();
    const pa = pe.and(7);
    expect(pa.param_env).toBe(pe);
    expect(debug_ParamEnv(pe, PLAIN)).toBe("ParamEnv { caller_bounds: [] }");
    expect(debug_ParamEnvAnd(pa, PLAIN, (v) => String(v))).toBe("ParamEnvAnd { param_env: ParamEnv { caller_bounds: [] }, value: 7 }");
  });
});

describe("TypingEnv / DefiningScopeKind", () => {
  test("Debug", () => {
    const te = new TypingEnv({ _0: { $: "PostAnalysis" } }, ParamEnv.empty());
    expect(debug_TypingEnv(te, PLAIN)).toBe(
      "TypingEnv { typing_mode: TypingModeEqWrapper(PostAnalysis), param_env: ParamEnv { caller_bounds: [] } }",
    );
    expect(debug_DefiningScopeKind("HirTypeck", PLAIN)).toBe("HirTypeck");
  });
});
