// Unit tests of lane middle-traits-thir: rustc_middle traits/*, thir.rs + thir/visit.rs, middle/region.rs.
import { describe, expect, test } from "bun:test";
import "../lib.ts";
import { ItemLocalId } from "../../rustc_hir_id/lib.ts";
import { DefId, DefIndex, LOCAL_CRATE } from "../../rustc_span/def_id.ts";
import { BytePos, create_default_session_globals_then, ErrorGuaranteed, Span } from "../../rustc_span/lib.ts";
import { SyntaxContext } from "../../rustc_span/hygiene.ts";
import { DUMMY_SP } from "../../rustc_span/span_encoding.ts";
import { Symbol } from "../../rustc_span/symbol.ts";
import { PLAIN, PRETTY } from "../../std/fmt.ts";
import { Unported } from "../../std/panic.ts";
import { CtxtInterners, GlobalCaches, type GlobalCtxt, TyCtxt } from "../ty/context.ts";
import { DepNodeIndex } from "../dep_graph/graph.ts";
import { WithDepNode, WithDepNodeCache } from "./cache.ts";
import {
  DynCompatibilityViolation,
  DynCompatibilityViolationSolution,
  debug_ImplSource,
  ImplSource,
  ObligationCause,
  ObligationCauseCode,
  ObligationCauseCodeHandle,
  SelectionError,
} from "./mod.ts";
import { EvaluationResult, OverflowError } from "./select.ts";
import { ExternalConstraints } from "./solve.ts";
import { DropckConstraint } from "./query.ts";
import { Children, Graph, Node, OverlapMode } from "./specialization_graph.ts";
import { FirstStatementIndex, Scope, ScopeData, ScopeTree, debug_Scope, Scope_eq } from "../middle/region.ts";
import { ArmId, debug_ExprId, ExprId, Pat, PatRange, StmtId, Thir, type Expr, type PatKind } from "../thir.ts";
import { Visitor, walk_expr } from "../thir/visit.ts";
import type { Ty } from "../ty/mod.ts";

const did = (i: number): DefId => new DefId(DefIndex.from_u32(i), LOCAL_CRATE);
const debug_num = (v: number): string => String(v);

describe("select.rs", () => {
  test("EvaluationResult methods follow the derived order", () => {
    expect(EvaluationResult.must_apply_considering_regions("EvaluatedToOk")).toBe(true);
    expect(EvaluationResult.must_apply_considering_regions("EvaluatedToOkModuloRegions")).toBe(false);
    expect(EvaluationResult.must_apply_modulo_regions("EvaluatedToOkModuloRegions")).toBe(true);
    expect(EvaluationResult.must_apply_modulo_regions("EvaluatedToOkModuloOpaqueTypes")).toBe(false);
    expect(EvaluationResult.may_apply("EvaluatedToAmbigStackDependent")).toBe(true);
    expect(EvaluationResult.may_apply("EvaluatedToErr")).toBe(false);
    expect(EvaluationResult.is_stack_dependent("EvaluatedToAmbigStackDependent")).toBe(true);
    expect(EvaluationResult.is_stack_dependent("EvaluatedToAmbig")).toBe(false);
  });

  test("From impls", () => {
    const e = ErrorGuaranteed.unchecked_error_guaranteed();
    expect(OverflowError.from(e)).toEqual({ $: "Error", _0: e });
    expect(SelectionError.from(OverflowError.Canonical)).toEqual({ $: "Overflow", _0: { $: "Canonical" } });
  });
});

describe("mod.rs", () => {
  test("ObligationCauseCodeHandle: Misc is None, deref gives Misc back", () => {
    const h = ObligationCauseCode.into(ObligationCauseCode.Misc);
    expect(h.code).toBeUndefined();
    expect(ObligationCauseCodeHandle.deref(h)).toBe(ObligationCauseCode.Misc);
    const c: ObligationCauseCode = { $: "WhereClause", _0: did(1), _1: DUMMY_SP };
    expect(ObligationCauseCode.into(c).code).toBe(c);
  });

  test("ObligationCause: misc / dummy / map_code / derived_cause / peel_derives", () => {
    const cause = ObligationCause.misc(DUMMY_SP, 0 as never);
    expect(cause.code_()).toEqual({ $: "Misc" });
    const dummy = ObligationCause.dummy();
    expect(dummy.span).toBe(DUMMY_SP);
    expect(dummy.code.code).toBeUndefined();

    cause.map_code((parent_code) => ({ $: "FunctionArg", arg_hir_id: undefined as never, call_hir_id: undefined as never, parent_code }));
    expect(cause.code_().$).toBe("FunctionArg");
    expect(ObligationCauseCode.parent(cause.code_())).toEqual({ $: "Misc" });
    expect(ObligationCauseCode.peel_derives(cause.code_())).toEqual({ $: "Misc" });

    const pred = { value: "P", bound_vars: [] } as never;
    const derived = cause.derived_cause(pred, (d) => ({ $: "BuiltinDerived", _0: d }));
    expect(derived).toBe(cause);
    const code = derived.code_();
    expect(code.$).toBe("BuiltinDerived");
    const [base, base_pred] = ObligationCauseCode.peel_derives_with_predicate(code);
    expect(base).toEqual({ $: "Misc" });
    expect(base_pred).toBe(pred);
    expect(ObligationCauseCode.peel_match_impls(code)).toBe(code);
  });

  test("ImplSource helpers and the manual Debug impls", () => {
    const src: ImplSource<number> = { $: "Builtin", _0: { $: "Trivial" }, _1: [1, 2] };
    expect(debug_ImplSource(src, PRETTY, debug_num)).toBe("Builtin(Trivial, [1, 2])");
    const p: ImplSource<number> = { $: "Param", _0: [3] };
    expect(debug_ImplSource(p, PLAIN, debug_num)).toBe("ImplSourceParamData([3])");
    expect(ImplSource.map(p, (n: number) => n * 10)).toEqual({ $: "Param", _0: [30] });
  });

  test("DynCompatibilityViolation: error_msg / spans / solution", () => {
    create_default_session_globals_then(() => {
      const sp = Span.new(BytePos.from_usize(1), BytePos.from_usize(4), SyntaxContext.root(), undefined);
      const name = Symbol.intern("foo");
      const sized: DynCompatibilityViolation = { $: "SizedSelf", _0: [sp] };
      expect(DynCompatibilityViolation.error_msg(sized)).toBe("it requires `Self: Sized`");
      expect(DynCompatibilityViolation.spans(sized)).toEqual([sp]);
      expect(DynCompatibilityViolation.solution(sized)).toBe(DynCompatibilityViolationSolution.None);

      const sup_dummy: DynCompatibilityViolation = { $: "SupertraitSelf", _0: [DUMMY_SP] };
      expect(DynCompatibilityViolation.error_msg(sup_dummy)).toBe(
        "it cannot use `Self` as a type parameter in a supertrait or `where`-clause",
      );

      const input_dummy: DynCompatibilityViolation = { $: "Method", _0: name, _1: { $: "ReferencesSelfInput", _0: undefined }, _2: DUMMY_SP };
      expect(DynCompatibilityViolation.error_msg(input_dummy)).toBe("method `foo` references the `Self` type in its parameters");
      expect(DynCompatibilityViolation.spans(input_dummy)).toEqual([]);
      const input: DynCompatibilityViolation = { ...input_dummy, _2: sp };
      expect(DynCompatibilityViolation.error_msg(input)).toBe("method `foo` references the `Self` type in this parameter");
      expect(DynCompatibilityViolation.solution(input)).toEqual({ $: "MoveToAnotherTrait", _0: name });

      const recv: DynCompatibilityViolation = { $: "Method", _0: name, _1: { $: "UndispatchableReceiver", _0: [sp, name] }, _2: sp };
      const sol = DynCompatibilityViolation.solution(recv);
      expect(sol.$).toBe("ChangeToRefSelf");

      const gac: DynCompatibilityViolation = { $: "AssocConst", _0: name, _1: "NonType", _2: sp };
      expect(DynCompatibilityViolation.error_msg(gac)).toBe(
        "it contains associated const `foo` that's not defined as `#[rustc_always_gca]`",
      );
    });
  });
});

describe("cache.rs", () => {
  test("WithDepNodeCache compares tuple keys by value", () => {
    const cache = WithDepNodeCache.default_<[DefId, number], string>();
    const tcx = { dep_graph: { read_index(_: DepNodeIndex) {} } } as unknown as TyCtxt;
    cache.insert([did(3), 1], DepNodeIndex.from_u32(7), "v");
    expect(cache.get([did(3), 1], tcx)).toBe("v");
    expect(cache.get([did(3), 2], tcx)).toBeUndefined();
    const n = WithDepNode.new(DepNodeIndex.from_u32(1), 5);
    expect(n.get(tcx)).toBe(5);
  });

  test("GlobalCaches::default builds the traits caches (infer's CanonicalParamEnvCache stops on first use)", () => {
    // merge-w15b: rmeta-ty's `pending_cache` defers the infer cache's stop from `default` to its first use.
    const caches = GlobalCaches.default_();
    expect(caches.selection_cache).toBeInstanceOf(WithDepNodeCache);
    expect(caches.evaluation_cache).toBeInstanceOf(WithDepNodeCache);
    expect(() => (caches.canonical_param_env_cache as unknown as { get(): unknown }).get()).toThrow(/CanonicalParamEnvCache: Default \(lane infcx-contract\)/);
  });
});

describe("solve.rs", () => {
  test("ExternalConstraints are hash-consed by TyCtxt::mk_external_constraints", () => {
    const interners = CtxtInterners.new(undefined);
    const tcx = new TyCtxt({ interners } as unknown as GlobalCtxt);
    const data = () => ({ region_constraints: { $: "Old" as const, _0: [] }, opaque_types: [], normalization_nested_goals: { _0: [] } });
    const a = tcx.mk_external_constraints(data());
    expect(a).toBeInstanceOf(ExternalConstraints);
    expect(tcx.mk_external_constraints(data())).toBe(a);
    expect(Object.isFrozen(a)).toBe(true);
  });
});

describe("query.rs", () => {
  test("DropckConstraint::from_iter concatenates", () => {
    const a = new DropckConstraint([], [1 as unknown as Ty], []);
    const b = new DropckConstraint([], [2 as unknown as Ty], [3 as unknown as Ty]);
    const r = DropckConstraint.from_iter([a, b]);
    expect(r.dtorck_types).toEqual([1, 2] as unknown as Ty[]);
    expect(r.overflows).toEqual([3] as unknown as Ty[]);
    expect(DropckConstraint.empty().outlives).toEqual([]);
  });
});

describe("specialization_graph.rs", () => {
  test("Graph / OverlapMode / Node / Ancestors", () => {
    const g = Graph.new();
    g.parent.set(did(2), did(1));
    expect(g.parent_(did(2))).toEqual(did(1));
    expect(() => g.parent_(did(9))).toThrow(/Failed to get parent for/);
    expect(OverlapMode.use_negative_impl("Strict")).toBe(true);
    expect(OverlapMode.use_implicit_negative("Strict")).toBe(false);
    expect(Node.is_from_trait({ $: "Trait", _0: did(1) })).toBe(true);
    expect(Children.default_().blanket_impls).toEqual([]);
  });
});

describe("middle/region.rs", () => {
  const sc = (n: number, data: ScopeData = ScopeData.Node): Scope => new Scope(ItemLocalId.from_u32(n), data);

  test("Debug of Scope", () => {
    expect(debug_Scope(sc(3), PLAIN)).toBe("Node(3)");
    expect(debug_Scope(sc(3, ScopeData.IfThenRescope), PRETTY)).toBe("IfThen[edition2024](3)");
    expect(debug_Scope(sc(4, { $: "Remainder", _0: FirstStatementIndex.from_u32(1) }), PLAIN)).toBe(
      "Remainder { block: 4, first_statement_index: 1}",
    );
  });

  test("parent map, subscopes and temporary scopes", () => {
    const tree = ScopeTree.default_();
    tree.record_scope_parent(sc(1), sc(2, ScopeData.Destruction));
    tree.record_scope_parent(sc(3), sc(1));
    tree.record_scope_parent(sc(4), undefined);
    expect(Scope_eq(tree.opt_encl_scope(sc(3))!, sc(1))).toBe(true);
    expect(tree.is_subscope_of(sc(3), sc(2, ScopeData.Destruction))).toBe(true);
    expect(tree.is_subscope_of(sc(3), sc(4))).toBe(false);
    const [s, bi] = tree.default_temporary_scope(sc(3));
    expect(Scope_eq(s, sc(1))).toBe(true);
    expect(bi).toBeUndefined();
    const t = tree.temporary_scope(ItemLocalId.from_u32(3));
    expect(Scope_eq(t.temp_lifetime!, sc(1))).toBe(true);
    tree.record_extended_temp_scope(ItemLocalId.from_u32(7), undefined);
    expect(tree.temporary_scope(ItemLocalId.from_u32(7))).toEqual({ temp_lifetime: undefined, backwards_incompatible: undefined });
    // `insert` then `assert!(prev.is_none())`: a second parent for the same child panics.
    expect(() => tree.record_scope_parent(sc(3), sc(2))).toThrow(/prev.is_none/);
  });
});

describe("thir.rs + thir/visit.rs", () => {
  const ty = 0 as unknown as Ty;
  const pat = (kind: PatKind): Pat => new Pat(ty, DUMMY_SP, undefined, kind);
  const binding = (name: Symbol, subpattern?: Pat): PatKind =>
    ({ $: "Binding", name, mode: { _0: { $: "No" }, _1: "Not" }, var: undefined, ty, subpattern, is_primary: true, is_shorthand: false }) as never;

  test("ids print with their debug_format", () => {
    expect(debug_ExprId(ExprId.from_u32(3), PLAIN)).toBe("e3");
    expect(ArmId.debug(ArmId.from_u32(0), PLAIN)).toBe("a0");
    expect(StmtId.debug(StmtId.from_u32(12), PLAIN)).toBe("s12");
  });

  test("Thir::new and Index", () => {
    const thir = Thir.new({ $: "Const", _0: ty });
    expect(thir.exprs).toEqual([]);
    expect(() => thir.index_ExprId(ExprId.from_u32(0))).toThrow(/index out of bounds: the len is 0 but the index is 0/);
  });

  test("Pat walks", () => {
    create_default_session_globals_then(() => {
      const a = Symbol.intern("a");
      const b = Symbol.intern("b");
      const e = ErrorGuaranteed.unchecked_error_guaranteed();
      const p = pat({ $: "Or", pats: [pat(binding(a)), pat({ $: "Leaf", subpatterns: [{ field: 0 as never, pattern: pat(binding(b)) }] })] });
      const names: Symbol[] = [];
      p.each_binding((name) => names.push(name));
      expect(names).toEqual([a, b]);
      expect(pat(binding(a)).simple_ident()).toBe(a);
      expect(pat(binding(a, pat({ $: "Wild" }))).simple_ident()).toBeUndefined();
      expect(p.pat_error_reported()).toEqual({ $: "Ok", _0: null });
      const perr = pat({ $: "Slice", prefix: [pat({ $: "Error", _0: e })], slice: undefined, suffix: [] });
      expect(perr.pat_error_reported()).toEqual({ $: "Err", _0: e });
    });
  });

  test("Visitor walks expressions in upstream order", () => {
    const thir = Thir.new({ $: "Const", _0: ty });
    const ex = (kind: Expr["kind"]): Expr => ({ kind, ty, temp_scope_id: ItemLocalId.from_u32(0), span: DUMMY_SP });
    thir.exprs.push(ex({ $: "Tuple", fields: [] })); // e0
    thir.exprs.push(ex({ $: "Return", value: undefined })); // e1
    thir.exprs.push(ex({ $: "Binary", op: "Add" as never, lhs: ExprId.from_u32(0), rhs: ExprId.from_u32(1) })); // e2
    const seen: string[] = [];
    class V extends Visitor {
      override thir(): Thir {
        return thir;
      }
      override visit_expr(expr: Expr): void {
        seen.push(expr.kind.$);
        walk_expr(this, expr);
      }
    }
    new V().visit_expr(thir.index_ExprId(ExprId.from_u32(2)));
    expect(seen).toEqual(["Binary", "Tuple", "Return"]);
  });
});

test("an unported dependency stops as UNPORTED, not as a TypeError", () => {
  const char_ty = { kind: () => ({ $: "Char" }) } as unknown as Ty;
  const range = new PatRange({ $: "Finite", _0: 0 as never }, { $: "PosInfinity" }, "Included", char_ty);
  expect(() => range.is_full_range({} as TyCtxt)).toThrow(Unported);
});
