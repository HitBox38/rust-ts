// Test driver for lane res-macros' in-process tests (not a port): builds the real `Resolver` for a crate
// file the way `resolver_for_lowering_raw` (passes.rs:791) does before `configure_and_expand`.
//
// Same construction as resolver_new.test.ts's `with_tcx` (lane res-lib; see its header): the driver's
// `Config` for the nocore arguments, `passes::parse`, `pre_configure_attrs`, a `GlobalCtxt` built as
// `create_and_enter_global_ctxt` builds it (crate name = the file stem, crate type `bin`, no CStore), the
// default providers plus `rustc_resolve::provide`, then `registered_*_tools`, the `crate_for_resolver`
// steal and `Resolver::new`.
import { basename } from "node:path";
import "../lib.ts";
import type { Attribute, Crate } from "../../rustc_ast/lib.ts";
import { Untracked } from "../../rustc_crate_store/cstore.ts";
import type { CrateStore } from "../../rustc_crate_store/cstore.ts";
import { Steal } from "../../rustc_data_structures/steal.ts";
import { compiler_entrypoint } from "../../rustc_driver_impl/lib.ts";
import * as rustc_expand_config from "../../rustc_expand/config.ts";
import { pre_configure_attrs } from "../../rustc_expand/config.ts";
import { Definitions } from "../../rustc_hir_id/definitions.ts";
import { type Config, run_compiler } from "../../rustc_interface/interface.ts";
import { DEFAULT_QUERY_PROVIDERS, parse } from "../../rustc_interface/passes.ts";
import { DepGraph } from "../../rustc_middle/dep_graph/graph.ts";
import { clone_Providers as clone_HookProviders } from "../../rustc_middle/hooks.ts";
import { clone_ExternProviders, clone_Providers } from "../../rustc_middle/query/query_api.ts";
import { CurrentGcx, TyCtxt } from "../../rustc_middle/ty/context.ts";
import { query_system } from "../../rustc_query_impl/lib.ts";
import { StableCrateId } from "../../rustc_span/def_id.ts";
import { Symbol } from "../../rustc_span/symbol.ts";
import { panic, unported } from "../../std/panic.ts";
import { provide, Resolver } from "../lib.ts";

class CaptureConfig extends Error {}

/** The `interface::Config` rustc's driver builds from `args`. */
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

/** The nocore suites' arguments for `file` (edition 2021; `-Zui-testing` off, as the suites). */
export function nocore_args(file: string): string[] {
  return ["--target", "x86_64-unknown-linux-gnu", "--edition=2021", "-Zcrate-attr=feature(no_core)", "-Zcrate-attr=no_core", file];
}

/** Runs `f` with the `Resolver` of `file` right after `Resolver::new`, and the crate it will resolve. */
export function with_resolver<R>(file: string, f: (resolver: Resolver, krate: Crate, tcx: TyCtxt) => R): R {
  const config = config_from_args(nocore_args(file));
  let out: R | undefined;
  run_compiler(config, (compiler) => {
    const sess = compiler.sess;
    const krate = parse(sess);
    const pre_configured_attrs = pre_configure_attrs(sess, krate.attrs);
    const crate_name = Symbol.intern(basename(file, ".rs"));
    const stable_crate_id = StableCrateId.new(crate_name, true, [...sess.opts.cg.metadata], sess.cfg_version);
    const untracked = new Untracked(NO_CSTORE, [], Definitions.new(stable_crate_id), new Map(), undefined);
    const base = DEFAULT_QUERY_PROVIDERS();
    const queries = clone_Providers(base.queries);
    const extern = clone_ExternProviders(base.extern_queries);
    const hooks = clone_HookProviders(base.hooks);
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
        // `resolver_for_lowering_raw` (passes.rs:791) up to `Resolver::new`.
        const arenas = Resolver.arenas();
        void tcx.registered_attr_tools(null);
        void tcx.registered_lint_tools(null);
        const [krate_, attrs] = tcx.crate_for_resolver(null).steal() as [Crate, Attribute[]];
        const resolver = Resolver.new(tcx, attrs, krate_.spans.inner_span, krate_.spans.inject_use_span, arenas);
        return f(resolver, krate_, tcx);
      },
    );
  });
  return out as R;
}
