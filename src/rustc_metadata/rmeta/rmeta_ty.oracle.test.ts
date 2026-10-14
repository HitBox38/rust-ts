// Oracle test for lane rmeta-ty: typed values decoded from crate metadata (rustc_middle ty/codec.rs, the TyDecodable
// derives of the type sets, rmeta decoder.rs's `cached_ty_for_shorthand`, the typed extern providers of
// cstore_impl.rs).
//
// rmetatydump (rustc-dev probe, tools/probes/rmetatydump) runs the oracle's driver on `#![no_std] extern crate
// alloc;` (target x86_64-unknown-linux-gnu, the oracle sysroot) and prints, through the oracle's queries, for a sample
// of the DefIndexes of core and alloc: `def_kind`, `type_of`, `fn_sig`, `generics_of`, `inferred_outlives_of`,
// `explicit_clauses_of`, the super / implied clauses of traits, `explicit_item_bounds`, `variances_of` and
// `associated_item`; see the probe's header for the format. Types are printed twice: as a structural "shape" (written
// out by hand on both sides, independent of the pretty printer) and as their `{:?}` (`.dbg` lines).
//
// The port runs the same compilation (driver config, `parse`, `create_and_enter_global_ctxt`,
// `tcx.resolver_for_lowering()`, which loads the crates through the real creader) and prints the same lines through
// its queries (cstore_impl.ts's providers). A line the port cannot produce yet stops as `UNPORTED(<what>)`: it is
// counted as pending under its stop, and every other line must equal the oracle's. The summary (matched / pending by
// stop) goes to $RUST_TS_DATA/tmp/rmeta-ty-oracle/<agent>/summary.txt; the test also requires that each kind of line
// matches on at least `MIN_MATCHED` lines, so a regression cannot hide behind UNPORTED.
//
// Without the probe the test is a visible skip; RUST_TS_REQUIRE_PROBES=1 makes that a failure.
import { expect, test } from "bun:test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA } from "../../../scripts/lib/common.ts";
import type { Crate } from "../../rustc_ast/lib.ts";
import { compiler_entrypoint } from "../../rustc_driver_impl/lib.ts";
import { type Config, run_compiler } from "../../rustc_interface/interface.ts";
import { create_and_enter_global_ctxt, parse } from "../../rustc_interface/passes.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { GenericArg, GenericArgs } from "../../rustc_middle/ty/generic_args.ts";
import { GenericArg as GenericArgC } from "../../rustc_middle/ty/generic_args.ts";
import type { Generics } from "../../rustc_middle/ty/generics.ts";
import type { Term, Ty } from "../../rustc_middle/ty/mod.ts";
import { Term as TermC } from "../../rustc_middle/ty/mod.ts";
import type { Clause } from "../../rustc_middle/ty/predicate.ts";
import type { AssocItem } from "../../rustc_middle/ty/assoc.gen.ts";
import { debug_DefKind } from "../../rustc_hir/def.ts";
import { debug_Safety } from "../../rustc_hir/hir.gen.ts";
import { debug_ExternAbi } from "../../rustc_abi/extern_abi.ts";
import { debug_FloatTy, debug_IntTy, debug_UintTy, Mutability } from "../../rustc_ast_ir/lib.ts";
import { type CrateNum, DefId, DefIndex } from "../../rustc_span/def_id.ts";
import { Symbol } from "../../rustc_span/symbol.ts";
import type { Span } from "../../rustc_span/lib.ts";
import { debug_Variance } from "../../rustc_type_ir/lib.ts";
import type { BoundVarIndexKind, EarlyBinder, FnSig, Variance } from "../../rustc_type_ir/decls.ts";
import { FnSigKind } from "../../rustc_type_ir/ty_kind.ts";
import type { Region } from "../../rustc_type_ir/sty/mod.ts";
import type { Const } from "../../rustc_type_ir/sty/consts.ts";
import type { Binder } from "../../rustc_type_ir/binder.ts";
import { PLAIN } from "../../std/fmt.ts";
import { Unported } from "../../std/panic.ts";
import { creader } from "../lib.ts";
import { debug_EarlyBinder } from "../../rustc_type_ir/binder.ts";
import { debug_Ty } from "../../rustc_middle/ty/mod.ts";
import { debug_Clause } from "../../rustc_middle/ty/predicate.ts";
import { debug_Binder } from "../../rustc_type_ir/binder.gen.ts";
import { debug_FnSig } from "../../rustc_type_ir/ty_kind.ts";
import { debug_Span } from "../../rustc_span/lib.ts";
import { debug_list, debug_tuple } from "../../std/fmt.ts";

const REQUIRE_PROBES = process.env.RUST_TS_REQUIRE_PROBES === "1";
const PROBE = join(DATA, "target", "probes", "release", "rmetatydump");
const SKIP = !existsSync(PROBE) && !REQUIRE_PROBES;
if (SKIP) console.log("SKIP: rmetatydump probe not built (bun scripts/probes.ts build rmetatydump); RUST_TS_REQUIRE_PROBES=1 makes this a failure");

const TUPLE = "x86_64-unknown-linux-gnu";
const CRATES = ["core", "alloc"];
/** Lines of each shape kind that must match (not merely be pending): see the header. */
/** (Measured by lane rmeta-ty: kind 3400, type_of 1181, fn_sig 214, generics 1912, outlives 1908, variances 884, assoc 747,
 * bounds 121; the rest stopped at AdtDefData / GenericClauses / `Predicate::expect_clause` / Debug of `Ty`.) */
// merge-w15b: raised to the counts after the wave-15 merge (ty-adt-assoc / ty-results / ty-args landed).
const MIN_MATCHED: Record<string, number> = {
  kind: 3400,
  type_of: 1181,
  "type_of.dbg": 294,
  fn_sig: 214,
  generics: 1912,
  outlives: 1912,
  "outlives.dbg": 1908,
  super: 9,
  implied: 9,
  variances: 884,
  assoc: 748,
  bounds: 124,
};
const WORK = join(DATA, "tmp", "rmeta-ty-oracle", process.env.RUST_TS_AGENT ?? "default");

function sysroot(): string {
  const oracle = require("../../../scripts/lib/oracle.ts") as typeof import("../../../scripts/lib/oracle.ts");
  return oracle.oracleSysroot();
}
function source_file(): string {
  mkdirSync(WORK, { recursive: true });
  const f = join(WORK, "rmetaty.rs");
  writeFileSync(f, "#![no_std]\nextern crate alloc;\n");
  return f;
}
function rustc_args(file: string): string[] {
  return ["--target", TUPLE, "--sysroot", sysroot(), "--crate-type", "lib", "--edition", "2024", file];
}

/** The probe's `sample(n)`. */
function sample(n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) if (i < 300 || i + 100 >= n || (i - 300) % 37 === 0) out.push(i);
  return out;
}

class CaptureConfig extends Error {}
function config_from_args(args: string[]): Config {
  let config: Config | undefined;
  try {
    compiler_entrypoint(["rustc", ...args], {
      config(c: Config) {
        config = c;
        throw new CaptureConfig();
      },
    });
  } catch (e) {
    if (!(e instanceof CaptureConfig)) throw e;
  }
  if (config === undefined) throw new globalThis.Error("ERROR: no config");
  return config;
}

// ---- the probe's shapes (tools/probes/rmetatydump/main.rs), over the port's values ----

function did(tcx: TyCtxt, d: DefId): string {
  return `${Symbol.as_str(tcx.crate_name(d.krate))}:${DefIndex.as_u32(d.index)}`;
}
function bvi(k: BoundVarIndexKind): string {
  return k.$ === "Bound" ? `${k._0}` : "C";
}
function args_shape(tcx: TyCtxt, args: GenericArgs): string {
  return `<${args.map((a) => arg_shape(tcx, a)).join(", ")}>`;
}
function arg_shape(tcx: TyCtxt, a: GenericArg): string {
  const k = GenericArgC.kind(a);
  switch (k.$) {
    case "Lifetime":
      return region_shape(k._0);
    case "Type":
      return ty_shape(tcx, k._0);
    case "Const":
      return const_shape(k._0);
  }
}
function term_shape(tcx: TyCtxt, t: Term): string {
  const k = TermC.kind(t);
  return k.$ === "Ty" ? ty_shape(tcx, k._0) : const_shape(k._0);
}
function region_shape(r: Region): string {
  const k = r.kind();
  switch (k.$) {
    case "ReEarlyParam":
      return `'${Symbol.as_str(k._0.name)}#${k._0.index}`;
    case "ReBound":
      return `'^${bvi(k._0)}.${k._1.var}`;
    case "ReLateParam":
      return "'late";
    case "ReStatic":
      return "'static";
    case "ReVar":
      return "'var";
    case "RePlaceholder":
      return "'placeholder";
    case "ReErased":
      return "'erased";
    case "ReError":
      return "'error";
  }
}
function const_shape(c: Const): string {
  const k = c.kind();
  switch (k.$) {
    case "Param":
      return `const ${Symbol.as_str(k._0.name)}#${k._0.index}`;
    case "Bound":
      return `const ^${bvi(k._0)}.${k._1.var}`;
    default:
      return `const ${k.$}`;
  }
}
function tys_shape(tcx: TyCtxt, tys: readonly Ty[]): string {
  return tys.map((t) => ty_shape(tcx, t)).join(", ");
}
function ty_shape(tcx: TyCtxt, t: Ty): string {
  const k = t.kind();
  switch (k.$) {
    case "Bool":
      return "bool";
    case "Char":
      return "char";
    case "Int":
      return debug_IntTy(k._0, PLAIN);
    case "Uint":
      return debug_UintTy(k._0, PLAIN);
    case "Float":
      return debug_FloatTy(k._0, PLAIN);
    case "Adt":
      return `Adt(${did(tcx, (k._0 as unknown as { did(): DefId }).did())})${args_shape(tcx, k._1)}`;
    case "Foreign":
      return `Foreign(${did(tcx, k._0)})`;
    case "Str":
      return "str";
    case "Array":
      return `[${ty_shape(tcx, k._0)}; ${const_shape(k._1)}]`;
    case "Pat":
      return `Pat(${ty_shape(tcx, k._0)})`;
    case "Slice":
      return `[${ty_shape(tcx, k._0)}]`;
    case "RawPtr":
      return `*${Mutability.ptr_str(k._1)} ${ty_shape(tcx, k._0)}`;
    case "Ref":
      return `&${region_shape(k._0)} ${Mutability.prefix_str(k._2)}${ty_shape(tcx, k._1)}`;
    case "FnDef":
      return `FnDef(${did(tcx, k._0)})<${k._1.bound_vars.length}>${args_shape(tcx, k._1.value)}`;
    case "FnPtr":
      return `FnPtr<${k._0.bound_vars.length}>(${tys_shape(tcx, k._0.value.inputs_and_output)})`;
    case "UnsafeBinder":
      return "UnsafeBinder";
    case "Dynamic":
      return `Dynamic[${k._0.length}](${region_shape(k._1)})`;
    case "Closure":
    case "CoroutineClosure":
    case "Coroutine":
    case "CoroutineWitness":
      return `${k.$}(${did(tcx, k._0)})${args_shape(tcx, k._1)}`;
    case "Never":
      return "!";
    case "Tuple":
      return `(${tys_shape(tcx, k._0)})`;
    case "Alias":
      return `${k._1.kind.$}(${did(tcx, k._1.kind.def_id)})${args_shape(tcx, k._1.args)}`;
    case "Param":
      return `${Symbol.as_str(k._0.name)}#${k._0.index}`;
    case "Bound":
      return `^${bvi(k._0)}.${k._1.var}`;
    case "Placeholder":
      return "Placeholder";
    case "Infer":
      return "Infer";
    case "Error":
      return "Error";
  }
}
function clause_shape(tcx: TyCtxt, c: Clause): string {
  const k = c.internee;
  const n = k.bound_vars.length;
  const p = k.value;
  if (p.$ !== "Clause") throw new globalThis.Error(`ERROR: a Clause over ${p.$}`);
  const ck = p._0;
  let body: string;
  switch (ck.$) {
    case "Trait":
      body = `Trait(${did(tcx, ck._0.trait_ref.def_id)})${args_shape(tcx, ck._0.trait_ref.args)}`;
      break;
    case "RegionOutlives":
      body = `RegionOutlives(${region_shape(ck._0._0)}: ${region_shape(ck._0._1)})`;
      break;
    case "TypeOutlives":
      body = `TypeOutlives(${ty_shape(tcx, ck._0._0)}: ${region_shape(ck._0._1)})`;
      break;
    case "Projection":
      body = `Projection(${did(tcx, ck._0.projection_term.kind.def_id)})${args_shape(tcx, ck._0.projection_term.args)} == ${term_shape(tcx, ck._0.term)}`;
      break;
    case "ConstArgHasType":
      body = `ConstArgHasType(${const_shape(ck._0)}: ${ty_shape(tcx, ck._1)})`;
      break;
    case "WellFormed":
      body = `WellFormed(${term_shape(tcx, ck._0)})`;
      break;
    case "ConstEvaluatable":
      body = `ConstEvaluatable(${const_shape(ck._0)})`;
      break;
    case "HostEffect":
      body = `HostEffect(${did(tcx, ck._0.trait_ref.def_id)})${args_shape(tcx, ck._0.trait_ref.args)}`;
      break;
    case "UnstableFeature":
      body = `UnstableFeature(${Symbol.as_str(ck._0)})`;
      break;
  }
  return `<${n}>${body}`;
}
function clauses_shape(tcx: TyCtxt, cs: readonly (readonly [Clause, Span])[]): string {
  return `[${cs.map(([c]) => clause_shape(tcx, c)).join(", ")}]`;
}
function opt_did(tcx: TyCtxt, d: DefId | undefined): string {
  return d === undefined ? "-" : did(tcx, d);
}

const TYPE_OF = new Set(["Struct", "Union", "Enum", "Variant", "Ctor", "Field", "Fn", "Const", "TyAlias", "ForeignTy", "Impl", "AssocFn", "AssocConst", "Closure", "ConstParam", "SyntheticCoroutineBody"]);
const GENERICS = new Set(["Struct", "Union", "Enum", "Variant", "Trait", "TyAlias", "ForeignTy", "TraitAlias", "AssocTy", "Fn", "Const", "Static", "Ctor", "AssocFn", "AssocConst", "OpaqueTy", "Impl", "Field", "TyParam", "Closure", "SyntheticCoroutineBody"]);
const VARIANCES = new Set(["Struct", "Union", "Enum", "OpaqueTy", "Fn", "Ctor", "AssocFn"]);

type Line = [key: string, value: () => string];

/**
 * A query result computed once: a query that stopped as UNPORTED is left in progress (the stop unwinds through the
 * query engine, which in the real driver ends the process), so calling it again would report a cycle.
 */
function once<T>(f: () => T): () => T {
  let r: { ok: T } | { err: unknown } | undefined;
  return () => {
    if (r === undefined) {
      try {
        r = { ok: f() };
      } catch (e) {
        r = { err: e };
      }
    }
    if ("err" in r) throw r.err;
    return r.ok;
  };
}

/** The port's lines for one DefId, in the probe's order (`<i> <key> <value>`; `kind` is `kind=<..>`). */
function lines_of(tcx: TyCtxt, d: DefId): Line[] {
  const kind = tcx.def_kind(d);
  const out: Line[] = [["kind", () => `kind=${debug_DefKind(kind, PLAIN)}`]];
  const k = kind.$;
  const static_not_nested = k === "Static" && !(kind as { nested: boolean }).nested;
  if (TYPE_OF.has(k) || static_not_nested) {
    const type_of = once(() => tcx.type_of(d) as EarlyBinder<Ty>);
    out.push(["type_of", () => ty_shape(tcx, type_of().value)]);
    out.push(["type_of.dbg", () => debug_EarlyBinder(type_of(), PLAIN, debug_Ty)]);
  }
  const ctor_fn = k === "Ctor" && (kind as { _1: string })._1 === "Fn";
  if (k === "Fn" || k === "AssocFn" || ctor_fn) {
    const fn_sig = once(() => tcx.fn_sig(d) as EarlyBinder<Binder<FnSig>>);
    out.push([
      "fn_sig",
      () => {
        const sig = fn_sig().value;
        const s = sig.value;
        return `<${sig.bound_vars.length}>(${tys_shape(tcx, s.inputs_and_output)}) c_variadic=${FnSigKind.c_variadic(s.fn_sig_kind)} safety=${debug_Safety(FnSigKind.safety(s.fn_sig_kind), PLAIN)} abi=${debug_ExternAbi(FnSigKind.abi(s.fn_sig_kind), PLAIN)}`;
      },
    ]);
    out.push(["fn_sig.dbg", () => debug_EarlyBinder(fn_sig(), PLAIN, (b, f) => debug_Binder(b, f, debug_FnSig))]);
  }
  if (GENERICS.has(k)) {
    out.push([
      "generics",
      () => {
        const g = tcx.generics_of(d) as Generics;
        const ps = g.own_params.map((p) => `${Symbol.as_str(p.name)}#${p.index}:${p.kind.$}`);
        return `parent=${opt_did(tcx, g.parent)} params=[${ps.join(", ")}]`;
      },
    ]);
    const outlives = once(() => tcx.inferred_outlives_of(d) as readonly [Clause, Span][]);
    out.push(["outlives", () => clauses_shape(tcx, outlives())]);
    out.push(["outlives.dbg", () => debug_list(PLAIN, outlives().map(([c, sp]) => debug_tuple(PLAIN, "", [debug_Clause(c, PLAIN), debug_Span(sp, PLAIN)])))]);
    out.push([
      "clauses",
      () => {
        const c = tcx.explicit_clauses_of(d) as { parent: DefId | undefined; clauses: readonly [Clause, Span][] };
        return `parent=${opt_did(tcx, c.parent)} ${clauses_shape(tcx, c.clauses)}`;
      },
    ]);
  }
  if (k === "Trait" || k === "TraitAlias") {
    out.push(["super", () => clauses_shape(tcx, (tcx.explicit_super_clauses_of(d) as EarlyBinder<readonly [Clause, Span][]>).value)]);
    out.push(["implied", () => clauses_shape(tcx, (tcx.explicit_implied_clauses_of(d) as EarlyBinder<readonly [Clause, Span][]>).value)]);
  }
  if (k === "AssocTy" || k === "OpaqueTy") {
    out.push(["bounds", () => clauses_shape(tcx, (tcx.explicit_item_bounds(d) as EarlyBinder<readonly [Clause, Span][]>).value)]);
  }
  if (VARIANCES.has(k)) {
    out.push(["variances", () => `[${(tcx.variances_of(d) as readonly Variance[]).map((v) => debug_Variance(v, PLAIN)).join(", ")}]`]);
  }
  if (k === "AssocFn" || k === "AssocConst" || k === "AssocTy") {
    out.push([
      "assoc",
      () => {
        const a = tcx.associated_item(d) as AssocItem;
        let kk: string;
        let name = "-";
        let has_self = "-";
        switch (a.kind.$) {
          case "Const":
            kk = "Const";
            name = Symbol.as_str(a.kind.name);
            break;
          case "Fn":
            kk = "Fn";
            name = Symbol.as_str(a.kind.name);
            has_self = `${a.kind.has_self}`;
            break;
          case "Type":
            kk = "Type";
            if (a.kind.data.$ === "Normal") name = Symbol.as_str(a.kind.data._0);
            break;
        }
        const c = a.container;
        const container = c.$ === "TraitImpl" ? (c._0.$ === "Ok" ? `TraitImpl(${did(tcx, c._0._0)})` : "TraitImpl(Err)") : c.$;
        return `${kk} name=${name} has_self=${has_self} container=${container}`;
      },
    ]);
  }
  return out;
}


function value_or_stop(f: () => string): string {
  try {
    return f();
  } catch (e) {
    if (e instanceof Unported) return `UNPORTED(${e.what})`;
    throw e;
  }
}

test.skipIf(SKIP)("rmeta-ty oracle: typed extern providers of core and alloc", () => {
  if (!existsSync(PROBE)) throw new globalThis.Error("ERROR: rmetatydump probe not built (bun scripts/probes.ts build rmetatydump)");
  const file = source_file();
  const args = rustc_args(file);
  const r = Bun.spawnSync([PROBE, CRATES.join(","), ...args], { stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== 0) throw new globalThis.Error(`ERROR: rmetatydump failed: ${r.stderr.toString().slice(0, 2000)}`);
  const oracle = r.stdout.toString().split("\n").filter((l) => l !== "");

  const ours: string[] = [];
  const config = config_from_args(args);
  run_compiler(config, (compiler) => {
    const krate: Crate = parse(compiler.sess);
    create_and_enter_global_ctxt(compiler, krate, (tcx) => {
      void tcx.resolver_for_lowering();
      for (const want of CRATES) {
        const cnum = (tcx.crates(null) as readonly CrateNum[]).find((c) => Symbol.as_str(tcx.crate_name(c)) === want);
        if (cnum === undefined) throw new globalThis.Error(`ERROR: crate ${want} is not loaded`);
        const n = creader.CStore.from_tcx(tcx).num_def_ids_untracked(cnum);
        ours.push(`crate ${want} num_def_ids=${n}`);
        for (const i of sample(n)) {
          const d = new DefId(DefIndex.from_usize(i), cnum);
          for (const [key, value] of lines_of(tcx, d)) {
            const v = value_or_stop(value);
            ours.push(key === "kind" ? `${i} ${v}` : `${i} ${key} ${v}`);
          }
        }
      }
    });
  });

  // compare line by line (same keys in the same order); UNPORTED lines are pending
  const matched = new Map<string, number>();
  const pending = new Map<string, number>();
  const diffs: string[] = [];
  const keyOf = (l: string) => {
    const m = /^(\d+) (kind=|\S+)/.exec(l);
    return m ? (m[2] === "kind=" ? "kind" : m[2]!) : l;
  };
  expect(ours.length).toBe(oracle.length);
  for (let i = 0; i < oracle.length; i++) {
    const o = oracle[i]!;
    const p = ours[i]!;
    const key = keyOf(o);
    expect(keyOf(p)).toBe(key);
    const u = /^\d+ \S+ UNPORTED\((.*)\)$/.exec(p);
    if (u) {
      pending.set(u[1]!, (pending.get(u[1]!) ?? 0) + 1);
      continue;
    }
    if (o === p) matched.set(key, (matched.get(key) ?? 0) + 1);
    else diffs.push(`oracle: ${o}\nours:   ${p}`);
  }
  const summary = [
    `lines ${oracle.length}, diffs ${diffs.length}`,
    ...[...matched].sort(([a], [b]) => a.localeCompare(b)).map(([k, n]) => `matched ${k}: ${n}`),
    ...[...pending].sort(([, a], [, b]) => b - a).map(([k, n]) => `pending ${n}: ${k}`),
    ...diffs.slice(0, 50),
  ].join("\n");
  mkdirSync(WORK, { recursive: true });
  writeFileSync(join(WORK, "summary.txt"), summary + "\n");
  writeFileSync(join(WORK, "ours.txt"), ours.join("\n") + "\n");
  writeFileSync(join(WORK, "oracle.txt"), oracle.join("\n") + "\n");
  if (diffs.length) console.log(`ERROR: rmeta-ty oracle: ${diffs.length} diffs; first:\n${diffs[0]}\n(summary: ${join(WORK, "summary.txt")})`);
  expect(diffs.length).toBe(0);
  for (const [k, min] of Object.entries(MIN_MATCHED)) expect([k, (matched.get(k) ?? 0) >= min]).toEqual([k, true]);
}, 600_000);
