// The dump of the `resdump-nocore` suite (src/rust_ts/resdump.ts): what tools/probes/resdump/main.rs's
// `fn dump(tcx)` prints, section by section, with the ported resolver outputs (`tcx.resolutions(())`,
// `tcx.resolver_for_lowering()`, `tcx.definitions_untracked()`). The probe's header documents the
// sections, their line formats and sort keys. Loaded by resdump.ts after the driver (load order and
// the stack re-exec, as src/rust_ts/main.ts).
import "../rustc_session/options.ts"; // LOAD ORDER: see rustc_session/config.ts
import "../rustc_session/lib.ts";
import type { NodeId } from "../rustc_ast/node_id.ts";
import { debug_NodeId } from "../rustc_ast/node_id.ts";
import { debug_StrippedCfgItem } from "../rustc_attr_ir/data_structures.gen.ts";
import { debug_DefKind, debug_Namespace, debug_PerNS, debug_Res, type Res } from "../rustc_hir/def.ts";
import { debug_DefKey } from "../rustc_hir_id/definitions.ts";
import { debug_DelegationInfo, debug_DelegationInherentFnKind, debug_AmbigModChild, debug_LifetimeRes, debug_MainDefinition, debug_MissingLifetimeKind, debug_ModChild, debug_PartialRes } from "../rustc_middle/middle/resolve.ts";
import { debug_EffectiveVisibility } from "../rustc_middle/middle/privacy.ts";
import { debug_Visibility } from "../rustc_middle/ty/mod.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { debug_CrateNum, debug_DefId, debug_DefPathHash, debug_LocalDefId, debug_LocalModId, type DefIndex, type LocalDefId } from "../rustc_span/def_id.ts";
import { debug_ExpnId } from "../rustc_span/hygiene.ts";
import { debug_Span, Span } from "../rustc_span/lib.ts";
import { debug_Ident, debug_Symbol, type Ident, Symbol } from "../rustc_span/symbol.ts";
import { type Debug, debug_bool, debug_option, debug_tuple, debug_vec, PLAIN } from "../std/fmt.ts";

// `{:?}` of the values the dump prints (all `PLAIN`).
const dbg = <T>(v: T, d: Debug<T>): string => d(v, PLAIN);
const dbg_opt_res_node: Debug<Res<NodeId> | undefined> = (r, f) => debug_option(r, f, (x, f) => debug_Res(x, f, debug_NodeId));

/**
 * PORT: `#[derive(Debug)]` of `rustc_hir::TraitCandidate` (hir.rs:4803, M3), for the stand-in in
 * rustc_resolve/lib.ts (`def_id`, `import_ids`, `lint_ambiguous`).
 */
interface TraitCandidateLike {
  def_id: Parameters<typeof debug_DefId>[0];
  import_ids: readonly LocalDefId[];
  lint_ambiguous: boolean;
}
const debug_TraitCandidate: Debug<TraitCandidateLike> = (v, f) =>
  `TraitCandidate { def_id: ${debug_DefId(v.def_id, f)}, import_ids: ${debug_vec(v.import_ids, f, debug_LocalDefId)}, lint_ambiguous: ${debug_bool(v.lint_ambiguous, f)} }`;

/** `fn di`: the `DefIndex` of a LocalDefId. */
function di(id: LocalDefId): number {
  return id as unknown as number;
}

/** `<String as Ord>::cmp` (byte order of the UTF-8 encoding = code point order). */
function str_cmp(a: string, b: string): number {
  if (a === b) return 0;
  const ai = a[globalThis.Symbol.iterator]();
  const bi = b[globalThis.Symbol.iterator]();
  for (;;) {
    const x = ai.next();
    const y = bi.next();
    if (x.done) return y.done ? 0 : -1;
    if (y.done) return 1;
    const cx = x.value.codePointAt(0)!;
    const cy = y.value.codePointAt(0)!;
    if (cx !== cy) return cx < cy ? -1 : 1;
  }
}

/** `sort_by_key` / `sort_by_cached_key` on a tuple key (lexicographic; both are stable, like `Array.sort`). */
function sort_by_key<T>(v: T[], key: (x: T) => readonly (number | string)[]): T[] {
  const keyed = v.map((x) => [key(x), x] as const);
  keyed.sort(([a], [b]) => {
    for (let i = 0; i < a.length; i++) {
      const x = a[i]!;
      const y = b[i]!;
      const c = typeof x === "number" ? (x < (y as number) ? -1 : x > (y as number) ? 1 : 0) : str_cmp(x, y as string);
      if (c !== 0) return c;
    }
    return 0;
  });
  return keyed.map(([, x]) => x);
}

/** `fn span_key`: (lo, hi, `{:?}`). */
function span_key(s: Span): readonly (number | string)[] {
  const d = Span.data(s);
  return [d.lo as number, d.hi as number, debug_Span(s, PLAIN)];
}

/** `fn sym_key`: (the string, `{:?}`). */
function sym_key(s: Symbol): readonly (number | string)[] {
  return [Symbol.as_str(s), debug_Symbol(s, PLAIN)];
}

/** `== <name> (<n>)` followed by the lines. */
function section(out: string[], name: string, lines: string[]): void {
  out.push(`== ${name} (${lines.length})\n`);
  for (const l of lines) {
    out.push(l, "\n");
  }
}

/** The probe's `fn dump`, section by section. */
export function dump(tcx: TyCtxt): string {
  const out: string[] = [];
  const g = tcx.resolutions(null);

  section(
    out,
    "visibilities_for_hashing",
    g.visibilities_for_hashing.map(([id, vis]) => `${dbg(id, debug_LocalDefId)} ${debug_Visibility(vis, PLAIN, debug_LocalModId)}`),
  );

  // UnordMap: hash order, sorted (1).
  {
    const v = sort_by_key([...g.expn_that_defined], ([id]) => [di(id)]);
    section(out, "expn_that_defined", v.map(([id, e]) => `${dbg(id, debug_LocalDefId)} ${dbg(e, debug_ExpnId)}`));
  }

  // `EffectiveVisibilities.map` is an FxIndexMap: insertion order.
  section(out, "effective_visibilities", [...g.effective_visibilities.map].map(([id, e]) => `${dbg(id, debug_LocalDefId)} ${dbg(e, debug_EffectiveVisibility)}`));

  // FxIndexMap<_, FxIndexSet<_>>: insertion order, outer and inner.
  section(
    out,
    "macro_reachable_adts",
    [...g.macro_reachable_adts].map(([id, set]) => `${dbg(id, debug_LocalDefId)} ${debug_vec([...set], PLAIN, debug_LocalDefId)}`),
  );

  // UnordMap: hash order, sorted (1).
  {
    const v = sort_by_key([...g.extern_crate_map], ([id]) => [di(id)]);
    section(out, "extern_crate_map", v.map(([id, c]) => `${dbg(id, debug_LocalDefId)} ${dbg(c, debug_CrateNum)}`));
  }

  // FxIndexSet: insertion order (after check_unused's swap_removes).
  section(out, "maybe_unused_trait_imports", [...g.maybe_unused_trait_imports].map((id) => dbg(id, debug_LocalDefId)));

  // LocalDefIdMap (= UnordMap): hash order, sorted (1); each Vec in upstream order.
  {
    const v = sort_by_key([...g.module_children], ([id]) => [di(id)]);
    const lines: string[] = [];
    for (const [id, children] of v) {
      lines.push(dbg(id, debug_LocalDefId));
      for (const c of children) lines.push(`  ${dbg(c, debug_ModChild)}`);
    }
    out.push(`== module_children (${g.module_children.size})\n`);
    for (const l of lines) out.push(l, "\n");
  }

  // LocalDefIdMap (= UnordMap): hash order, sorted (1); each Vec in upstream order.
  {
    const v = sort_by_key([...g.ambig_module_children], ([id]) => [di(id)]);
    const lines: string[] = [];
    for (const [id, children] of v) {
      lines.push(dbg(id, debug_LocalDefId));
      for (const c of children) lines.push(`  ${dbg(c, debug_AmbigModChild)}`);
    }
    out.push(`== ambig_module_children (${g.ambig_module_children.size})\n`);
    for (const l of lines) out.push(l, "\n");
  }

  // FxIndexMap<_, FxIndexSet<Symbol>>: insertion order, outer and inner.
  section(out, "glob_map", [...g.glob_map].map(([id, set]) => `${dbg(id, debug_LocalDefId)} ${debug_vec([...set], PLAIN, debug_Symbol)}`));

  out.push("== main_def\n");
  out.push(`${debug_option(g.main_def, PLAIN, debug_MainDefinition)}\n`);

  // FxIndexMap: insertion order; each Vec in upstream order.
  section(out, "trait_impls", [...g.trait_impls.values()].map(([id, impls]) => `${dbg(id, debug_DefId)} ${debug_vec(impls, PLAIN, debug_LocalDefId)}`));

  section(out, "proc_macros", g.proc_macros.map((id) => dbg(id, debug_LocalDefId)));

  // UnordSet: hash order, sorted (4).
  {
    const v = sort_by_key([...g.paths_matching_assoc_types], span_key);
    section(out, "paths_matching_assoc_types", v.map((s) => dbg(s, debug_Span)));
  }

  // FxIndexMap: insertion order.
  section(out, "confused_type_with_std_module", [...g.confused_type_with_std_module].map(([k, s]) => `${dbg(k, debug_Span)} ${dbg(s, debug_Span)}`));

  // FxIndexMap<_, DocLinkResMap (= FxIndexMap)>: insertion order, outer and inner.
  {
    const lines: string[] = [];
    for (const [id, map] of g.doc_link_resolutions) {
      lines.push(dbg(id, debug_LocalModId));
      for (const [[sym, ns], res] of map.values()) {
        lines.push(`  ${dbg(sym, debug_Symbol)} ${dbg(ns, debug_Namespace)} ${dbg(res, dbg_opt_res_node)}`);
      }
    }
    out.push(`== doc_link_resolutions (${g.doc_link_resolutions.size})\n`);
    for (const l of lines) out.push(l, "\n");
  }

  // FxIndexMap: insertion order; each Vec in upstream order.
  section(out, "doc_link_traits_in_scope", [...g.doc_link_traits_in_scope].map(([id, traits]) => `${dbg(id, debug_LocalModId)} ${debug_vec(traits, PLAIN, debug_DefId)}`));

  // UnordSet: hash order, sorted (3).
  {
    const v = sort_by_key([...g.all_macro_rules], sym_key);
    section(out, "all_macro_rules", v.map((s) => dbg(s, debug_Symbol)));
  }

  section(out, "stripped_cfg_items", g.stripped_cfg_items.map((item) => debug_StrippedCfgItem(item, PLAIN, debug_DefId)));

  // FxIndexMap: insertion order.
  section(out, "delegation_infos", [...g.delegation_infos].map(([id, info]) => `${dbg(id, debug_LocalDefId)} ${dbg(info, debug_DelegationInfo)}`));

  // FxIndexMap<_, FxIndexMap<Ident, _>>: insertion order, outer and inner.
  {
    const lines: string[] = [];
    for (const [id, map] of g.delegation_inherent_fn_map) {
      lines.push(dbg(id, debug_LocalDefId));
      for (const [ident, kind] of map) lines.push(`  ${dbg(ident as Ident, debug_Ident)} ${dbg(kind, debug_DelegationInherentFnKind)}`);
    }
    out.push(`== delegation_inherent_fn_map (${g.delegation_inherent_fn_map.size})\n`);
    for (const l of lines) out.push(l, "\n");
  }

  // ResolverAstLowering.
  const [resolver, _krate] = tcx.resolver_for_lowering();
  const r = resolver.borrow();

  out.push("== next_node_id\n");
  out.push(`${dbg(r.next_node_id, debug_NodeId)}\n`);

  // NodeMap (= UnordMap): hash order, sorted (5).
  {
    const v = sort_by_key([...r.partial_res_map], ([id]) => [id as number]);
    section(out, "partial_res_map", v.map(([id, res]) => `${dbg(id, debug_NodeId)} ${dbg(res, debug_PartialRes)}`));
  }

  // NodeMap (= UnordMap), and each owner's NodeMaps: hash order, sorted (5); values in upstream order.
  {
    const owners = sort_by_key([...r.owners], ([id]) => [id as number]);
    out.push(`== owners (${owners.length})\n`);
    for (const [id, o] of owners) {
      out.push(`${dbg(id, debug_NodeId)} def_id=${dbg(o.def_id, debug_LocalDefId)} lifetime_elision_allowed=${o.lifetime_elision_allowed}\n`);
      const sub = <V>(name: string, map: Map<NodeId, V>, debug_V: Debug<V>): void => {
        const v = sort_by_key([...map], ([id]) => [id as number]);
        for (const [id, val] of v) {
          out.push(`  ${name} ${dbg(id, debug_NodeId)} ${debug_V(val, PLAIN)}\n`);
        }
      };
      sub("node_id_to_def_id", o.node_id_to_def_id, debug_LocalDefId);
      sub("label_res", o.label_res_map, debug_NodeId);
      sub("lifetime_res", o.lifetimes_res_map, debug_LifetimeRes);
      sub("trait_map", o.trait_map, (v, f) => debug_vec(v as readonly TraitCandidateLike[], f, debug_TraitCandidate));
      sub("import_res", o.import_res, (v, f) => debug_PerNS(v, f, dbg_opt_res_node));
      sub("extra_lifetime_params", o.extra_lifetime_params_map, (v, f) =>
        debug_vec(v, f, ([ident, node_id, kind], f) => debug_tuple(f, "", [debug_Ident(ident, f), debug_NodeId(node_id, f), debug_MissingLifetimeKind(kind, f)])),
      );
    }
  }

  {
    // `LintBuffer.map` is an FxIndexMap<NodeId, Vec<_>>: insertion order, each Vec in push order.
    const lb = r.lint_buffer.borrow();
    const lines: string[] = [];
    for (const [id, lints] of lb.map) {
      for (const l of lints) {
        const spans: readonly Span[] = l.span === undefined ? [] : l.span.primary_spans_();
        lines.push(`${dbg(id, debug_NodeId)} ${l.lint_id.lint.name} ${debug_vec(spans, PLAIN, debug_Span)}`);
      }
    }
    section(out, "lint_buffer", lines);
  }

  // LocalDefIdMap (= UnordMap): hash order, sorted (1).
  {
    const v = sort_by_key([...r.disambiguators.keys()], (id) => [di(id)]);
    section(out, "disambiguators", v.map((id) => dbg(id, debug_LocalDefId)));
  }

  // The definitions table.
  {
    const defs = tcx.definitions_untracked();
    const lines: string[] = [];
    for (const [index, key, hash] of defs.enumerated_keys_and_path_hashes()) {
      const id = index as DefIndex as unknown as LocalDefId;
      lines.push(`${dbg(id, debug_LocalDefId)} ${dbg(tcx.def_kind(id), debug_DefKind)} ${dbg(key, debug_DefKey)} ${dbg(hash, debug_DefPathHash)}`);
    }
    section(out, "definitions", lines);
  }
  return out.join("");
}
