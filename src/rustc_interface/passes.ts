// Partial port of compiler/rustc_interface/src/passes.rs: `parse`, expansion and resolution
// (`configure_and_expand`, `resolver_for_lowering_raw`, `early_lint_checks`), dep-info output
// (`write_dep_info`), `create_and_enter_global_ctxt` with its helpers, `run_required_analyses`, `analysis` and
// `start_codegen` (metadata-only, plan-m5 D5: codegen itself is the backend's, unported).
//
// PORT: the crates that the path calls into and that other lanes are porting are reached through local
// shims below ("Pending-lane shims"), named and typed as upstream, whose bodies call `unported` with the
// upstream path and the owning lane. Root replaces each shim by the import when that lane lands.
import "../rustc_session/options.ts"; // LOAD ORDER: see rustc_session/config.ts
import { mkdirSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { resolve as path_resolve_win32 } from "node:path/win32";
import type { Crate, Item } from "../rustc_ast/ast.gen.ts";
import type { NodeId } from "../rustc_ast/node_id.ts";
import { Input, type OutputFilenames, type OutFileName, std_print, UnstableOptions_impl } from "../rustc_session/config.ts";
import type { Session } from "../rustc_session/session.ts";
import "../rustc_session/utils.ts"; // `Session::time`
import { unported, unreachable } from "../std/panic.ts";
import * as rustc_resolve from "../rustc_resolve/lib.ts";
import * as rustc_ast_passes from "../rustc_ast_passes/lib.ts";
import { Resolver } from "../rustc_resolve/lib.ts";
import { path_components, path_eq, path_file_stem, path_is_absolute, path_join } from "../std/path.ts";
import { AttributeParser } from "../rustc_attr_parsing/lib.ts";
import type { ShouldEmit } from "../rustc_attr_parsing/lib.ts";
import * as rustc_expand_config from "../rustc_expand/config.ts";
import { pre_configure_attrs } from "../rustc_expand/config.ts";
import { ExtCtxt, type LintStoreExpand, type ResolverExpand } from "../rustc_expand/base.ts";
import { ExpansionConfig } from "../rustc_expand/expand.ts";
import { new_parser_from_file, new_parser_from_source_str, unwrap_or_emit_fatal } from "../rustc_parse/lib.ts";
import type { Compiler } from "./interface.ts";
import * as cmdline_attrs from "../rustc_builtin_macros/cmdline_attrs.ts";
import * as proc_macro_harness from "../rustc_builtin_macros/proc_macro_harness.ts";
import { register_builtin_macros } from "../rustc_builtin_macros/lib.ts";
import * as standard_library_imports from "../rustc_builtin_macros/standard_library_imports.ts";
import * as test_harness from "../rustc_builtin_macros/test_harness.ts";
import type { Attribute } from "../rustc_ast/ast.gen.ts";
import type { CrateStore } from "../rustc_crate_store/cstore.ts";
import { Untracked } from "../rustc_crate_store/cstore.ts";
import { Steal } from "../rustc_data_structures/steal.ts";
import type { BufferedEarlyLint, Diag, DiagCtxtHandle, Level, LintBuffer, MultiSpan } from "../rustc_errors/lib.ts";
import type { HirId } from "../rustc_hir_id/lib.ts";
import type { Features } from "../rustc_feature/unstable.ts";
import { Definitions } from "../rustc_hir_id/definitions.ts";
import type { LintId, RegisteredTools } from "../rustc_lint_defs/lib.ts";
import * as rustc_codegen_ssa from "../rustc_codegen_ssa/lib.ts";
import { CompiledModules, type CrateInfo } from "../rustc_codegen_ssa/lib.ts";
import { CrateInfo_new } from "../rustc_codegen_ssa/base.ts";
import type { EncodedMetadata } from "../rustc_metadata/lib.ts";
import type { CodegenBackend } from "./stand_ins.ts";
import * as rustc_lint from "../rustc_lint/lib.ts";
import * as rustc_ty_utils from "../rustc_ty_utils/lib.ts";
import * as rustc_privacy from "../rustc_privacy/lib.ts";
import * as rustc_symbol_mangling from "../rustc_symbol_mangling/lib.ts";
import { creader, fs as rustc_metadata_fs, provide as rustc_metadata_provide } from "../rustc_metadata/lib.ts";
import type { EarlyCheckNode, LintStore } from "../rustc_lint/lib.ts";
import { DepGraph } from "../rustc_middle/dep_graph/graph.ts";
import { clone_Providers as clone_HookProviders, Providers_default as HookProviders_default } from "../rustc_middle/hooks.ts";
import "../rustc_middle/lib.ts";
import { hir } from "../rustc_middle/lib.ts";
import * as rustc_ast_lowering from "../rustc_ast_lowering/lib.ts";
import * as rustc_const_eval from "../rustc_const_eval/lib.ts";
import * as rustc_mir_dataflow from "../rustc_mir_dataflow/lib.ts";
import * as rustc_hir_analysis from "../rustc_hir_analysis/lib.ts";
import * as rustc_hir_typeck from "../rustc_hir_typeck/lib.ts";
import * as rustc_trait_selection from "../rustc_trait_selection/lib.ts";
import type { ResolverAstLowering, ResolverGlobalCtxt } from "../rustc_middle/middle/resolve.ts";
import { type GlobalCtxt, TyCtxt } from "../rustc_middle/ty/context.ts";
import { HasAttrs_DefId, provide as ty_provide, type Ty, TypingEnv } from "../rustc_middle/ty/mod.ts";
import { find_attr } from "../rustc_attr_ir/lib.ts";
import { clone_ExternProviders, clone_Providers, ExternProviders_default, Providers_default } from "../rustc_middle/query/query_api.ts";
import { type Providers as QueryProviders, QUERY_DECLS, QUERY_NAMES } from "../rustc_middle/queries.gen.ts";
import type { Providers as MiddleProviders } from "../rustc_middle/util/mod.ts";
import { provide as rustc_passes_provide } from "../rustc_passes/lib.ts";
import * as rustc_passes from "../rustc_passes/lib.ts";
import { par_fns } from "../rustc_data_structures/sync/parallel.ts";
import { EarlyBinder } from "../rustc_type_ir/binder.ts";
import { Unnormalized } from "../rustc_type_ir/unnormalized.ts";
import { provide as rustc_mir_build_provide } from "../rustc_mir_build/lib.ts";
import { provide as rustc_borrowck_provide } from "../rustc_borrowck/lib.ts";
import { provide as rustc_mir_transform_provide } from "../rustc_mir_transform/lib.ts";
import { provide as rustc_traits_provide } from "../rustc_traits/lib.ts";
import { provide as query_impl_provide, query_system } from "../rustc_query_impl/lib.ts";
import { feature_err } from "../rustc_session/diagnostics.ts";
import { filename_for_input, invalid_output_for_target, validate_crate_name } from "../rustc_session/output.ts";
import { LOCAL_CRATE, LocalDefId, StableCrateId, type StableCrateIdMap } from "../rustc_span/def_id.ts";
import { FatalErrorMarker } from "../rustc_span/fatal_error.ts";
import { DUMMY_SP, type ErrorGuaranteed, display_SourceFileHash, FileName, type SourceFileHash, type SourceFileHashAlgorithm, Span as SpanC, type Span } from "../rustc_span/lib.ts";
import { utf8 } from "../std/str.ts";
import { Symbol, sym } from "../rustc_span/symbol.ts";
import { CrateType_discriminant, type CrateType } from "../rustc_structures/lib.ts";
import type { Limit } from "../rustc_structures/limit.ts";
import { PanicStrategy } from "../rustc_target/spec/mod.ts";
import { assert_eq, Panic, panic } from "../std/panic.ts";
import { is_whitespace } from "../std/char.ts";
import * as diagnostics from "./diagnostics.gen.ts";
import * as limits from "./limits.ts";
import * as util from "./util.ts";

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

  cmdline_attrs.inject(krate, sess.psess, sess.opts.unstable_opts.crate_attr);

  return krate;
}

// rustc: compiler/rustc_interface/src/passes.rs:89 pre_expansion_lint
function pre_expansion_lint(
  sess: Session,
  features: Features,
  lint_store: LintStore,
  registered_lint_tools: RegisteredTools,
  check_node: EarlyCheckNode,
  node_name: Symbol,
): void {
  // PORT: `generic_activity_with_arg(.., node_name.as_str())`: the profiler stand-in records nothing (no
  // self-profiler), so the event argument is unobservable; `generic_activity` gives the same guard.
  void node_name;
  sess.prof.generic_activity("pre_AST_expansion_lint_checks").run(() => {
    rustc_lint.check_ast_node(sess, features, true, lint_store, registered_lint_tools, undefined, check_node);
  });
}

// Cannot implement directly for `LintStore` due to trait coherence.
class LintStoreExpandImpl implements LintStoreExpand {
  constructor(public _0: LintStore) {}

  // rustc: compiler/rustc_interface/src/passes.rs:116 pre_expansion_lint
  pre_expansion_lint(
    sess: Session,
    features: Features,
    registered_lint_tools: RegisteredTools,
    node_id: NodeId,
    attrs: readonly Attribute[],
    items: readonly Item[],
    name: Symbol,
  ): void {
    const check_node: EarlyCheckNode = { $: "LoadedMod", _0: node_id, _1: attrs, _2: items };
    pre_expansion_lint(sess, features, this._0, registered_lint_tools, check_node, name);
  }
}

/// Runs the "early phases" of the compiler: initial `cfg` processing,
/// syntax expansion, secondary `cfg` expansion, synthesis of a test
/// harness if one is to be provided, injection of a dependency on the
/// standard library and prelude, and name resolution.
// #[instrument(level = "trace", skip(krate, resolver))]
// rustc: compiler/rustc_interface/src/passes.rs:136 configure_and_expand
function configure_and_expand(krate: Crate, pre_configured_attrs: readonly Attribute[], resolver: Resolver): Crate {
  const tcx = resolver.tcx();
  const sess = tcx.sess;
  const features = tcx.features();
  const lint_store = rustc_lint.unerased_lint_store(sess);
  const crate_name = tcx.crate_name(LOCAL_CRATE);
  pre_expansion_lint(
    sess,
    features,
    lint_store,
    tcx.registered_lint_tools(null) as RegisteredTools,
    { $: "CrateRoot", _0: krate, _1: pre_configured_attrs },
    crate_name,
  );
  register_builtin_macros(resolver);

  const num_standard_library_imports = sess.time("crate_injection", () => {
    return standard_library_imports.inject(krate, pre_configured_attrs, resolver, sess, features);
  });

  // Expand all macros
  krate = sess.time("macro_expand_crate", () => {
    // Windows dlls do not have rpaths, so they don't know how to find their
    // dependencies. It's up to us to tell the system where to find all the
    // dependent dlls. Note that this uses cfg!(windows) as opposed to
    // targ_cfg because syntax extensions are always loaded for the host
    // compiler, not for the target.
    //
    // This is somewhat of an inherently racy operation, however, as
    // multiple threads calling this function could possibly continue
    // extending PATH far beyond what it should. To solve this for now we
    // just don't add any new elements to PATH which are already there
    // within PATH. This is basically a targeted fix at #17360 for rustdoc
    // which runs rustc in parallel but has been seen (#33844) to cause
    // problems with PATH becoming too long.
    // PORT: `cfg!(windows)` is the host platform; `OsString` values are JS strings.
    let old_path: string | undefined = "";
    if (process.platform === "win32") {
      old_path = process.env.PATH ?? old_path;
      const new_path = sess
        .host_filesearch()
        .search_paths("Native")
        .map((p) => p.dir);
      for (const path of env_split_paths_windows(old_path)) {
        if (!new_path.some((p) => path_eq(p, path))) { // `PathBuf: PartialEq` compares components
          new_path.push(path);
        }
      }
      const joined = env_join_paths_windows(new_path.filter((p) => env_join_paths_windows([p]) !== undefined));
      if (joined === undefined) panic("called `Result::unwrap()` on an `Err` value");
      process.env.PATH = joined;
    }

    // Create the config for macro expansion
    const recursion_limit = get_recursion_limit(pre_configured_attrs, sess);
    const cfg = new ExpansionConfig(
      crate_name,
      features,
      recursion_limit,
      sess.opts.unstable_opts.trace_macros,
      sess.is_test_crate(),
      sess.opts.unstable_opts.span_debug,
      sess.opts.unstable_opts.proc_macro_backtrace,
    );

    const lint_store_expand = new LintStoreExpandImpl(lint_store);
    const ecx = ExtCtxt.new(sess, cfg, resolver, lint_store_expand);
    ecx.num_standard_library_imports = num_standard_library_imports;
    // Expand macros now!
    const krate2 = sess.time("expand_crate", () => ecx.monotonic_expander().expand_crate(krate));

    if (ecx.nb_macro_errors > 0) {
      sess.dcx().abort_if_errors();
    }

    // The rest is error reporting and stats

    // `buffered_lints.append(&mut ecx.buffered_early_lint)`
    sess.psess.buffered_lints.push(...ecx.buffered_early_lint);
    ecx.buffered_early_lint.length = 0;

    sess.time("check_unused_macros", () => {
      ecx.check_unused_macros();
    });

    // If we hit a recursion limit, exit early to avoid later passes getting overwhelmed
    // with a large AST
    if (ecx.reduced_recursion_limit !== undefined) {
      sess.dcx().abort_if_errors();
      unreachable();
    }

    if (process.platform === "win32") {
      process.env.PATH = old_path;
    }

    if (ecx.sess.opts.unstable_opts.macro_stats) {
      print_macro_stats(ecx);
    }

    return krate2;
  });

  sess.time("maybe_building_test_harness", () => {
    test_harness.inject(krate, sess, features, resolver);
  });

  const has_proc_macro_decls = sess.time("AST_validation", () => {
    return rustc_ast_passes.ast_validation.check_crate(
      sess,
      features,
      krate,
      // PORT: `tcx.is_sdylib_interface_build()` (rustc_middle ty/context.rs) is not on the ported `TyCtxt`;
      // its body is `self.sess.opts.unstable_opts.build_sdylib_interface`.
      tcx.sess.opts.unstable_opts.build_sdylib_interface,
      resolver.lint_buffer(),
    );
  });

  const crate_types = tcx.crate_types();
  const is_executable_crate = crate_types.includes("Executable");
  const is_proc_macro_crate = crate_types.includes("ProcMacro");

  if (crate_types.length > 1) {
    if (is_executable_crate) {
      sess.dcx().emit_err(diagnostics.MixedBinCrate_diagnostic({}));
    }
    if (is_proc_macro_crate) {
      sess.dcx().emit_err(diagnostics.MixedProcMacroCrate_diagnostic({}));
    }
  }

  if (is_proc_macro_crate && sess.target.is_like_wasm && !sess.opts.unstable_opts.wasm_proc_macros) {
    sess.dcx().emit_err(diagnostics.UnstableWasmProcMacro_diagnostic({}));
  }

  if (crate_types.includes("Sdylib") && !tcx.features().export_stable()) {
    feature_err(sess, sym.export_stable, DUMMY_SP, "`sdylib` crate type is unstable").emit();
  }

  if (is_proc_macro_crate && sess.sanitizers() !== 0) {
    sess.dcx().emit_err(diagnostics.CannotSanitizeProcMacro_diagnostic({}));
  }

  if (is_proc_macro_crate && !PanicStrategy.unwinds(sess.panic_strategy())) {
    sess.dcx().emit_warn(diagnostics.ProcMacroCratePanicAbort_diagnostic({}));
  }

  sess.time("maybe_create_a_macro_crate", () => {
    const is_test_crate = sess.is_test_crate();
    proc_macro_harness.inject(
      krate,
      sess,
      features,
      resolver,
      is_proc_macro_crate,
      has_proc_macro_decls,
      is_test_crate,
      sess.dcx(),
    );
  });

  // Done with macro expansion!

  resolver.resolve_crate(krate);

  creader.CStore.from_tcx(tcx).report_session_incompatibilities(tcx, krate);
  return krate;
}

/** `env::split_paths` on Windows (library/std/src/sys/paths/windows.rs): `;`-separated, `"` toggles quoting. */
function env_split_paths_windows(unparsed: string): string[] {
  const out: string[] = [];
  let in_progress = "";
  let in_quote = false;
  for (const b of unparsed) {
    if (b === '"') {
      in_quote = !in_quote;
    } else if (b === ";" && !in_quote) {
      out.push(in_progress);
      in_progress = "";
    } else {
      in_progress += b;
    }
  }
  out.push(in_progress);
  return out;
}

/** `env::join_paths` on Windows: `None` (`Err`) when a path contains `"`; paths with `;` are quoted. */
function env_join_paths_windows(paths: readonly string[]): string | undefined {
  let joined = "";
  for (let i = 0; i < paths.length; i++) {
    const v = paths[i]!;
    if (i > 0) joined += ";";
    if (v.includes('"')) return undefined;
    else if (v.includes(";")) joined += `"${v}"`;
    else joined += v;
  }
  return joined;
}

/**
 * `print_macro_stats(ecx)` (passes.rs:321). PORT: not ported: `-Zmacro-stats` needs rustc_expand's stats.rs
 * (unowned; its `update_*_macro_stats` are unported, so this is unreachable) and
 * `rustc_data_structures::thousands`.
 */
function print_macro_stats(_ecx: ExtCtxt): void {
  unported("rustc_interface::passes::print_macro_stats (-Zmacro-stats)");
}

// rustc: compiler/rustc_interface/src/passes.rs:411 early_lint_checks
function early_lint_checks(tcx: TyCtxt, _: null): null {
  const sess = tcx.sess;
  const [resolver_steal, krate_steal] = tcx.resolver_for_lowering();
  const resolver = resolver_steal.borrow();
  const krate = krate_steal.borrow();
  const lint_buffer = resolver.lint_buffer.steal();

  if (sess.opts.unstable_opts.input_stats) {
    rustc_passes_input_stats_print_ast_stats(tcx, krate);
  }

  // Needs to go *after* expansion to be able to check the results of macro expansion.
  sess.time("complete_gated_feature_checking", () => {
    rustc_ast_passes.feature_gate.check_crate(krate, sess, tcx.features());
  });

  // Add all buffered lints from the `ParseSess` to the `Session`.
  {
    const buffered_lints = sess.psess.buffered_lints;
    // info!("{} parse sess buffered_lints", buffered_lints.len());
    for (const early_lint of buffered_lints.splice(0)) {
      lint_buffer.add_early_lint(early_lint);
    }
  }

  // Gate identifiers containing invalid Unicode codepoints that were recovered during lexing.
  {
    const identifiers = sess.psess.bad_unicode_identifiers;
    const drained = [...identifiers];
    identifiers.clear();
    for (const [ident, spans] of drained) {
      // `spans.sort_by_key(|span| span.lo_hi())` (stable)
      spans.sort((a, b) => {
        const [alo, ahi] = SpanC.lo_hi(a);
        const [blo, bhi] = SpanC.lo_hi(b);
        return alo !== blo ? alo - blo : ahi - bhi;
      });
      if (ident === sym.ferris) {
        type FerrisFix = "SnakeCase" | "ScreamingSnakeCase" | "PascalCase";
        // rustc: compiler/rustc_interface/src/passes.rs:447 as_str
        const FerrisFix_as_str = (self: FerrisFix): string => {
          switch (self) {
            case "SnakeCase":
              return "ferris";
            case "ScreamingSnakeCase":
              return "FERRIS";
            case "PascalCase":
              return "Ferris";
          }
        };

        const first_span = spans[0]!;
        const prev_source = sess.psess.source_map().span_to_prev_source(first_span);
        let fix: FerrisFix;
        if (prev_source.$ === "Err") {
          fix = "SnakeCase";
        } else {
          const source_before_ferris = split_whitespace(prev_source._0.toString()).reverse();
          const next = source_before_ferris[0];
          if (next === "struct" || next === "trait" || next === "mod" || next === "union" || next === "type" || next === "enum") {
            fix = "PascalCase";
          } else if (next === "const" || next === "static") {
            fix = "ScreamingSnakeCase";
          } else if (next === "mut" && source_before_ferris[1] === "static") {
            fix = "ScreamingSnakeCase";
          } else {
            fix = "SnakeCase";
          }
        }
        const ferris_fix = FerrisFix_as_str(fix);

        sess.dcx().emit_err(diagnostics.FerrisIdentifier_diagnostic({ spans, first_span, ferris_fix }));
      } else {
        sess.dcx().emit_err(diagnostics.EmojiIdentifier_diagnostic({ spans, ident }));
      }
    }
  }

  const lint_store = rustc_lint.unerased_lint_store(tcx.sess);
  rustc_lint.check_ast_node(
    sess,
    tcx.features(),
    false,
    lint_store,
    tcx.registered_lint_tools(null) as RegisteredTools,
    lint_buffer,
    { $: "CrateRoot", _0: krate, _1: krate.attrs },
  );
  return null;
}

/** `str::split_whitespace` (Unicode `White_Space` separators, empty pieces skipped). */
function split_whitespace(s: string): string[] {
  const out: string[] = [];
  let cur = "";
  for (const ch of s) {
    if (is_whitespace(ch.codePointAt(0)!)) {
      if (cur.length !== 0) out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  if (cur.length !== 0) out.push(cur);
  return out;
}

// rustc: compiler/rustc_interface/src/passes.rs:497 env_var_os
function env_var_os(tcx: TyCtxt, key: string): string | undefined {
  // PORT: `&OsStr` keys and values are JS strings (`to_string_lossy`/`to_str` are the identity).
  const value = process.env[key];

  const value_tcx = value;

  // Also add the variable to Cargo's dependency tracking
  //
  // NOTE: This only works for passes run before `write_dep_info`. See that
  // for extension points for configuring environment variables to be
  // properly change-tracked.
  // PORT: `Session.env_depinfo` is a `Set<string>` holding the JSON text of the `(Symbol, Option<Symbol>)`
  // pair (as rustc_builtin_macros env.ts does) until session.ts carries the tuple.
  tcx.sess.env_depinfo.add(JSON.stringify([key, value ?? null]));

  return value_tcx;
}

// Returns all the paths that correspond to generated files.
// rustc: compiler/rustc_interface/src/passes.rs:516 generated_output_paths
function generated_output_paths(tcx: TyCtxt, outputs: OutputFilenames, exact_name: boolean, crate_name: Symbol): string[] {
  const sess = tcx.sess;
  const out_filenames: string[] = [];
  for (const output_type of sess.opts.output_types.keys()) {
    const out_filename = outputs.path(output_type);
    const file = OutFileNameC_as_path(out_filename);
    if (output_type === "Exe" && !exact_name) {
      // If the filename has been overridden using `-o`, it will not be modified
      // by appending `.rlib`, `.exe`, etc., so we can skip this transformation.
      for (const crate_type of tcx.crate_types()) {
        const p = filename_for_input(sess, crate_type, crate_name, outputs);
        out_filenames.push(OutFileNameC_as_path(p));
      }
    } else if (output_type === "DepInfo" && sess.opts.unstable_opts.dep_info_omit_d_target) {
      // Don't add the dep-info output when omitting it from dep-info targets
    } else if (output_type === "DepInfo" && out_filename.$ === "Stdout") {
      // Don't add the dep-info output when it goes to stdout
    } else {
      out_filenames.push(file);
    }
  }
  return out_filenames;
}

/** `OutFileName::as_path` (config.rs:1171). */
function OutFileNameC_as_path(o: OutFileName): string {
  return o.$ === "Real" ? o._0 : "stdout";
}

/**
 * `rustc_fs_util::try_canonicalize(path).ok()`: `fs::canonicalize(path).or_else(|_| std::path::absolute(path))`.
 * PORT (driver-m2): rustc_fs_util is not ported; `std::path::absolute` is written out below.
 */
function try_canonicalize(path: string): string | undefined {
  try {
    return realpathSync.native(path);
  } catch {
    return std_path_absolute(path);
  }
}

/**
 * `std::path::absolute` (`.ok()`): unix: an empty path is an error; otherwise `cwd.join(path)` (for a relative
 * path) with `.` components and repeated separators removed (`..` is kept), a leading `//` kept.
 * Windows: `GetFullPathNameW` (node's `path.win32.resolve` normalises the same way). PORT (driver-m2).
 */
function std_path_absolute(path: string): string | undefined {
  if (path.length === 0) return undefined;
  if (process.platform === "win32") return path_resolve_win32(path);
  const comps = path_components(path);
  let normalized: string;
  const parts: string[] = [];
  for (let c = comps.next(); c !== undefined; c = comps.next()) {
    switch (c.$) {
      case "RootDir":
      case "CurDir":
        break;
      case "ParentDir":
        parts.push("..");
        break;
      case "Normal":
        parts.push(c._0);
        break;
      case "Prefix":
        return unreachable("path prefixes are Windows-only");
    }
  }
  if (path_is_absolute(path)) {
    normalized = (path.startsWith("//") && !path.startsWith("///") ? "//" : "/") + parts.join("/");
  } else {
    normalized = path_join(process.cwd(), parts.join("/"));
  }
  if (path.endsWith("/") && parts.length !== 0) normalized += "/";
  return normalized;
}

// rustc: compiler/rustc_interface/src/passes.rs:550 output_contains_path
function output_contains_path(output_paths: readonly string[], input_path: string): boolean {
  const canonical_input_path = try_canonicalize(input_path);
  if (canonical_input_path === undefined) {
    return false;
  }
  return output_paths.some((output_path) => try_canonicalize(output_path) === canonical_input_path);
}

// rustc: compiler/rustc_interface/src/passes.rs:558 output_conflicts_with_dir
function output_conflicts_with_dir(output_paths: readonly string[]): string | undefined {
  return output_paths.find((output_path) => {
    // `Path::is_dir`: `fs::metadata` (follows symlinks), false on error.
    try {
      return statSync(output_path).isDirectory();
    } catch {
      return false;
    }
  });
}

// rustc: compiler/rustc_interface/src/passes.rs:562 escape_dep_filename
function escape_dep_filename(filename: string): string {
  // Apparently clang and gcc *only* escape spaces:
  // https://llvm.org/klaus/clang/commit/9d50634cfc268ecc9a7250226dd5ca0e945240d4
  return filename.replaceAll(" ", "\\ ");
}

// Makefile comments only need escaping newlines and `\`.
// The result can be unescaped by anything that can unescape `escape_default` and friends.
// rustc: compiler/rustc_interface/src/passes.rs:570 escape_dep_env
function escape_dep_env(symbol: Symbol): string {
  const s = Symbol.as_str(symbol);
  let escaped = "";
  for (const c of s) {
    switch (c) {
      case "\n":
        escaped += "\\n";
        break;
      case "\r":
        escaped += "\\r";
        break;
      case "\\":
        escaped += "\\\\";
        break;
      default:
        escaped += c;
    }
  }
  return escaped;
}

// rustc: compiler/rustc_interface/src/passes.rs:584 write_out_deps
function write_out_deps(tcx: TyCtxt, outputs: OutputFilenames, out_filenames: readonly string[]): void {
  // Write out dependency rules to the dep-info file if requested
  const sess = tcx.sess;
  if (!sess.opts.output_types.contains_key("DepInfo")) {
    return;
  }
  const deps_output = outputs.path("DepInfo");
  const deps_filename = OutFileNameC_as_path(deps_output);

  // PORT: the `try { .. }` block: io errors are thrown `IoError`s, caught below.
  let error: unknown = undefined;
  try {
    // Build a list of files used to compile the output and
    // write Makefile-compatible dependency rules
    // PORT: `IndexMap<String, (u64, Option<SourceFileHash>)>` -> an insertion-ordered `Map`.
    const files = new Map<string, [number, SourceFileHash | undefined]>();
    for (const fmap of sess.source_map().files().deref()) {
      if (!fmap.is_real_file()) continue;
      if (fmap.is_imported()) continue;
      files.set(escape_dep_filename(FileName.prefer_local_unconditionally(fmap.name).to_string()), [
        // This needs to be unnormalized,
        // as external tools wouldn't know how rustc normalizes them
        fmap.unnormalized_source_len,
        fmap.checksum_hash,
      ]);
    }

    const checksum_hash_algo = sess.opts.unstable_opts.checksum_hash_algorithm;

    // Account for explicitly marked-to-track files
    // (e.g. accessed in proc macros).
    const file_depinfo = sess.file_depinfo;

    const normalize_path = (path: string): string => escape_dep_filename(path);

    // The entries will be used to declare dependencies between files in a
    // Makefile-like output, so the iteration order does not matter.
    // rustc: compiler/rustc_interface/src/passes.rs:625 hash_iter_files
    const hash_iter_files = (it: Iterable<string>, checksum_hash_algo: SourceFileHashAlgorithm | undefined): [string, [number, SourceFileHash | undefined]][] =>
      Array.from(it, (path): [string, [number, SourceFileHash | undefined]] => {
        if (checksum_hash_algo !== undefined) {
          // `fs::File::open(path)` + `SourceFileHash::new(algo, &mut file)` + `file.metadata().len()`;
          // on error `tracing::error!` and `(path, (0, None))`.
          return unported("rustc_span::SourceFileHash::new (reading a file; -Z checksum-hash-algorithm)");
        }
        return [path, [0, undefined]];
      });

    const extra_tracked_files = hash_iter_files(
      Array.from(file_depinfo, (path_sym) => normalize_path(Symbol.as_str(path_sym))),
      checksum_hash_algo,
    );
    for (const [k, v] of extra_tracked_files) files.set(k, v);

    // We also need to track used PGO profile files
    const profile_instr = sess.opts.cg.profile_use;
    if (profile_instr !== undefined) {
      for (const [k, v] of hash_iter_files([normalize_path(profile_instr)], checksum_hash_algo)) files.set(k, v);
    }
    const profile_sample = sess.opts.cg.profile_sample_use;
    if (profile_sample !== undefined) {
      for (const [k, v] of hash_iter_files([normalize_path(profile_sample)], checksum_hash_algo)) files.set(k, v);
    }

    // Debugger visualizers files
    for (const debugger_visualizer of tcx.debugger_visualizers(LOCAL_CRATE) as { path: string | undefined }[]) {
      const path = debugger_visualizer.path;
      if (path === undefined) panic("called `Option::unwrap()` on a `None` value");
      for (const [k, v] of hash_iter_files([normalize_path(path)], checksum_hash_algo)) files.set(k, v);
    }

    if (sess.binary_dep_depinfo()) {
      const backend = sess.opts.unstable_opts.codegen_backend;
      if (backend !== undefined) {
        if (backend.includes(".")) {
          // If the backend name contain a `.`, it is the path to an external dynamic
          // library. If not, it is not a path.
          for (const [k, v] of hash_iter_files([backend], checksum_hash_algo)) files.set(k, v);
        }
      }

      for (const cnum of tcx.crates(null)) {
        void cnum;
        // `tcx.used_crate_source(cnum)` and its dylib/rlib/rmeta paths.
        unported("rustc_metadata used_crate_source (-Z binary-dep-depinfo; wave 11)");
      }
    }

    const write_deps_to_file = (): string => {
      let file = "";
      for (const path of out_filenames) {
        file += `${path}: ${[...files.keys()].join(" ")}\n\n`;
      }

      // Emit a fake target for each input file to the compilation. This
      // prevents `make` from spitting out an error if a file is later
      // deleted. For more info see #28735
      for (const path of files.keys()) {
        file += `${path}:\n`;
      }

      // Emit special comments with information about accessed environment variables.
      const env_depinfo = sess.env_depinfo;
      if (env_depinfo.size !== 0) {
        // We will soon sort, so the initial order does not matter.
        // #[allow(rustc::potential_query_instability)]
        // PORT: entries are the JSON text of `[key, value | null]` (see `env_var_os`).
        const envs: [string, string | undefined][] = Array.from(env_depinfo, (e) => {
          const [k, v] = JSON.parse(e) as [string, string | null];
          return [escape_dep_env(Symbol.intern(k)), v === null ? undefined : escape_dep_env(Symbol.intern(v))];
        });
        // `sort_unstable` of `(String, Option<String>)`: byte order, `None` first.
        envs.sort((a, b) => str_cmp(a[0], b[0]) || (a[1] === b[1] ? 0 : a[1] === undefined ? -1 : b[1] === undefined ? 1 : str_cmp(a[1], b[1])));
        file += "\n";
        for (const [k, v] of envs) {
          file += `# env-dep:${k}`;
          if (v !== undefined) {
            file += `=${v}`;
          }
          file += "\n";
        }
      }

      // If caller requested this information, add special comments about source file checksums.
      // These are not necessarily the same checksums as was used in the debug files.
      if (UnstableOptions_impl.checksum_hash_algorithm(sess.opts.unstable_opts) !== undefined) {
        for (const [path, [file_len, hash_algo]] of files) {
          if (hash_algo === undefined) continue;
          file += `# checksum:${display_SourceFileHash(hash_algo)} file_len:${file_len} ${path}\n`;
        }
      }

      return file;
    };

    switch (deps_output.$) {
      case "Stdout": {
        std_print(write_deps_to_file());
        break;
      }
      case "Real": {
        writeFileSync(deps_output._0, write_deps_to_file());
        break;
      }
    }
  } catch (e) {
    if (e instanceof Error && "code" in e) error = e;
    else throw e;
  }

  if (error === undefined) {
    if (sess.opts.json_artifact_notifications) {
      sess.dcx().emit_artifact_notification(deps_filename, "dep-info");
    }
  } else {
    // `sess.dcx().emit_fatal(diagnostics::ErrorWritingDependencies { path: deps_filename, error })`:
    // PORT: `io::Error` has no `IntoDiagArg` in the generated diagnostics yet.
    unported(`rustc_interface::diagnostics::ErrorWritingDependencies (${String(error)})`);
  }
}

/** `str::cmp` (byte order of UTF-8 = code point order). */
function str_cmp(a: string, b: string): number {
  const x = utf8(a);
  const y = utf8(b);
  const n = Math.min(x.length, y.length);
  for (let i = 0; i < n; i++) {
    if (x[i] !== y[i]) return x[i]! - y[i]!;
  }
  return x.length - y.length;
}

// rustc: compiler/rustc_interface/src/passes.rs:791 resolver_for_lowering_raw
function resolver_for_lowering_raw(tcx: TyCtxt, _: null): [Steal<ResolverAstLowering>, Steal<Crate>, ResolverGlobalCtxt] {
  // PORT: `WorkerLocal::new(|_| Resolver::arenas())`: single-threaded, the `WorkerLocal` is its value.
  const arenas = Resolver.arenas();
  void tcx.registered_attr_tools(null); // Uses `crate_for_resolver`.
  void tcx.registered_lint_tools(null); // Uses `crate_for_resolver`.
  const [krate0, pre_configured_attrs] = tcx.crate_for_resolver(null).steal();
  const resolver = Resolver.new(tcx, pre_configured_attrs, krate0.spans.inner_span, krate0.spans.inject_use_span, arenas);
  const krate = configure_and_expand(krate0, pre_configured_attrs, resolver);

  // Don't mutate the cstore or stable crate id map from here on.
  tcx.untracked().freeze_cstore();

  const { global_ctxt: untracked_resolutions, ast_lowering: untracked_resolver_for_lowering } = resolver.into_outputs();

  return [
    Steal.new(untracked_resolver_for_lowering, "rustc_middle::middle::resolve::ResolverAstLowering"),
    Steal.new(krate, "rustc_ast::ast::Crate"),
    untracked_resolutions,
  ];
}

// rustc: compiler/rustc_interface/src/passes.rs:823 write_dep_info
export function write_dep_info(tcx: TyCtxt): void {
  // Make sure name resolution and macro expansion is run for
  // the side-effect of providing a complete set of all
  // accessed files and env vars.
  void tcx.resolver_for_lowering();

  const sess = tcx.sess;
  const _timer = sess.timer("write_dep_info");
  const crate_name = tcx.crate_name(LOCAL_CRATE);

  // PORT: the `output_filenames` query value is typed `unknown` in queries.gen.ts (OutputFilenames was not
  // in the codegen type map); it is the `OutputFilenames` fed by `create_and_enter_global_ctxt`.
  const outputs = tcx.output_filenames(null) as OutputFilenames;
  const output_paths = generated_output_paths(tcx, outputs, sess.io.output_file !== undefined, crate_name);

  // Ensure the source file isn't accidentally overwritten during compilation.
  const input_path = Input.opt_path(sess.io.input);
  if (input_path !== undefined) {
    if (Options_will_create_output_file(sess)) {
      if (output_contains_path(output_paths, input_path)) {
        sess.dcx().emit_fatal(diagnostics.InputFileWouldBeOverWritten_diagnostic({ path: input_path }));
      }
      const dir_path = output_conflicts_with_dir(output_paths);
      if (dir_path !== undefined) {
        sess.dcx().emit_fatal(diagnostics.GeneratedFileConflictsWithDirectory_diagnostic({ input_path, dir_path }));
      }
    }
  }

  const temps_dir = sess.io.temps_dir;
  if (temps_dir !== undefined) {
    if (!fs_create_dir_all(temps_dir)) {
      sess.dcx().emit_fatal(diagnostics.TempsDirError_diagnostic({}));
    }
  }

  write_out_deps(tcx, outputs, output_paths);

  const only_dep_info = sess.opts.output_types.contains_key("DepInfo") && sess.opts.output_types.len() === 1;

  if (!only_dep_info) {
    const dir = sess.io.output_dir;
    if (dir !== undefined) {
      if (!fs_create_dir_all(dir)) {
        sess.dcx().emit_fatal(diagnostics.OutDirError_diagnostic({}));
      }
    }
  }
  void _timer;
}

/** `Options::will_create_output_file` (config.rs:1562; `Options_impl` in config.ts). */
function Options_will_create_output_file(sess: Session): boolean {
  return (
    !sess.opts.unstable_opts.parse_crate_root_only && // The file is just being parsed
    sess.opts.unstable_opts.ls.length === 0 // The file is just being queried
  );
}

/** `fs::create_dir_all(dir).is_ok()` (an empty path is `Ok`). */
function fs_create_dir_all(dir: string): boolean {
  if (dir === "") return true;
  try {
    mkdirSync(dir, { recursive: true });
    return true;
  } catch {
    return false;
  }
}

// rustc: compiler/rustc_interface/src/passes.rs:873 write_interface
export function write_interface(tcx: TyCtxt): void {
  if (!tcx.crate_types().includes("Sdylib")) {
    return;
  }
  // `print_crate_as_interface` and writing `lib<crate>.rs`.
  unported("rustc_interface::passes::write_interface (rustc_ast_pretty::pprust::print_crate_as_interface; -Zbuild-sdylib-interface)");
}

// ---- create_and_enter_global_ctxt (passes.rs:894-1074) and its helpers ------------------------------------
//
// PORT: steps whose crates are not ported yet are local stand-ins that call `unported` unless their input
// makes them trivially empty: `rustc_incremental::{setup_dep_graph, load_query_result_cache,
// provide}` (no incremental, D3), and the providers of the crates listed in `DEFAULT_QUERY_PROVIDERS`.

/** `rustc_incremental::setup_dep_graph` (persist/load.rs:180): no incremental compilation (D3). */
function setup_dep_graph(sess: Session, _crate_name: Symbol, _stable_crate_id: StableCrateId): [DepGraph, undefined] {
  if (sess.opts.incremental === undefined) {
    return [DepGraph.new_disabled(), undefined];
  }
  return unported("rustc_incremental::setup_dep_graph (-C incremental; D3)");
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

/**
 * PORT: port-side placeholder providers (merge-w15b). Upstream, every crate in `DEFAULT_QUERY_PROVIDERS` installs its
 * providers, so a query reaching `Providers::default()`'s `default_query` / `default_extern_query` is a compiler bug
 * (an ICE). Here most of those crates' `provide` fns are not ported, so their queries would land on that ICE: a
 * missing port, not a rustc bug. Each local and extern provider therefore starts as `unported("<query> provider (not
 * ported)")` (exit 70, UNPORTED); the ported `provide` fns below replace the ones they own, as upstream's do.
 */
function install_unported_providers(providers: MiddleProviders): void {
  const queries = providers.queries as unknown as Record<string, unknown>;
  const extern_queries = providers.extern_queries as unknown as Record<string, unknown>;
  for (const name of QUERY_NAMES) {
    queries[name] = (): never => unported(`${name} provider (not ported)`);
    if (QUERY_DECLS[name].separate_provide_extern) {
      extern_queries[name] = (): never => unported(`${name} extern provider (not ported)`);
    }
  }
}

/** `DEFAULT_QUERY_PROVIDERS` (passes.rs:894): the `LazyLock`'s initializer; see `DEFAULT_QUERY_PROVIDERS`. */
function default_query_providers(): MiddleProviders {
  const providers: MiddleProviders = { queries: Providers_default(), extern_queries: ExternProviders_default(), hooks: HookProviders_default() };
  install_unported_providers(providers);
  providers.queries.analysis = analysis;
  providers.queries.resolver_for_lowering_raw = resolver_for_lowering_raw;
  providers.queries.stripped_cfg_items = (tcx, _) => tcx.resolutions(null).stripped_cfg_items;
  providers.queries.resolutions = (tcx, _) => tcx.resolver_for_lowering_raw(null)[2];
  providers.queries.early_lint_checks = early_lint_checks;
  providers.queries.env_var_os = (tcx, key) => env_var_os(tcx, key as string);
  // PORT: the `hir_crate_items` query value is `unknown` in queries.gen.ts.
  providers.queries.proc_macro_decls_static = (tcx, _) => (tcx.hir_crate_items(null) as hir.ModuleItems).proc_macro_decls();
  rustc_ast_lowering.provide(providers.queries);
  // PORT: pending crates (their `provide` fns are not ported): rustc_expand_queries,
  // rustc_monomorphize (rustc_const_eval, rustc_borrowck, rustc_mir_dataflow, rustc_mir_transform, rustc_privacy,
  // rustc_hir_analysis, rustc_hir_typeck, rustc_traits, rustc_ty_utils, rustc_metadata, rustc_lint, rustc_symbol_mangling,
  // rustc_codegen_ssa and rustc_mir_build are provided below).
  // Their queries stop as UNPORTED (`install_unported_providers`).
  limits.provide(providers.queries);
  rustc_const_eval.provide(providers);
  hir.provide(providers.queries);
  rustc_borrowck_provide(providers.queries);
  rustc_incremental_provide(providers);
  rustc_mir_build_provide(providers);
  rustc_mir_dataflow.provide(providers);
  rustc_mir_transform_provide(providers);
  rustc_privacy.provide(providers.queries);
  query_impl_provide(providers);
  rustc_resolve.provide(providers.queries);
  rustc_hir_analysis.provide(providers.queries);
  rustc_hir_typeck.provide(providers.queries);
  ty_provide(providers.queries);
  rustc_trait_selection.traits.provide(providers.queries);
  rustc_trait_selection.solve.provide(providers.queries);
  rustc_passes_provide(providers.queries);
  rustc_traits_provide(providers.queries);
  rustc_ty_utils.provide(providers.queries);
  rustc_metadata_provide(providers);
  rustc_lint.provide(providers.queries);
  rustc_symbol_mangling.provide(providers.queries);
  rustc_codegen_ssa.provide(providers);
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
    compiler.codegen_backend.supported_crate_types(sess),
    compiler.codegen_backend.name(),
    pre_configured_attrs,
    krate.spans.inner_span,
  );
  const stable_crate_id = StableCrateId.new(crate_name, crate_types.includes("Executable"), [...sess.opts.cg.metadata], sess.cfg_version);

  const outputs = util.build_output_filenames(pre_configured_attrs, sess);

  const [dep_graph, incr_comp_session] = setup_dep_graph(sess, crate_name, stable_crate_id);

  // PORT: `FreezeLock`s are their inner values (PORTING §5).
  const cstore: CrateStore = creader.CStore.new(compiler.codegen_backend.metadata_loader());
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

  const callback = compiler.override_queries;
  if (callback !== undefined) {
    callback(sess, providers);
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
    // `compiler.current_gcx.clone()` (an `Arc` clone: the same cell)
    compiler.current_gcx,
    (tcx) => {
      const r = tcx.create_crate_num(stable_crate_id);
      if (r.$ !== "Ok") return panic("called `Result::unwrap()` on an `Err` value");
      const feed = r._0;
      assert_eq(feed.key(), LOCAL_CRATE, (v) => String(v));
      feed.crate_name(crate_name);

      const unit = tcx.feed_unit_query();
      unit.features_query(rustc_expand_config.features(tcx.sess, pre_configured_attrs, crate_name));
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

/**
 * PORT: `rustc_hir::lints::DelayedLint` (lints.rs) is not ported yet (`unknown` in rustc_ast_lowering/hir_shim.ts);
 * this is the view of its fields that `emit_delayed_lints` reads (the literal rustc_ast_lowering builds).
 */
interface DelayedLintView {
  lint_id: LintId;
  id: HirId;
  span: MultiSpan;
  callback: (dcx: DiagCtxtHandle, level: Level, sess: unknown) => Diag;
}

/** `struct DiagCallback<'tcx> { callback, tcx }` (passes.rs:1069). */
interface DiagCallback {
  callback: (dcx: DiagCtxtHandle, level: Level, sess: unknown) => Diag;
  tcx: TyCtxt;
}

// impl<'a, 'tcx> Diagnostic<'a> for DiagCallback<'tcx>
// rustc: compiler/rustc_interface/src/passes.rs:1078 into_diag
function DiagCallback_into_diag(self: DiagCallback, dcx: DiagCtxtHandle, level: Level): Diag {
  return self.callback(dcx, level, self.tcx.sess);
}

// rustc: compiler/rustc_interface/src/passes.rs:1083 emit_delayed_lints
export function emit_delayed_lints(tcx: TyCtxt): void {
  // PORT: the `hir_crate_items` query value is `unknown` in queries.gen.ts.
  for (const owner_id of (tcx.hir_crate_items(null) as hir.ModuleItems).owners()) {
    const delayed_lints = tcx.opt_ast_lowering_delayed_lints(owner_id);
    if (delayed_lints !== undefined) {
      for (const lint of delayed_lints.steal() as DelayedLintView[]) {
        const cb: DiagCallback = { callback: lint.callback, tcx };
        tcx.emit_node_span_lint(lint.lint_id.lint, lint.id, lint.span, { into_diag: (dcx, level) => DiagCallback_into_diag(cb, dcx, level) });
      }
    }
  }
}

/// Runs all analyses that we guarantee to run, even if errors were reported in earlier analyses.
/// This function never fails.
// rustc: compiler/rustc_interface/src/passes.rs:1100 run_required_analyses
function run_required_analyses(tcx: TyCtxt): void {
  if (tcx.sess.opts.unstable_opts.input_stats) {
    rustc_passes_input_stats_print_hir_stats(tcx);
  }
  // When using rustdoc's "jump to def" feature, it enters this code and `check_crate`
  // is not defined. So we need to cfg it out.
  // #[cfg(all(not(doc), debug_assertions))]
  // rustc_passes::hir_id_validator::check_crate(tcx);
  // PORT: rustc ships without debug assertions (PORTING §3), so this call is compiled out of the oracle.

  // Prefetch this to prevent multiple threads from blocking on it later.
  // This is needed since the `hir_id_validator::check_crate` call above is not guaranteed
  // to use `hir_crate_items`.
  tcx.ensure_done().hir_crate_items(null);

  // PORT: `definitions.write()`: the `RwLock` is its inner value (PORTING §5).
  tcx.untracked().definitions.commit_end_of_determinism();

  rustc_passes.delegation.check_glob_and_list_delegations_target_expr(tcx);

  const sess = tcx.sess;
  sess.time("misc_checking_1", () => {
    par_fns([
      () => {
        sess.time("looking_for_entry_point", () => tcx.ensure_ok().entry_fn(null));
        sess.time("check_externally_implementable_items", () => {
          tcx.ensure_ok().check_externally_implementable_items(null);
        });

        sess.time("looking_for_derive_registrar", () => {
          tcx.ensure_ok().proc_macro_decls_static(null);
        });

        creader.CStore.from_tcx(tcx).report_unused_deps(tcx);
      },
      () => {
        tcx.ensure_ok().exportable_items(LOCAL_CRATE);
        tcx.ensure_ok().stable_order_of_exportable_impls(LOCAL_CRATE);
        tcx.par_hir_for_each_module((module) => {
          tcx.ensure_ok().check_mod_attrs(module);
          tcx.ensure_ok().check_mod_unstable_api_usage(module);
        });
      },
      () => {
        // We force these queries to run,
        // since they might not otherwise get called.
        // This marks the corresponding crate-level attributes
        // as used, and ensures that their values are valid.
        tcx.ensure_ok().limits(null);
      },
    ]);
  });

  sess.time("emit_ast_lowering_delayed_lints", () => {
    emit_delayed_lints(tcx);
  });

  rustc_hir_analysis.check_crate(tcx);
  // Freeze definitions as we don't add new ones at this point.
  // We need to wait until now since we synthesize a by-move body
  // for all coroutine-closures.
  //
  // This improves performance by allowing lock-free access to them.
  // PORT: `tcx.untracked().definitions.freeze()`: `FreezeLock::freeze` is a no-op (PORTING §5: the lock is its
  // inner value).

  sess.time("MIR_borrow_checking", () => {
    tcx.par_hir_body_owners((def_id) => {
      const not_typeck_child = !tcx.is_typeck_child(LocalDefId.to_def_id(def_id));
      if (not_typeck_child) {
        // Child unsafety and borrowck happens together with the parent
        tcx.ensure_ok().check_unsafety(def_id);
      }
      if (tcx.is_trivial_const(def_id)) {
        return;
      }
      if (not_typeck_child) {
        tcx.ensure_ok().mir_borrowck(def_id);
        tcx.ensure_ok().check_transmutes(def_id);
        if (tcx.sess.opts.unstable_opts.offload.length !== 0) {
          tcx.ensure_ok().check_offloads(def_id);
        }
      }
      tcx.ensure_ok().has_ffi_unwind_calls(def_id);
      tcx.ensure_ok().check_liveness(def_id);

      // If we need to codegen, ensure that we emit all errors from
      // `mir_drops_elaborated_and_const_checked` now, to avoid discovering
      // them later during codegen.
      if (tcx.sess.opts.output_types.should_codegen() || tcx.hir_body_const_context(def_id) !== undefined) {
        tcx.ensure_ok().mir_drops_elaborated_and_const_checked(def_id);
      }
      if (tcx.is_coroutine(LocalDefId.to_def_id(def_id)) && !tcx.is_async_drop_in_place_coroutine(LocalDefId.to_def_id(def_id))) {
        // Eagerly check the unsubstituted layout for cycles.
        tcx
          .ensure_ok()
          .layout_of(
            TypingEnv.codegen(tcx, LocalDefId.to_def_id(def_id)).as_query_input(
              Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.type_of(def_id) as EarlyBinder<Ty>)),
            ),
          );
      }
    });
  });

  sess.time("layout_testing", () => rustc_passes.layout_test.test_layout(tcx));
  sess.time("abi_testing", () => rustc_passes.abi_test.test_abi(tcx));
}

/// Runs the type-checking, region checking and other miscellaneous analysis
/// passes on the crate.
// rustc: compiler/rustc_interface/src/passes.rs:1209 analysis
function analysis(tcx: TyCtxt, _: null): null {
  run_required_analyses(tcx);

  const sess = tcx.sess;

  // Avoid overwhelming user with errors if borrow checking failed.
  // I'm not sure how helpful this is, to be honest, but it avoids a
  // lot of annoying errors in the ui tests (basically,
  // lint warnings and so on -- kindck used to do this abort, but
  // kindck is gone now). -nmatsakis
  //
  // But we exclude lint errors from this, because lint errors are typically
  // less serious and we're more likely to want to continue (#87337).
  const guar = sess.dcx().has_errors_excluding_lint_errors();
  if (guar !== undefined) {
    guar.raise_fatal();
  }

  sess.time("misc_checking_3", () => {
    par_fns([
      () => {
        tcx.ensure_ok().effective_visibilities(null);

        par_fns([
          () => {
            tcx.par_hir_for_each_module((module) => {
              tcx.ensure_ok().check_private_in_public(module);
            });
          },
          () => {
            tcx.par_hir_for_each_module((module) => {
              tcx.ensure_ok().check_mod_deathness(module);
            });
          },
          () => {
            sess.time("lint_checking", () => {
              rustc_lint.check_crate(tcx);
            });
          },
          () => {
            tcx.ensure_ok().clashing_extern_declarations(null);
          },
        ]);
      },
      () => {
        sess.time("privacy_checking_modules", () => {
          tcx.par_hir_for_each_module((module) => {
            tcx.ensure_ok().check_mod_privacy(module);
          });
        });
      },
    ]);

    // This check has to be run after all lints are done processing. We don't
    // define a lint filter, as all lint checks should have finished at this point.
    sess.time("check_lint_expectations", () => tcx.ensure_ok().check_expectations(undefined));

    // This query is only invoked normally if a diagnostic is emitted that needs any
    // diagnostic item. If the crate compiles without checking any diagnostic items,
    // we will fail to emit overlap diagnostics. Thus we invoke it here unconditionally.
    void tcx.all_diagnostic_items(null);

    // This query is only invoked normally if a diagnostic is emitted that needs any
    // canonical symbol. If the crate compiles without checking any runtime symbols,
    // we will fail to emit overlap diagnostics. Thus we invoke it here unconditionally.
    void tcx.all_canonical_symbols(null);
  });

  // If `-Zvalidate-mir` is set, we also want to compute the final MIR for each item
  // (either its `mir_for_ctfe` or `optimized_mir`) since that helps uncover any bugs
  // in MIR optimizations that may only be reachable through codegen, or other codepaths
  // that requires the optimized/ctfe MIR, coroutine bodies, or evaluating consts.
  // Nevertheless, wait after type checking is finished, as optimizing code that does not
  // type-check is very prone to ICEs.
  if (tcx.sess.opts.unstable_opts.validate_mir) {
    sess.time("ensuring_final_MIR_is_computable", () => {
      tcx.par_hir_body_owners((def_id) => {
        if (!tcx.is_trivial_const(def_id)) {
          tcx.instance_mir({ $: "Item", _0: LocalDefId.to_def_id(def_id) });
        }
      });
    });
  }
  return null;
}

/// Runs the codegen backend, after which the AST and analysis can
/// be discarded.
// rustc: compiler/rustc_interface/src/passes.rs:1295 start_codegen
export function start_codegen(codegen_backend: CodegenBackend, tcx: TyCtxt): [unknown, CrateInfo, EncodedMetadata] {
  tcx.sess.timings.start_section(tcx.sess.dcx(), "Codegen");

  // Hook for tests.
  const entry = tcx.entry_fn(null);
  if (entry !== undefined) {
    const [def_id] = entry;
    if (find_attr(HasAttrs_DefId.get_attrs(def_id, tcx), (k) => (k.$ === "RustcDelayedBugFromInsideQuery" ? null : undefined)) !== undefined) {
      tcx.ensure_ok().trigger_delayed_bug(def_id);
    }
  }

  // Don't run this test assertions when not doing codegen. Compiletest tries to build
  // build-fail tests in check mode first and expects it to not give an error in that case.
  if (tcx.sess.opts.output_types.should_codegen()) {
    rustc_symbol_mangling.test.dump_symbol_names_and_def_paths(tcx);
  }

  // Don't do code generation if there were any errors. Likewise if
  // there were any delayed bugs, because codegen will likely cause
  // more ICEs, obscuring the original problem.
  const guar = tcx.sess.dcx().has_errors_or_delayed_bugs();
  if (guar !== undefined) {
    guar.raise_fatal();
  }

  // info!("Pre-codegen\n{:?}", tcx.debug_stats());

  const r = rustc_metadata_fs.encode_and_write_metadata(tcx);
  if (r.$ === "Err") {
    return r._0.raise_fatal();
  }
  const metadata = r._0;

  const is_host_metadata = tcx.sess.opts.unstable_opts.offload.some((o) => o.$ === "HostMetadata");

  const codegen = tcx.sess.time("codegen_crate", (): unknown => {
    if (tcx.sess.opts.unstable_opts.no_codegen || !tcx.sess.opts.output_types.should_codegen() || is_host_metadata) {
      tcx.sess.dcx().abort_if_errors();

      if (is_host_metadata) {
        // rustc_monomorphize::write_host_metadata_offload_manifest(tcx);
        return unported("rustc_monomorphize::write_host_metadata_offload_manifest (-Z offload=HostMetadata)");
      }

      // Linker::link will skip join_codegen in case of a `CompiledModules` Any value.
      return new CompiledModules([], undefined);
    } else {
      return codegen_backend.codegen_crate(tcx);
    }
  });

  // info!("Post-codegen\n{:?}", tcx.debug_stats());

  // This must run after monomorphization so that all generic types
  // have been instantiated.
  if (tcx.sess.opts.unstable_opts.print_type_sizes) {
    // tcx.sess.code_stats.print_type_sizes();
    unported("rustc_session::code_stats::CodeStats::print_type_sizes (-Z print-type-sizes)");
  }

  const crate_info = CrateInfo_new(tcx, codegen_backend.target_cpu(tcx.sess));

  return [codegen, crate_info, metadata];
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

  const attr_crate_name = parse_crate_name(sess, krate_attrs, { $: "EarlyFatal", also_emit_lints: true });

  const validate = (name: Symbol, span: Span | undefined): Symbol => {
    validate_crate_name(sess, name, span);
    return name;
  };

  if (sess.opts.crate_name !== undefined) {
    const crate_name = Symbol.intern(sess.opts.crate_name);
    if (attr_crate_name !== undefined && attr_crate_name[0] !== crate_name) {
      const [attr_crate_name_, span] = attr_crate_name;
      sess.dcx().emit_err(diagnostics.CrateNameDoesNotMatch_diagnostic({ span, crate_name, attr_crate_name: attr_crate_name_ }));
    }
    return validate(crate_name, undefined);
  }

  if (attr_crate_name !== undefined) {
    return validate(attr_crate_name[0], attr_crate_name[1]);
  }

  if (sess.io.input.$ === "File") {
    // `path.file_stem().and_then(|s| s.to_str())` (paths are JS strings: always valid UTF-8 here)
    const file_stem = path_file_stem(sess.io.input._0);
    if (file_stem !== undefined) {
      if (file_stem.startsWith("-")) {
        sess.dcx().emit_err(diagnostics.CrateNameInvalid_diagnostic({ crate_name: file_stem }));
      } else {
        return validate(Symbol.intern(file_stem.replaceAll("-", "_")), undefined);
      }
    }
  }

  return sym.rust_out;
}

// rustc: compiler/rustc_interface/src/passes.rs:1415 parse_crate_name
export function parse_crate_name(sess: Session, attrs: readonly Attribute[], emit_errors: ShouldEmit): [Symbol, Span] | undefined {
  const a = AttributeParser.parse_limited_sym_should_emit(sess, attrs, [sym.crate_name], DUMMY_SP, undefined, emit_errors);
  if (a === undefined) return undefined; // `?`
  if (!(a.$ === "Parsed" && a._0.$ === "CrateName")) {
    return unreachable("crate_name is the only attr we could've parsed here");
  }
  const { name, name_span } = a._0;

  return [name, name_span];
}

// rustc: compiler/rustc_interface/src/passes.rs:1436 collect_crate_types
export function collect_crate_types(session: Session, backend_crate_types: readonly CrateType[], codegen_backend_name: string, attrs: readonly Attribute[], crate_span: Span): CrateType[] {
  // If we're generating a test executable, then ignore all other output
  // styles at all other locations
  if (session.opts.test) {
    if (!session.target.executables) {
      session.dcx().emit_warn(diagnostics.UnsupportedCrateTypeForTarget_diagnostic({ crate_type: "Executable", target_triple: session.opts.target_triple }));
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
  // #[allow(rustc::bad_opt_access)]
  let base = [...session.opts.crate_types];
  if (base.length === 0) {
    const a = AttributeParser.parse_limited_sym_should_emit(session, attrs, [sym.crate_type], crate_span, undefined, {
      $: "EarlyFatal",
      also_emit_lints: false,
    });
    if (a !== undefined && a.$ === "Parsed" && a._0.$ === "CrateType") {
      base.push(...a._0._0);
    }

    if (base.length === 0) {
      base.push(default_output_for_target(session));
    } else {
      // `base.sort(); base.dedup();` (derived `Ord`: declaration order)
      base.sort((a, b) => CrateType_discriminant[a] - CrateType_discriminant[b]);
      base = base.filter((t, i) => i === 0 || base[i - 1] !== t);
    }
  }

  base = base.filter((crate_type) => {
    if (invalid_output_for_target(session, crate_type)) {
      session.dcx().emit_warn(diagnostics.UnsupportedCrateTypeForTarget_diagnostic({ crate_type, target_triple: session.opts.target_triple }));
      return false;
    } else if (!backend_crate_types.includes(crate_type)) {
      session.dcx().emit_warn(diagnostics.UnsupportedCrateTypeForCodegenBackend_diagnostic({ crate_type, codegen_backend: codegen_backend_name }));
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

// rustc: compiler/rustc_interface/src/passes.rs:1523 get_recursion_limit
function get_recursion_limit(krate_attrs: readonly Attribute[], sess: Session): Limit {
  const attr = AttributeParser.parse_limited_sym_should_emit(
    sess,
    krate_attrs,
    [sym.recursion_limit],
    DUMMY_SP,
    undefined,
    // errors are fatal here, but lints aren't.
    // If things aren't fatal we continue, and will parse this again.
    // That makes the same lint trigger again.
    // So, no lints here to avoid duplicates.
    { $: "EarlyFatal", also_emit_lints: false },
  );
  return limits.get_recursion_limit(attr === undefined ? [] : [attr], sess);
}

function clone_MiddleProviders(p: MiddleProviders): MiddleProviders {
  // `#[derive(Copy, Clone)] struct Providers` (rustc_middle/src/util/mod.rs)
  return { queries: clone_Providers(p.queries), extern_queries: clone_ExternProviders(p.extern_queries), hooks: clone_HookProviders(p.hooks) };
}

// ---- Pending-lane shims ------------------------------------------------------------------------------------
// Each is named and typed as upstream; its body calls `unported` with the upstream path and the lane that
// ports it. Root replaces each by the import when the lane lands (handoff driver-m2).

/** `rustc_passes::input_stats::print_ast_stats` (input_stats.rs:71). PORT: no lane yet (-Zinput-stats). */
function rustc_passes_input_stats_print_ast_stats(_tcx: TyCtxt, _krate: Crate): void {
  unported("rustc_passes::input_stats::print_ast_stats (-Zinput-stats)");
}

/** `rustc_passes::input_stats::print_hir_stats` (input_stats.rs:63). PORT: no lane yet (-Zinput-stats). */
function rustc_passes_input_stats_print_hir_stats(_tcx: TyCtxt): void {
  unported("rustc_passes::input_stats::print_hir_stats (-Zinput-stats)");
}

export type { BufferedEarlyLint };
