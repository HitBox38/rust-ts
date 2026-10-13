// Partial port of compiler/rustc_interface/src/passes.rs: `parse`, and `create_and_enter_global_ctxt` with
// its helpers (`DEFAULT_QUERY_PROVIDERS`, `get_crate_name`, `parse_crate_name`, `collect_crate_types`,
// `default_output_for_target`). Expansion and resolution (`configure_and_expand`,
// `resolver_for_lowering_raw`, `early_lint_checks`), analysis and codegen are unported.
import "../rustc_session/options.ts"; // LOAD ORDER: see rustc_session/config.ts
import type { Crate } from "../rustc_ast/ast.gen.ts";
import { Input } from "../rustc_session/config.ts";
import type { ParseSess } from "../rustc_session/parse.ts";
import type { Session } from "../rustc_session/session.ts";
import "../rustc_session/utils.ts"; // `Session::time`
import { unported } from "../std/panic.ts";
import { new_parser_from_file, new_parser_from_source_str, unwrap_or_emit_fatal } from "../rustc_parse/lib.ts";
import type { Compiler } from "./interface.ts";
import type { Attribute } from "../rustc_ast/ast.gen.ts";
import type { CrateStore } from "../rustc_crate_store/cstore.ts";
import { Untracked } from "../rustc_crate_store/cstore.ts";
import { Steal } from "../rustc_data_structures/steal.ts";
import type { Features } from "../rustc_feature/unstable.ts";
import { Definitions } from "../rustc_hir_id/definitions.ts";
import { DepGraph } from "../rustc_middle/dep_graph/graph.ts";
import { clone_Providers as clone_HookProviders, Providers_default as HookProviders_default } from "../rustc_middle/hooks.ts";
import "../rustc_middle/lib.ts";
import { CurrentGcx, type GlobalCtxt, provide as ty_context_provide, TyCtxt } from "../rustc_middle/ty/context.ts";
import { clone_ExternProviders, clone_Providers, ExternProviders_default, Providers_default } from "../rustc_middle/query/query_api.ts";
import type { Providers as MiddleProviders } from "../rustc_middle/util/mod.ts";
import { provide as query_impl_provide, query_system } from "../rustc_query_impl/lib.ts";
import { LOCAL_CRATE, StableCrateId, type StableCrateIdMap } from "../rustc_span/def_id.ts";
import { FatalErrorMarker } from "../rustc_span/fatal_error.ts";
import type { Span } from "../rustc_span/lib.ts";
import { Symbol, sym } from "../rustc_span/symbol.ts";
import { type CrateType, CrateType_discriminant } from "../rustc_structures/lib.ts";
import { assert_eq, Panic, panic } from "../std/panic.ts";

// rustc: compiler/rustc_interface/src/passes.rs:54 parse
export function parse(sess: Session): Crate {
  const r = sess.time("parse_crate", () => {
    const input = sess.io.input;
    let parser;
    switch (input.$) {
      case "File":
        parser = unwrap_or_emit_fatal(new_parser_from_file(sess.psess, input._0, "ShebangAndFrontmatter", undefined));
        break;
      case "Str":
      case "DocTestStr":
        parser = unwrap_or_emit_fatal(
          new_parser_from_source_str(sess.psess, Input.file_name(input, sess), input.input, "ShebangAndFrontmatter"),
        );
        break;
    }
    return parser.parse_crate_mod();
  });
  if (r.$ === "Err") {
    const guar = r._0.emit_err();
    return guar.raise_fatal();
  }
  const krate = r._0;

  cmdline_attrs_inject(krate, sess.psess, sess.opts.unstable_opts.crate_attr);

  return krate;
}

/**
 * `rustc_builtin_macros::cmdline_attrs::inject` (cmdline_attrs.rs:10). PORT: rustc_builtin_macros is not
 * ported; with no `-Z crate-attr` the upstream loop body never runs.
 */
function cmdline_attrs_inject(_krate: Crate, _psess: ParseSess, attrs: readonly string[]): void {
  for (const raw_attr of attrs) {
    unported(`rustc_builtin_macros::cmdline_attrs::inject (-Z crate-attr=${raw_attr})`);
  }
}

// ---- create_and_enter_global_ctxt (passes.rs:894-1074) and its helpers (lane tyctxt-min) --------------
//
// PORT: the steps whose crates are not ported yet are local stand-ins that call `unported` unless their
// input makes them trivially empty (each names its upstream fn and the lane that ports it):
// `rustc_expand::config::{pre_configure_attrs, features}` (wave 9), attribute parsing for
// `#![crate_name]`/`#![crate_type]` (attr-parse lanes), `rustc_session::output::{validate_crate_name,
// invalid_output_for_target}`, `util::build_output_filenames`, `rustc_metadata::CStore::new` (wave 11),
// `rustc_incremental::{setup_dep_graph, load_query_result_cache, provide}` (no incremental, D3), and the
// providers of the crates listed in `DEFAULT_QUERY_PROVIDERS`.

/** `rustc_expand::config::pre_configure_attrs` (config.rs:127): pending wave 9 (expand-base). */
function pre_configure_attrs(_sess: Session, attrs: readonly Attribute[]): Attribute[] {
  // `attrs.iter().flat_map(process_cfg_attr).take_while(..).collect()`: empty for an empty slice.
  if (attrs.length === 0) return [];
  return unported("rustc_expand::config::pre_configure_attrs (crate attributes; wave 9)");
}

/** `rustc_expand::config::features` (config.rs): pending wave 9 (expand-base). */
function expand_config_features(_sess: Session, _krate_attrs: readonly Attribute[], _crate_name: Symbol): Features {
  return unported("rustc_expand::config::features (wave 9)");
}

/** `rustc_session::output::validate_crate_name` (output.rs): not ported. */
function validate_crate_name(_sess: Session, _name: Symbol, _span: Span | undefined): void {
  unported("rustc_session::output::validate_crate_name");
}

/** `rustc_session::output::invalid_output_for_target` (output.rs): not ported. */
function invalid_output_for_target(_sess: Session, _crate_type: CrateType): boolean {
  return unported("rustc_session::output::invalid_output_for_target");
}

/** `util::build_output_filenames` (util.rs:641): not ported (`OutputFilenames`). */
function build_output_filenames(_attrs: readonly Attribute[], _sess: Session): unknown {
  return unported("rustc_interface::util::build_output_filenames");
}

/** `rustc_incremental::setup_dep_graph` (persist/load.rs:180): no incremental compilation (D3). */
function setup_dep_graph(sess: Session, _crate_name: Symbol, _stable_crate_id: StableCrateId): [DepGraph, undefined] {
  if (sess.opts.incremental === undefined) {
    return [DepGraph.new_disabled(), undefined];
  }
  return unported("rustc_incremental::setup_dep_graph (-C incremental; D3)");
}

/** `rustc_metadata::CStore::new(metadata_loader)` (cstore_impl): pending wave 11 (cstore). */
function cstore_new(): CrateStore {
  const no = (): never => unported("rustc_metadata::creader::CStore (wave 11)");
  return { debug: no, as_any: no, untracked_as_any: no, def_key: no, def_path: no, def_path_hash: no, crate_name: no, stable_crate_id: no };
}

/**
 * `rustc_incremental::provide` (lib.rs): sets the `save_dep_graph` hook, which returns at once without
 * `-C incremental` (persist/save.rs:25). PORT: stand-in until rustc_incremental is ported (D3).
 */
function rustc_incremental_provide(providers: MiddleProviders): void {
  providers.hooks.save_dep_graph = (tcx) =>
    tcx.dep_graph.with_ignore(() => {
      if (tcx.sess.opts.incremental === undefined) return null;
      return unported("rustc_incremental::persist::save::save_dep_graph (-C incremental; D3)");
    });
}

/** `DEFAULT_QUERY_PROVIDERS` (passes.rs:894): the `LazyLock`'s initializer; see `DEFAULT_QUERY_PROVIDERS`. */
function default_query_providers(): MiddleProviders {
  const providers: MiddleProviders = { queries: Providers_default(), extern_queries: ExternProviders_default(), hooks: HookProviders_default() };
  providers.queries.analysis = () => unported("rustc_interface::passes::analysis (M3+)");
  providers.queries.resolver_for_lowering_raw = () => unported("rustc_interface::passes::resolver_for_lowering_raw (lane driver-m2, wave 10)");
  providers.queries.stripped_cfg_items = (tcx, _) => tcx.resolutions(null).stripped_cfg_items;
  providers.queries.resolutions = (tcx, _) => tcx.resolver_for_lowering_raw(null)[2];
  providers.queries.early_lint_checks = () => unported("rustc_interface::passes::early_lint_checks (lane driver-m2, wave 10)");
  providers.queries.env_var_os = () => unported("rustc_interface::passes::env_var_os (`&OsStr` keys)");
  providers.queries.proc_macro_decls_static = () => unported("tcx.hir_crate_items(()).proc_macro_decls() (HIR, M3)");
  // PORT: pending crates (their `provide` fns are not ported): rustc_ast_lowering, limits, rustc_expand_queries,
  // rustc_const_eval, rustc_middle::hir, rustc_borrowck, rustc_mir_build, rustc_mir_dataflow, rustc_mir_transform,
  // rustc_monomorphize, rustc_privacy, rustc_resolve, rustc_hir_analysis, rustc_hir_typeck, traits, solve,
  // rustc_passes, rustc_traits, rustc_ty_utils, rustc_metadata, rustc_lint, rustc_symbol_mangling,
  // rustc_codegen_ssa. Their queries keep upstream's `default_query` ICE.
  rustc_incremental_provide(providers);
  query_impl_provide(providers);
  ty_context_provide(providers.queries);
  return providers;
}
let DEFAULT_QUERY_PROVIDERS_: MiddleProviders | undefined;
/** `pub static DEFAULT_QUERY_PROVIDERS: LazyLock<Providers>` */
export function DEFAULT_QUERY_PROVIDERS(): MiddleProviders {
  DEFAULT_QUERY_PROVIDERS_ ??= default_query_providers();
  return DEFAULT_QUERY_PROVIDERS_;
}

// rustc: compiler/rustc_interface/src/passes.rs:932 create_and_enter_global_ctxt
export function create_and_enter_global_ctxt<T>(compiler: Compiler, krate: Crate, f: (tcx: TyCtxt) => T): [T, undefined] {
  const sess = compiler.sess;

  const pre_configured_attrs = pre_configure_attrs(sess, krate.attrs);

  const crate_name = get_crate_name(sess, pre_configured_attrs);
  const crate_types = collect_crate_types(
    sess,
    // `&compiler.codegen_backend.supported_crate_types(sess)`: PORT: not on the backend stand-in yet.
    unported("rustc_codegen_ssa::traits::CodegenBackend::supported_crate_types (backend stand-in)"),
    compiler.codegen_backend.name(),
    pre_configured_attrs,
    krate.spans.inner_span,
  );
  const stable_crate_id = StableCrateId.new(crate_name, crate_types.includes("Executable"), [...sess.opts.cg.metadata], sess.cfg_version);

  const outputs = build_output_filenames(pre_configured_attrs, sess);

  const [dep_graph, incr_comp_session] = setup_dep_graph(sess, crate_name, stable_crate_id);

  // PORT: `FreezeLock`s are their inner values (PORTING §5).
  const cstore = cstore_new();
  const definitions = Definitions.new(stable_crate_id);

  const stable_crate_ids: StableCrateIdMap = new Map();
  const untracked = new Untracked(cstore, [], definitions, stable_crate_ids, undefined);

  // We're constructing the HIR here; we don't care what we will
  // read, since we haven't even constructed the *input* to
  // incr. comp. yet.
  dep_graph.assert_ignored();

  // `rustc_incremental::load_query_result_cache(sess, None)`: `None` without incremental (D3).
  const query_result_on_disk_cache = undefined;

  const codegen_backend = compiler.codegen_backend;
  const providers = clone_MiddleProviders(DEFAULT_QUERY_PROVIDERS());
  // `codegen_backend.provide(&mut providers)`: PORT: the LLVM backend's providers are not ported (codegen).
  void codegen_backend;

  if (compiler.override_queries !== undefined) {
    unported("rustc_interface::Config::override_queries");
  }

  const incremental = dep_graph.is_fully_enabled();
  const track_present = incremental || sess.opts.unstable_opts.incremental_verify_ich || sess.prof.profiler !== undefined; // || cfg!(debug_assertions)

  // Note: this function body is the origin point of the widely-used 'tcx lifetime.
  // PORT: arenas are erased; `gcx_cell` is the `OnceLock`.
  const gcx_cell: { value: GlobalCtxt | undefined } = { value: undefined };

  const res = TyCtxt.create_global_ctxt(
    gcx_cell,
    compiler.sess,
    crate_types,
    stable_crate_id,
    untracked,
    incr_comp_session,
    dep_graph,
    query_system(providers.queries, providers.extern_queries, query_result_on_disk_cache, incremental, track_present),
    providers.hooks,
    // `compiler.current_gcx.clone()`: PORT: `Compiler.current_gcx` is still the opaque stand-in of
    // rustc_interface/stand_ins.ts; root swaps it for rustc_middle's `CurrentGcx` (handoff tyctxt-min).
    CurrentGcx.new(),
    (tcx) => {
      const r = tcx.create_crate_num(stable_crate_id);
      if (r.$ !== "Ok") return panic("called `Result::unwrap()` on an `Err` value");
      const feed = r._0;
      assert_eq(feed.key(), LOCAL_CRATE, (v) => String(v));
      feed.crate_name(crate_name);

      const unit = tcx.feed_unit_query();
      unit.features_query(expand_config_features(tcx.sess, pre_configured_attrs, crate_name));
      unit.crate_for_resolver(Steal.new<[Crate, Attribute[]]>([krate, pre_configured_attrs], "(rustc_ast::ast::Crate, thin_vec::ThinVec<rustc_ast::ast::Attribute>)"));
      unit.output_filenames(outputs);

      // There are two paths out of `f`.
      // - Normal exit.
      // - Panic, e.g. triggered by `abort_if_errors` or a fatal error.
      //
      // If a panic occurs, we still need to wind down the self-profiler to correctly record
      // the query events that are still in flight. Otherwise, they will be invalid and will
      // show up as "<unknown>" in the profiling data.
      let res: T;
      try {
        res = f(tcx);
      } catch (err) {
        if (err instanceof Panic || err instanceof FatalErrorMarker) {
          tcx.alloc_self_profile_query_strings();
        }
        // Resume unwinding if a panic happened.
        throw err;
      }

      tcx.finish();
      return res;
    },
  );

  return [res, incr_comp_session];
}

/// Compute and validate the crate name.
// rustc: compiler/rustc_interface/src/passes.rs:1368 get_crate_name
export function get_crate_name(sess: Session, krate_attrs: readonly Attribute[]): Symbol {
  // We validate *all* occurrences of `#![crate_name]`, pick the first find and
  // if a crate name was passed on the command line via `--crate-name` we enforce
  // that they match.
  // We perform the validation step here instead of later to ensure it gets run
  // in all code paths that require the crate name very early on, namely before
  // macro expansion.

  const attr_crate_name = parse_crate_name(sess, krate_attrs);

  const validate = (name: Symbol, span: Span | undefined): Symbol => {
    validate_crate_name(sess, name, span);
    return name;
  };

  if (sess.opts.crate_name !== undefined) {
    const crate_name = Symbol.intern(sess.opts.crate_name);
    if (attr_crate_name !== undefined && attr_crate_name[0] !== crate_name) {
      // sess.dcx().emit_err(diagnostics::CrateNameDoesNotMatch { span, crate_name, attr_crate_name });
      unported("rustc_interface::diagnostics::CrateNameDoesNotMatch");
    }
    return validate(crate_name, undefined);
  }

  if (attr_crate_name !== undefined) {
    return validate(attr_crate_name[0], attr_crate_name[1]);
  }

  if (sess.io.input.$ === "File") {
    // `path.file_stem().and_then(|s| s.to_str())`: PORT: no `Path::file_stem` in src/std yet.
    return unported("std::path::Path::file_stem (get_crate_name from the input file name)");
  }

  return sym.rust_out;
}

// rustc: compiler/rustc_interface/src/passes.rs:1415 parse_crate_name
export function parse_crate_name(_sess: Session, attrs: readonly Attribute[]): [Symbol, Span] | undefined {
  // `AttributeParser::parse_limited_sym_should_emit(sess, attrs, &[sym::crate_name], DUMMY_SP, None,
  // ShouldEmit::EarlyFatal { also_emit_lints: true })?`: no attribute, no `crate_name`.
  if (attrs.length === 0) return undefined;
  return unported("rustc_attr_parsing::AttributeParser::parse_limited_sym_should_emit (#![crate_name]; attr-parse lanes)");
}

// rustc: compiler/rustc_interface/src/passes.rs:1436 collect_crate_types
export function collect_crate_types(session: Session, backend_crate_types: readonly CrateType[], codegen_backend_name: string, attrs: readonly Attribute[], _crate_span: Span): CrateType[] {
  // If we're generating a test executable, then ignore all other output
  // styles at all other locations
  if (session.opts.test) {
    if (!session.target.executables) {
      // session.dcx().emit_warn(diagnostics::UnsupportedCrateTypeForTarget { .. });
      unported("rustc_interface::diagnostics::UnsupportedCrateTypeForTarget");
      return [];
    }
    return ["Executable"];
  }

  // Shadow `sdylib` crate type in interface build.
  if (session.opts.unstable_opts.build_sdylib_interface) {
    return ["Rlib"];
  }

  // Only check command line flags if present. If no types are specified by
  // command line, then reuse the empty `base` Vec to hold the types that
  // will be found in crate attributes.
  // JUSTIFICATION: before wrapper fn is available
  let base = [...session.opts.crate_types];
  if (base.length === 0) {
    if (attrs.length !== 0) {
      // `AttributeParser::parse_limited_sym_should_emit(.., &[sym::crate_type], crate_span, None, EarlyFatal)`
      unported("rustc_attr_parsing::AttributeParser::parse_limited_sym_should_emit (#![crate_type]; attr-parse lanes)");
    }

    if (base.length === 0) {
      base.push(default_output_for_target(session));
    } else {
      base.sort((a, b) => CrateType_discriminant[a] - CrateType_discriminant[b]);
      base = base.filter((t, i) => i === 0 || base[i - 1] !== t);
    }
  }

  base = base.filter((crate_type) => {
    if (invalid_output_for_target(session, crate_type)) {
      unported("rustc_interface::diagnostics::UnsupportedCrateTypeForTarget");
      return false;
    } else if (!backend_crate_types.includes(crate_type)) {
      void codegen_backend_name;
      unported("rustc_interface::diagnostics::UnsupportedCrateTypeForCodegenBackend");
      return false;
    } else {
      return true;
    }
  });

  return base;
}

/// Returns default crate type for target
///
/// Default crate type is used when crate type isn't provided neither
/// through cmd line arguments nor through crate attributes
///
/// It is CrateType::Executable for all platforms but iOS as there is no
/// way to run iOS binaries anyway without jailbreaking and
/// interaction with Rust code through static library is the only
/// option for now
// rustc: compiler/rustc_interface/src/passes.rs:1519 default_output_for_target
function default_output_for_target(sess: Session): CrateType {
  return !sess.target.executables ? "StaticLib" : "Executable";
}

function clone_MiddleProviders(p: MiddleProviders): MiddleProviders {
  // `#[derive(Copy, Clone)] struct Providers` (rustc_middle/src/util/mod.rs)
  return { queries: clone_Providers(p.queries), extern_queries: clone_ExternProviders(p.extern_queries), hooks: clone_HookProviders(p.hooks) };
}
