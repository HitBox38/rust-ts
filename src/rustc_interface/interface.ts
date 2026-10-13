// Partial port of compiler/rustc_interface/src/interface.rs: `Compiler`, `parse_cfg`, `parse_check_cfg`,
// `Config`, `run_compiler`. `try_print_query_stack` needs rustc_middle (not ported).
import type { Providers as MiddleProviders } from "../rustc_middle/util/mod.ts";
import "../rustc_session/options.ts"; // LOAD ORDER: see rustc_session/config.ts
import type { PathBuf } from "../rustc_error_messages/lib.ts";
import type { Level, LintId } from "../rustc_lint_defs/lib.ts";
import { type Input, LinkerJobs, type OutFileName, Options_impl, UnstableOptions_impl, build_configuration, build_target_config } from "../rustc_session/config.ts";
import { type Options, str_cmp } from "../rustc_session/options.ts";
import { EarlyDiagCtxt, type Session, build_early_session, build_session } from "../rustc_session/session.ts";
import * as rustc_lint from "../rustc_lint/lib.ts";
import { drop_compiler_dcx } from "../rust_ts/driver.ts";
import { ast, token } from "../rustc_ast/lib.ts";
import { meta_list_item_to_string } from "../rustc_ast_pretty/pprust/mod.ts";
import { new_parser_from_source_str } from "../rustc_parse/lib.ts";
import { StripTokens } from "../rustc_parse/lexer/mod.ts";
import { type Parser, Recovery } from "../rustc_parse/parser/mod.ts";
import { Cfg, CheckCfg } from "../rustc_session/config/cfg.ts";
import { ParseSess } from "../rustc_session/parse.ts";
import { FileName } from "../rustc_span/lib.ts";
import { Ident, kw, Symbol, sym } from "../rustc_span/symbol.ts";
import { RealFileLoader } from "../rustc_span/source_map.ts";
import { Panic, unported, unwrap } from "../std/panic.ts";
import { FatalErrorMarker } from "../rustc_span/fatal_error.ts";
import { type CodegenBackend, CurrentGcx, jobserver_initialize } from "./stand_ins.ts";
import * as util from "./util.ts";
import { setup_callbacks } from "./callbacks.ts";
import { DEF_ID_DEBUG } from "../rustc_span/def_id.ts";

/// Represents a compiler session. Note that every `Compiler` contains a
/// `Session`, but `Compiler` also contains some things that cannot be in
/// `Session`, due to `Session` being in a crate that has many fewer
/// dependencies than this crate.
///
/// Can be used to run `rustc_interface` queries.
/// Created by passing [`Config`] to [`run_compiler`].
export class Compiler {
  constructor(
    public sess: Session,
    public codegen_backend: CodegenBackend,
    public override_queries: ((sess: Session, providers: MiddleProviders) => void) | undefined,

    /// A reference to the current `GlobalCtxt` which we pass on to `GlobalCtxt`.
    public current_gcx: CurrentGcx,
  ) {}
}

/// Converts strings provided as `--cfg [cfgspec]` into a `Cfg`.
// rustc: compiler/rustc_interface/src/interface.rs:47 parse_cfg
export function parse_cfg(sess: Session, cfgs: string[]): Cfg {
  const cfg = Cfg.default();
  for (const s of cfgs) {
    cfg.insert(
      ((): readonly [Symbol, Symbol | undefined] => {
        const psess = ParseSess.emitter_with_note(`this occurred on the command line: \`--cfg=${s}\``);
        const filename = FileName.cfg_spec_source_code(s);

        // macro_rules! error
        const error = (reason: string): never => {
          return sess.dcx().fatal(`invalid \`--cfg\` argument: \`${s}\` (${reason})`);
        };

        const r = new_parser_from_source_str(psess, filename, s, StripTokens.Nothing);
        switch (r.$) {
          case "Ok": {
            let parser = r._0;
            parser = parser.recovery(Recovery.Forbidden);
            const m = parser.parse_meta_item();
            if (m.$ === "Ok" && parser.token.kind.$ === "Eof" && parser.dcx().has_errors() === undefined) {
              const meta_item = m._0;
              if (meta_item.path.segments.length !== 1) {
                error("argument key must be an identifier");
              }
              const kind = meta_item.kind;
              if (kind.$ === "List") {
                // {}
              } else if (kind.$ === "NameValue" && !ast.LitKind.is_str(kind._0.kind)) {
                error("argument value must be a string");
              } else {
                // MetaItemKind::NameValue(..) | MetaItemKind::Word
                const ident = unwrap(meta_item.ident(), "multi-segment cfg key");

                if (ident.is_path_segment_keyword()) {
                  error("malformed `cfg` input, expected a valid identifier");
                }

                return [ident.name, meta_item.value_str()];
              }
            } else if (m.$ === "Ok") {
              // Ok(..) => {}
            } else {
              m._0.cancel();
            }
            break;
          }
          case "Err":
            for (const err of r._0) err.cancel();
            break;
        }

        // If the user tried to use a key="value" flag, but is missing the quotes, provide
        // a hint about how to resolve this.
        if (s.includes("=") && !s.includes('="') && !s.endsWith('"')) {
          return error(
            'expected `key` or `key="value"`, ensure escaping is appropriate' + ` for your shell, try 'key="value"' or key=\\"value\\"`,
          );
        } else {
          return error('expected `key` or `key="value"`');
        }
      })(),
    );
  }

  return build_configuration(sess, cfg);
}

/// Converts strings provided as `--check-cfg [specs]` into a `CheckCfg`.
// rustc: compiler/rustc_interface/src/interface.rs:116 parse_check_cfg
export function parse_check_cfg(sess: Session, specs: string[]): CheckCfg {
  // If any --check-cfg is passed then exhaustive_values and exhaustive_names
  // are enabled by default.
  const exhaustive_names = specs.length !== 0;
  const exhaustive_values = specs.length !== 0;
  const check_cfg = CheckCfg.default();
  check_cfg.exhaustive_names = exhaustive_names;
  check_cfg.exhaustive_values = exhaustive_values;

  for (const s of specs) {
    const psess = ParseSess.emitter_with_note(`this occurred on the command line: \`--check-cfg=${s}\``);
    const filename = FileName.cfg_spec_source_code(s);

    const VISIT = "visit <https://doc.rust-lang.org/nightly/rustc/check-cfg.html> for more details";

    // macro_rules! error
    const error = (reason: string): never => {
      const diag = sess.dcx().struct_fatal(`invalid \`--check-cfg\` argument: \`${s}\``);
      diag.note(reason);
      diag.note(VISIT);
      return diag.emit_fatal();
    };
    const error_in = (arg: ast.MetaItemInner, reason: string): never => {
      const diag = sess.dcx().struct_fatal(`invalid \`--check-cfg\` argument: \`${s}\``);

      const pparg = meta_list_item_to_string(arg);
      const lit = ast.MetaItemInner.lit(arg);
      if (lit !== undefined) {
        const lit_kind = lit.as_token_lit().kind;
        const [lit_kind_article, lit_kind_descr] = [token.LitKind.article(lit_kind), token.LitKind.descr(lit_kind)];
        diag.note(`\`${pparg}\` is ${lit_kind_article} ${lit_kind_descr} literal`);
      } else {
        diag.note(`\`${pparg}\` is invalid`);
      }

      diag.note(reason);
      diag.note(VISIT);
      return diag.emit_fatal();
    };

    const expected_error = (): never => {
      return error('expected `cfg(name, values("value1", "value2", ... "valueN"))`');
    };

    const pr = new_parser_from_source_str(psess, filename, s, StripTokens.Nothing);
    let parser: Parser;
    switch (pr.$) {
      case "Ok":
        parser = pr._0.recovery(Recovery.Forbidden);
        break;
      case "Err":
        for (const err of pr._0) err.cancel();
        return expected_error();
    }

    const m = parser.parse_meta_item();
    let meta_item: ast.MetaItem;
    if (m.$ === "Ok" && parser.token.kind.$ === "Eof" && parser.dcx().has_errors() === undefined) {
      meta_item = m._0;
    } else if (m.$ === "Ok") {
      return expected_error();
    } else {
      m._0.cancel();
      return expected_error();
    }

    const args = meta_item.meta_item_list();
    if (args === undefined) {
      return expected_error();
    }

    if (!meta_item.has_name(sym.cfg)) {
      expected_error();
    }

    const names: Ident[] = [];
    const values = new Set<Symbol | undefined>();

    let any_specified = false;
    let values_specified = false;
    let values_any_specified = false;

    for (const arg of args) {
      let ident: Ident | undefined;
      let boolean: boolean | undefined;
      let list: readonly ast.MetaItemInner[] | undefined;
      if (ast.MetaItemInner.is_word(arg) && (ident = ast.MetaItemInner.ident(arg)) !== undefined) {
        if (values_specified) {
          error("`cfg()` names cannot be after values");
        }

        if (ident.is_path_segment_keyword()) {
          error("malformed `cfg` input, expected a valid identifier");
        }

        names.push(ident);
      } else if ((boolean = ast.MetaItemInner.boolean_literal(arg)) !== undefined) {
        if (values_specified) {
          error("`cfg()` names cannot be after values");
        }
        names.push(Ident.new(boolean ? kw.True : kw.False, ast.MetaItemInner.span(arg)));
      } else if (ast.MetaItemInner.has_name(arg, sym.any) && (list = ast.MetaItemInner.meta_item_list(arg)) !== undefined) {
        const args = list;
        if (any_specified) {
          error("`any()` cannot be specified multiple times");
        }
        any_specified = true;
        if (args.length !== 0) {
          error_in(arg, "`any()` takes no argument");
        }
      } else if (ast.MetaItemInner.has_name(arg, sym.values) && (list = ast.MetaItemInner.meta_item_list(arg)) !== undefined) {
        const args = list;
        if (names.length === 0) {
          error("`values()` cannot be specified before the names");
        } else if (values_specified) {
          error("`values()` cannot be specified multiple times");
        }
        values_specified = true;

        for (const arg of args) {
          const lit = ast.MetaItemInner.lit(arg);
          let inner: readonly ast.MetaItemInner[] | undefined;
          if (lit !== undefined && lit.kind.$ === "Str") {
            values.add(lit.kind._0);
          } else if (ast.MetaItemInner.has_name(arg, sym.any) && (inner = ast.MetaItemInner.meta_item_list(arg)) !== undefined) {
            if (values_any_specified) {
              error_in(arg, "`any()` in `values()` cannot be specified multiple times");
            }
            values_any_specified = true;
            if (inner.length !== 0) {
              error_in(arg, "`any()` in `values()` takes no argument");
            }
          } else if (ast.MetaItemInner.has_name(arg, sym.none) && (inner = ast.MetaItemInner.meta_item_list(arg)) !== undefined) {
            values.add(undefined);
            if (inner.length !== 0) {
              error_in(arg, "`none()` in `values()` takes no argument");
            }
          } else {
            error_in(arg, "`values()` arguments must be string literals, `none()` or `any()`");
          }
        }
      } else {
        error_in(arg, "`cfg()` arguments must be simple identifiers, `any()` or `values(...)`");
      }
    }

    if (!values_specified && !any_specified) {
      // `cfg(name)` is equivalent to `cfg(name, values(none()))` so add
      // an implicit `none()`
      values.add(undefined);
    } else if (values.size !== 0 && values_any_specified) {
      error("`values()` arguments cannot specify string literals and `any()` at the same time");
    }

    if (any_specified) {
      if (names.length === 0 && values.size === 0 && !values_specified && !values_any_specified) {
        check_cfg.exhaustive_names = false;
      } else {
        error("`cfg(any())` can only be provided in isolation");
      }
    } else {
      for (const name of names) {
        const v = check_cfg.expecteds.get(name.name);
        if (v !== undefined) {
          // `.and_modify(..)`
          if (v.$ === "Some" && !values_any_specified) {
            // #[allow(rustc::potential_query_instability)]
            for (const x of values) v._0.add(x);
          } else if (v.$ === "Some") {
            check_cfg.expecteds.set(name.name, { $: "Any" });
          } else {
            // ExpectedValues::Any => {}
          }
        } else {
          // `.or_insert_with(..)`
          check_cfg.expecteds.set(name.name, values_any_specified ? { $: "Any" } : { $: "Some", _0: new Set(values) });
        }
      }
    }
  }

  check_cfg.fill_well_known(sess.target);

  return check_cfg;
}

/// The compiler configuration
export interface Config {
  /// Command line options
  opts: Options;

  /// Unparsed cfg! configuration in addition to the default ones.
  crate_cfg: string[];
  crate_check_cfg: string[];

  input: Input;
  output_dir: PathBuf | undefined;
  output_file: OutFileName | undefined;
  ice_file: PathBuf | undefined;
  /// Load files from sources other than the file system.
  ///
  /// Has no uses within this repository, but may be used in the future by
  /// bjorn3 for "hooking rust-analyzer's VFS into rustc at some point for
  /// running rustc without having to save". (See #102759.)
  file_loader: undefined;

  lint_caps: Map<LintId, Level>;

  /// This is a callback from the driver that is called when [`ParseSess`] is created.
  psess_created: undefined;

  /// This is a callback to track otherwise untracked state used by the caller.
  ///
  /// You can write to `sess.env_depinfo` and `sess.file_depinfo` to track env vars and files.
  track_state: undefined;

  /// This is a callback from the driver that is called when we're registering lints;
  /// it is called during lint loading when we have the LintStore in a non-shared state.
  ///
  /// Note that if you find a Some here you probably want to call that function in the new
  /// function being registered.
  register_lints: undefined;

  /// This is a callback from the driver that is called just after we have populated
  /// the list of queries.
  override_queries: ((sess: Session, providers: MiddleProviders) => void) | undefined;

  /// An extra set of symbols to add to the symbol interner, the symbol indices
  /// will start at [`PREDEFINED_SYMBOLS_COUNT`](rustc_span::symbol::PREDEFINED_SYMBOLS_COUNT)
  extra_symbols: string[];

  /// This is a callback from the driver that is called to create a codegen backend.
  ///
  /// Has no uses within this repository, but is used by bjorn3 for "the
  /// hotswapping branch of cg_clif" for "setting the codegen backend from a
  /// custom driver where the custom codegen backend has arbitrary data."
  /// (See #102759.)
  make_codegen_backend: undefined;

  /// The inner atomic value is set to true when a feature marked as `internal` is
  /// enabled. Makes it so that "please report a bug" is hidden, as ICEs with
  /// internal features are wontfix, and they are usually the cause of the ICEs.
  using_internal_features: { value: boolean };
}
// PORT: the driver passes `None` for every callback (`file_loader`, `psess_created`, `track_state`,
// `register_lints`, `override_queries`, `make_codegen_backend`); their `Some` arms are not ported.

/** Whether `e` is an unwind payload (`Panic`/`FatalErrorMarker`), i.e. what `catch_unwind` catches. */
function is_unwind(e: unknown): boolean {
  return e instanceof Panic || e instanceof FatalErrorMarker;
}

// JUSTIFICATION: before session exists, only config
// #[allow(rustc::bad_opt_access)]
// rustc: compiler/rustc_interface/src/interface.rs:379 run_compiler
export function run_compiler<R>(config: Config, f: (compiler: Compiler) => R): R {
  // trace!("run_compiler");

  // Set parallel mode before thread pool creation, which will create `Lock`s.
  // `rustc_data_structures::sync::set_dyn_thread_safe_mode(config.opts.jobs.frontend.is_some())`
  // PORT: rust-ts is single-threaded; the parallel frontend (`-Z threads` > 1) is unported in
  // `util::run_in_thread_pool_with_globals`.

  // Initialize jobserver as early as possible.
  const early_dcx = EarlyDiagCtxt.new(config.opts.error_format);
  const jobs = config.opts.jobs;
  const limit = max_opt(max_opt(jobs.frontend, jobs.backend), LinkerJobs.limit(jobs.linker));
  if (limit !== undefined) {
    jobserver_initialize(limit, (err) => {
      const note = "the build environment is likely misconfigured";
      early_dcx.early_struct_warn(err).with_note(note).emit();
    });
  }

  // PORT: installs only `DEF_ID_DEBUG` (callbacks.ts module comment). Upstream installs the callbacks for the
  // rest of the process (one compiler per rustc process); rust-ts tests run several compilers in one process
  // and also test the defaults, so the previous hook is restored when `run_compiler` returns. Nothing formats
  // a `DefId` after that in a real run, so this is not observable there.
  const old_def_id_debug = DEF_ID_DEBUG.deref();
  setup_callbacks();
  try {
    const target = build_target_config(
      early_dcx,
      config.opts.target_triple,
      config.opts.sysroot.path(),
      config.opts.unstable_opts.unstable_options,
    );
    const file_loader = config.file_loader ?? new RealFileLoader();
    const path_mapping = Options_impl.file_path_mapping(config.opts);
    const hash_kind = UnstableOptions_impl.src_hash_algorithm(config.opts.unstable_opts, target);
    const checksum_hash_kind = UnstableOptions_impl.checksum_hash_algorithm(config.opts.unstable_opts);

    return util.run_in_thread_pool_with_globals(
      early_dcx,
      config.opts.edition,
      jobs,
      config.extra_symbols,
      { file_loader, path_mapping, hash_kind, checksum_hash_kind },
      (current_gcx) => {
        // The previous `early_dcx` can't be reused here because it doesn't
        // impl `Send`. Creating a new one is fine.
        const early_dcx = EarlyDiagCtxt.new(config.opts.error_format);

        const temps_dir = config.opts.unstable_opts.temps_dir;

        const early_sess = build_early_session(config.opts, target, config.ice_file);

        const codegen_backend: CodegenBackend = util.get_codegen_backend(
          early_dcx,
          early_sess.opts.sysroot,
          early_sess.opts.unstable_opts.codegen_backend,
          early_sess.target,
        );
        const codegen_backend_init = codegen_backend.init(early_sess);

        const sess = build_session(
          early_sess,
          codegen_backend_init,
          {
            input: config.input,
            output_dir: config.output_dir,
            output_file: config.output_file,
            temps_dir,
          },
          config.lint_caps,
          util.rustc_version_str() ?? "unknown",
          config.using_internal_features,
        );

        // STACK_SIZE is setup in run_in_thread_pool_with_globals, before arriving here.
        sess.opts.recommended_stack_size = util.STACK_SIZE.value!;

        const target_config = codegen_backend.target_config(sess.early_sess);

        // Store all of the target features in the session.
        // Needs to be done before `parse_cfg` because it checks this list.
        for (const f of [...target_config.internal_target_features].sort((a, b) => str_cmp(Symbol.as_str(a), Symbol.as_str(b)))) {
          sess.internal_target_features.add(f);
        }

        sess.config = parse_cfg(sess, config.crate_cfg);
        const is_nightly_build = sess.is_nightly_build();
        const is_crt_static = sess.crt_static(undefined);
        util.add_configuration(sess.config, target_config, sess.target, is_nightly_build, is_crt_static);

        sess.check_config = parse_check_cfg(sess, config.crate_check_cfg);

        // `psess_created` / `track_state` are `None` (driver).

        // Even though the session holds the lint store, we can't build the
        // lint store until after the session exists. And we wait until now
        // so that `register_lints` sees the fully initialized session.
        const lint_store = rustc_lint.new_lint_store(sess.enable_internal_lints());
        // `if let Some(register_lints) = config.register_lints` (always `None` for the driver, see `Config`)
        sess.lint_store = lint_store;

        util.check_abi_required_features(sess);

        const compiler = new Compiler(sess, codegen_backend, config.override_queries, current_gcx);

        // There are two paths out of `f`.
        // - Normal exit.
        // - Panic, e.g. triggered by `abort_if_errors` or a fatal error.
        //
        // We must run `finish_diagnostics` in both cases.
        let res: { $: "Ok"; _0: R } | { $: "Err"; _0: unknown };
        try {
          res = { $: "Ok", _0: f(compiler) };
        } catch (e) {
          // `catch_unwind` catches panics (`Panic`, `FatalErrorMarker`); anything else (e.g. `Unported`)
          // is not an unwind and propagates unchanged.
          if (!is_unwind(e)) throw e;
          res = { $: "Err", _0: e };
        }

        compiler.sess.finish_diagnostics();

        // If error diagnostics have been emitted, we can't return an
        // error directly, because the return type of this function
        // is `R`, not `Result<R, E>`. But we need to communicate the
        // errors' existence to the caller, otherwise the caller might
        // mistakenly think that no errors occurred and return a zero
        // exit code. So we abort (panic) instead, similar to if `f`
        // had panicked.
        if (res.$ === "Ok") {
          try {
            compiler.sess.dcx().abort_if_errors();
          } catch (e) {
            // PORT: the unwind starts here and leaves the closure: the rest of it does not run, and
            // `compiler` (with its `DiagCtxt`) is dropped while unwinding.
            if (!is_unwind(e)) throw e;
            drop_compiler_dcx(compiler.sess.psess.dcx_, true);
            throw e;
          }
        }

        // Also make sure to flush delayed bugs as if we panicked, the
        // bugs would be flushed by the Drop impl of DiagCtxt while
        // unwinding, which would result in an abort with
        // "panic in a destructor during cleanup".
        compiler.sess.dcx().flush_delayed();

        if (res.$ === "Err") {
          // Resume unwinding if a panic happened.
          // PORT: `resume_unwind(err)` drops `compiler` (and its `DiagCtxt`) while unwinding.
          drop_compiler_dcx(compiler.sess.psess.dcx_, true);
          throw res._0;
        }

        // `prof.generic_activity("drop_compiler").run(move || drop(compiler));`
        const prof = compiler.sess.prof;
        prof.generic_activity("drop_compiler").run(() => drop_compiler_dcx(compiler.sess.psess.dcx_, false));

        return res._0;
      },
    );
  } finally {
    DEF_ID_DEBUG.swap(old_def_id_debug);
  }
}

/** `Option<NonZero<usize>>::max` (`None < Some(_)`). */
function max_opt(a: number | undefined, b: number | undefined): number | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return Math.max(a, b);
}

// `try_print_query_stack` (interface.rs:542): not ported (rustc_middle / rustc_query_impl).
