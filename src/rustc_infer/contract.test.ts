// The rustc_infer contract (decls.ts, lane infcx-contract) against upstream, plus the parts it ports for real:
// - every fn of every rustc_infer file is declared in decls.ts at its `file:line` (a real declaration, a comment-only
//   one, or a `// served by` line of the `InferCtxtLike` impl) or is ported (a `// rustc:` marker in src/);
// - at runtime every real declaration exists (ported, or an `unported` placeholder of the owning stub module), the
//   placeholders stop as UNPORTED and name their own file's module;
// - `InferCtxt` has every `InferCtxtLike` method (`implements` is also checked by tsc in decls.ts);
// - rustc_trait_selection's extension methods exist, are placeholders of rustc_trait_selection, and no extension name
//   collides with an inherent `InferCtxt` / `At` / `InferCtxtBuilder` method;
// - `tcx.infer_ctxt().build(..)` builds an empty `InferCtxt` whose ena tables and undo log work (type_variable.rs,
//   unify_key.rs, snapshot/undo_log.rs and the `InferCtxtInner` glue of mod.rs).
//
// The upstream fns come from the repo's fn finder (`upstreamFns`, scripts/coverage.ts).
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { upstreamFns } from "../../scripts/coverage.ts";
import { UPSTREAM } from "../../scripts/lib/common.ts";
import "./lib.ts";
import "../rustc_trait_selection/lib.ts";
import { unported_stub_path } from "../rust_ts/stubs.ts";
import { CommonLifetimes, CommonTypes, CtxtInterners, type GlobalCtxt, TyCtxt } from "../rustc_middle/ty/context.ts";
import { CanonicalParamEnvCache, OriginalQueryValues } from "../rustc_middle/infer/canonical.ts";
import { DUMMY_SP } from "../rustc_span/lib.ts";
import { TypingMode } from "../rustc_type_ir/infer_ctxt.ts";
import { UniverseIndex } from "../rustc_type_ir/lib.ts";
import { Unported } from "../std/panic.ts";
import { At, InferCtxt, InferCtxtBuilder, InferCtxtInner } from "./decls.ts";
import { TypeVariableValue } from "./infer/type_variable.ts";

const SRC = "compiler/rustc_infer/src/";
const HERE = import.meta.dir;
const REPO_SRC = join(HERE, "..");

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith(".rs")) out.push(p);
  }
  return out;
}
const UP_FILES = walk(join(UPSTREAM, SRC))
  .map((p) => relative(join(UPSTREAM, SRC), p))
  .sort();
const ALL = UP_FILES.flatMap((f) => upstreamFns(SRC + f).map((u) => ({ file: f, line: u.line, name: u.name })));

/** `// rustc: compiler/rustc_infer/src/<file>:<line> <name>` markers anywhere under src/. */
function markers(): Set<string> {
  const out = new Set<string>();
  const visit = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) visit(p);
      else if (e.name.endsWith(".ts")) {
        for (const m of readFileSync(p, "utf8").matchAll(/\/\/ rustc: compiler\/rustc_infer\/src\/(\S+):(\d+) (\w+)/g)) out.add(`${m[1]}:${m[2]} ${m[3]}`);
      }
    }
  };
  visit(REPO_SRC);
  return out;
}

interface Decl {
  file: string;
  line: number;
  name: string;
  /** the interface / namespace / class the declaration sits in */
  ctx: string;
  /** the `declare module` path (relative to decls.ts), if any */
  module: string | undefined;
  kind: "proto" | "static";
  /** `Companions` member */
  sub: string | undefined;
}

/** The real declarations of a decls file (the parser the stub modules were generated with). */
function parse_decls(path: string): { decls: Decl[]; index: Map<string, string> } {
  const lines = readFileSync(path, "utf8").split("\n");
  const decls: Decl[] = [];
  const index = new Map<string, string>();
  let module: string | undefined;
  let stack: { indent: number; kind: string; name: string }[] = [];
  let sub: string | undefined;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!;
    const r = /^\s*\/\/ ((?:\w+\/)*\w+\.rs):(\d+)\b/.exec(l);
    if (r) index.set(`${r[1]}:${r[2]}`, lines[i + 1] ?? "");
    let m = /^declare module "([^"]+)" \{/.exec(l);
    if (m) {
      module = m[1];
      stack = [];
      continue;
    }
    if (l === "}") {
      module = undefined;
      stack = [];
      continue;
    }
    m = /^(\s*)(?:export )?(interface|namespace|class) (\w+)(?:<[^>]*>)?(?: implements \w+)? \{/.exec(l);
    if (m) {
      stack.push({ indent: m[1]!.length, kind: m[2]!, name: m[3]! });
      continue;
    }
    m = /^(\s*)\}/.exec(l);
    if (m && stack.length && m[1]!.length === stack[stack.length - 1]!.indent) {
      stack.pop();
      continue;
    }
    m = /^ {2}(\w+): \{$/.exec(l);
    if (m && stack.length && stack[stack.length - 1]!.name === "Companions") {
      sub = m[1];
      continue;
    }
    if (r && stack.length) {
      const nxt = lines[i + 1] ?? "";
      const ctx = stack[stack.length - 1]!;
      const m2 = /^\s*(?:declare static )?(?:export let |function )?(\w+?)(_)?(<[^(]*>)?[(:]/.exec(nxt);
      if (nxt.trim().startsWith("//") || !m2) continue;
      let name = m2[1]! + (m2[2] ?? "");
      let kind: "proto" | "static" = ctx.kind === "namespace" || nxt.includes("declare static") ? "static" : "proto";
      if (name === "new_" && kind === "static") name = "new";
      decls.push({ file: r[1]!, line: Number(r[2]), ctx: ctx.name, module, kind, name, sub: ctx.name === "Companions" ? sub : undefined });
    }
  }
  return { decls, index };
}

const DECLS = parse_decls(join(HERE, "decls.ts"));

/** The TS module of an upstream rustc_infer file (as the stub generator mapped them). */
const ts_of = (file: string): string => join(HERE, file.replace(/\.rs$/, ".ts"));
/** The `rustc_infer::..` module path of an upstream file (the prefix of its placeholders' paths). */
const mod_path = (file: string): string =>
  ["rustc_infer", ...file.replace(/\.rs$/, "").split("/").filter((p, i, a) => !(i === a.length - 1 && (p === "mod" || p === "lib")))].join("::");

async function target(d: Decl): Promise<Record<string, unknown>> {
  if (d.ctx === "Companions") return (await import(ts_of(d.file)))[d.sub!] as Record<string, unknown>;
  if (d.ctx === "FreeFns") return (await import(ts_of(d.file))) as Record<string, unknown>;
  if (d.ctx === "TyCtxt") return TyCtxt.prototype as unknown as Record<string, unknown>;
  const cls =
    d.module === undefined
      ? ({ InferCtxt, InferCtxtInner, InferCtxtBuilder, At } as Record<string, unknown>)[d.ctx]
      : (await import(join(HERE, d.module.replace(/\.gen\.ts$/, ".ts"))))[d.ctx];
  expect(cls).toBeDefined();
  return (d.kind === "proto" ? (cls as { prototype: unknown }).prototype : cls) as Record<string, unknown>;
}

/** A `TyCtxt` over a fresh `CtxtInterners` (as rustc_type_ir's tests), with the solver choice fixed. */
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
  const tcx = new TyCtxt(gcx as unknown as GlobalCtxt);
  // PORT(test): `next_trait_solver_globally` reads the session; the test has none (the oracle's default is `Globally`).
  (tcx as unknown as { next_trait_solver_globally: () => boolean }).next_trait_solver_globally = () => true;
  return tcx;
}

describe("rustc_infer contract", () => {
  test("every rustc_infer fn is declared in decls.ts at its file:line or ported", () => {
    const marks = markers();
    const missing: string[] = [];
    for (const f of ALL) {
      if (marks.has(`${f.file}:${f.line} ${f.name}`)) continue;
      const d = DECLS.index.get(`${f.file}:${f.line}`);
      // `name(`, `// name`, `declare static name`, `export let name`, `function name_` (a static `new`), or the
      // `ir_<name>` / `<SelfTy>_<name>` forms
      const name = f.name === "fmt" ? "(fmt|display_\\w+)" : f.name;
      if (d === undefined || !new RegExp(`^\\s*(// )?(declare static |export let |function )?(\\w+_)?${name}_?\\b`).test(d)) {
        missing.push(`${f.file}:${f.line} ${f.name}`);
      }
    }
    expect(missing).toEqual([]);
    // 644 fns in rustc_infer at the pin (infer 545, traits 61, solver_region_constraints/tests.rs 1, ...).
    expect(ALL.length).toBe(644);
  });

  test("every real declaration exists at runtime; placeholders stop as UNPORTED and name their own file", async () => {
    const bad: string[] = [];
    let stubs = 0;
    for (const d of DECLS.decls) {
      const obj = await target(d);
      const f = obj[d.name];
      if (typeof f !== "function") {
        bad.push(`${d.file}:${d.line} ${d.ctx}.${d.name}: ${typeof f}`);
        continue;
      }
      const path = unported_stub_path(f);
      if (path !== undefined) {
        stubs++;
        if (!path.startsWith(mod_path(d.file) + "::")) bad.push(`${d.file}:${d.line} ${d.name}: placeholder of ${path}`);
        expect(() => (f as () => unknown).call(obj)).toThrow(Unported);
      }
    }
    expect(bad).toEqual([]);
    expect(DECLS.decls.length).toBeGreaterThan(300);
    expect(stubs).toBeGreaterThan(250);
  });

  test("InferCtxt has every InferCtxtLike method", () => {
    const src = readFileSync(join(HERE, "../rustc_type_ir/infer_ctxt.ts"), "utf8");
    const body = src.slice(src.indexOf("export interface InferCtxtLike {"), src.indexOf("export const InferCtxtLike_provided"));
    const names = [...body.matchAll(/^ {2}(\w+)(<[^(]*>)?\(/gm)].map((m) => m[1]!);
    expect(names.length).toBeGreaterThan(60);
    const proto = InferCtxt.prototype as unknown as Record<string, unknown>;
    expect(names.filter((n) => typeof proto[n] !== "function")).toEqual([]);
  });

  test("rustc_trait_selection's extension methods are its placeholders and collide with no inherent method", async () => {
    const ts = parse_decls(join(HERE, "../rustc_trait_selection/decls.ts"));
    const inherent = new Set(DECLS.decls.filter((d) => d.module === undefined).map((d) => `${d.ctx}.${d.name}`));
    const bad: string[] = [];
    for (const d of ts.decls) {
      if (inherent.has(`${d.ctx}.${d.name}`)) bad.push(`collision ${d.ctx}.${d.name}`);
      const cls =
        d.module === "../rustc_infer/decls.ts"
          ? ({ InferCtxt, InferCtxtBuilder, At } as Record<string, unknown>)[d.ctx]
          : (await import(join(HERE, "../rustc_trait_selection", d.module!)))[d.ctx];
      const obj = (d.kind === "proto" ? (cls as { prototype: unknown }).prototype : cls) as Record<string, unknown>;
      const f = obj[d.name];
      const path = unported_stub_path(f);
      const mod = ["rustc_trait_selection", ...d.file.replace(/\.rs$/, "").split("/").filter((p) => p !== "mod")].join("::");
      if (path === undefined || !path.startsWith(mod + "::")) bad.push(`${d.file}:${d.line} ${d.name}: ${path ?? typeof f}`);
    }
    expect(bad).toEqual([]);
    expect(ts.decls.length).toBe(29);
  });
});

describe("InferCtxt construction (ported: builder, InferCtxtInner glue, ena tables, undo log)", () => {
  test("tcx.infer_ctxt().build(..) builds an empty InferCtxt", () => {
    const tcx = mk_tcx();
    const builder = tcx.infer_ctxt();
    expect(builder).toBeInstanceOf(InferCtxtBuilder);
    expect([builder.considering_regions, builder.in_hir_typeck_, builder.skip_leak_check_, builder.next_trait_solver, builder.enable_next_solver_overflow_fcw_]).toEqual([true, false, false, true, true]);
    const infcx = builder.ignoring_regions().in_hir_typeck().with_next_trait_solver(false).build(TypingMode.non_body_analysis());
    expect(infcx).toBeInstanceOf(InferCtxt);
    expect(infcx.tcx).toBe(tcx);
    expect(infcx.typing_mode).toEqual(TypingMode.non_body_analysis());
    expect([infcx.considering_regions, infcx.in_hir_typeck, infcx.skip_leak_check, infcx.next_trait_solver_]).toEqual([false, true, false, false]);
    expect(infcx.universe_).toBe(UniverseIndex.ROOT);
    expect(infcx.tainted_by_errors_).toBeUndefined();
    expect(infcx.inner).toBeInstanceOf(InferCtxtInner);
    expect(infcx.inner.undo_log.logs).toEqual([]);
    expect(infcx.inner.region_obligations()).toEqual([]);
    expect(infcx.inner.region_constraint_storage).toBeDefined();
    expect(infcx.lexical_region_resolutions).toBeUndefined();
  });

  test("the type-variable table: new_var, equate, instantiate, probe", () => {
    const tcx = mk_tcx();
    const infcx = tcx.infer_ctxt().build(TypingMode.non_body_analysis());
    const origin = { span: DUMMY_SP, param_def_id: undefined };
    const a = infcx.inner.type_variables().new_var(UniverseIndex.ROOT, origin);
    const b = infcx.inner.type_variables().new_var(UniverseIndex.from_u32(1), origin);
    expect([a, b]).toEqual([0, 1] as never);
    expect(infcx.inner.type_variables().num_vars()).toBe(2);
    expect(infcx.inner.type_variables().var_origin(b)).toBe(origin);
    infcx.inner.type_variables().equate(a, b);
    // `TyVidEqKey::order_roots` keeps the smaller vid as the root; the universes unify to the minimum.
    expect(infcx.inner.type_variables().root_var(b)).toBe(a);
    expect(infcx.inner.type_variables().sub_unification_table_root_var(b)).toBe(infcx.inner.type_variables().sub_unification_table_root_var(a));
    expect(infcx.inner.type_variables().probe(b)).toEqual({ $: "Unknown", universe: UniverseIndex.ROOT });
    expect(infcx.inner.type_variables().unresolved_root_variables()).toEqual([a]);
    const unit = tcx.types.unit;
    infcx.inner.type_variables().instantiate(b, unit);
    expect(TypeVariableValue.known(infcx.inner.type_variables().probe(a))).toBe(unit);
    // `try_probe_value` reads only a root's value (no pointer chasing).
    expect(infcx.inner.try_type_variables_probe_ref(a)).toEqual({ $: "Known", value: unit });
    expect(infcx.inner.try_type_variables_probe_ref(b)).toBeUndefined();
    expect(infcx.inner.type_variables().unresolved_root_variables()).toEqual([]);
  });

  test("snapshots: rollback_to undoes the ena tables, commit keeps them", () => {
    const tcx = mk_tcx();
    const infcx = tcx.infer_ctxt().build(TypingMode.non_body_analysis());
    const origin = { span: DUMMY_SP, param_def_id: undefined };
    const a = infcx.inner.type_variables().new_var(UniverseIndex.ROOT, origin);
    // Outside a snapshot nothing is logged.
    expect(infcx.inner.undo_log.logs.length).toBe(0);

    const s1 = infcx.inner.undo_log.start_snapshot();
    const b = infcx.inner.type_variables().new_var(UniverseIndex.ROOT, origin);
    infcx.inner.type_variables().equate(a, b);
    const i = infcx.inner.int_unification_table().new_key({ $: "Unknown" });
    expect(infcx.inner.undo_log.logs.length).toBeGreaterThan(0);
    expect(infcx.inner.undo_log.logs.some((l) => l.$ === "TypeVariables")).toBe(true);
    expect(infcx.inner.undo_log.logs.some((l) => l.$ === "IntUnificationTable")).toBe(true);
    infcx.inner.rollback_to(s1);
    expect(infcx.inner.type_variables().num_vars()).toBe(1);
    expect(infcx.inner.int_unification_storage.len()).toBe(0);
    expect(infcx.inner.undo_log.logs).toEqual([]);
    expect(infcx.inner.undo_log.num_open_snapshots_).toBe(0);
    void i;

    const s2 = infcx.inner.undo_log.start_snapshot();
    infcx.inner.type_variables().new_var(UniverseIndex.ROOT, origin);
    infcx.inner.commit(s2);
    expect(infcx.inner.type_variables().num_vars()).toBe(2);
    expect(infcx.inner.undo_log.logs).toEqual([]);
  });

  test("the contract's placeholders stop as UNPORTED", () => {
    const tcx = mk_tcx();
    const infcx = tcx.infer_ctxt().build(TypingMode.non_body_analysis());
    expect(() => infcx.next_ty_var(DUMMY_SP)).toThrow(Unported);
    expect(() => infcx.next_ty_var(DUMMY_SP)).toThrow(/rustc_infer::infer::InferCtxt::next_ty_var/);
    // (`unwrap_region_constraints` stopped at `RegionConstraintStorage::with_log` until lane infer-regions ported it.)
    expect(() => infcx.can_eq(undefined as never, undefined, undefined, undefined as never)).toThrow(/rustc_trait_selection::infer::InferCtxt::can_eq/);
  });

  test("rustc_middle infer/canonical.rs: CanonicalParamEnvCache and OriginalQueryValues defaults", () => {
    const cache = CanonicalParamEnvCache.default_();
    expect(cache.map.size).toBe(0);
    expect(OriginalQueryValues.default_()).toEqual({ universe_map: [UniverseIndex.ROOT], var_values: [] });
  });
});


