// Partial port of compiler/rustc_session/src/session.rs: `EarlySession`, `Session` (all fields), the
// session methods that need no unported crate, `build_early_session`/`build_session` (with stand-ins for
// rustc_target, the codegen backend, filesearch and the lint store), `EarlyDiagCtxt`, `mk_emitter`.
//
// PORT decisions:
// - `impl Deref/DerefMut for Session` (Target = EarlySession) -> getters `target`, `host`, `opts`, `psess`
//   on `Session` that read `early_sess`, plus the `EarlySession` methods re-declared on `Session` (they
//   forward to `early_sess`, as auto-deref would).
// - Fields computed by unported crates are deferred (`defer_field`, stand_ins.ts): reading one calls
//   `unported(..)` instead of seeing a made-up value. See `build_session`.
// - `Lock<T>`/`AppendOnlyVec<T>`/atomics are the inner values.
// - LOAD ORDER: options.ts is imported before config.ts (see config.ts header).
// LOAD ORDER (see config.ts header): a bare import is never elided by the transpiler.
import "./options.ts";
import type { PathBuf } from "../rustc_error_messages/lib.ts";
import { AnnotateSnippetEmitter } from "../rustc_errors/annotate_snippet_emitter_writer.ts";
import type { Diag } from "../rustc_errors/diagnostic.ts";
import { type DynEmitter, OutputTheme, stderr_destination } from "../rustc_errors/emitter.ts";
import { E0658 } from "../rustc_errors/error_codes.gen.ts";
import { DiagCtxt, type DiagCtxtHandle, type Diagnostic, type ErrCode, TerminalUrl } from "../rustc_errors/lib.ts";
import { TimingSectionHandler } from "../rustc_errors/timings.ts";
import { UnstableFeatures } from "../rustc_feature/lib.ts";
import type { Level, LintId } from "../rustc_lint_defs/lib.ts";
import { Edition } from "../rustc_span/edition.ts";
import type { ErrorGuaranteed, RealFileName, Span } from "../rustc_span/lib.ts";
import { type SourceMap, get_source_map } from "../rustc_span/source_map.ts";
import type { Symbol } from "../rustc_span/symbol.ts";
import { assert, unported, unwrap } from "../std/panic.ts";
import { dimensions } from "../vendor/termize/lib.ts";
import type { Options } from "./options.ts";
import {
  type Cfg,
  type CoverageOptions,
  type ErrorOutputType,
  Input,
  type LtoCli,
  type OutFileName,
  UnstableOptions_impl,
  host_tuple,
} from "./config.ts";
import * as diagnostics from "./diagnostics.ts";
import * as diagnostics_gen from "./diagnostics.gen.ts";
import { ParseSess } from "./parse.ts";
import {
  type CodeModel,
  CrateType,
  type MergeFunctions,
  type PanicStrategy,
  type RelocModel,
  SanitizerSet,
  type SearchPath,
  SelfProfilerRef,
  Target,
  TargetTuple,
  type TlsModel,
  defer_field,
} from "./stand_ins.ts";

/// The behavior of the CTFE engine when an error occurs with regards to backtraces.
// #[derive(Clone, Copy)]
export type CtfeBacktrace =
  /// Do nothing special, return the error as usual without a backtrace.
  | "Disabled"
  /// Capture a backtrace at the point the error is created and return it in the error
  /// (to be printed later if/when the error ever actually gets shown to the user).
  | "Capture"
  /// Capture a backtrace at the point the error is created and immediately print it out.
  | "Immediate";

// #[derive(Clone)]
export interface CompilerIO {
  input: Input;
  output_dir: PathBuf | undefined;
  output_file: OutFileName | undefined;
  temps_dir: PathBuf | undefined;
}

/** `dyn DynLintStore` (session.rs:83). PORT: opaque; rustc_lint is not ported. */
export interface DynLintStore {
  lint_groups_iter(): Iterable<LintGroup>;
}

/// Partial session built before the full session. More specifically, `EarlySession` is used to
/// init the codegen backend, and then both pieces are used to build the full `Session`.
export class EarlySession {
  constructor(
    public target: Target,
    public host: Target,
    public opts: Options,
    public psess: ParseSess,
  ) {}

  // #[inline]
  // rustc: compiler/rustc_session/src/session.rs:339 dcx
  dcx(): DiagCtxtHandle {
    return this.psess.dcx();
  }

  // #[inline]
  // rustc: compiler/rustc_session/src/session.rs:344 source_map
  source_map(): SourceMap {
    return this.psess.source_map();
  }

  /// Note: this is simpler than `Session::lto`, hence the `early_` prefix (to more clearly
  /// distinguish it).
  // rustc: compiler/rustc_session/src/session.rs:350 early_lto
  early_lto(): LtoCli {
    return this.opts.cg.lto;
  }

  // rustc: compiler/rustc_session/src/session.rs:354 print_llvm_stats
  print_llvm_stats(): boolean {
    return this.opts.unstable_opts.print_codegen_stats;
  }

  // rustc: compiler/rustc_session/src/session.rs:358 print_llvm_stats_json
  print_llvm_stats_json(): string | undefined {
    return this.opts.unstable_opts.print_codegen_stats_json;
  }

  // rustc: compiler/rustc_session/src/session.rs:362 relocation_model
  relocation_model(): RelocModel {
    return this.opts.cg.relocation_model ?? (this.target as unknown as { relocation_model: RelocModel }).relocation_model;
  }

  // rustc: compiler/rustc_session/src/session.rs:366 code_model
  code_model(): CodeModel | undefined {
    return this.opts.cg.code_model ?? (this.target as unknown as { code_model: CodeModel | undefined }).code_model;
  }

  // rustc: compiler/rustc_session/src/session.rs:370 tls_model
  tls_model(): TlsModel {
    return this.opts.unstable_opts.tls_model ?? (this.target as unknown as { tls_model: TlsModel }).tls_model;
  }

  /// Returns the panic strategy for this compile session. If the user explicitly selected one
  /// using '-C panic', use that, otherwise use the panic strategy defined by the target.
  // rustc: compiler/rustc_session/src/session.rs:376 panic_strategy
  panic_strategy(): PanicStrategy {
    return this.opts.cg.panic ?? (this.target as unknown as { panic_strategy: PanicStrategy }).panic_strategy;
  }

  /// Get the deployment target on Apple platforms based on the standard environment variables,
  /// or fall back to the minimum version supported by `rustc`.
  ///
  /// This should be guarded behind `if sess.target.is_like_darwin`.
  // not ported (no marker): compiler/rustc_session/src/session.rs:384 apple_deployment_target
  apple_deployment_target(): never {
    return unported("rustc_target::spec::apple::OSVersion (EarlySession::apple_deployment_target)");
  }

  // not ported (no marker): compiler/rustc_session/src/session.rs:420 sanitizers
  sanitizers(): SanitizerSet {
    // `self.opts.unstable_opts.sanitizer.combine_with_defaults(self.target.options.default_sanitizers)`
    return unported("rustc_structures::SanitizerSet::combine_with_defaults (EarlySession::sanitizers)");
  }

  // rustc: compiler/rustc_session/src/session.rs:427 merge_functions
  merge_functions(): MergeFunctions {
    return this.opts.unstable_opts.merge_functions ?? (this.target as unknown as { merge_functions: MergeFunctions }).merge_functions;
  }

  // rustc: compiler/rustc_session/src/session.rs:431 is_nightly_build
  is_nightly_build(): boolean {
    return UnstableFeatures.is_nightly_build(this.opts.unstable_features);
  }
}

/// Some info about the backend, returned by `CodegenBackend::init` and put into the `Session`.
// #[derive(Default)]
export interface CodegenBackendInit {
  /// See `Session::global_backend_features`.
  global_backend_features: string[];

  /// See `Session::replaced_intrinsics`.
  replaced_intrinsics: Symbol[];

  /// See `Session::fallback_intrinsics`.
  fallback_intrinsics: Symbol[];

  /// See `Session::thin_lto_supported`.
  thin_lto_supported: boolean;
}

/// Represents the data associated with a compilation
/// session for a single crate.
export class Session {
  constructor(
    /// The `EarlySession` is embedded so it can be passed to functions that need it.
    /// `Session::deref{_,mut}` exist so the fields within can be accessed as if they were direct
    /// fields of `Session`.
    public early_sess: EarlySession,
    public wasm_proc_macro_tuple: TargetTuple,
    public wasm_proc_macro_target: Target,
    public target_tlib_path: SearchPath,
    public unstable_features: UnstableFeatures,
    public config: Cfg,
    // PORT: `CheckCfg` (config/cfg.rs) is not ported.
    public check_config: unknown,
    /// Spans passed to `proc_macro::quote_span`. Each span has a numerical
    /// identifier represented by its position in the vector.
    private proc_macro_quoted_spans_: Span[],

    /// Input, input file path and output file path to this compilation process.
    public io: CompilerIO,

    /// Used by `-Z self-profile`.
    public prof: SelfProfilerRef,

    /// Used to emit section timings events (enabled by `--json=timings`).
    public timings: TimingSectionHandler,

    /// Data about code being compiled, gathered during compilation.
    // PORT: `CodeStats` (code_stats.rs) is not ported.
    public code_stats: unknown,

    /// This only ever stores a `LintStore` but we don't want a dependency on that type here.
    public lint_store: DynLintStore | undefined,

    /// Cap lint level specified by a driver specifically.
    public driver_lint_caps: Map<LintId, Level>,

    /// Tracks the current behavior of the CTFE engine when an error occurs.
    /// Options range from returning the error without a backtrace to returning an error
    /// and immediately printing the backtrace to stderr.
    /// The `Lock` is only used by miri to allow setting `ctfe_backtrace` after analysis when
    /// `MIRI_BACKTRACE` is set. This makes it only apply to miri's errors and not to all CTFE
    /// errors.
    public ctfe_backtrace: CtfeBacktrace,

    /// This tracks where `-Zunleash-the-miri-inside-of-you` was used to get around a
    /// const check, optionally with the relevant feature gate. We use this to
    /// warn about unleashing, but with a single diagnostic instead of dozens that
    /// drown everything else in noise.
    private miri_unleashed_features: [Span, Symbol | undefined][],

    /// Architecture to use for interpreting asm!.
    // PORT: `InlineAsmArch` (rustc_target::asm) is not ported.
    public asm_arch: unknown,

    /// Set of actually enabled features for the current target, including ones that are not
    /// in `cfg(target_feature)` because they are unstable or internal-only.
    /// This is used by the compiler itself when it needs to know which target features are actually
    /// going to be enabled in the backend (e.g. for knowing which registers inline asm can use).
    public internal_target_features: Set<Symbol>,

    /// The list of backend target features for this session. Not used by Rust itself because the
    /// concrete feature names can be backend-specific. This is computed from the target's base
    /// features, `-Ctarget-cpu`, `-Ctarget-feature`, and other flags that the current backend
    /// models as target features (but that are not considered target features in Rust).
    public global_backend_features: string[],

    /// The version of the rustc process, possibly including a commit hash and description.
    public cfg_version: string,

    /// The inner atomic value is set to true when a feature marked as `internal` is
    /// enabled. Makes it so that "please report a bug" is hidden, as ICEs with
    /// internal features are wontfix, and they are usually the cause of the ICEs.
    /// None signifies that this is not tracked.
    public using_internal_features: { value: boolean },

    /// Environment variables accessed during the build and their values when they exist.
    public env_depinfo: Set<string>,

    /// File paths accessed during the build.
    public file_depinfo: Set<Symbol>,

    // PORT: `FileSearch` (filesearch.rs) is not ported.
    private target_filesearch_: unknown,
    private host_filesearch_: unknown,
    private wasm_proc_macro_filesearch_: unknown,

    /// A list of all intrinsics that the current codegen backend definitely replaces with its own
    /// implementations, which means their fallback bodies do not need to be monomorphized.
    public replaced_intrinsics: Set<Symbol>,

    /// A list of all intrinsics that the current codegen backend definitely does *not* replace
    /// with its own implementations, which means their fallback bodies can be MIR-inlined.
    public fallback_intrinsics: Set<Symbol>,

    /// Does the codegen backend support ThinLTO?
    public thin_lto_supported: boolean,

    /// Global per-session counter for MIR optimization pass applications.
    ///
    /// Used by `-Zmir-opt-bisect-limit` to assign an index to each
    /// optimization-pass execution candidate during this compilation.
    public mir_opt_bisect_eval_count: number,

    /// Whether the test harness removed a user-written `#[rustc_main]` attribute
    /// while generating the synthetic test entry point.
    public removed_rustc_main_attr: boolean,

    /// Config specifying targets' pointer authentication preference.
    // PORT: `PointerAuthConfig` (this file, 146) is not ported.
    public pointer_auth_config: unknown,

    /// Cached sanitizer set. Cached because it is accessed frequently.
    private sanitizers_: SanitizerSet,
  ) {}

  // ---- impl Deref for Session (Target = EarlySession) ----

  get target(): Target {
    return this.early_sess.target;
  }
  get host(): Target {
    return this.early_sess.host;
  }
  get opts(): Options {
    return this.early_sess.opts;
  }
  set opts(opts: Options) {
    this.early_sess.opts = opts;
  }
  get psess(): ParseSess {
    return this.early_sess.psess;
  }
  /** `EarlySession::dcx` through `Deref`. */
  dcx(): DiagCtxtHandle {
    return this.early_sess.dcx();
  }
  /** `EarlySession::source_map` through `Deref`. */
  source_map(): SourceMap {
    return this.early_sess.source_map();
  }
  /** `EarlySession::panic_strategy` through `Deref`. */
  panic_strategy(): PanicStrategy {
    return this.early_sess.panic_strategy();
  }
  /** `EarlySession::code_model` through `Deref`. */
  code_model(): CodeModel | undefined {
    return this.early_sess.code_model();
  }

  // ---- impl Session (session.rs:604) ----

  // rustc: compiler/rustc_session/src/session.rs:605 miri_unleashed_feature
  miri_unleashed_feature(span: Span, feature_gate: Symbol | undefined): void {
    this.miri_unleashed_features.push([span, feature_gate]);
  }

  // rustc: compiler/rustc_session/src/session.rs:609 local_crate_source_file
  local_crate_source_file(): RealFileName | undefined {
    const path = Input.opt_path(this.io.input);
    if (path === undefined) return undefined;
    return this.source_map().path_mapping().to_real_filename(this.source_map().working_dir(), path);
  }

  // rustc: compiler/rustc_session/src/session.rs:617 check_miri_unleashed_features
  private check_miri_unleashed_features(): ErrorGuaranteed | undefined {
    let guar: ErrorGuaranteed | undefined;
    const unleashed_features = this.miri_unleashed_features;
    if (unleashed_features.length !== 0) {
      let must_err = false;
      // Create a diagnostic pointing at where things got unleashed.
      this.dcx().emit_warn(
        diagnostics_gen.SkippingConstChecks_diagnostic({
          unleashed_features: unleashed_features.map(([span, gate]): diagnostics_gen.UnleashedFeatureHelp => {
            if (gate !== undefined) {
              must_err = true;
              return { $: "Named", span, gate };
            }
            return { $: "Unnamed", span };
          }),
        }),
      );

      // If we should err, make sure we did.
      if (must_err && this.dcx().has_errors() === undefined) {
        // We have skipped a feature gate, and not run into other errors... reject.
        guar = this.dcx().emit_err(diagnostics_gen.NotCircumventFeature_diagnostic({}));
      }
    }
    return guar;
  }

  /// Invoked all the way at the end to finish off diagnostics printing.
  // rustc: compiler/rustc_session/src/session.rs:646 finish_diagnostics
  finish_diagnostics(): ErrorGuaranteed | undefined {
    let guar: ErrorGuaranteed | undefined;
    guar = guar ?? this.check_miri_unleashed_features();
    guar = guar ?? this.dcx().emit_stashed_diagnostics();
    this.dcx().print_error_count();
    if (this.opts.json_future_incompat) {
      this.dcx().emit_future_breakage_report();
    }
    return guar;
  }

  /// Returns true if the crate is a testing one.
  // rustc: compiler/rustc_session/src/session.rs:658 is_test_crate
  is_test_crate(): boolean {
    return this.opts.test;
  }

  /// `feature` must be a language feature.
  // #[track_caller]
  // rustc: compiler/rustc_session/src/session.rs:664 create_feature_err
  create_feature_err(err: Diagnostic, feature: Symbol): Diag {
    const e = this.dcx().create_err(err);
    if (e.deref().code === undefined) {
      e.code(E0658);
    }
    diagnostics.add_feature_diagnostics(e, this, feature);
    return e;
  }

  /// Record the fact that we called `trimmed_def_paths`, and do some
  /// checking about whether its cost was justified.
  // rustc: compiler/rustc_session/src/session.rs:675 record_trimmed_def_paths
  record_trimmed_def_paths(): void {
    if (
      this.opts.unstable_opts.print_type_sizes ||
      this.opts.unstable_opts.query_dep_graph ||
      this.opts.unstable_opts.dump_mir !== undefined ||
      this.opts.unstable_opts.unpretty !== undefined ||
      this.prof.is_args_recording_enabled() ||
      this.opts.output_types.contains_key("Mir") ||
      process.env.RUSTC_LOG !== undefined
    ) {
      return;
    }

    this.dcx().set_must_produce_diag();
  }

  // rustc: compiler/rustc_session/src/session.rs:690 proc_macro_quoted_spans
  proc_macro_quoted_spans(): [number, Span][] {
    // This is equivalent to `.iter().copied().enumerate()`, but that isn't possible for
    // AppendOnlyVec, so we resort to this scheme.
    return this.proc_macro_quoted_spans_.map((s, i): [number, Span] => [i, s]);
  }

  // rustc: compiler/rustc_session/src/session.rs:696 save_proc_macro_span
  save_proc_macro_span(span: Span): number {
    return this.proc_macro_quoted_spans_.push(span) - 1;
  }

  /// Returns `true` if internal lints should be added to the lint store - i.e. if
  /// `-Zunstable-options` is provided and this isn't rustdoc (internal lints can trigger errors
  /// to be emitted under rustdoc).
  // rustc: compiler/rustc_session/src/session.rs:703 enable_internal_lints
  enable_internal_lints(): boolean {
    return this.unstable_options() && !this.opts.actually_rustdoc;
  }

  // rustc: compiler/rustc_session/src/session.rs:707 instrument_coverage
  instrument_coverage(): boolean {
    return this.opts.cg.instrument_coverage_() !== "No";
  }

  // rustc: compiler/rustc_session/src/session.rs:724 coverage_options
  coverage_options(): CoverageOptions {
    return this.opts.unstable_opts.coverage_options;
  }

  // rustc: compiler/rustc_session/src/session.rs:728 is_sanitizer_cfi_enabled
  is_sanitizer_cfi_enabled(): boolean {
    return (this.sanitizers() & SanitizerSet.CFI) === SanitizerSet.CFI;
  }

  // rustc: compiler/rustc_session/src/session.rs:732 is_sanitizer_cfi_canonical_jump_tables_disabled
  is_sanitizer_cfi_canonical_jump_tables_disabled(): boolean {
    return this.opts.unstable_opts.sanitizer_cfi_canonical_jump_tables === false;
  }

  // rustc: compiler/rustc_session/src/session.rs:736 is_sanitizer_cfi_canonical_jump_tables_enabled
  is_sanitizer_cfi_canonical_jump_tables_enabled(): boolean {
    return this.opts.unstable_opts.sanitizer_cfi_canonical_jump_tables === true;
  }

  // rustc: compiler/rustc_session/src/session.rs:740 is_sanitizer_cfi_generalize_pointers_enabled
  is_sanitizer_cfi_generalize_pointers_enabled(): boolean {
    return this.opts.unstable_opts.sanitizer_cfi_generalize_pointers === true;
  }

  // rustc: compiler/rustc_session/src/session.rs:744 is_sanitizer_cfi_normalize_integers_enabled
  is_sanitizer_cfi_normalize_integers_enabled(): boolean {
    return this.opts.unstable_opts.sanitizer_cfi_normalize_integers === true;
  }

  // rustc: compiler/rustc_session/src/session.rs:748 is_sanitizer_cfi_recover_enabled
  is_sanitizer_cfi_recover_enabled(): boolean {
    return this.opts.unstable_opts.sanitizer_cfi_recover === true;
  }

  // rustc: compiler/rustc_session/src/session.rs:752 is_sanitizer_cfi_diag_enabled
  is_sanitizer_cfi_diag_enabled(): boolean {
    return this.opts.unstable_opts.sanitizer_cfi_diag === true;
  }

  // rustc: compiler/rustc_session/src/session.rs:756 is_sanitizer_cfi_minimal_runtime_enabled
  is_sanitizer_cfi_minimal_runtime_enabled(): boolean {
    return this.opts.unstable_opts.sanitizer_cfi_minimal_runtime === true;
  }

  // rustc: compiler/rustc_session/src/session.rs:760 is_sanitizer_kcfi_arity_enabled
  is_sanitizer_kcfi_arity_enabled(): boolean {
    return this.opts.unstable_opts.sanitizer_kcfi_arity === true;
  }

  // rustc: compiler/rustc_session/src/session.rs:764 is_sanitizer_kcfi_enabled
  is_sanitizer_kcfi_enabled(): boolean {
    return (this.sanitizers() & SanitizerSet.KCFI) === SanitizerSet.KCFI;
  }

  // rustc: compiler/rustc_session/src/session.rs:768 is_split_lto_unit_enabled
  is_split_lto_unit_enabled(): boolean {
    return this.opts.unstable_opts.split_lto_unit === true;
  }

  /// Check whether this compile session and crate type use static crt.
  // rustc: compiler/rustc_session/src/session.rs:773 crt_static
  crt_static(crate_type: CrateType | undefined): boolean {
    const target = this.target as unknown as { crt_static_respected: boolean; crt_static_default: boolean };
    if (!target.crt_static_respected) {
      // If the target does not opt in to crt-static support, use its default.
      return target.crt_static_default;
    }

    const requested_features = this.opts.cg.target_feature.split(",");
    const found_negative = requested_features.some((r) => r === "-crt-static");
    const found_positive = requested_features.some((r) => r === "+crt-static");

    // JUSTIFICATION: necessary use of crate_types directly (see FIXME below)
    // #[allow(rustc::bad_opt_access)]
    if (found_positive || found_negative) {
      return found_positive;
    } else if (crate_type === CrateType.ProcMacro || (crate_type === undefined && this.opts.crate_types.includes("ProcMacro"))) {
      // FIXME: When crate_type is not available,
      // we use compiler options to determine the crate_type.
      // We can't check `#![crate_type = "proc-macro"]` here.
      return false;
    } else {
      return target.crt_static_default;
    }
  }

  /// Is this edition 2015?
  // rustc: compiler/rustc_session/src/session.rs:843 is_rust_2015
  is_rust_2015(): boolean {
    return Edition.is_rust_2015(this.edition());
  }

  /// Are we allowed to use features from the Rust 2018 edition?
  // rustc: compiler/rustc_session/src/session.rs:848 at_least_rust_2018
  at_least_rust_2018(): boolean {
    return Edition.at_least_rust_2018(this.edition());
  }

  /// Are we allowed to use features from the Rust 2021 edition?
  // rustc: compiler/rustc_session/src/session.rs:853 at_least_rust_2021
  at_least_rust_2021(): boolean {
    return Edition.at_least_rust_2021(this.edition());
  }

  /// Are we allowed to use features from the Rust 2024 edition?
  // rustc: compiler/rustc_session/src/session.rs:858 at_least_rust_2024
  at_least_rust_2024(): boolean {
    return Edition.at_least_rust_2024(this.edition());
  }

  // rustc: compiler/rustc_session/src/session.rs:896 diagnostic_width
  diagnostic_width(): number {
    const default_column_width = 140;
    const width = this.opts.diagnostic_width;
    if (width !== undefined) {
      return width;
    } else if (this.opts.unstable_opts.ui_testing) {
      return default_column_width;
    } else {
      const d = dimensions();
      return d === undefined ? default_column_width : d[0];
    }
  }

  // rustc: compiler/rustc_session/src/session.rs:924 lint_groups_iter
  lint_groups_iter(): Iterable<LintGroup> {
    const lint_store = this.lint_store;
    if (lint_store !== undefined) {
      return lint_store.lint_groups_iter();
    } else {
      return [];
    }
  }

  // ---- impl Session (session.rs:969) ----

  // rustc: compiler/rustc_session/src/session.rs:970 verbose_internals
  verbose_internals(): boolean {
    return this.opts.unstable_opts.verbose_internals;
  }

  // rustc: compiler/rustc_session/src/session.rs:974 verify_llvm_ir
  verify_llvm_ir(): boolean {
    return this.opts.unstable_opts.verify_llvm_ir || process.env.RUSTC_VERIFY_LLVM_IR !== undefined;
  }

  // rustc: compiler/rustc_session/src/session.rs:978 binary_dep_depinfo
  binary_dep_depinfo(): boolean {
    return this.opts.unstable_opts.binary_dep_depinfo;
  }

  // rustc: compiler/rustc_session/src/session.rs:982 mir_opt_level
  mir_opt_level(): number {
    return this.opts.unstable_opts.mir_opt_level ?? (this.opts.optimize !== "No" ? 2 : 1);
  }

  // rustc: compiler/rustc_session/src/session.rs:1072 unstable_options
  unstable_options(): boolean {
    return this.opts.unstable_opts.unstable_options;
  }

  // rustc: compiler/rustc_session/src/session.rs:1076 is_nightly_build
  is_nightly_build(): boolean {
    return UnstableFeatures.is_nightly_build(this.opts.unstable_features);
  }

  // rustc: compiler/rustc_session/src/session.rs:1251 teach
  teach(code: ErrCode): boolean {
    return this.opts.unstable_opts.teach && this.dcx().must_teach(code);
  }

  // rustc: compiler/rustc_session/src/session.rs:1255 edition
  edition(): Edition {
    return this.opts.edition;
  }

  // rustc: compiler/rustc_session/src/session.rs:1259 link_dead_code
  link_dead_code(): boolean {
    return this.opts.cg.link_dead_code ?? false;
  }

  // rustc: compiler/rustc_session/src/session.rs:1263 sanitizers
  sanitizers(): SanitizerSet {
    return this.sanitizers_;
  }
}

// #[derive(Clone, Copy)]
export type CodegenUnits =
  /// Specified by the user. In this case we try fairly hard to produce the
  /// number of CGUs requested.
  | { readonly $: "User"; readonly _0: number }
  /// A default value, i.e. not specified by the user. In this case we take
  /// more liberties about CGU formation, e.g. avoid producing very small
  /// CGUs.
  | { readonly $: "Default"; readonly _0: number };
export const CodegenUnits = {
  // rustc: compiler/rustc_session/src/session.rs:590 as_usize
  as_usize(self: CodegenUnits): number {
    switch (self.$) {
      case "User":
        return self._0;
      case "Default":
        return self._0;
    }
  },
} as const;

export interface LintGroup {
  name: string;
  lints: LintId[];
  is_externally_loaded: boolean;
}

// JUSTIFICATION: part of session construction
// #[allow(rustc::bad_opt_access)]
// rustc: compiler/rustc_session/src/session.rs:1282 default_emitter
function default_emitter(sopts: Options, source_map: SourceMap): DynEmitter {
  const macro_backtrace = sopts.unstable_opts.macro_backtrace;
  const track_diagnostics = sopts.unstable_opts.track_diagnostics;
  let terminal_url: TerminalUrl;
  if (sopts.unstable_opts.terminal_urls === "Auto") {
    if (
      process.env.COLORTERM === "truecolor" &&
      process.env.TERM === "xterm-256color" &&
      UnstableFeatures.is_nightly_build(sopts.unstable_features)
    ) {
      terminal_url = "Yes";
    } else {
      terminal_url = "No";
    }
  } else {
    terminal_url = sopts.unstable_opts.terminal_urls;
  }

  const sm = sopts.unstable_opts.link_only ? undefined : source_map;

  const error_format = sopts.error_format;
  switch (error_format.$) {
    case "HumanReadable": {
      const { short, unicode } = error_format.kind;
      let emitter = AnnotateSnippetEmitter.new(stderr_destination(error_format.color_config));
      emitter = AnnotateSnippetEmitter.sm(emitter, sm);
      emitter = AnnotateSnippetEmitter.short_message(emitter, short);
      emitter = AnnotateSnippetEmitter.diagnostic_width(emitter, sopts.diagnostic_width);
      emitter = AnnotateSnippetEmitter.macro_backtrace(emitter, macro_backtrace);
      emitter = AnnotateSnippetEmitter.track_diagnostics(emitter, track_diagnostics);
      emitter = AnnotateSnippetEmitter.terminal_url(emitter, terminal_url);
      emitter = AnnotateSnippetEmitter.theme(emitter, unicode ? OutputTheme.Unicode : OutputTheme.Ascii);
      emitter = AnnotateSnippetEmitter.ignored_directories_in_source_blocks(emitter, [
        ...sopts.unstable_opts.ignore_directory_in_diagnostics_source_blocks,
      ]);
      return AnnotateSnippetEmitter.ui_testing(emitter, sopts.unstable_opts.ui_testing);
    }
    case "Json":
      return unported("rustc_errors::json::JsonEmitter (--error-format=json)");
  }
}

// JUSTIFICATION: literally session construction
// #[allow(rustc::bad_opt_access)]
// rustc: compiler/rustc_session/src/session.rs:1340 build_early_session
export function build_early_session(sopts: Options, target: Target, ice_file: PathBuf | undefined): EarlySession {
  // FIXME: This is not general enough to make the warning lint completely override
  // normal diagnostic warnings, since the warning lint can also be denied and changed
  // later via the source code.
  const last = sopts.lint_opts.findLast(([key, _]) => key === "warnings");
  const warnings_allow = last !== undefined && last[1] === "Allow";
  const cap_lints_allow = sopts.lint_cap !== undefined && sopts.lint_cap === "Allow";
  const can_emit_warnings = !(warnings_allow || cap_lints_allow);

  const source_map = unwrap(get_source_map());
  const emitter = default_emitter(sopts, source_map);

  let dcx = DiagCtxt.new(emitter).with_flags(UnstableOptions_impl.dcx_flags(sopts.unstable_opts, can_emit_warnings));
  if (ice_file !== undefined) {
    dcx = dcx.with_ice_file(ice_file);
  }

  const msrv = sopts.unstable_opts.hint_msrv;
  if (msrv !== undefined) {
    dcx = dcx.with_msrv(msrv);
  }

  const host_triple = TargetTuple.from_tuple(host_tuple());
  const r = Target.search(host_triple, sopts.sysroot.path(), sopts.unstable_opts.unstable_options);
  const [host, target_warnings] = r.$ === "Ok" ? r._0 : dcx.handle().fatal(`Error loading host specification: ${r._0}`);
  for (const warning of target_warnings.warning_messages()) {
    dcx.handle().warn(warning);
  }

  const psess = ParseSess.with_dcx(dcx, source_map);

  return new EarlySession(target, host, sopts, psess);
}

// JUSTIFICATION: literally session construction
// #[allow(rustc::bad_opt_access)]
// rustc: compiler/rustc_session/src/session.rs:1386 build_session
export function build_session(
  early_sess: EarlySession,
  codegen_backend_init: CodegenBackendInit,
  io: CompilerIO,
  driver_lint_caps: Map<LintId, Level>,
  cfg_version: string,
  using_internal_features: { value: boolean },
): Session {
  const { target: _target, host: _host, opts: sopts, psess } = early_sess;
  const dcx = psess.dcx();

  const wasm_proc_macro_tuple = TargetTuple.from_tuple("wasm32-wasip2");
  const wr = Target.search(wasm_proc_macro_tuple, sopts.sysroot.path(), sopts.unstable_opts.unstable_options);
  const [wasm_proc_macro_target, target_warnings] =
    wr.$ === "Ok" ? wr._0 : dcx.fatal(`Error loading wasm proc-macro target specification: ${wr._0}`);
  for (const warning of target_warnings.warning_messages()) {
    dcx.warn(warning);
  }

  let self_profiler: undefined;
  if (sopts.unstable_opts.self_profile.$ === "Enabled") {
    // `SelfProfiler::new(directory, crate_name, self_profile_events, self_profile_counter)`
    return unported("rustc_data_structures::profiling::SelfProfiler::new (-Z self-profile)");
  } else {
    self_profiler = undefined;
  }

  // `host_tlib_path`/`target_tlib_path`/`wasm_proc_macro_tlib_path`:
  // `SearchPath::from_sysroot_and_triple(sopts.sysroot.path(), ..)` (search_paths.rs, deferred below).

  const prof = SelfProfilerRef.new(
    self_profiler,
    sopts.unstable_opts.time_passes ? sopts.unstable_opts.time_passes_format : undefined,
  );

  const val = process.env.RUSTC_CTFE_BACKTRACE;
  const ctfe_backtrace: CtfeBacktrace = val === "immediate" ? "Immediate" : val !== undefined && val !== "0" ? "Capture" : "Disabled";

  const timings = TimingSectionHandler.new(sopts.json_timings);

  const sess = new Session(
    early_sess,
    wasm_proc_macro_tuple,
    wasm_proc_macro_target,
    /* target_tlib_path */ undefined as unknown as SearchPath,
    // PORT: upstream at the pin: `UnstableFeatures::from_environment(None)` (not `opts.unstable_features`,
    // which uses `--crate-name`).
    UnstableFeatures.from_environment(undefined),
    /* config */ new Set(),
    /* check_config */ undefined,
    /* proc_macro_quoted_spans */ [],
    io,
    prof,
    timings,
    /* code_stats */ undefined,
    /* lint_store */ undefined,
    driver_lint_caps,
    ctfe_backtrace,
    /* miri_unleashed_features */ [],
    /* asm_arch */ undefined,
    /* internal_target_features */ new Set(),
    /* global_backend_features */ [],
    cfg_version,
    using_internal_features,
    /* env_depinfo */ new Set(),
    /* file_depinfo */ new Set(),
    /* target_filesearch */ undefined,
    /* host_filesearch */ undefined,
    /* wasm_proc_macro_filesearch */ undefined,
    /* replaced_intrinsics */ new Set(),
    /* fallback_intrinsics */ new Set(),
    /* thin_lto_supported */ false,
    /* mir_opt_bisect_eval_count */ 0,
    /* removed_rustc_main_attr */ false,
    /* pointer_auth_config */ undefined,
    /* sanitizers */ 0,
  );

  // PORT: fields whose upstream value comes from crates that are not ported are deferred: reading
  // one calls `unported` (stand_ins.ts `defer_field`). Upstream computes, in order:
  // - `target_tlib_path`: `SearchPath::from_sysroot_and_triple(sysroot, target_triple)` (search_paths.rs)
  // - `asm_arch`: `if target.allow_asm { InlineAsmArch::from_arch(&target.arch) }` (rustc_target::asm)
  // - `target_filesearch`/`host_filesearch`/`wasm_proc_macro_filesearch`: `FileSearch::new(..)` (filesearch.rs)
  // - `pointer_auth_config`: `PointerAuthConfig::from_raw(&pointer_authentication, &target)` (rustc_target)
  // - `sanitizers`: `early_sess.sanitizers()` (target default sanitizers)
  // - `global_backend_features`, `replaced_intrinsics`, `fallback_intrinsics`, `thin_lto_supported`:
  //   destructured from `codegen_backend_init` (the codegen backend stand-in defers them too)
  // - `code_stats` (code_stats.rs)
  // `config`/`check_config`/`lint_store`/`internal_target_features` start empty as upstream; the
  // driver (rustc_interface::interface::run_compiler) fills or defers them.
  defer_field(sess, "target_tlib_path", "rustc_session::search_paths::SearchPath::from_sysroot_and_triple");
  defer_field(sess, "asm_arch", "rustc_target::asm::InlineAsmArch::from_arch (Session::asm_arch)");
  defer_field(sess, "target_filesearch_" as keyof Session & string, "rustc_session::filesearch::FileSearch::new");
  defer_field(sess, "host_filesearch_" as keyof Session & string, "rustc_session::filesearch::FileSearch::new");
  defer_field(sess, "wasm_proc_macro_filesearch_" as keyof Session & string, "rustc_session::filesearch::FileSearch::new");
  defer_field(sess, "pointer_auth_config", "rustc_session::session::PointerAuthConfig::from_raw (rustc_target)");
  defer_field(sess, "sanitizers_" as keyof Session & string, "rustc_session::session::EarlySession::sanitizers (rustc_target)");
  defer_field(sess, "code_stats", "rustc_session::code_stats::CodeStats");
  for (const key of ["global_backend_features", "replaced_intrinsics", "fallback_intrinsics", "thin_lto_supported"] as const) {
    const desc = Object.getOwnPropertyDescriptor(codegen_backend_init, key);
    if (desc?.get !== undefined) {
      defer_field(sess, key, `rustc_codegen_ssa::traits::CodegenBackend::init (Session::${key})`);
    } else {
      (sess as unknown as Record<string, unknown>)[key] =
        key === "replaced_intrinsics" || key === "fallback_intrinsics"
          ? new Set(codegen_backend_init[key])
          : codegen_backend_init[key];
    }
  }

  validate_commandline_args_with_session_available(sess);

  return sess;
}

/// Validate command line arguments with a `Session`.
///
/// If it is useful to have a Session available already for validating a commandline argument, you
/// can do so here.
// JUSTIFICATION: needs to access args to validate them
// #[allow(rustc::bad_opt_access)]
// rustc-unported (no marker): compiler/rustc_session/src/session.rs:1545 validate_commandline_args_with_session_available
function validate_commandline_args_with_session_available(_sess: Session): void {
  // PORT: every check here reads the target spec (`sess.target.*`, `sess.crt_static`, `sess.lto()`,
  // `sess.split_debuginfo()`, ...) or the codegen backend. rustc_target is not ported, so the checks are
  // not run: a flag combination that upstream rejects for the target is accepted here. Root: port this
  // fn with rustc_target. The `-Zunpretty=ast-tree` driver path passes no flag these checks read beyond
  // their defaults, for which upstream emits nothing on the built-in host targets.
}

/// A wrapper around an [`DiagCtxt`] that is used for early error emissions.
export class EarlyDiagCtxt {
  constructor(public dcx: DiagCtxt) {}

  // rustc: compiler/rustc_session/src/session.rs:1878 new
  static new(output: ErrorOutputType): EarlyDiagCtxt {
    const emitter = mk_emitter(output);
    return new EarlyDiagCtxt(DiagCtxt.new(emitter));
  }

  /// Swap out the underlying dcx once we acquire the user's preference on error emission
  /// format. If `early_err` was previously called this will panic.
  // rustc: compiler/rustc_session/src/session.rs:1885 set_error_format
  set_error_format(output: ErrorOutputType): void {
    assert(this.dcx.handle().has_errors() === undefined, "assertion failed: self.dcx.handle().has_errors().is_none()");

    const emitter = mk_emitter(output);
    // PORT: assigning drops the old `DiagCtxt` (its `DiagCtxtInner::drop` runs).
    const old = this.dcx;
    this.dcx = DiagCtxt.new(emitter);
    old.inner.drop();
  }

  // #[must_use = "raise_fatal must be called on the returned ErrorGuaranteed in order to exit with a non-zero status code"]
  // rustc: compiler/rustc_session/src/session.rs:1893 early_err
  early_err(msg: string): ErrorGuaranteed {
    return this.dcx.handle().err(msg);
  }

  // rustc: compiler/rustc_session/src/session.rs:1897 early_fatal
  early_fatal(msg: string): never {
    return this.dcx.handle().fatal(msg);
  }

  // rustc: compiler/rustc_session/src/session.rs:1901 early_struct_fatal
  early_struct_fatal(msg: string): Diag {
    return this.dcx.handle().struct_fatal(msg);
  }

  // rustc: compiler/rustc_session/src/session.rs:1905 early_warn
  early_warn(msg: string): void {
    this.dcx.handle().warn(msg);
  }

  // rustc: compiler/rustc_session/src/session.rs:1909 early_struct_warn
  early_struct_warn(msg: string): Diag {
    return this.dcx.handle().struct_warn(msg);
  }
}

// rustc: compiler/rustc_session/src/session.rs:1914 mk_emitter
function mk_emitter(output: ErrorOutputType): DynEmitter {
  let emitter: DynEmitter;
  switch (output.$) {
    case "HumanReadable": {
      const { short, unicode } = output.kind;
      let e = AnnotateSnippetEmitter.new(stderr_destination(output.color_config));
      e = AnnotateSnippetEmitter.theme(e, unicode ? OutputTheme.Unicode : OutputTheme.Ascii);
      emitter = AnnotateSnippetEmitter.short_message(e, short);
      break;
    }
    case "Json":
      emitter = unported("rustc_errors::json::JsonEmitter (--error-format=json)");
  }
  return emitter;
}

