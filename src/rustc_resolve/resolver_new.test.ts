// `Resolver::new` on an empty `#![no_core]` crate, compared with the `resdump` probe
// (tools/probes/resdump) run on the same crate with the `resdump-nocore` suite's arguments.
//
// Fixture: resolve_oracle/empty.resdump.txt, made by
//   cd src/rustc_resolve/resolve_oracle && RUSTC_ICE=0 RUST_BACKTRACE=0 \
//     $RUST_TS_DATA/target/probes/release/resdump --target x86_64-unknown-linux-gnu \
//     --sysroot <oracle sysroot> --edition=2015 -Zcrate-attr='feature(no_core)' -Zcrate-attr=no_core empty.rs
// (rustc 1.101.0-nightly (6f5da406b 2026-10-10)). With RUST_TS_REQUIRE_PROBES=1 and the probe built, the
// test re-runs the probe and checks that the fixture is current.
//
// The driver path to `resolver_for_lowering_raw` is lane driver-m2's and `create_and_enter_global_ctxt`
// still stops at unported steps, so this test builds the `GlobalCtxt` itself the way
// `create_and_enter_global_ctxt` does (passes.rs:932): crate name `empty` (the file stem), crate type
// `bin`, `StableCrateId::new`, `Definitions::new`, the default providers plus `rustc_resolve::provide`,
// and the `crate_name` / `features_query` / `crate_for_resolver` feeds. Then it does what
// `resolver_for_lowering_raw` (passes.rs:791) does before `configure_and_expand`, and prints the
// sections of the probe's dump that `Resolver::new` determines: the others are filled by expansion and
// `resolve_crate` (`effective_visibilities`, `next_node_id`), which are other lanes' code.
import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import "./lib.ts";
import { type Attribute, type Crate } from "../rustc_ast/lib.ts";
import { debug_NodeId } from "../rustc_ast/node_id.ts";
import { Untracked } from "../rustc_crate_store/cstore.ts";
import type { CrateStore } from "../rustc_crate_store/cstore.ts";
import { Steal } from "../rustc_data_structures/steal.ts";
import { compiler_entrypoint } from "../rustc_driver_impl/lib.ts";
import * as rustc_expand_config from "../rustc_expand/config.ts";
import { pre_configure_attrs } from "../rustc_expand/config.ts";
import { debug_DefKind } from "../rustc_hir/def.ts";
import { debug_DefKey, Definitions } from "../rustc_hir_id/definitions.ts";
import { type Config, run_compiler } from "../rustc_interface/interface.ts";
import { DEFAULT_QUERY_PROVIDERS, parse } from "../rustc_interface/passes.ts";
import { DepGraph } from "../rustc_middle/dep_graph/graph.ts";
import { clone_Providers as clone_HookProviders } from "../rustc_middle/hooks.ts";
import { clone_ExternProviders, clone_Providers } from "../rustc_middle/query/query_api.ts";
import { CurrentGcx, TyCtxt } from "../rustc_middle/ty/context.ts";
import { debug_Visibility } from "../rustc_middle/ty/mod.ts";
import { query_system } from "../rustc_query_impl/lib.ts";
import { debug_DefPathHash, debug_LocalModId, LOCAL_CRATE, LocalDefId, StableCrateId } from "../rustc_span/def_id.ts";
import { Symbol } from "../rustc_span/symbol.ts";
import { PLAIN } from "../std/fmt.ts";
import { panic, unported } from "../std/panic.ts";
import { provide, Resolver, type ResolverOutputs } from "./lib.ts";

const HERE = import.meta.dir;
const FIXTURE = join(HERE, "resolve_oracle", "empty.resdump.txt");
const ARGS = ["--target", "x86_64-unknown-linux-gnu", "--edition=2015", "-Zcrate-attr=feature(no_core)", "-Zcrate-attr=no_core", join(HERE, "resolve_oracle", "empty.rs")];

class CaptureConfig extends Error {}

/** The `interface::Config` rustc's driver builds from `args` (as rustc_expand/expand_oracle/walk.ts). */
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
  if (config === undefined) throw new Error("no config");
  return config;
}

const NO_CSTORE = new Proxy({}, { get: () => () => unported("rustc_metadata::creader::CStore (wave 11)") }) as unknown as CrateStore;

/**
 * Runs `f` with a `TyCtxt` for the crate root resolve_oracle/empty.rs built as `create_and_enter_global_ctxt`
 * builds it, with `rustc_resolve::provide` added to the default providers.
 */
function with_tcx<R>(f: (tcx: TyCtxt) => R): R {
  const config = config_from_args(ARGS);
  let out: R | undefined;
  run_compiler(config, (compiler) => {
    const sess = compiler.sess;
    const krate = parse(sess);
    const pre_configured_attrs = pre_configure_attrs(sess, krate.attrs);
    // PORT (test): `get_crate_name` (unported `validate_crate_name`) -> the file stem; `collect_crate_types`
    // -> `bin` (the default without `--crate-type`).
    const crate_name = Symbol.intern("empty");
    const stable_crate_id = StableCrateId.new(crate_name, true, [...sess.opts.cg.metadata], sess.cfg_version);
    const untracked = new Untracked(NO_CSTORE, [], Definitions.new(stable_crate_id), new Map(), undefined);
    const base = DEFAULT_QUERY_PROVIDERS();
    const queries = clone_Providers(base.queries);
    const extern = clone_ExternProviders(base.extern_queries);
    const hooks = clone_HookProviders(base.hooks);
    // What lane driver-m2 adds to `DEFAULT_QUERY_PROVIDERS`: `rustc_resolve::provide`.
    provide(queries);
    out = TyCtxt.create_global_ctxt(
      { value: undefined },
      sess,
      ["Executable"],
      stable_crate_id,
      untracked,
      undefined,
      DepGraph.new_disabled(),
      query_system(queries, extern, undefined, false, false),
      hooks,
      CurrentGcx.new(),
      (tcx) => {
        const r = tcx.create_crate_num(stable_crate_id);
        if (r.$ !== "Ok") return panic("create_crate_num");
        r._0.crate_name(crate_name);
        const unit = tcx.feed_unit_query();
        unit.features_query(rustc_expand_config.features(tcx.sess, pre_configured_attrs, crate_name));
        unit.crate_for_resolver(Steal.new<[Crate, Attribute[]]>([krate, pre_configured_attrs], "(rustc_ast::ast::Crate, thin_vec::ThinVec<rustc_ast::ast::Attribute>)"));
        return f(tcx);
      },
    );
  });
  return out as R;
}

/** `{:?}` of a local `DefId` through the tcx (`def_path_debug_str`; the crate root only, which is all an empty crate has). */
function debug_local_def_id(tcx: TyCtxt, id: LocalDefId): string {
  if (LocalDefId.index(id) !== 0) throw new Error("test helper: crate root only");
  // `format!("{}[{:04x}]{}", crate_name, stable_crate_id.as_u64() >> (8 * 6), def_path.to_string_no_crate_verbose())`
  const scid = tcx.stable_crate_id(LOCAL_CRATE);
  const hi16 = (StableCrateId.as_u64(scid) >> 48n).toString(16).padStart(4, "0");
  return `DefId(0:0 ~ ${Symbol.as_str(tcx.crate_name(LOCAL_CRATE))}[${hi16}])`;
}

/** The probe's sections that `Resolver::new` determines, printed like tools/probes/resdump/main.rs. */
function dump_after_new(tcx: TyCtxt, resolver: Resolver, outputs: ResolverOutputs): Map<string, string[]> {
  const g = outputs.global_ctxt;
  const a = outputs.ast_lowering;
  const sec = new Map<string, string[]>();
  const di = (id: LocalDefId) => debug_local_def_id(tcx, id);
  sec.set("visibilities_for_hashing", g.visibilities_for_hashing.map(([id, vis]) => `${di(id)} ${debug_Visibility(vis, PLAIN, debug_LocalModId)}`));
  sec.set("expn_that_defined", [...g.expn_that_defined].map(() => unported("test: expn_that_defined lines")));
  sec.set("macro_reachable_adts", [...g.macro_reachable_adts].map(() => unported("test")));
  sec.set("extern_crate_map", [...g.extern_crate_map].map(() => unported("test")));
  sec.set("maybe_unused_trait_imports", [...g.maybe_unused_trait_imports].map(() => unported("test")));
  sec.set("module_children", [...g.module_children].map(() => unported("test")));
  sec.set("ambig_module_children", [...g.ambig_module_children].map(() => unported("test")));
  sec.set("glob_map", [...g.glob_map].map(() => unported("test")));
  sec.set("main_def", [g.main_def === undefined ? "None" : unported("test")]);
  sec.set("trait_impls", [...g.trait_impls].map(() => unported("test")));
  sec.set("proc_macros", g.proc_macros.map(() => unported("test")));
  sec.set("paths_matching_assoc_types", [...g.paths_matching_assoc_types].map(() => unported("test")));
  sec.set("confused_type_with_std_module", [...g.confused_type_with_std_module].map(() => unported("test")));
  sec.set("doc_link_resolutions", [...g.doc_link_resolutions].map(() => unported("test")));
  sec.set("doc_link_traits_in_scope", [...g.doc_link_traits_in_scope].map(() => unported("test")));
  sec.set("all_macro_rules", [...g.all_macro_rules].map(() => unported("test")));
  sec.set("stripped_cfg_items", g.stripped_cfg_items.map(() => unported("test")));
  sec.set("delegation_infos", [...g.delegation_infos].map(() => unported("test")));
  sec.set("delegation_inherent_fn_map", [...g.delegation_inherent_fn_map].map(() => unported("test")));
  sec.set("partial_res_map", [...a.partial_res_map].map(() => unported("test")));
  const owners: string[] = [];
  for (const [id, data] of [...a.owners].sort((x, y) => x[0] - y[0])) {
    owners.push(`${debug_NodeId(id, PLAIN)} def_id=${di(data.def_id)} lifetime_elision_allowed=${data.lifetime_elision_allowed}`);
    if (data.node_id_to_def_id.size + data.label_res_map.size + data.lifetimes_res_map.size + data.trait_map.size + data.import_res.size + data.extra_lifetime_params_map.size !== 0) unported("test: owner maps");
  }
  sec.set("owners", owners);
  sec.set("lint_buffer", a.lint_buffer.borrow().map.size === 0 ? [] : [unported("test: lint_buffer lines")]);
  sec.set("disambiguators", [...a.disambiguators].map(() => unported("test")));
  const defs = tcx.definitions_untracked();
  const definitions: string[] = [];
  for (let i = 0; i < defs.num_definitions(); i++) {
    const id = LocalDefId.of(i as Parameters<typeof LocalDefId.of>[0]);
    definitions.push(`${di(id)} ${debug_DefKind(tcx.def_kind(id), PLAIN)} ${debug_DefKey(defs.def_key(id), PLAIN)} ${debug_DefPathHash(defs.def_path_hash(id), PLAIN)}`);
  }
  sec.set("definitions", definitions);
  void resolver;
  return sec;
}

/** The probe's output as `section -> lines` (`== name (n)` headers; `main_def`/`next_node_id` have none). */
function parse_resdump(text: string): Map<string, string[]> {
  const sec = new Map<string, string[]>();
  let cur: string[] | undefined;
  for (const line of text.split("\n")) {
    const m = /^== (\w+)(?: \((\d+)\))?$/.exec(line);
    if (m) {
      cur = [];
      sec.set(m[1]!, cur);
    } else if (line !== "" && cur) cur.push(line);
  }
  return sec;
}

test("Resolver::new on an empty no_core crate matches the resdump probe", () => {
  const oracle = parse_resdump(readFileSync(FIXTURE, "utf8"));
  const got = with_tcx((tcx) => {
    // `resolver_for_lowering_raw` (passes.rs:791) up to `Resolver::new`.
    const arenas = Resolver.arenas();
    void tcx.registered_attr_tools(null); // Uses `crate_for_resolver`.
    void tcx.registered_lint_tools(null); // Uses `crate_for_resolver`.
    const [krate, pre_configured_attrs] = tcx.crate_for_resolver(null).steal() as [Crate, Attribute[]];
    const resolver = Resolver.new(tcx, pre_configured_attrs, krate.spans.inner_span, krate.spans.inject_use_span, arenas);

    // State `Resolver::new` sets up (lib.rs:1803).
    expect(resolver.next_node_id_).toBe(0 as typeof resolver.next_node_id_);
    expect(resolver.extern_prelude.size).toBe(0); // `no_core`: neither `core` nor `std`
    expect(resolver.builtin_type_decls.size).toBe(19);
    expect(resolver.local_modules.length).toBe(1);
    expect(resolver.graph_root.no_implicit_prelude).toBe(false);
    expect(resolver.empty_module.no_implicit_prelude).toBe(true);
    expect(resolver.registered_attr_tools_.size).toBe(5); // PREDEFINED_TOOLS
    expect(resolver.invocation_parent_scopes.size).toBe(1);
    expect(resolver.owners.size).toBe(1);

    return dump_after_new(tcx, resolver, resolver.into_outputs());
  });
  const compared = [...got.keys()];
  expect(compared.length).toBe(24);
  for (const name of compared) {
    expect({ name, lines: got.get(name) }).toEqual({ name, lines: oracle.get(name) });
  }
  // Sections set after `Resolver::new` (expansion / `resolve_crate`): not compared here.
  expect([...oracle.keys()].filter((k) => !got.has(k)).sort()).toEqual(["effective_visibilities", "next_node_id"]);
});

test("the fixture is the current probe output", () => {
  const req = process.env.RUST_TS_REQUIRE_PROBES === "1";
  const data = process.env.RUST_TS_DATA;
  const probe = data === undefined ? undefined : join(data, "target", "probes", "release", "resdump");
  if (probe === undefined || !existsSync(probe)) {
    if (req) throw new Error(`ERROR: resdump probe missing (${probe}); bun scripts/probes.ts build resdump`);
    return;
  }
  const { oracleSysroot } = require("../../scripts/lib/oracle.ts") as typeof import("../../scripts/lib/oracle.ts");
  const args = ["--target", "x86_64-unknown-linux-gnu", "--sysroot", oracleSysroot(), "--edition=2015", "-Zcrate-attr=feature(no_core)", "-Zcrate-attr=no_core", "empty.rs"];
  const r = Bun.spawnSync([probe, ...args], { cwd: join(HERE, "resolve_oracle"), env: { ...process.env, RUSTC_ICE: "0", RUST_BACKTRACE: "0" } });
  expect(r.exitCode).toBe(0);
  expect(new TextDecoder().decode(r.stdout)).toBe(readFileSync(FIXTURE, "utf8"));
});
