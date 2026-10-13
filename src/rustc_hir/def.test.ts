// Oracle tests for rustc_hir::def (+ the rustc_hir_id / rustc_structures Debug and Display impls).
//
// `def_oracle/cases.txt` was produced by `def_oracle/gen.rs`, a scratch Rust program built against
// the pinned toolchain's own rustc_hir / rustc_hir_id / rustc_structures (rustc-dev component of
// nightly-2026-10-11). Each line is `key<TAB>value` (newlines of `{:#?}` output escaped as `\n`).
// This test recomputes every line with the TS port and compares them all.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { debug_HirId, display_HirId, HirId, ItemLocalId, OwnerId, debug_OwnerId } from "../rustc_hir_id/lib.ts";
import { DefKey, DefPathData, DisambiguatedDefPathData, debug_DefKey, debug_DefPathData, debug_DisambiguatedDefPathData, display_DefPathData } from "../rustc_hir_id/definitions.ts";
import { CRATE_DEF_ID, CrateNum, DefId, DefIndex, debug_DefId } from "../rustc_span/def_id.ts";
import { create_default_session_globals_then } from "../rustc_span/lib.ts";
import { debug_Symbol, display_Symbol, Symbol } from "../rustc_span/symbol.ts";
import {
  CrateType,
  display_CrateType,
  CollapseMacroDebuginfo,
  CollapseMacroDebuginfo_discriminant,
  debug_CollapseMacroDebuginfo,
  debug_Limit,
  debug_NativeLibKind,
  debug_SanitizerSet,
  display_Limit,
  display_SanitizerSet,
  Limit,
  NativeLibKind,
  SanitizerSet,
} from "../rustc_structures/lib.ts";
import { debug_bool, debug_int, debug_option, debug_str, debug_tuple, debug_vec, type Debug, type Fmt, PLAIN, PRETTY } from "../std/fmt.ts";
import { Panic } from "../std/panic.ts";
import {
  type CtorKind,
  type CtorOf,
  type DefKind,
  debug_DefKind,
  debug_MacroKinds,
  debug_Namespace,
  debug_NonMacroAttrKind,
  debug_PerNS,
  debug_Res,
  MacroKinds,
  Namespace,
  NonMacroAttrKind,
  PerNS,
  type PrimTy,
  Res,
  type Safety,
} from "./def.ts";
import { DefKind as DefKindC } from "./def.ts";
import type { Mutability } from "../rustc_ast_ir/lib.ts";

const ORACLE = new Map<string, string>(
  readFileSync(join(import.meta.dir, "def_oracle", "cases.txt"), "utf8")
    .split("\n")
    .filter((l) => l !== "")
    .map((l) => {
      const t = l.indexOf("\t");
      return [l.slice(0, t), l.slice(t + 1)] as [string, string];
    }),
);

const esc = (s: string): string => s.replaceAll("\\", "\\\\").replaceAll("\n", "\\n");

function def_kinds(): DefKind[] {
  const v: DefKind[] = [
    DefKindC.Mod,
    DefKindC.Struct,
    DefKindC.Union,
    DefKindC.Enum,
    DefKindC.Variant,
    DefKindC.Trait,
    DefKindC.TyAlias,
    DefKindC.ForeignTy,
    DefKindC.TraitAlias,
    DefKindC.AssocTy,
    DefKindC.TyParam,
    DefKindC.Fn,
    DefKindC.Const,
    DefKindC.ConstParam,
  ];
  for (const safety of ["Unsafe", "Safe"] as Safety[])
    for (const mutability of ["Not", "Mut"] as Mutability[]) for (const nested of [false, true]) v.push({ $: "Static", safety, mutability, nested });
  for (const of of ["Struct", "Variant"] as CtorOf[]) for (const kind of ["Fn", "Const"] as CtorKind[]) v.push({ $: "Ctor", _0: of, _1: kind });
  v.push(DefKindC.AssocFn, DefKindC.AssocConst);
  for (let bits = 0; bits < 8; bits++) v.push({ $: "Macro", _0: MacroKinds.from_bits_retain(bits) });
  v.push(
    DefKindC.ExternCrate,
    DefKindC.Use,
    DefKindC.ForeignMod,
    DefKindC.AnonConst,
    DefKindC.OpaqueTy,
    DefKindC.Field,
    DefKindC.LifetimeParam,
    DefKindC.GlobalAsm,
    { $: "Impl", of_trait: false },
    { $: "Impl", of_trait: true },
    DefKindC.Closure,
    DefKindC.SyntheticCoroutineBody,
    DefKindC.TestBinderConstraints,
  );
  return v;
}

const opt_ns = (ns: Namespace | undefined): string => debug_option(ns, PLAIN, debug_Namespace);
const res_u32: Debug<Res<number>> = (r, f) => debug_Res(r, f, debug_int);
const opt_def_id = (d: DefId | undefined): string => debug_option(d, PLAIN, debug_DefId);

function compute(): Map<string, string> {
  const out = new Map<string, string>();
  const line = (k: string, v: string): void => {
    out.set(k, esc(v));
  };
  create_default_session_globals_then(() => {
    const local_item = new DefId(DefIndex.from_u32(7), CrateNum.from_u32(0));
    const local_root = new DefId(DefIndex.from_u32(0), CrateNum.from_u32(0));
    const extern_root = new DefId(DefIndex.from_u32(0), CrateNum.from_u32(3));
    const foo = Symbol.intern("foo");

    def_kinds().forEach((k, i) => {
      const p = `defkind.${i}`;
      line(`${p}.debug`, debug_DefKind(k, PLAIN));
      line(`${p}.pretty`, debug_DefKind(k, PRETTY));
      line(`${p}.descr.local`, DefKindC.descr(k, local_item));
      line(`${p}.descr.local_root`, DefKindC.descr(k, local_root));
      line(`${p}.descr.extern_root`, DefKindC.descr(k, extern_root));
      line(`${p}.article`, DefKindC.article(k));
      line(`${p}.ns`, opt_ns(DefKindC.ns(k)));
      line(`${p}.def_path_data`, debug_DefPathData(DefKindC.def_path_data(k, foo), PLAIN));
      line(
        `${p}.flags`,
        [DefKindC.is_assoc(k), DefKindC.is_module_like(k), DefKindC.is_adt(k), DefKindC.is_fn_like(k), DefKindC.has_generics(k), DefKindC.has_codegen_attrs(k)].join(" "),
      );
    });

    for (let bits = 0; bits < 8; bits++) {
      const m = MacroKinds.from_bits_retain(bits);
      line(`macrokinds.${bits}`, `${debug_MacroKinds(m, PLAIN)} ${debug_str(MacroKinds.descr(m))} ${MacroKinds.article(m)}`);
    }

    const prims: PrimTy[] = [
      { $: "Int", _0: "I8" },
      { $: "Int", _0: "Isize" },
      { $: "Uint", _0: "U128" },
      { $: "Float", _0: "F16" },
      { $: "Float", _0: "F64" },
      { $: "Str" },
      { $: "Bool" },
      { $: "Char" },
    ];
    const res: Res<number>[] = [
      { $: "Def", _0: DefKindC.Fn, _1: local_item },
      { $: "Def", _0: DefKindC.Mod, _1: local_root },
      { $: "Def", _0: DefKindC.Mod, _1: extern_root },
      { $: "Def", _0: DefKindC.Enum, _1: local_item },
      { $: "Def", _0: DefKindC.Trait, _1: local_item },
      { $: "Def", _0: { $: "Ctor", _0: "Struct", _1: "Fn" }, _1: local_item },
      { $: "Def", _0: { $: "Ctor", _0: "Variant", _1: "Const" }, _1: local_item },
      { $: "Def", _0: { $: "Macro", _0: MacroKinds.DERIVE_ATTR }, _1: local_item },
      { $: "Def", _0: { $: "Static", safety: "Safe", mutability: "Mut", nested: false }, _1: extern_root },
      ...prims.map((p): Res<number> => ({ $: "PrimTy", _0: p })),
      { $: "SelfTyParam", trait_: local_item },
      { $: "SelfTyAlias", alias_to: extern_root, is_trait_impl: true },
      { $: "SelfCtor", _0: local_item },
      { $: "Local", _0: 42 },
      Res.ToolMod,
      { $: "OpenMod", _0: foo },
      { $: "NonMacroAttr", _0: { $: "Builtin", _0: Symbol.intern("inline") } },
      { $: "NonMacroAttr", _0: NonMacroAttrKind.Tool },
      { $: "NonMacroAttr", _0: NonMacroAttrKind.DeriveHelper },
      { $: "NonMacroAttr", _0: NonMacroAttrKind.DeriveHelperCompat },
      Res.Err,
    ];
    res.forEach((r, i) => {
      const p = `res.${i}`;
      line(`${p}.debug`, res_u32(r, PLAIN));
      line(`${p}.pretty`, res_u32(r, PRETTY));
      line(`${p}.descr`, Res.descr(r));
      line(`${p}.article`, Res.article(r));
      line(`${p}.ns`, opt_ns(Res.ns(r)));
      line(`${p}.macro_kinds`, debug_option(Res.macro_kinds(r), PLAIN, debug_MacroKinds));
      line(`${p}.matches_ns`, [Res.matches_ns(r, "TypeNS"), Res.matches_ns(r, "ValueNS"), Res.matches_ns(r, "MacroNS")].join(" "));
      line(`${p}.ids`, `${opt_def_id(Res.opt_def_id(r))} ${opt_def_id(Res.mod_def_id(r))} ${opt_def_id(Res.module_like_def_id(r))}`);
      line(`${p}.pat`, `${Res.expected_in_tuple_struct_pat(r)} ${Res.expected_in_unit_struct_pat(r)}`);
      line(`${p}.map_id`, res_u32(Res.map_id(r, (x: number) => x + 1), PLAIN));
    });

    const nmaks: NonMacroAttrKind[] = [{ $: "Builtin", _0: Symbol.intern("inline") }, NonMacroAttrKind.Tool, NonMacroAttrKind.DeriveHelper, NonMacroAttrKind.DeriveHelperCompat];
    nmaks.forEach((k, i) => {
      line(`nonmacroattr.${i}`, `${debug_NonMacroAttrKind(k, PLAIN)} ${NonMacroAttrKind.descr(k)} ${NonMacroAttrKind.article(k)} ${NonMacroAttrKind.is_used(k)}`);
    });

    for (const ns of ["TypeNS", "ValueNS", "MacroNS"] as Namespace[]) line(`namespace.${ns}`, Namespace.descr(ns));

    const per = new PerNS<Res<number> | undefined>({ $: "Local", _0: 1 }, undefined, Res.ToolMod);
    const d_opt_res: Debug<Res<number> | undefined> = (x, f) => debug_option(x, f, res_u32);
    line("perns.debug", debug_PerNS(per, PLAIN, d_opt_res));
    line("perns.pretty", debug_PerNS(per, PRETTY, d_opt_res));
    line("perns.present_items", debug_vec(per.present_items(), PLAIN, res_u32));
    const d_opt_res_hir: Debug<Res | undefined> = (x, f) => debug_option(x, f, (r, f) => debug_Res(r, f, debug_HirId));
    line("in_namespace.mod", debug_PerNS(Res.in_namespace({ $: "Def", _0: DefKindC.Mod, _1: local_item }), PLAIN, d_opt_res_hir));
    line("in_namespace.enum", debug_PerNS(Res.in_namespace({ $: "Def", _0: DefKindC.Enum, _1: local_item }), PLAIN, d_opt_res_hir));
    line("in_namespace.err", debug_PerNS(Res.in_namespace(Res.Err), PLAIN, d_opt_res_hir));

    const datas: DefPathData[] = [
      DefPathData.CrateRoot,
      DefPathData.Impl,
      DefPathData.ForeignMod,
      DefPathData.Use,
      DefPathData.GlobalAsm,
      { $: "TypeNs", _0: foo },
      { $: "ValueNs", _0: foo },
      { $: "MacroNs", _0: foo },
      { $: "LifetimeNs", _0: Symbol.intern("'a") },
      DefPathData.Closure,
      DefPathData.TestBinderConstraints,
      DefPathData.Ctor,
      DefPathData.AnonConst,
      DefPathData.OpaqueTy,
      { $: "OpaqueLifetime", _0: Symbol.intern("'b") },
      { $: "AnonAssocTy", _0: foo },
      DefPathData.SyntheticCoroutineBody,
      DefPathData.NestedStatic,
    ];
    datas.forEach((d, i) => {
      const dd0 = new DisambiguatedDefPathData(d, 0);
      const dd3 = new DisambiguatedDefPathData(d, 3);
      line(
        `defpathdata.${i}`,
        `${debug_DefPathData(d, PLAIN)} | ${display_DefPathData(d)} | ${debug_option(DefPathData.get_opt_name(d), PLAIN, debug_Symbol)} | ${display_Symbol(dd0.as_sym(true))} ${display_Symbol(dd3.as_sym(true))} ${display_Symbol(dd3.as_sym(false))} | ${debug_DisambiguatedDefPathData(dd3, PLAIN)}`,
      );
    });
    const key = new DefKey(DefIndex.from_u32(4), new DisambiguatedDefPathData({ $: "TypeNs", _0: foo }, 1));
    line("defkey.debug", debug_DefKey(key, PLAIN));
    line("defkey.pretty", debug_DefKey(key, PRETTY));

    const hir_id = new HirId(new OwnerId(CRATE_DEF_ID), ItemLocalId.from_u32(10));
    line("hirid.debug", debug_HirId(hir_id, PLAIN));
    line("hirid.pretty", debug_HirId(hir_id, PRETTY));
    line("hirid.display", display_HirId(hir_id));
    line("ownerid.debug", debug_OwnerId(hir_id.owner, PLAIN));
    line("res_hirid.debug", debug_Res<HirId>({ $: "Local", _0: hir_id }, PLAIN, debug_HirId));

    // rustc_structures
    line("limit.unlimited", `${display_Limit(Limit.unlimited())} ${debug_Limit(Limit.new(5), PLAIN)}`);
    for (const ct of ["Executable", "Dylib", "Rlib", "StaticLib", "Cdylib", "ProcMacro", "Sdylib"] as CrateType[]) {
      line(`cratetype.${ct}`, `${display_CrateType(ct)} ${CrateType.has_metadata(ct)}`);
    }
    for (const c of ["No", "Unspecified", "External", "Yes"] as CollapseMacroDebuginfo[]) {
      line(`collapse.${CollapseMacroDebuginfo_discriminant[c]}`, debug_CollapseMacroDebuginfo(c, PLAIN));
    }
    const nlks: NativeLibKind[] = [
      { $: "Static", bundle: true, whole_archive: undefined, export_symbols: false },
      { $: "Dylib", as_needed: undefined },
      { $: "RawDylib", as_needed: true },
      { $: "Framework", as_needed: undefined },
      NativeLibKind.LinkArg,
      NativeLibKind.WasmImportModule,
      NativeLibKind.Unspecified,
    ];
    nlks.forEach((k, i) => {
      line(`nativelibkind.${i}`, `${debug_NativeLibKind(k, PLAIN)} ${NativeLibKind.has_modifiers(k)} ${NativeLibKind.is_statically_included(k)} ${NativeLibKind.is_dllimport(k)}`);
    });
    for (const bits of [0, 1, 3, 0x20 | 0x100, 0x3fff, 0x800 | 0x4000]) {
      const s = SanitizerSet.from_bits_retain(bits);
      let display: string;
      try {
        display = display_SanitizerSet(s);
      } catch (e) {
        if (!(e instanceof Panic)) throw e;
        display = "<panics>";
      }
      const me = SanitizerSet.mutually_exclusive(s);
      const d_pair = (p: [SanitizerSet, SanitizerSet], f: Fmt): string => debug_tuple(f, "", [debug_SanitizerSet(p[0], f), debug_SanitizerSet(p[1], f)]);
      line(`sanitizer.${bits}`, `${debug_SanitizerSet(s, PLAIN)} | ${display} | ${debug_option(SanitizerSet.as_str(s), PLAIN, debug_str)} | ${debug_option(me, PLAIN, d_pair)}`);
    }
  });
  return out;
}

test("def.rs + hir_id + structures match the oracle dump", () => {
  const got = compute();
  const diffs: string[] = [];
  for (const [k, v] of ORACLE) {
    const g = got.get(k);
    if (g !== v) diffs.push(`${k}\n  want ${v}\n  got  ${g}`);
  }
  for (const k of got.keys()) if (!ORACLE.has(k)) diffs.push(`${k}: not in the oracle dump`);
  if (diffs.length) console.log(`ERROR: ${diffs.length}/${ORACLE.size} lines differ; first:\n${diffs.slice(0, 3).join("\n")}`);
  expect(ORACLE.size).toBeGreaterThan(700);
  expect(diffs.length).toBe(0);
});

test("in_namespace panics on other res kinds", () => {
  create_default_session_globals_then(() => {
    expect(() => Res.in_namespace({ $: "Def", _0: DefKindC.Fn, _1: new DefId(DefIndex.from_u32(7), CrateNum.from_u32(0)) })).toThrow(
      "bad path segment res Def(Fn, DefId { krate: crate0, index: DefIndex(7) })",
    );
    expect(() => Res.def_id<number>(Res.Err, debug_int)).toThrow("attempted .def_id() on invalid res: Err");
    expect(() => Res.expect_non_local<number, number>({ $: "Local", _0: 1 })).toThrow("unexpected `Res::Local`");
    expect(debug_bool(MacroKinds.contains(MacroKinds.DERIVE_ATTR_BANG, MacroKinds.BANG), PLAIN)).toBe("true");
  });
});
