// Unit tests of lane lower-delegation for src/rustc_ast_lowering/delegation/*.ts. Expectations follow the upstream
// code of compiler/rustc_ast_lowering/src/delegation/*.rs cited per test. The lowering context is a stand-in object
// on `LoweringContext.prototype` whose lib.rs methods (`next_id`, `create_def`, ...) are recorded fakes, since those
// belong to other lanes.
import { expect, test } from "bun:test";
import { type AngleBracketedArgs, type GenericArg as AstGenericArg, NodeId, PathSegment as AstPathSegment, Ty as AstTy } from "../../rustc_ast/lib.ts";
import { DUMMY_SP, create_default_session_globals_then } from "../../rustc_span/lib.ts";
import { DefId, LocalDefId, DefIndex, CrateNum, LOCAL_CRATE } from "../../rustc_span/def_id.ts";
import { Ident, kw, sym, Symbol } from "../../rustc_span/symbol.ts";
import * as hir from "../../rustc_hir/lib.ts";
import { HirId, HirId_INVALID, ItemLocalId, OwnerId } from "../../rustc_hir_id/lib.ts";
import { SortedMap } from "../../rustc_data_structures/sorted_map.ts";
import { ItemLocalId_cmp } from "../../rustc_hir/hir.ts";
import { PartialRes } from "../../rustc_middle/middle/resolve.ts";
import type { GenericParamDef } from "../../rustc_middle/ty/generics.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { Attribute } from "../../rustc_attr_ir/lib.ts";
import { Panic, Unported } from "../../std/panic.ts";
import { DelegationResolver, HIR_ARENA, LoweringContext } from "../lib.ts";
import {
  DelegationGenericArgsIterator,
  DelegationGenerics,
  type GenericArgSlot,
  GenericArgSlot as Slot,
  GenericsGenerationResult,
  GenericsGenerationResults,
  type HirOrTyGenerics as HirOrTy,
  HirOrTyGenerics,
} from "./generics.ts";
import { SelfResolver } from "./mod.ts";
import type { DelegationResolution, PerOwnerLoweringStateFields } from "./resolution.ts";

const OWNER = new OwnerId(LocalDefId.new(1));

/** A `LoweringContext` stand-in: lib.rs methods are recorded fakes. */
function fake_ctx(log: string[], extra: Record<string, unknown> = {}): LoweringContext {
  const lctx = Object.create(LoweringContext.prototype) as LoweringContext;
  let next_local = 1;
  let next_node = 1000;
  Object.assign(lctx, {
    arena: HIR_ARENA,
    partial_res_overrides: new Map(),
    next_id: (): HirId => {
      log.push("next_id");
      return new HirId(OWNER, ItemLocalId.from_u32(next_local++));
    },
    next_node_id: (): NodeId => {
      log.push("next_node_id");
      return NodeId.from_u32(next_node++);
    },
    lower_node_id: (n: NodeId): HirId => {
      log.push(`lower_node_id ${n}`);
      return new HirId(OWNER, ItemLocalId.from_u32(next_local++));
    },
    create_def: (node_id: NodeId, name: Symbol | undefined, def_kind: hir.def.DefKind, _span: unknown): LocalDefId => {
      log.push(`create_def ${node_id} ${name === undefined ? "-" : Symbol.as_str(name)} ${def_kind.$}`);
      return LocalDefId.new(100 + (node_id as number));
    },
    ...extra,
  });
  return lctx;
}

function def_id(i: number): DefId {
  return new DefId(DefIndex.new(i), LOCAL_CRATE);
}

function param_def(name: Symbol, index: number, kind: GenericParamDef["kind"]): GenericParamDef {
  return { name, def_id: def_id(50 + index), index, pure_wrt_drop: false, kind } as GenericParamDef;
}

function ty_infer(): AstGenericArg {
  return { $: "Type", _0: new AstTy(NodeId.from_u32(1), { $: "Infer" }, DUMMY_SP) };
}

function hir_param(name: Symbol, kind: hir.GenericParamKind, def: number): hir.GenericParam {
  return new hir.GenericParam(new HirId(OWNER, ItemLocalId.from_u32(def)), LocalDefId.new(def), { $: "Plain", _0: Ident.with_dummy_span(name) }, DUMMY_SP, false, kind, undefined, "Generics");
}

const fake_tcx = (log: string[], extra: Record<string, unknown> = {}): TyCtxt =>
  ({
    dcx: () => ({
      span_delayed_bug: (_sp: unknown, msg: string) => {
        log.push(`span_delayed_bug ${msg}`);
        return null;
      },
      delayed_bug: (msg: string) => {
        log.push(`delayed_bug ${msg}`);
        return null;
      },
      emit_err: () => null,
    }),
    ...extra,
  }) as unknown as TyCtxt;

test("create_slots_from_args: implicit Self first, infers become Generate(param, idx), zip stops at the shorter (generics.rs:542)", () => {
  create_default_session_globals_then(() => {
    const self_p = param_def(kw.SelfUpper, 0, { $: "Type", has_default: false, synthetic: false });
    const t = param_def(Symbol.intern("T"), 1, { $: "Type", has_default: false, synthetic: false });
    const a = param_def(Symbol.intern("'a"), 2, { $: "Lifetime" });
    const args: AngleBracketedArgs = {
      span: DUMMY_SP,
      args: [
        { $: "Arg", _0: ty_infer() },
        { $: "Arg", _0: { $: "Lifetime", _0: { id: NodeId.from_u32(2), ident: Ident.with_dummy_span(kw.StaticLifetime) } } },
        { $: "Arg", _0: ty_infer() },
      ],
    };
    const slots = DelegationResolver.create_slots_from_args(fake_tcx([]), args, [self_p, t, a], true);
    expect(slots).toEqual([
      { $: "Generate", _0: self_p, _1: undefined },
      { $: "Generate", _0: t, _1: 0 },
      Slot.UserSpecified,
    ]);
    // Without `add_first_self` the zip starts at the first param and the third arg has no param.
    expect(DelegationResolver.create_slots_from_args(fake_tcx([]), args, [t, a], false)).toEqual([{ $: "Generate", _0: t, _1: 0 }, Slot.UserSpecified]);
    // `&params[0]` on an empty slice panics like core.
    expect(() => DelegationResolver.create_slots_from_args(fake_tcx([]), args, [], true)).toThrow("index out of bounds: the len is 0 but the index is 0");
  });
});

test("create_slots_from_args: `'_` for a type param reports DelegationInfersMismatch (generics.rs:561)", () => {
  create_default_session_globals_then(() => {
    const t = param_def(Symbol.intern("T"), 1, { $: "Type", has_default: false, synthetic: false });
    const args: AngleBracketedArgs = {
      span: DUMMY_SP,
      args: [{ $: "Arg", _0: { $: "Lifetime", _0: { id: NodeId.from_u32(2), ident: Ident.with_dummy_span(kw.UnderscoreLifetime) } } }],
    };
    // The diagnostic builder is a stand-in until diagnostics.gen.ts lands.
    expect(() => DelegationResolver.create_slots_from_args(fake_tcx([]), args, [t], false)).toThrow(Unported);
  });
});

test("DelegationGenericArgsIterator: skips the implicit Self and impl-trait params; ids from the factory (generics.rs:108)", () => {
  create_default_session_globals_then(() => {
    const log: string[] = [];
    const ctx = fake_ctx(log);
    const params = [
      hir_param(kw.SelfUpper, { $: "Type", default: undefined, synthetic: false }, 10),
      hir_param(Symbol.intern("'a"), { $: "Lifetime", kind: hir.LifetimeParamKind.Explicit }, 11),
      hir_param(Symbol.intern("impl Trait"), { $: "Type", default: undefined, synthetic: true }, 12),
      hir_param(Symbol.intern("T"), { $: "Type", default: undefined, synthetic: false }, 13),
    ];
    const it = new DelegationGenericArgsIterator(0, params, true);
    const args = it.consume_all(ctx);
    expect(args.map((a) => a.$)).toEqual(["Lifetime", "Type"]);
    const lt = args[0]!;
    if (lt.$ !== "Lifetime") throw new Error("lifetime");
    expect(lt._0.kind).toEqual({ $: "Param", _0: LocalDefId.new(11) });
    expect(lt._0.source).toEqual({ $: "Path", angle_brackets: "Full" });
    expect(lt._0.syntax).toBe("ExplicitBound");
    const ty = args[1]!;
    if (ty.$ !== "Type" || ty._0.kind.$ !== "Path" || ty._0.kind._0.$ !== "Resolved") throw new Error("type path");
    const path = ty._0.kind._0._1;
    expect(path.res).toEqual({ $: "Def", _0: { $: "TyParam" }, _1: LocalDefId.to_def_id(LocalDefId.new(13)) });
    expect(Symbol.as_str(path.segments[0]!.ident.name)).toBe("T");
    // lifetime: factory; type: factory, then the path segment's id
    expect(log).toEqual(["next_id", "next_id", "next_id"]);
    expect(it.next(ctx, () => HirId_INVALID)).toBeUndefined();
  });
});

test("HirOrTyGenerics: uplifting replaces the variant in place, renames Self for the child, adds 'a: 'a (generics.rs:171,626,711)", () => {
  create_default_session_globals_then(() => {
    const log: string[] = [];
    const ctx = fake_ctx(log);
    const self_p = param_def(kw.SelfUpper, 0, { $: "Type", has_default: false, synthetic: false });
    const a = param_def(Symbol.intern("'a"), 1, { $: "Lifetime" });
    const n = param_def(Symbol.intern("N"), 2, { $: "Const", has_default: false });
    const data: GenericArgSlot<GenericParamDef>[] = [{ $: "Generate", _0: self_p, _1: undefined }, { $: "Generate", _0: a, _1: 3 }, Slot.UserSpecified, { $: "Generate", _0: n, _1: undefined }];
    const g0: HirOrTy = { $: "Ty", _0: new DelegationGenerics(data, "Child", false, false) };
    // (no narrowing: `into_hir_generics` replaces the variant in place)
    const g = g0 as HirOrTy;
    expect([...HirOrTyGenerics.infer_indices(g)]).toEqual([3]);
    expect(HirOrTyGenerics.hir_generics_or_empty(g)).toBe(hir.Generics.empty());
    expect(() => HirOrTyGenerics.create_args_iterator(g)).toThrow("attempting to get generic args before uplifting to HIR");

    HirOrTyGenerics.into_hir_generics(g, ctx, DUMMY_SP);
    const h = g0 as HirOrTy;
    expect(h).toBe(g);
    if (h.$ !== "Hir") throw new Error("uplifted");
    const params = h._0.data.params;
    expect(params.map((p) => Symbol.as_str(hir.ParamName.ident(p.name).name))).toEqual(["This", "'a", "N"]);
    expect(params.map((p) => p.kind.$)).toEqual(["Type", "Lifetime", "Const"]);
    const c = params[2]!.kind;
    if (c.$ !== "Const") throw new Error("const");
    expect(c.ty.kind).toEqual({ $: "InferDelegation", _0: { $: "DefId", _0: n.def_id } });
    expect(h._0.data.predicates.length).toBe(1);
    const pred = h._0.data.predicates[0]!;
    if (pred.kind.$ !== "RegionPredicate") throw new Error("region predicate");
    expect(pred.kind._0.in_where_clause).toBe(true);
    expect(pred.kind._0.bounds.map((b) => b.$)).toEqual(["Outlives"]);
    expect(log).toEqual([
      "next_node_id",
      "create_def 1000 This TyParam",
      "lower_node_id 1000",
      "next_node_id",
      "create_def 1001 'a LifetimeParam",
      "lower_node_id 1001",
      "next_node_id",
      "create_def 1002 N ConstParam",
      "next_id",
      "lower_node_id 1002",
      // generate_lifetime_predicate: the predicate, its lifetime, the bound's lifetime
      "next_id",
      "next_id",
      "next_id",
    ]);
    expect(HirOrTyGenerics.pos(g)).toBe("Child");
    expect(HirOrTyGenerics.is_trait_impl(g)).toBe(false);
    // The child's `Self` was renamed to `This`, so the lookup by `kw::SelfUpper` fails (only parents keep `Self`).
    expect(() => HirOrTyGenerics.find_self_param(g)).toThrow("`Self` generic param is not found while expected");
    expect(() => HirOrTyGenerics.infer_indices(g)).toThrow("accessed infer indices on uplifted generics");
    // A second call is a no-op ("uplifting will occur at most only once").
    HirOrTyGenerics.into_hir_generics(g, ctx, DUMMY_SP);
    expect(h._0.data.params).toBe(params);
  });
});

test("GenericsGenerationResults::all_params: parent and child lifetimes first (generics.rs:593)", () => {
  create_default_session_globals_then(() => {
    const t = hir_param(Symbol.intern("T"), { $: "Type", default: undefined, synthetic: false }, 1);
    const a = hir_param(Symbol.intern("'a"), { $: "Lifetime", kind: hir.LifetimeParamKind.Explicit }, 2);
    const u = hir_param(Symbol.intern("U"), { $: "Type", default: undefined, synthetic: false }, 3);
    const b = hir_param(Symbol.intern("'b"), { $: "Lifetime", kind: hir.LifetimeParamKind.Explicit }, 4);
    const gens = (ps: hir.GenericParam[]): GenericsGenerationResult =>
      new GenericsGenerationResult({ $: "Hir", _0: new DelegationGenerics(new hir.Generics(ps, [], false, DUMMY_SP, DUMMY_SP), "Parent", false, false) }, HirId_INVALID, true);
    const r = new GenericsGenerationResults(gens([t, a]), gens([u, b]), undefined);
    expect([...r.all_params()].map((p) => Symbol.as_str(hir.ParamName.ident(p.name).name))).toEqual(["'a", "'b", "T", "U"]);
    expect([...r.all_predicates()]).toEqual([]);
    expect(r.parent.segment_id_for_sig()).toBe(HirId_INVALID);
    r.parent.use_for_sig_inheritance = false;
    expect(r.parent.segment_id_for_sig()).toBeUndefined();
  });
});

test("process_segment: generated child args, segment id and flags recorded (mod.rs:514)", () => {
  create_default_session_globals_then(() => {
    const log: string[] = [];
    const ctx = fake_ctx(log);
    const t = param_def(Symbol.intern("T"), 0, { $: "Type", has_default: false, synthetic: false });
    const result = new GenericsGenerationResult({ $: "Ty", _0: new DelegationGenerics([{ $: "Generate", _0: t, _1: undefined }], "Child", false, false) }, HirId_INVALID, false);
    const seg_id = new HirId(OWNER, ItemLocalId.from_u32(77));
    const seg = new hir.PathSegment(Ident.with_dummy_span(Symbol.intern("foo")), seg_id, { $: "Err" }, undefined, false, false);
    const out = ctx.process_segment(DUMMY_SP, seg, result);
    expect(out).not.toBe(seg);
    expect(seg.args).toBeUndefined();
    expect(out.args?.args.map((a) => a.$)).toEqual(["Type"]);
    expect(out.args?.parenthesized).toBe("No");
    expect(out.delegation_child_segment).toBe(true);
    expect(result.args_segment_id).toEqual(seg_id);
    expect(result.use_for_sig_inheritance).toBe(true);
    expect(result.generics.$).toBe("Hir");
  });
});

test("generate_param / generate_arg / mk_expr / generate_header_error (mod.rs:194,219,610,620)", () => {
  create_default_session_globals_then(() => {
    const log: string[] = [];
    const ctx = fake_ctx(log);
    const [p0, n0] = ctx.generate_param(true, 0, DUMMY_SP);
    const [p1] = ctx.generate_param(true, 1, DUMMY_SP);
    expect(n0).toBe(NodeId.from_u32(1000));
    const k0 = p0.pat.kind;
    const k1 = p1.pat.kind;
    if (k0.$ !== "Binding" || k1.$ !== "Binding") throw new Error("binding");
    expect(k0._2.name).toBe(kw.SelfLower);
    expect(Symbol.as_str(k1._2.name)).toBe("arg1");
    expect(k0._1).toBe(p0.pat.hir_id);
    expect(log).toEqual(["next_node_id", "lower_node_id 1000", "next_id", "next_node_id", "lower_node_id 1001", "next_id"]);

    const e = ctx.generate_arg(false, 0, p0.pat.hir_id, DUMMY_SP);
    if (e.kind.$ !== "Path" || e.kind._0.$ !== "Resolved") throw new Error("path");
    expect(e.kind._0._1.res).toEqual({ $: "Local", _0: p0.pat.hir_id });
    expect(Symbol.as_str(e.kind._0._1.segments[0]!.ident.name)).toBe("arg0");

    const h = ctx.generate_header_error();
    expect([h.safety, h.constness, h.asyncness, h.abi]).toEqual([{ $: "Normal", _0: "Safe" }, hir.Constness.NotConst, hir.IsAsync.NotAsync, expect.objectContaining({ $: "Rust" })]);
  });
});

test("SelfResolver::try_replace_id overrides only `Res::Local(path_id)` (mod.rs:633)", () => {
  create_default_session_globals_then(() => {
    const path_id = NodeId.from_u32(5);
    const self_param = NodeId.from_u32(900);
    const res = new Map<NodeId, PartialRes>([
      [NodeId.from_u32(7), PartialRes.new({ $: "Local", _0: path_id })],
      [NodeId.from_u32(8), PartialRes.new({ $: "Local", _0: NodeId.from_u32(6) })],
    ]);
    const ctx = fake_ctx([], { get_partial_res: (id: NodeId) => res.get(id) });
    const r = new SelfResolver(ctx, path_id, self_param, []);
    for (const id of [7, 8, 9]) r.visit_id(NodeId.from_u32(id));
    expect(r.overwrites).toEqual([NodeId.from_u32(7)]);
    expect([...ctx.partial_res_overrides]).toEqual([[NodeId.from_u32(7), self_param]]);
  });
});

test("create_new_attrs / add_attrs_if_needed: #[inline] by default, #[must_use] inherited (attributes.rs:46,64)", () => {
  create_default_session_globals_then(() => {
    const reason = Symbol.intern("why");
    const must_use: Attribute = { $: "Parsed", _0: { $: "MustUse", span: DUMMY_SP, reason } };
    const inline: Attribute = { $: "Parsed", _0: { $: "Inline", _0: { $: "Always" }, _1: DUMMY_SP } };
    let sig_attrs: Attribute[] = [must_use];
    const tcx = fake_tcx([], { get_all_attrs: () => sig_attrs });
    const attrs = SortedMap.new<ItemLocalId, readonly Attribute[]>(ItemLocalId_cmp);
    const ctx = fake_ctx([], { tcx, curr_owner: { attrs } satisfies Partial<PerOwnerLoweringStateFields> });
    const sig_id = def_id(3);

    expect(ctx.create_new_attrs(DUMMY_SP, sig_id, undefined)).toEqual([
      { $: "Parsed", _0: { $: "MustUse", span: DUMMY_SP, reason } },
      { $: "Parsed", _0: { $: "Inline", _0: { $: "Hint" }, _1: DUMMY_SP } },
    ]);
    // An existing `#[inline]` suppresses the default one.
    expect(ctx.create_new_attrs(DUMMY_SP, sig_id, [inline])).toEqual([{ $: "Parsed", _0: { $: "MustUse", span: DUMMY_SP, reason } }]);
    sig_attrs = [];
    expect(ctx.create_new_attrs(DUMMY_SP, sig_id, [inline])).toEqual([]);

    attrs.insert(ItemLocalId.ZERO, [inline]);
    sig_attrs = [must_use];
    ctx.add_attrs_if_needed({ span: DUMMY_SP, sig_id } as DelegationResolution);
    expect(attrs.get(ItemLocalId.ZERO)).toEqual([inline, { $: "Parsed", _0: { $: "MustUse", span: DUMMY_SP, reason } }]);
  });
});

test("DelegationResolver: get_user_args, resolve_delegation_sig, check_for_cycles, check_block_soundness (resolution.rs, generics.rs:354)", () => {
  create_default_session_globals_then(() => {
    const log: string[] = [];
    const sig = def_id(40);
    const infos = new Map([
      [LocalDefId.new(1), { resolution: { $: "Full" as const, _0: sig } }],
      [LocalDefId.new(2), { resolution: { $: "Partial" as const } }],
    ]);
    const tcx = fake_tcx(log, {
      resolutions: () => ({ delegation_infos: infos }),
      def_kind: () => ({ $: "Fn" }),
    });
    const ctx = fake_ctx(log, { tcx, curr_owner: { owner: { def_id: LocalDefId.new(1) } } });
    const r = DelegationResolver.new(ctx);
    expect(r.tcx()).toBe(tcx);
    expect(r.owner_id()).toBe(LocalDefId.new(1));

    // get_user_args
    const seg = (args: AstPathSegment["args"]): AstPathSegment => new AstPathSegment(Ident.with_dummy_span(sym.dummy), NodeId.from_u32(3), args);
    expect(r.get_user_args(seg(undefined))).toBeUndefined();
    expect(r.get_user_args(seg({ $: "AngleBracketed", _0: { span: DUMMY_SP, args: [] } }))).toBeUndefined();
    const some: AngleBracketedArgs = { span: DUMMY_SP, args: [{ $: "Arg", _0: ty_infer() }] };
    expect(r.get_user_args(seg({ $: "AngleBracketed", _0: some }))).toBe(some);
    expect(r.get_user_args(seg({ $: "ParenthesizedElided", _0: DUMMY_SP }))).toBeUndefined();
    expect(log).toEqual(["span_delayed_bug expected angle-bracketed generic args in delegation segment"]);
    log.length = 0;

    // resolve_delegation_sig
    expect(r.resolve_delegation_sig(LocalDefId.new(1), DUMMY_SP)).toEqual({ $: "Ok", _0: sig });
    expect(r.resolve_delegation_sig(LocalDefId.new(9), DUMMY_SP).$).toBe("Err");
    expect(log.length).toBe(1);
    expect(log[0]).toStartWith("span_delayed_bug unresolved delegation ");

    // check_for_cycles: a non-local / non-delegation sig id ends the chain.
    expect(r.check_for_cycles(new DefId(DefIndex.new(4), CrateNum.from_u32(1)), DUMMY_SP)).toEqual({ $: "Ok", _0: undefined });
    expect(r.check_for_cycles(def_id(40), DUMMY_SP)).toEqual({ $: "Ok", _0: undefined });

    // check_block_soundness without a target expression
    const d = { body: undefined, source: { $: "Glob" } } as unknown as Parameters<typeof r.check_block_soundness>[0];
    expect(r.check_block_soundness(d, sig, false, 0)).toEqual({ $: "Ok", _0: [true, false] });
    expect(r.can_perform_self_mapping(d, LocalDefId.new(0), DUMMY_SP)).toBe(false);
  });
});

test("HirOrTyGenerics bugs before uplifting are ICEs, not Unported", () => {
  const g: HirOrTy = { $: "Ty", _0: new DelegationGenerics([], "Parent", true, false) };
  expect(() => HirOrTyGenerics.find_self_param(g)).toThrow(Panic);
  expect(HirOrTyGenerics.is_trait_impl(g)).toBe(true);
});
