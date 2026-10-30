// Partial port of compiler/rustc_interface/src/util.rs: the session/thread setup and codegen backend
// selection used by `interface::run_compiler`, and `rustc_version_str`.
import "../rustc_session/options.ts"; // LOAD ORDER: see rustc_session/config.ts
import { DEFAULT_STACK_SIZE, Input, type Jobs, OutFileName, OutputFilenames, OutputType, OutputTypes, type Sysroot } from "../rustc_session/config.ts";
import { isatty } from "node:tty";
import type { Attribute } from "../rustc_ast/ast.gen.ts";
import { parse_crate_name } from "./passes.ts";
import type { EarlyDiagCtxt } from "../rustc_session/session.ts";
import type { Target } from "../rustc_session/stand_ins.ts";
import type { Cfg } from "../rustc_session/config/cfg.ts";
import type { Session } from "../rustc_session/session.ts";
import { target_features } from "../rustc_target/lib.ts";
import { Symbol, sym } from "../rustc_span/symbol.ts";
import type { Edition } from "../rustc_span/edition.ts";
import { create_session_globals_then } from "../rustc_span/lib.ts";
import type { SourceMapInputs } from "../rustc_span/source_map.ts";
import { assert, panic, unported } from "../std/panic.ts";
import { display_CrateType } from "../rustc_structures/crate_type.ts";
import {
  type CodegenBackend,
  CodegenBackend_provided,
  CurrentGcx,
  type IncrCompSession,
  type TargetConfig,
  type WorkProductMap,
} from "./stand_ins.ts";
import { LlvmCodegenBackend } from "../rust_ts/codegen_backend.ts";
import type { EncodedMetadata } from "../rustc_metadata/lib.ts";
import type { CodegenBackendInit, EarlySession } from "../rustc_session/session.ts";
import type { CrateType } from "../rustc_structures/crate_type.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { MetadataLoaderDyn } from "../rustc_metadata/creader.ts";
import { internal_target_features } from "../rustc_codegen_ssa/target_features.ts";
import { type ArchiveBuilderBuilder, link_binary } from "../rustc_codegen_ssa/back/link.ts";
import { CompiledModules, type CrateInfo } from "../rustc_codegen_ssa/lib.ts";
import * as diagnostics from "./diagnostics.gen.ts";

export { DEFAULT_STACK_SIZE };

/// Adds `target_feature = "..."` cfgs for a variety of platform
/// specific features (SSE, NEON etc.).
///
/// This is performed by checking whether a set of permitted features
/// is available on the target machine, by querying the `TargetConfig` from the codegen backend.
// rustc: compiler/rustc_interface/src/util.rs:47 add_configuration
export function add_configuration(cfg: Cfg, target_config: TargetConfig, target: Target, is_nightly_build: boolean, is_crt_static: boolean): void {
  // Add some of the target features to `cfg`.
  cfg.extend(
    target
      .rust_target_features()
      .filter(([, gate]) => target_features.Stability.in_cfg(gate) && (is_nightly_build || target_features.Stability.requires_nightly(gate, /* in_cfg */ true) === undefined))
      .map(([feature]) => Symbol.intern(feature))
      .filter((feature) => target_config.internal_target_features.has(feature))
      .map((feature): [Symbol, Symbol | undefined] => [sym.target_feature, feature]),
  );

  if (target_config.has_reliable_f16) {
    cfg.insert([sym.target_has_reliable_f16, undefined]);
  }
  if (target_config.has_reliable_f16_math) {
    cfg.insert([sym.target_has_reliable_f16_math, undefined]);
  }
  if (target_config.has_reliable_f16b) {
    cfg.insert([sym.target_has_reliable_f16b, undefined]);
  }
  if (target_config.has_reliable_f128) {
    cfg.insert([sym.target_has_reliable_f128, undefined]);
  }
  if (target_config.has_reliable_f128_math) {
    cfg.insert([sym.target_has_reliable_f128_math, undefined]);
  }

  if (is_crt_static) {
    cfg.insert([sym.target_feature, sym.crt_dash_static]);
  }
}

/// Ensures that all target features required by the ABI are present.
/// Must be called after `internal_target_features` has been populated!
// rustc: compiler/rustc_interface/src/util.rs:95 check_abi_required_features
export function check_abi_required_features(sess: Session): void {
  const abi_feature_constraints = sess.target.abi_required_features();
  // We check this against `internal_target_features` as that is conveniently already
  // back-translated to rustc feature names, taking into account `-Ctarget-cpu` and `-Ctarget-feature`.
  // Just double-check that the features we care about are actually on our list.
  for (const feature of [...abi_feature_constraints.required, ...abi_feature_constraints.incompatible]) {
    assert(
      sess.target.rust_target_features().some(([name]) => feature === name),
      `target feature ${feature} is required/incompatible for the current ABI but not a recognized feature for this target`,
    );
  }

  // Make this a hard error on ARM since starting with LLVM24, the backend will otherwise
  // emit a (less friendly) hard error.
  // Also make it a hard error on x86, where we use SSE registers for the "Rust" ABI. The
  // post-mono ABI check only systematically checks "C" calls, so we better reject this here.
  const hard_error = sess.target.arch.$ === "Arm" || sess.target.arch.$ === "X86";

  for (const feature of abi_feature_constraints.required) {
    if (!sess.internal_target_features.has(Symbol.intern(feature))) {
      const diag = diagnostics.AbiRequiredTargetFeature_diagnostic({
        feature,
        enabled: "enabled",
        fcw: !hard_error,
      });
      if (hard_error) {
        sess.dcx().emit_err(diag);
      } else {
        sess.dcx().emit_warn(diag);
      }
    }
  }
  for (const feature of abi_feature_constraints.incompatible) {
    if (sess.internal_target_features.has(Symbol.intern(feature))) {
      const diag = diagnostics.AbiRequiredTargetFeature_diagnostic({
        feature,
        enabled: "disabled",
        fcw: !hard_error,
      });
      if (hard_error) {
        sess.dcx().emit_err(diag);
      } else {
        sess.dcx().emit_warn(diag);
      }
    }
  }
}

/** `pub static STACK_SIZE: OnceLock<usize>` */
export const STACK_SIZE: { value: number | undefined } = { value: undefined };

// rustc: compiler/rustc_interface/src/util.rs:147 init_stack_size
function init_stack_size(early_dcx: EarlyDiagCtxt): number {
  // Obey the environment setting or default
  if (STACK_SIZE.value === undefined) {
    let v: number;
    const os_str = process.env.RUST_MIN_STACK;
    // if someone finds out `export RUST_MIN_STACK=640000` isn't enough stack
    // they might try to "unset" it by running `RUST_MIN_STACK=  rustc code.rs`
    // this is wrong, but std would nonetheless "do what they mean", so let's do likewise
    if (os_str !== undefined && os_str.trim().length !== 0) {
      // rustc is a batch program, so error early on inputs which are unlikely to be intended
      // so no one thinks we parsed them setting `RUST_MIN_STACK="64 megabytes"`
      // FIXME: we could accept `RUST_MIN_STACK=64MB`, perhaps?
      const s = os_str.trim();
      // PORT: `s.parse::<usize>()`: ASCII digits with an optional leading `+`, no overflow past usize.
      if (/^\+?[0-9]+$/.test(s) && BigInt(s.replace(/^\+/, "")) <= 0xffff_ffff_ffff_ffffn) {
        v = Number(s.replace(/^\+/, ""));
      } else {
        const err = early_dcx.early_struct_fatal(`\`RUST_MIN_STACK\` should be a number of bytes, but was "${s}"`);
        err.note("you can also unset `RUST_MIN_STACK` to use the default stack size");
        return err.emit_fatal();
      }
    } else {
      // otherwise pick a consistent default
      v = DEFAULT_STACK_SIZE;
    }
    STACK_SIZE.value = v;
  }
  return STACK_SIZE.value;
}

// rustc: compiler/rustc_interface/src/util.rs:175 run_in_thread_with_globals
function run_in_thread_with_globals<R>(
  _thread_stack_size: number,
  edition: Edition,
  sm_inputs: SourceMapInputs,
  extra_symbols: readonly string[],
  f: (current_gcx: CurrentGcx) => R,
): R {
  // The "thread pool" is a single spawned thread in the non-parallel
  // compiler. We run on a spawned thread instead of the main thread (a) to
  // provide control over the stack size, and (b) to increase similarity with
  // the parallel compiler, in particular to ensure there is no accidental
  // sharing of data between the main thread and the compilation thread
  // (which might cause problems for the parallel compiler).
  // PORT: no thread: `f` runs on the JS main thread (the stack size is the host's); a panic on the
  // "thread" propagates as the thrown value, like `resume_unwind(e)` after `join`.

  // We build the session globals and run `f` on the spawned thread, because
  // `SessionGlobals` does not impl `Send` in the non-parallel compiler.
  return create_session_globals_then(edition, extra_symbols, sm_inputs, () => f(CurrentGcx.new()));
}

// rustc: compiler/rustc_interface/src/util.rs:214 run_in_thread_pool_with_globals
export function run_in_thread_pool_with_globals<R>(
  thread_builder_diag: EarlyDiagCtxt,
  edition: Edition,
  jobs: Jobs,
  extra_symbols: readonly string[],
  sm_inputs: SourceMapInputs,
  f: (current_gcx: CurrentGcx) => R,
): R {
  const thread_stack_size = init_stack_size(thread_builder_diag);

  const jobs_frontend = jobs.frontend ?? 1;
  // `let registry = sync::Registry::new(jobs_frontend);`

  // `let Some(proof) = sync::check_dyn_thread_safe() else { .. }`: dyn-thread-safe mode is on only with a
  // parallel frontend (`set_dyn_thread_safe_mode(jobs.frontend.is_some())` in run_compiler).
  if (jobs.frontend === undefined) {
    // assert_eq!(jobs_frontend.get(), 1);
    return run_in_thread_with_globals(thread_stack_size, edition, sm_inputs, extra_symbols, (current_gcx) => {
      // Register the thread for use with the `WorkerLocal` type.
      // `registry.register();`

      return f(current_gcx);
    });
  }

  return unported(`rustc_thread_pool (parallel frontend, ${jobs_frontend} threads)`);
}

/// Get the codegen backend based on the name and specified sysroot.
///
/// A name of `None` indicates that the default backend should be used.
// rustc: compiler/rustc_interface/src/util.rs:369 get_codegen_backend
export function get_codegen_backend(
  early_dcx: EarlyDiagCtxt,
  sysroot: Sysroot,
  backend_name: string | undefined,
  target: Target,
): CodegenBackend {
  // static LOAD: OnceLock<unsafe fn() -> Box<dyn CodegenBackend>> = OnceLock::new();
  if (LOAD === undefined) {
    const backend = backend_name ?? target.default_codegen_backend ?? CFG_DEFAULT_CODEGEN_BACKEND ?? "dummy";

    if (backend.includes(".")) {
      void early_dcx;
      LOAD = () => unported(`rustc_interface::util::load_backend_from_dylib (${backend})`);
    } else if (backend === "dummy") {
      LOAD = () => new DummyCodegenBackend();
    } else if (backend === "llvm") {
      LOAD = LlvmCodegenBackend.new;
    } else {
      LOAD = () => unported(`rustc_interface::util::get_codegen_sysroot (${backend}; sysroot ${sysroot.path()})`);
    }
  }

  // SAFETY: In case of a builtin codegen backend this is safe. In case of an external codegen
  // backend we hope that the backend links against the same rustc_driver version. If this is not
  // the case, we get UB.
  return LOAD();
}
let LOAD: (() => CodegenBackend) | undefined;

/** PORT: `option_env!("CFG_DEFAULT_CODEGEN_BACKEND")` of the oracle build (official nightlies: `llvm`). */
const CFG_DEFAULT_CODEGEN_BACKEND: string | undefined = "llvm";

export class DummyCodegenBackend implements CodegenBackend {
  // rustc: compiler/rustc_interface/src/util.rs:403 name
  name(): string {
    return "dummy";
  }

  init(sess: EarlySession): CodegenBackendInit {
    return CodegenBackend_provided.init(this, sess);
  }

  // rustc: compiler/rustc_interface/src/util.rs:407 target_config
  target_config(sess: EarlySession): TargetConfig {
    const abi_required_features = sess.target.abi_required_features();
    const internal_target_features_ = internal_target_features(
      sess,
      (_feature) => [],
      (feature) => {
        // This is a standin for the list of features a backend is expected to enable.
        // It would be better to parse target.features instead and handle implied features,
        // but target.features doesn't contain features that are enabled by default for an
        // architecture or target cpu.
        return abi_required_features.required.includes(feature);
      },
    );

    return {
      internal_target_features: internal_target_features_,
      has_reliable_f16: true,
      has_reliable_f16_math: true,
      has_reliable_f16b: true,
      has_reliable_f128: true,
      has_reliable_f128_math: true,
    };
  }

  // rustc: compiler/rustc_interface/src/util.rs:431 supported_crate_types
  supported_crate_types(_sess: Session): CrateType[] {
    // This includes bin despite failing on the link step to ensure that you
    // can still get the frontend handling for binaries. For all library
    // like crate types cargo will fallback to rlib unless you specifically
    // say that only a different crate type must be used.
    return ["Rlib", "Executable"];
  }

  print_passes(): void {
    CodegenBackend_provided.print_passes(this);
  }

  print_version(): void {
    CodegenBackend_provided.print_version(this);
  }

  metadata_loader(): MetadataLoaderDyn {
    return CodegenBackend_provided.metadata_loader(this);
  }

  // rustc: compiler/rustc_interface/src/util.rs:439 target_cpu
  target_cpu(_sess: Session): string {
    return "";
  }

  // rustc: compiler/rustc_interface/src/util.rs:443 codegen_crate
  codegen_crate(_tcx: TyCtxt): unknown {
    return new CompiledModules([], undefined);
  }

  // rustc: compiler/rustc_interface/src/util.rs:447 join_codegen
  join_codegen(
    ongoing_codegen: unknown,
    _sess: Session,
    _incr_comp_session: IncrCompSession | undefined,
    _outputs: OutputFilenames,
    _crate_info: CrateInfo,
  ): [CompiledModules, WorkProductMap] {
    // (*ongoing_codegen.downcast().unwrap(), WorkProductMap::default())
    if (!(ongoing_codegen instanceof CompiledModules)) {
      return panic("called `Result::unwrap()` on an `Err` value: Any { .. }");
    }
    return [ongoing_codegen, new Map()];
  }

  print_pass_timings(): void {
    CodegenBackend_provided.print_pass_timings(this);
  }

  print_statistics(): void {
    CodegenBackend_provided.print_statistics(this);
  }

  print_statistics_json(): string {
    return CodegenBackend_provided.print_statistics_json(this);
  }

  // rustc: compiler/rustc_interface/src/util.rs:458 link
  link(sess: Session, compiled_modules: CompiledModules, crate_info: CrateInfo, metadata: EncodedMetadata, outputs: OutputFilenames): void {
    // JUSTIFICATION: TyCtxt no longer available here
    // #[allow(rustc::bad_opt_access)]
    const crate_type = crate_info.crate_types.find((crate_type) => crate_type !== "Rlib");
    if (crate_type !== undefined && outputs.outputs.should_link()) {
      sess.dcx().fatal(`crate type ${display_CrateType(crate_type)} not supported by the dummy codegen backend`);
    }

    link_binary(sess, DummyArchiveBuilderBuilder, compiled_modules, crate_info, metadata, outputs, this.name());
  }
}

/**
 * PORT: `struct DummyArchiveBuilderBuilder` (util.rs:489): its `new_archive_builder` (:492) and
 * `create_dll_import_lib` (:499) build archives with `ArArchiveBuilderBuilder` (codegen_ssa back/archive.rs, M7),
 * which only the linking steps of `link_binary` reach; opaque here (see `ArchiveBuilderBuilder`).
 */
const DummyArchiveBuilderBuilder: ArchiveBuilderBuilder = { __archive_builder_builder: "DummyArchiveBuilderBuilder" };

// rustc: compiler/rustc_interface/src/util.rs:617 multiple_output_types_to_stdout
function multiple_output_types_to_stdout(output_types: OutputTypes, single_output_file_is_stdout: boolean): boolean {
  // use std::io::IsTerminal;
  if (isatty(1)) {
    // If stdout is a tty, check if multiple text output types are
    // specified by `--emit foo=- --emit bar=-` or `-o - --emit foo,bar`
    const named_text_types = [...output_types.iter()].filter(([f, o]) => OutputType.is_text_output(f) && o !== undefined && o.$ === "Stdout").length;
    const unnamed_text_types = [...output_types.iter()].filter(([f, o]) => OutputType.is_text_output(f) && o === undefined).length;
    return named_text_types > 1 || (unnamed_text_types > 1 && single_output_file_is_stdout);
  } else {
    // Otherwise, all the output types should be checked
    const named_types = [...output_types.values()].filter((o) => o !== undefined && o.$ === "Stdout").length;
    const unnamed_types = [...output_types.values()].filter((o) => o === undefined).length;
    return named_types > 1 || (unnamed_types > 1 && single_output_file_is_stdout);
  }
}

// rustc: compiler/rustc_interface/src/util.rs:641 build_output_filenames
export function build_output_filenames(attrs: readonly Attribute[], sess: Session): OutputFilenames {
  if (multiple_output_types_to_stdout(sess.opts.output_types, sess.io.output_file !== undefined && sess.io.output_file.$ === "Stdout")) {
    sess.dcx().emit_fatal(diagnostics.MultipleOutputTypesToStdout_diagnostic({}));
  }

  let crate_name = sess.opts.crate_name;
  if (crate_name === undefined) {
    const i = parse_crate_name(sess, attrs, { $: "Nothing" });
    crate_name = i !== undefined ? Symbol.as_str(i[0]) : undefined;
  }

  const invocation_temp =
    sess.opts.incremental !== undefined
      ? unported("rustc_interface::util::build_output_filenames (invocation_temp: rand rng().next_u32().to_base_fixed_len(CASE_INSENSITIVE); -C incremental)")
      : undefined;

  const output_file = sess.io.output_file;
  if (output_file === undefined) {
    // "-" as input file will cause the parser to read from stdin so we
    // have to make up a name
    // We want to toss everything after the final '.'
    const dirpath = sess.io.output_dir ?? "";

    // If a crate name is present, we use it as the link name
    const stem = crate_name ?? Input.filestem(sess.io.input);

    return OutputFilenames.new(
      dirpath,
      crate_name ?? stem.replaceAll("-", "_"),
      stem,
      undefined,
      sess.io.temps_dir,
      invocation_temp,
      sess.opts.unstable_opts.split_dwarf_out_dir,
      sess.opts.cg.extra_filename,
      clone_OutputTypes(sess.opts.output_types),
    );
  } else {
    const out_file = output_file;
    const unnamed_output_types = [...sess.opts.output_types.values()].filter((a) => a === undefined).length;
    let ofile: OutFileName | undefined;
    if (unnamed_output_types > 1) {
      sess.dcx().emit_warn(diagnostics.MultipleOutputTypesAdaption_diagnostic({}));
      ofile = undefined;
    } else {
      if (sess.opts.cg.extra_filename.length !== 0) {
        sess.dcx().emit_warn(diagnostics.IgnoringExtraFilename_diagnostic({}));
      }
      ofile = out_file;
    }
    if (sess.io.output_dir !== undefined) {
      sess.dcx().emit_warn(diagnostics.IgnoringOutDir_diagnostic({}));
    }

    // `out_file.filestem().unwrap_or_default().to_str().unwrap().to_string()`
    const out_filestem = OutFileName.filestem(out_file) ?? "";
    return OutputFilenames.new(
      OutFileName.parent(out_file) ?? "",
      crate_name ?? out_filestem.replaceAll("-", "_"),
      out_filestem,
      ofile,
      sess.io.temps_dir,
      invocation_temp,
      sess.opts.unstable_opts.split_dwarf_out_dir,
      sess.opts.cg.extra_filename,
      clone_OutputTypes(sess.opts.output_types),
    );
  }
}

/** `OutputTypes::clone` (`#[derive(Clone)]` of the `BTreeMap` newtype). */
function clone_OutputTypes(v: OutputTypes): OutputTypes {
  return new OutputTypes(new Map(v._0));
}

/// Returns a version string such as "1.46.0 (04488afe3 2020-08-24)" when invoked by an in-tree tool.
// `pub macro version_str() { option_env!("CFG_VERSION") }`
export function version_str(): string | undefined {
  return CFG_VERSION;
}

/**
 * PORT: `option_env!("CFG_VERSION")` of the oracle build: `{release} ({short commit hash} {commit date})`
 * from UPSTREAM.json (`rust.release`, `rust.commit`[..9], `rust.commitDate`); checked against
 * `rustc -V` in src/rustc_driver_impl/driver.oracle.test.ts.
 */
export const CFG_VERSION: string = "1.101.0-nightly (6f5da406b 2026-10-10)";

/// Returns the version string for `rustc` itself (which may be different from a tool version).
// rustc: compiler/rustc_interface/src/util.rs:722 rustc_version_str
export function rustc_version_str(): string | undefined {
  return version_str();
}
