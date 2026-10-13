// Partial port of compiler/rustc_interface/src/interface.rs: `Compiler`, `Config`, `run_compiler`.
// `parse_cfg`/`parse_check_cfg` need the parser and config/cfg.rs (unported, see below);
// `try_print_query_stack` needs rustc_middle (not ported).
import "../rustc_session/options.ts"; // LOAD ORDER: see rustc_session/config.ts
import type { PathBuf } from "../rustc_error_messages/lib.ts";
import type { Level, LintId } from "../rustc_lint_defs/lib.ts";
import { type Cfg, type Input, LinkerJobs, type OutFileName, Options_impl, UnstableOptions_impl, build_configuration, build_target_config } from "../rustc_session/config.ts";
import type { Options } from "../rustc_session/options.ts";
import { EarlyDiagCtxt, type Session, build_early_session, build_session } from "../rustc_session/session.ts";
import { defer_field } from "../rustc_session/stand_ins.ts";
import { drop_compiler_dcx } from "../rust_ts/driver.ts";
import { RealFileLoader } from "../rustc_span/source_map.ts";
import { Panic, unported } from "../std/panic.ts";
import { FatalErrorMarker } from "../rustc_span/fatal_error.ts";
import { type CodegenBackend, CurrentGcx, jobserver_initialize } from "./stand_ins.ts";
import * as util from "./util.ts";

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
    // PORT: `Option<fn(&Session, &mut Providers)>` (rustc_middle `Providers` is not ported).
    public override_queries: unknown,

    /// A reference to the current `GlobalCtxt` which we pass on to `GlobalCtxt`.
    public current_gcx: CurrentGcx,
  ) {}
}

/// Converts strings provided as `--cfg [cfgspec]` into a `Cfg`.
// PORT: not ported (no marker): each `--cfg` spec is parsed with the parser (`new_parser_from_source_str`,
// `parse_meta_item`), and the result goes through `config::build_configuration` (config/cfg.rs,
// rustc_target). Reaching it with any `--cfg` calls `unported`.
export function parse_cfg(_sess: Session, cfgs: string[]): Cfg {
  for (const s of cfgs) {
    unported(`rustc_interface::interface::parse_cfg (--cfg=${s})`);
  }
  return build_configuration(_sess, new Set());
}

/// Converts strings provided as `--check-cfg [specs]` into a `CheckCfg`.
// PORT: not ported (no marker): needs config/cfg.rs `CheckCfg` (+ `fill_well_known(&sess.target)`).
export function parse_check_cfg(_sess: Session, specs: string[]): unknown {
  for (const s of specs) {
    unported(`rustc_interface::interface::parse_check_cfg (--check-cfg=${s})`);
  }
  return unported("rustc_session::config::cfg::CheckCfg::fill_well_known (rustc_target)");
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
  override_queries: undefined;

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

  // `crate::callbacks::setup_callbacks()`: PORT: not run. It installs rustc_middle-aware hooks
  // (`SPAN_TRACK`, `DEF_ID_DEBUG`, `TRACK_DIAGNOSTIC`, `TRACK_FEATURE`, `EMIT_BUG_DIAGNOSTIC`) that only
  // differ from the defaults while a `TyCtxt` is entered; rust-ts never creates one.

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

      // PORT: the next steps need the codegen backend's `TargetConfig` (LLVM), config/cfg.rs, the target
      // spec and rustc_lint, none of which is ported. They report nothing for the default
      // configuration; what they compute is deferred (reading it calls `unported`):
      //   let target_config = codegen_backend.target_config(&sess);
      //   sess.internal_target_features.extend(target_config.internal_target_features..);
      defer_field(sess, "internal_target_features", "rustc_codegen_ssa::TargetConfig::internal_target_features (Session::internal_target_features)");
      //   sess.config = parse_cfg(&sess, config.crate_cfg);
      //   util::add_configuration(&mut sess.config, &target_config, &sess.early_sess.target, ..);
      if (config.crate_cfg.length !== 0) {
        sess.config = parse_cfg(sess, config.crate_cfg);
      }
      defer_field(sess, "config", "rustc_session::config::build_configuration / rustc_interface::util::add_configuration (Session::config)");
      //   sess.check_config = parse_check_cfg(&sess, config.crate_check_cfg);
      if (config.crate_check_cfg.length !== 0) {
        sess.check_config = parse_check_cfg(sess, config.crate_check_cfg);
      }
      defer_field(sess, "check_config", "rustc_interface::interface::parse_check_cfg (Session::check_config)");

      // `psess_created` / `track_state` are `None` (driver).

      // Even though the session holds the lint store, we can't build the
      // lint store until after the session exists. And we wait until now
      // so that `register_lints` sees the fully initialized session.
      //   let mut lint_store = rustc_lint::new_lint_store(sess.enable_internal_lints());
      //   sess.lint_store = Some(Arc::new(lint_store));
      defer_field(sess, "lint_store", "rustc_lint::new_lint_store (Session::lint_store)");

      //   util::check_abi_required_features(&sess);  (target spec + internal_target_features)

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
}

/** `Option<NonZero<usize>>::max` (`None < Some(_)`). */
function max_opt(a: number | undefined, b: number | undefined): number | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return Math.max(a, b);
}

// `try_print_query_stack` (interface.rs:542): not ported (rustc_middle / rustc_query_impl).
