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
import { JsonEmitter } from "../rustc_errors/json.ts";
import { E0658 } from "../rustc_errors/error_codes.gen.ts";
import { DiagCtxt, type DiagCtxtHandle, type Diagnostic, type ErrCode, TerminalUrl } from "../rustc_errors/lib.ts";
import { TimingSectionHandler } from "../rustc_errors/timings.ts";
import { UnstableFeatures } from "../rustc_feature/lib.ts";
import type { Level, LintId } from "../rustc_lint_defs/lib.ts";
import { Edition } from "../rustc_span/edition.ts";
import type { ErrorGuaranteed, RealFileName, Span } from "../rustc_span/lib.ts";
import { FileName, Span as SpanC } from "../rustc_span/lib.ts";
import { path_components, path_is_absolute, path_join, path_parent } from "../std/path.ts";
import { Err, Ok, type Result } from "../std/result.ts";
import { FilePathMapping, SourceMap, get_source_map } from "../rustc_span/source_map.ts";
import type { Symbol } from "../rustc_span/symbol.ts";
import { assert, unported, unwrap } from "../std/panic.ts";
import { stderr } from "../vendor/anstream/stream.ts";
import { dimensions } from "../vendor/termize/lib.ts";
import type { Options } from "./options.ts";
import {
  FunctionReturn,
  LinkerPluginLto,
  type Lto,
  NATIVE_CPU,
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
  PanicStrategy,
  type SplitDebuginfo,
  LinkerFlavorCli,
  type RelocModel,
  SanitizerSet,
  SelfProfilerRef,
  Target,
  TargetTuple,
  type TlsModel,
  defer_field,
} from "./stand_ins.ts";
import { FileSearch } from "./filesearch.ts";
import { existsSync } from "node:fs";
import { asm as target_asm, spec as target_spec } from "../rustc_target/lib.ts";
const LinkerFlavor = target_spec.LinkerFlavor;
import { Cfg, CheckCfg } from "./config/cfg.ts";
import { SearchPath } from "./search_paths.ts";

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

  // rustc: compiler/rustc_session/src/session.rs:420 sanitizers
  sanitizers(): SanitizerSet {
    return SanitizerSet.combine_with_defaults(this.opts.unstable_opts.sanitizer, this.target.options.default_sanitizers);
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
    public check_config: CheckCfg,
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
    public asm_arch: target_asm.InlineAsmArch | undefined,

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

    private target_filesearch_: FileSearch,
    private host_filesearch_: FileSearch,
    private wasm_proc_macro_filesearch_: FileSearch | undefined,

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
  // rustc: compiler/rustc_session/src/session.rs:812 target_filesearch
  target_filesearch(): FileSearch {
    return this.target_filesearch_;
  }
  // rustc: compiler/rustc_session/src/session.rs:815 host_filesearch
  host_filesearch(): FileSearch {
    return this.host_filesearch_;
  }
  // rustc: compiler/rustc_session/src/session.rs:818 wasm_proc_macro_filesearch
  wasm_proc_macro_filesearch(): FileSearch {
    return unwrap(this.wasm_proc_macro_filesearch_, "wasm_filesearch not set");
  }

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

  // rustc: compiler/rustc_session/src/session.rs:916 staticlib_components
  staticlib_components(verbatim: boolean): [string, string] {
    if (verbatim) {
      return ["", ""];
    } else {
      return [this.target.staticlib_prefix, this.target.staticlib_suffix];
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

  /// Resolves a `path` mentioned inside Rust code, returning an absolute path.
  ///
  /// This unifies the logic used for resolving `include_*!` and debugger visualizers.
  // rustc: compiler/rustc_session/src/session.rs:934 resolve_path
  resolve_path(path: PathBuf, span: Span): Result<PathBuf, Diag> {
    // Relative paths are resolved relative to the file in which they are found
    // after macro expansion (that is, they are unhygienic).
    if (!path_is_absolute(path)) {
      const callsite = SpanC.source_callsite(span);
      const source_map = this.source_map();
      let base_path = FileName.into_local_path(source_map.span_to_filename(callsite));
      if (base_path === undefined) {
        return Err(
          this.dcx().create_err(
            diagnostics_gen.ResolveRelativePath_diagnostic({
              span,
              path: source_map.filename_for_diagnostics(source_map.span_to_filename(callsite)).to_string(),
            }),
          ),
        );
      }
      // `base_path.pop()`: truncate to the parent, if any.
      base_path = path_parent(base_path) ?? base_path;
      base_path = path_join(base_path, path);
      return Ok(base_path);
    } else {
      // This ensures that Windows verbatim paths are fixed if mixed path separators are used,
      // which can happen when `concat!` is used to join paths.
      const first = path_components(path).next();
      if (first !== undefined && first.$ === "Prefix" && (first.parsed.$ === "Verbatim" || first.parsed.$ === "VerbatimDisk" || first.parsed.$ === "VerbatimUNC")) {
        // `Ok(path.components().collect())`
        return unported("std::path::PathBuf::from_iter (Session::resolve_path, Windows verbatim path)");
      }
      return Ok(path);
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

  /// Calculates the flavor of LTO to use for this compilation.
  // rustc: compiler/rustc_session/src/session.rs:987 lto
  lto(): Lto {
    // If our target has codegen requirements ignore the command line
    if (this.target.requires_lto) {
      return "Fat";
    }

    // If the user specified something, return that. If they only said `-C
    // lto` and we've for whatever reason forced off ThinLTO via the CLI,
    // then ensure we can't use a ThinLTO.
    switch (this.opts.cg.lto) {
      case "Unspecified":
        // The compiler was invoked without the `-Clto` flag. Fall
        // through to the default handling
        break;
      case "No":
        // The user explicitly opted out of any kind of LTO
        return "No";
      case "Yes":
      case "Fat":
      case "NoParam":
        // All of these mean fat LTO
        return "Fat";
      case "Thin":
        // The user explicitly asked for ThinLTO
        if (!this.thin_lto_supported) {
          // Backend doesn't support ThinLTO, fallback to fat LTO.
          this.dcx().emit_warn(diagnostics_gen.ThinLtoNotSupportedByBackend_diagnostic({}));
          return "Fat";
        }
        return "Thin";
    }

    if (!this.thin_lto_supported) {
      return "No";
    }

    // Ok at this point the target doesn't require anything and the user
    // hasn't asked for anything. Our next decision is whether or not
    // we enable "auto" ThinLTO where we use multiple codegen units and
    // then do ThinLTO over those codegen units. The logic below will
    // either return `No` or `ThinLocal`.

    // If processing command line options determined that we're incompatible
    // with ThinLTO (e.g., `-C lto --emit llvm-ir`) then return that option.
    if (this.opts.cli_forced_local_thinlto_off) {
      return "No";
    }

    // If `-Z thinlto` specified process that, but note that this is mostly
    // a deprecated option now that `-C lto=thin` exists.
    const enabled = this.opts.unstable_opts.thinlto;
    if (enabled !== undefined) {
      if (enabled) {
        return "ThinLocal";
      } else {
        return "No";
      }
    }

    // If there's only one codegen unit and LTO isn't enabled then there's
    // no need for ThinLTO so just return false.
    if (CodegenUnits.as_usize(this.codegen_units()) === 1) {
      return "No";
    }

    // Now we're in "defaults" territory. By default we enable ThinLTO for
    // optimized compiles (anything greater than O0).
    switch (this.opts.optimize) {
      case "No":
        return "No";
      default:
        return "ThinLocal";
    }
  }

  // rustc: compiler/rustc_session/src/session.rs:1072 unstable_options
  unstable_options(): boolean {
    return this.opts.unstable_opts.unstable_options;
  }

  // rustc: compiler/rustc_session/src/session.rs:1076 is_nightly_build
  is_nightly_build(): boolean {
    return UnstableFeatures.is_nightly_build(this.opts.unstable_features);
  }

  // rustc: compiler/rustc_session/src/session.rs:1080 overflow_checks
  overflow_checks(): boolean {
    return this.opts.cg.overflow_checks ?? this.opts.debug_assertions;
  }

  // rustc: compiler/rustc_session/src/session.rs:1084 ub_checks
  ub_checks(): boolean {
    return this.opts.unstable_opts.ub_checks ?? this.opts.debug_assertions;
  }

  // rustc: compiler/rustc_session/src/session.rs:1088 contract_checks
  contract_checks(): boolean {
    return this.opts.unstable_opts.contract_checks ?? false;
  }

  // rustc: compiler/rustc_session/src/session.rs:1099 split_debuginfo
  split_debuginfo(): SplitDebuginfo {
    return this.opts.cg.split_debuginfo ?? this.target.split_debuginfo;
  }

  /// Returns the DWARF version passed on the CLI or the default for the target.
  // rustc: compiler/rustc_session/src/session.rs:1104 dwarf_version
  dwarf_version(): number {
    return this.opts.cg.dwarf_version ?? this.opts.unstable_opts.dwarf_version ?? this.target.default_dwarf_version;
  }

  // rustc: compiler/rustc_session/src/session.rs:1112 stack_protector
  stack_protector(): target_spec.StackProtector {
    if (this.target.options.supports_stack_protector) {
      return this.opts.unstable_opts.stack_protector;
    } else {
      return "None";
    }
  }

  /// Returns the number of codegen units that should be used for this
  /// compilation
  // rustc: compiler/rustc_session/src/session.rs:1183 codegen_units
  codegen_units(): CodegenUnits {
    const n = this.opts.cli_forced_codegen_units;
    if (n !== undefined) {
      return { $: "User", _0: n };
    }
    const d = this.target.default_codegen_units;
    if (d !== undefined) {
      return { $: "Default", _0: d };
    }

    // If incremental compilation is turned on, we default to a high number
    // codegen units in order to reduce the "collateral damage" small
    // changes cause.
    if (this.opts.incremental !== undefined) {
      return { $: "Default", _0: 256 };
    }

    // Why is 16 codegen units the default all the time?
    //
    // The main reason for enabling multiple codegen units by default is to
    // leverage the ability for the codegen backend to do codegen and
    // optimization in parallel. This allows us, especially for large crates, to
    // make good use of all available resources on the machine once we've
    // hit that stage of compilation. Large crates especially then often
    // take a long time in codegen/optimization and this helps us amortize that
    // cost.
    //
    // Note that a high number here doesn't mean that we'll be spawning a
    // large number of threads in parallel. The backend of rustc contains
    // global rate limiting through the `jobserver` crate so we'll never
    // overload the system with too much work, but rather we'll only be
    // optimizing when we're otherwise cooperating with other instances of
    // rustc.
    //
    // Rather a high number here means that we should be able to keep a lot
    // of idle cpus busy. By ensuring that no codegen unit takes *too* long
    // to build we'll be guaranteed that all cpus will finish pretty closely
    // to one another and we should make relatively optimal use of system
    // resources
    //
    // Note that the main cost of codegen units is that it prevents LLVM
    // from inlining across codegen units. Users in general don't have a lot
    // of control over how codegen units are split up so it's our job in the
    // compiler to ensure that undue performance isn't lost when using
    // codegen units (aka we can't require everyone to slap `#[inline]` on
    // everything).
    //
    // If we're compiling at `-O0` then the number doesn't really matter too
    // much because performance doesn't matter and inlining is ok to lose.
    // In debug mode we just want to try to guarantee that no cpu is stuck
    // doing work that could otherwise be farmed to others.
    //
    // In release mode, however (O1 and above) performance does indeed
    // matter! To recover the loss in performance due to inlining we'll be
    // enabling ThinLTO by default (the function for which is just below).
    // This will ensure that we recover any inlining wins we otherwise lost
    // through codegen unit partitioning.
    //
    // ---
    //
    // Ok that's a lot of words but the basic tl;dr; is that we want a high
    // number here -- but not too high. Additionally we're "safe" to have it
    // always at the same number at all optimization levels.
    //
    // As a result 16 was chosen here! Mostly because it was a power of 2
    // and most benchmarks agreed it was roughly a local optimum. Not very
    // scientific.
    return { $: "Default", _0: 16 };
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
    case "Json": {
      const { pretty, json_rendered, color_config } = error_format;
      // PORT: `Box::new(io::BufWriter::new(io::stderr()))`: `JsonEmitter::emit` writes each value with one
      // `write_all` and flushes right after, so the unbuffered `Stderr` writes the same bytes.
      let emitter = JsonEmitter.new(stderr(), sm, pretty, json_rendered, color_config);
      emitter = JsonEmitter.ui_testing(emitter, sopts.unstable_opts.ui_testing);
      emitter = JsonEmitter.ignored_directories_in_source_blocks(emitter, [
        ...sopts.unstable_opts.ignore_directory_in_diagnostics_source_blocks,
      ]);
      emitter = JsonEmitter.diagnostic_width(emitter, sopts.diagnostic_width);
      emitter = JsonEmitter.macro_backtrace(emitter, macro_backtrace);
      emitter = JsonEmitter.track_diagnostics(emitter, track_diagnostics);
      return JsonEmitter.terminal_url(emitter, terminal_url);
    }
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

  const host_triple = host_tuple();
  const target_triple = TargetTuple.tuple(sopts.target_triple);
  // FIXME use host sysroot?
  const host_tlib_path = SearchPath.from_sysroot_and_triple(sopts.sysroot.path(), host_triple);
  const target_tlib_path = SearchPath.from_sysroot_and_triple(sopts.sysroot.path(), target_triple);
  const wasm_proc_macro_tlib_path = SearchPath.from_sysroot_and_triple(sopts.sysroot.path(), TargetTuple.tuple(wasm_proc_macro_tuple));

  const prof = SelfProfilerRef.new(
    self_profiler,
    sopts.unstable_opts.time_passes ? sopts.unstable_opts.time_passes_format : undefined,
  );

  const val = process.env.RUSTC_CTFE_BACKTRACE;
  const ctfe_backtrace: CtfeBacktrace = val === "immediate" ? "Immediate" : val !== undefined && val !== "0" ? "Capture" : "Disabled";

  const asm_arch = early_sess.target.allow_asm ? target_asm.InlineAsmArch.from_arch(early_sess.target.arch) : undefined;
  const target_filesearch = FileSearch.new(sopts.search_paths, target_tlib_path, early_sess.target, sopts.unstable_opts.implicit_sysroot_deps);
  const host_filesearch = early_sess.target.eq(early_sess.host)
    ? target_filesearch
    : FileSearch.new(sopts.search_paths, host_tlib_path, early_sess.host, sopts.unstable_opts.implicit_sysroot_deps);
  const wasm_proc_macro_filesearch = sopts.unstable_opts.wasm_proc_macros
    ? FileSearch.new(sopts.search_paths, wasm_proc_macro_tlib_path, wasm_proc_macro_target, sopts.unstable_opts.implicit_sysroot_deps)
    : undefined;

  const timings = TimingSectionHandler.new(sopts.json_timings);

  // `PointerAuthConfig::from_raw(&sopts.unstable_opts.pointer_authentication, &target)`
  // PORT: `from_raw` returns `None` unless the target's `cfg_abi` is `Pauthtest` (session.rs:232); the
  // config itself (`PointerAuthConfig`/`PointerAuthSchema`) is not ported.
  const pointer_auth_config: undefined =
    early_sess.target.cfg_abi.$ !== "Pauthtest" ? undefined : unported("rustc_session::session::PointerAuthConfig::from_raw (pauthtest target)");

  // `EarlySess::sanitizers` does some computation but is called infrequently. `Sess::sanitizers`
  // is called much more often so we cache the value.
  const sanitizers = early_sess.sanitizers();

  const sess = new Session(
    early_sess,
    wasm_proc_macro_tuple,
    wasm_proc_macro_target,
    target_tlib_path,
    // PORT: upstream at the pin: `UnstableFeatures::from_environment(None)` (not `opts.unstable_features`,
    // which uses `--crate-name`).
    UnstableFeatures.from_environment(undefined),
    /* config */ Cfg.default(),
    /* check_config */ CheckCfg.default(),
    /* proc_macro_quoted_spans */ [],
    io,
    prof,
    timings,
    /* code_stats */ undefined,
    /* lint_store */ undefined,
    driver_lint_caps,
    ctfe_backtrace,
    /* miri_unleashed_features */ [],
    asm_arch,
    /* internal_target_features */ new Set(),
    /* global_backend_features */ [],
    cfg_version,
    using_internal_features,
    /* env_depinfo */ new Set(),
    /* file_depinfo */ new Set(),
    target_filesearch,
    host_filesearch,
    wasm_proc_macro_filesearch,
    /* replaced_intrinsics */ new Set(),
    /* fallback_intrinsics */ new Set(),
    /* thin_lto_supported */ false,
    /* mir_opt_bisect_eval_count */ 0,
    /* removed_rustc_main_attr */ false,
    pointer_auth_config,
    sanitizers,
  );

  // PORT: fields whose upstream value comes from crates that are not ported are deferred: reading
  // one calls `unported` (stand_ins.ts `defer_field`). Upstream computes, in order:
  // - `global_backend_features`, `replaced_intrinsics`, `fallback_intrinsics`, `thin_lto_supported`:
  //   destructured from `codegen_backend_init` (the codegen backend stand-in defers them too)
  // - `code_stats` (code_stats.rs)
  // `config`/`check_config`/`lint_store`/`internal_target_features` start empty as upstream; the
  // driver (rustc_interface::interface::run_compiler) fills or defers them.
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
// rustc: compiler/rustc_session/src/session.rs:1545 validate_commandline_args_with_session_available
function validate_commandline_args_with_session_available(sess: Session): void {
  const D = diagnostics_gen;
  // Since we don't know if code in an rlib will be linked to statically or
  // dynamically downstream, rustc generates `__imp_` symbols that help linkers
  // on Windows deal with this lack of knowledge (#27438). Unfortunately,
  // these manually generated symbols confuse LLD when it tries to merge
  // bitcode during ThinLTO. Therefore we disallow dynamic linking on Windows
  // when compiling for LLD ThinLTO. This way we can validly just not generate
  // the `dllimport` attributes and `__imp_` symbols in that case.
  if (LinkerPluginLto.enabled(sess.opts.cg.linker_plugin_lto) && sess.opts.cg.prefer_dynamic && sess.target.is_like_windows) {
    sess.dcx().emit_err(D.LinkerPluginToWindowsNotSupported_diagnostic({}));
  }

  // `sess.pointer_auth_config.as_ref().and_then(|cfg| cfg.function_pointers.as_ref()).is_some_and(..)`
  // PORT: `PointerAuthConfig` (only built for `CfgAbi::Pauthtest` targets) is not ported; no ported
  // target is one, so `pointer_auth_config` is `None` (see `build_session`).
  if (sess.pointer_auth_config !== undefined) {
    unported("rustc_session::session::PointerAuthConfig (validate_commandline_args_with_session_available)");
  }

  if (sess.target.cfg_abi.$ !== "Pauthtest" && sess.opts.unstable_opts.pointer_authentication.length !== 0) {
    sess.dcx().emit_warn(D.PointerAuthenticationNotSupportedForTarget_diagnostic({ target_triple: sess.opts.target_triple }));
  }

  // Make sure that any given profiling data actually exists so LLVM can't
  // decide to silently skip PGO.
  const profile_use = sess.opts.cg.profile_use;
  if (profile_use !== undefined) {
    if (!existsSync(profile_use)) {
      sess.dcx().emit_err(D.ProfileUseFileDoesNotExist_diagnostic({ path: profile_use }));
    }
  }

  // Do the same for sample profile data.
  const profile_sample_use = sess.opts.cg.profile_sample_use;
  if (profile_sample_use !== undefined) {
    if (!existsSync(profile_sample_use)) {
      sess.dcx().emit_err(D.ProfileSampleUseFileDoesNotExist_diagnostic({ path: profile_sample_use }));
    }
  }

  // Unwind tables cannot be disabled if the target requires them.
  const include_uwtables = sess.opts.cg.force_unwind_tables;
  if (include_uwtables !== undefined) {
    if (sess.target.requires_uwtable && !include_uwtables) {
      sess.dcx().emit_err(D.TargetRequiresUnwindTables_diagnostic({}));
    }
  }

  // Sanitizers can only be used on platforms that we know have working sanitizer codegen.
  const supported_sanitizers = sess.target.options.supported_sanitizers;
  let unsupported_sanitizers = sess.sanitizers() & ~supported_sanitizers;
  // Niche: if `fixed-x18`, or effectively switching on `reserved-x18` flag, is enabled
  // we should allow Shadow Call Stack sanitizer.
  if (sess.opts.unstable_opts.fixed_x18 && sess.target.arch.$ === "AArch64") {
    unsupported_sanitizers &= ~SanitizerSet.SHADOWCALLSTACK;
  }
  switch (SanitizerSet.iter(unsupported_sanitizers).length) {
    case 0:
      break;
    case 1:
      sess.dcx().emit_err(D.SanitizerNotSupported_diagnostic({ us: SanitizerSet.display(unsupported_sanitizers) }));
      break;
    default:
      sess.dcx().emit_err(D.SanitizersNotSupported_diagnostic({ us: SanitizerSet.display(unsupported_sanitizers) }));
      break;
  }

  // Cannot mix and match mutually-exclusive sanitizers.
  const me = SanitizerSet.MUTUALLY_EXCLUSIVE.find(([a, b]) => SanitizerSet.contains(sess.sanitizers(), a) && SanitizerSet.contains(sess.sanitizers(), b));
  if (me !== undefined) {
    const [first, second] = me;
    sess.dcx().emit_err(D.CannotMixAndMatchSanitizers_diagnostic({ first: SanitizerSet.display(first), second: SanitizerSet.display(second) }));
  }

  // Cannot enable crt-static with sanitizers on Linux
  if (sess.crt_static(undefined) && sess.sanitizers() !== 0 && !sess.target.is_like_msvc) {
    sess.dcx().emit_err(D.CannotEnableCrtStaticLinux_diagnostic({}));
  }

  // FIXME(jchlanda) Pauthtest does not support static linking. It must be dynamically linked,
  // with a dynamic linker acting as the ELF interpreter that can resolve pauth relocations and
  // enforce pointer authentication constraints.
  if (sess.crt_static(undefined) && sess.target.cfg_abi.$ === "Pauthtest") {
    sess.dcx().emit_err(D.CannotEnableCrtStaticPointerAuth_diagnostic({}));
  }

  // LLVM CFI requires LTO.
  if (sess.is_sanitizer_cfi_enabled() && !(sess.lto() === "Fat" || LinkerPluginLto.enabled(sess.opts.cg.linker_plugin_lto))) {
    sess.dcx().emit_err(D.SanitizerCfiRequiresLto_diagnostic({}));
  }

  // KCFI requires panic=abort
  if (sess.is_sanitizer_kcfi_enabled() && PanicStrategy.unwinds(sess.panic_strategy())) {
    sess.dcx().emit_err(D.SanitizerKcfiRequiresPanicAbort_diagnostic({}));
  }

  // LLVM CFI using rustc LTO requires a single codegen unit.
  if (sess.is_sanitizer_cfi_enabled() && sess.lto() === "Fat" && CodegenUnits.as_usize(sess.codegen_units()) !== 1) {
    sess.dcx().emit_err(D.SanitizerCfiRequiresSingleCodegenUnit_diagnostic({}));
  }

  // Canonical jump tables requires CFI.
  if (sess.is_sanitizer_cfi_canonical_jump_tables_disabled()) {
    if (!sess.is_sanitizer_cfi_enabled()) {
      sess.dcx().emit_err(D.SanitizerCfiCanonicalJumpTablesRequiresCfi_diagnostic({}));
    }
  }

  // KCFI arity indicator requires KCFI.
  if (sess.is_sanitizer_kcfi_arity_enabled() && !sess.is_sanitizer_kcfi_enabled()) {
    sess.dcx().emit_err(D.SanitizerKcfiArityRequiresKcfi_diagnostic({}));
  }

  // LLVM CFI pointer generalization requires CFI or KCFI.
  if (sess.is_sanitizer_cfi_generalize_pointers_enabled()) {
    if (!(sess.is_sanitizer_cfi_enabled() || sess.is_sanitizer_kcfi_enabled())) {
      sess.dcx().emit_err(D.SanitizerCfiGeneralizePointersRequiresCfi_diagnostic({}));
    }
  }

  // LLVM CFI recovery requires CFI.
  if (sess.is_sanitizer_cfi_recover_enabled()) {
    if (!sess.is_sanitizer_cfi_enabled()) {
      sess.dcx().emit_err(D.SanitizerCfiRecoverRequiresCfi_diagnostic({}));
    }
  }

  // LLVM CFI diagnostics requires CFI.
  if (sess.is_sanitizer_cfi_diag_enabled()) {
    if (!sess.is_sanitizer_cfi_enabled()) {
      sess.dcx().emit_err(D.SanitizerCfiDiagRequiresCfi_diagnostic({}));
    }
  }

  // LLVM CFI minimal runtime requires CFI recovery or CFI diagnostics.
  if (sess.is_sanitizer_cfi_minimal_runtime_enabled()) {
    if (!sess.is_sanitizer_cfi_enabled()) {
      sess.dcx().emit_err(D.SanitizerCfiMinimalRuntimeRequiresCfi_diagnostic({}));
    } else if (!(sess.is_sanitizer_cfi_recover_enabled() || sess.is_sanitizer_cfi_diag_enabled())) {
      sess.dcx().emit_err(D.SanitizerCfiMinimalRuntimeRequiresCfiRecoverOrDiag_diagnostic({}));
    }
  }

  // LLVM CFI integer normalization requires CFI or KCFI.
  if (sess.is_sanitizer_cfi_normalize_integers_enabled()) {
    if (!(sess.is_sanitizer_cfi_enabled() || sess.is_sanitizer_kcfi_enabled())) {
      sess.dcx().emit_err(D.SanitizerCfiNormalizeIntegersRequiresCfi_diagnostic({}));
    }
  }

  // LTO unit splitting requires LTO.
  if (sess.is_split_lto_unit_enabled() && !(sess.lto() === "Fat" || sess.lto() === "Thin" || LinkerPluginLto.enabled(sess.opts.cg.linker_plugin_lto))) {
    sess.dcx().emit_err(D.SplitLtoUnitRequiresLto_diagnostic({}));
  }

  // VFE requires LTO.
  if (sess.lto() !== "Fat") {
    if (sess.opts.unstable_opts.virtual_function_elimination) {
      sess.dcx().emit_err(D.UnstableVirtualFunctionElimination_diagnostic({}));
    }
  }

  if (sess.opts.unstable_opts.stack_protector !== "None") {
    if (!sess.target.options.supports_stack_protector) {
      sess.dcx().emit_warn(
        D.StackProtectorNotSupportedForTarget_diagnostic({
          stack_protector: sess.opts.unstable_opts.stack_protector,
          target_triple: sess.opts.target_triple,
        }),
      );
    }
  }

  if (sess.opts.unstable_opts.small_data_threshold !== undefined) {
    if (sess.target.small_data_threshold_support_().$ === "None") {
      sess.dcx().emit_warn(D.SmallDataThresholdNotSupportedForTarget_diagnostic({ target_triple: sess.opts.target_triple }));
    }
  }

  if (sess.opts.unstable_opts.branch_protection !== undefined && sess.target.arch.$ !== "AArch64") {
    sess.dcx().emit_err(D.BranchProtectionRequiresAArch64_diagnostic({}));
  }

  const dwarf_version = sess.opts.cg.dwarf_version ?? sess.opts.unstable_opts.dwarf_version;
  if (dwarf_version !== undefined) {
    // DWARF 1 is not supported by LLVM and DWARF 6 is not yet finalized.
    if (dwarf_version < 2 || dwarf_version > 5) {
      sess.dcx().emit_err(D.UnsupportedDwarfVersion_diagnostic({ dwarf_version }));
    }
  }

  if (!sess.target.options.supported_split_debuginfo.includes(sess.split_debuginfo()) && !sess.opts.unstable_opts.unstable_options) {
    sess.dcx().emit_err(D.SplitDebugInfoUnstablePlatform_diagnostic({ debuginfo: sess.split_debuginfo() }));
  }

  if (sess.opts.unstable_opts.embed_source) {
    const dwarf_version = sess.dwarf_version();

    if (dwarf_version < 5) {
      sess.dcx().emit_warn(D.EmbedSourceInsufficientDwarfVersion_diagnostic({ dwarf_version }));
    }

    if (sess.opts.debuginfo === "None") {
      sess.dcx().emit_warn(D.EmbedSourceRequiresDebugInfo_diagnostic({}));
    }
  }

  const instrument_mcount = sess.opts.unstable_opts.instrument_mcount;
  if (instrument_mcount.$ === "Fentry") {
    const opts = instrument_mcount._0;
    if (!sess.target.options.supports_fentry) {
      sess.dcx().emit_err(D.InstrumentationNotSupported_diagnostic({ us: "fentry" }));
    }
    if ((opts.no_call || opts.record) && sess.target.arch.$ !== "S390x") {
      sess.dcx().emit_err(D.InstrumentationNotSupported_diagnostic({ us: "fentry-*" }));
    }
  }

  if (sess.opts.unstable_opts.instrument_xray !== undefined && !sess.target.options.supports_xray) {
    sess.dcx().emit_err(D.InstrumentationNotSupported_diagnostic({ us: "XRay" }));
  }

  const flavor = sess.opts.cg.linker_flavor;
  const compatible_list = flavor !== undefined ? LinkerFlavor.check_compatibility(sess.target.linker_flavor, flavor) : undefined;
  if (flavor !== undefined && compatible_list !== undefined) {
    const flavor_ = LinkerFlavorCli.desc(flavor);
    sess.dcx().emit_err(D.IncompatibleLinkerFlavor_diagnostic({ flavor: flavor_, compatible_list }));
  }

  if (sess.opts.unstable_opts.function_return !== FunctionReturn.default()) {
    if (!(sess.target.arch.$ === "X86" || sess.target.arch.$ === "X86_64")) {
      sess.dcx().emit_err(D.FunctionReturnRequiresX86OrX8664_diagnostic({}));
    }
  }

  if (sess.opts.unstable_opts.indirect_branch_cs_prefix) {
    if (!(sess.target.arch.$ === "X86" || sess.target.arch.$ === "X86_64")) {
      sess.dcx().emit_err(D.IndirectBranchCsPrefixRequiresX86OrX8664_diagnostic({}));
    }
  }

  const regparm = sess.opts.unstable_opts.regparm;
  if (regparm !== undefined) {
    if (regparm > 3) {
      sess.dcx().emit_err(D.UnsupportedRegparm_diagnostic({ regparm }));
    }
    if (sess.target.arch.$ !== "X86") {
      sess.dcx().emit_err(D.UnsupportedRegparmArch_diagnostic({}));
    }
  }
  if (sess.opts.unstable_opts.reg_struct_return) {
    if (sess.target.arch.$ !== "X86") {
      sess.dcx().emit_err(D.UnsupportedRegStructReturnArch_diagnostic({}));
    }
  }

  // The code model check applies to `thunk` and `thunk-extern`, but not `thunk-inline`, so it is
  // kept as a `match` to force a change if new ones are added, even if we currently only support
  // `thunk-extern` like Clang.
  switch (sess.opts.unstable_opts.function_return) {
    case "Keep":
      break;
    case "ThunkExtern": {
      // FIXME: In principle, the inherited base LLVM target code model could be large,
      // but this only checks whether we were passed one explicitly (like Clang does).
      const code_model = sess.code_model();
      if (code_model !== undefined && code_model === "Large") {
        sess.dcx().emit_err(D.FunctionReturnThunkExternRequiresNonLargeCodeModel_diagnostic({}));
      }
      break;
    }
  }

  if (sess.opts.unstable_opts.packed_stack) {
    if (sess.target.arch.$ !== "S390x") {
      sess.dcx().emit_err(D.UnsupportedPackedStack_diagnostic({}));
    }
  }

  const cpu_name = sess.opts.cg.target_cpu;
  if (cpu_name !== undefined) {
    if (cpu_name === NATIVE_CPU && sess.target.requires_consistent_cpu) {
      sess.dcx().emit_fatal(
        D.NativeTargetCpuNotAllowed_diagnostic({
          target_triple: sess.opts.target_triple,
          need_explicit_cpu: sess.target.need_explicit_cpu,
        }),
      );
    }
  }
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
    case "Json": {
      const { pretty, json_rendered, color_config } = output;
      // PORT: `io::BufWriter::new(io::stderr())` -> `stderr()` (see `default_emitter`).
      emitter = JsonEmitter.new(stderr(), SourceMap.new(FilePathMapping.empty()), pretty, json_rendered, color_config);
      break;
    }
  }
  return emitter;
}

