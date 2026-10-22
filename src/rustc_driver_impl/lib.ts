//! The Rust compiler.
//!
//! # Note
//!
//! This API is completely unstable and subject to change.
// Partial port of compiler/rustc_driver_impl/src/lib.rs: the `main` → `compiler_entrypoint` →
// `handle_options` → `run_compiler` path, version/help printing and the `-Zunpretty` early exit.
// Everything after parsing (expansion, analysis, codegen, linking), `--explain`, `-W help`,
// `--print`, metadata listing, rlink processing and the ICE hook is unported (see each fn).
import "../rustc_session/options.ts"; // LOAD ORDER: see rustc_session/config.ts
import "../rustc_session/lib.ts";
import type { AttrVec, Crate } from "../rustc_ast/ast.gen.ts";
import type { PResult } from "../rustc_errors/lib.gen.ts";
import { catch_fatal_errors } from "../rustc_errors/lib.ts";
import { type Compiler, type Config, run_compiler } from "../rustc_interface/interface.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { new_parser_from_file, new_parser_from_source_str, unwrap_or_emit_fatal } from "../rustc_parse/lib.ts";
import * as passes from "../rustc_interface/passes.ts";
import { build_output_filenames } from "../rustc_interface/util.ts";
import { filename_for_input, invalid_output_for_target } from "../rustc_session/output.ts";
import { CrateType as CrateTypeC } from "../rustc_structures/crate_type.ts";
import { DUMMY_SP } from "../rustc_span/lib.ts";
import { path_file_name } from "../std/path.ts";
import type { CodegenBackend } from "../rustc_interface/stand_ins.ts";
import { get_codegen_backend } from "../rustc_interface/util.ts";
import {
  ErrorOutputType,
  Input,
  type OutFileName,
  OutFileName as OutFileNameImpl,
  PpMode,
  Sysroot,
  build_session_options,
  build_target_config,
  host_tuple,
  nightly_options,
  parse_target_triple,
  rustc_optgroups,
} from "../rustc_session/config.ts";
import { CG_OPTIONS, type OptionDesc, OptionDesc as OptionDescC, type UnstableOptions, Z_OPTIONS, str_cmp } from "../rustc_session/options.ts";
import { find_gated_cfg } from "../rustc_feature/builtin_attrs.ts";
import { Target_to_json, spec as target_spec } from "../rustc_target/lib.ts";
import { JsonObject, to_string_pretty } from "../rustc_target/json.ts";
import { TargetTuple } from "../rustc_target/spec/tuple.ts";
import { Symbol } from "../rustc_span/symbol.ts";
import { EarlyDiagCtxt, type Session } from "../rustc_session/session.ts";
import type { TimePassesFormat } from "../rustc_session/stand_ins.ts";
import { UnstableFeatures } from "../rustc_feature/lib.ts";
import type { PathBuf } from "../rustc_error_messages/lib.ts";
import * as env from "../std/env.ts";
import { panic, unported } from "../std/panic.ts";
import { from_utf8 } from "../std/str.ts";
import { FileName } from "../rustc_span/lib.ts";
import { readFileSync } from "node:fs";
import * as getopts from "../vendor/getopts/lib.ts";
import { arg_expand_all, raw_args } from "./args.ts";
import * as pretty from "./pretty.ts";
import * as signal_handler from "./signal_handler.ts";
import * as rustc_log from "../rustc_log/lib.ts";
import * as tracing from "../rust_ts/tracing.ts";
import { safe_println } from "./print.ts";

export * as args from "./args.ts";
export * as pretty from "./pretty.ts";

/// Exit status code used for successful compilation and help output.
export const EXIT_SUCCESS: number = 0;

/// Exit status code used for compilation failures and invalid flags.
export const EXIT_FAILURE: number = 1;

export const DEFAULT_BUG_REPORT_URL: string =
  "https://github.com/rust-lang/rust/issues/new?labels=C-bug%2C+I-ICE%2C+T-compiler&template=ice.md";

// PORT: build constants of the oracle rustc (`option_env!` in the `version!` macro), from UPSTREAM.json:
// `CFG_VERSION` (see rustc_interface/util.ts), `CFG_VER_HASH` = `rust.commit`, `CFG_VER_DATE` =
// `rust.commitDate`, `CFG_RELEASE` = `rust.release`. Checked against `rustc -vV` in driver.oracle.test.ts.
import { CFG_VERSION } from "../rustc_interface/util.ts";
const CFG_VER_HASH: string | undefined = "6f5da406b56c2db6607202b63daee73aa8c61297";
const CFG_VER_DATE: string | undefined = "2026-10-10";
const CFG_RELEASE: string | undefined = "1.101.0-nightly";

export interface Callbacks {
  /// Called before creating the compiler instance
  config(config: Config): void;
  /// Called after parsing the crate root. Submodules are not yet parsed when
  /// this callback is called. Return value instructs the compiler whether to
  /// continue the compilation afterwards (defaults to `Compilation::Continue`)
  after_crate_root_parsing?(compiler: Compiler, krate: Crate): Compilation; // (provided)
  /// Called after expansion. Return value instructs the compiler whether to
  /// continue the compilation afterwards (defaults to `Compilation::Continue`)
  after_expansion?(compiler: Compiler, tcx: TyCtxt): Compilation; // (provided)
  /// Called after analysis. Return value instructs the compiler whether to
  /// continue the compilation afterwards (defaults to `Compilation::Continue`)
  after_analysis?(compiler: Compiler, tcx: TyCtxt): Compilation; // (provided)
}

/** The provided methods of `Callbacks` (PORTING §8): an implementor's override wins. */
export const Callbacks_provided = {
  // rustc: compiler/rustc_driver_impl/src/lib.rs:126 after_crate_root_parsing
  after_crate_root_parsing(self: Callbacks, compiler: Compiler, krate: Crate): Compilation {
    if (self.after_crate_root_parsing !== undefined) return self.after_crate_root_parsing(compiler, krate);
    return "Continue";
  },
  // rustc: compiler/rustc_driver_impl/src/lib.rs:135 after_expansion
  after_expansion(self: Callbacks, compiler: Compiler, tcx: TyCtxt): Compilation {
    if (self.after_expansion !== undefined) return self.after_expansion(compiler, tcx);
    return "Continue";
  },
  // rustc: compiler/rustc_driver_impl/src/lib.rs:144 after_analysis
  after_analysis(self: Callbacks, compiler: Compiler, tcx: TyCtxt): Compilation {
    if (self.after_analysis !== undefined) return self.after_analysis(compiler, tcx);
    return "Continue";
  },
} as const;

// #[derive(Default)]
export class TimePassesCallbacks implements Callbacks {
  constructor(public time_passes: TimePassesFormat | undefined) {}

  static default(): TimePassesCallbacks {
    return new TimePassesCallbacks(undefined);
  }

  // JUSTIFICATION: the session doesn't exist at this point.
  // #[allow(rustc::bad_opt_access)]
  // rustc: compiler/rustc_driver_impl/src/lib.rs:161 config
  config(config: Config): void {
    // If a --print=... option has been given, we don't print the "total"
    // time because it will mess up the --print output. See #64339.
    //
    this.time_passes =
      config.opts.prints.length === 0 && config.opts.unstable_opts.time_passes ? config.opts.unstable_opts.time_passes_format : undefined;
    config.opts.trimmed_def_paths = true;
  }
}

/// This is the primary entry point for rustc.
// rustc: compiler/rustc_driver_impl/src/lib.rs:172 compiler_entrypoint
export function compiler_entrypoint(at_args0: readonly string[], callbacks: Callbacks): void {
  const default_early_dcx = EarlyDiagCtxt.new(ErrorOutputType.default());

  // Throw away the first argument, the name of the binary.
  // In case of at_args being empty, as might be the case by
  // passing empty argument array to execve under some platforms,
  // just use an empty slice.
  //
  // This situation was possible before due to arg_expand_all being
  // called before removing the argument, enabling a crash by calling
  // the compiler with @empty_file as argv[0] and no more arguments.
  const at_args = at_args0.slice(1);

  const args = arg_expand_all(default_early_dcx, at_args);

  // For the purposes of checking that an --edition was passed, we only emit a message if the only
  // argument passed to rustc is a file name.
  let warn_unspecified_edition: boolean;
  if (args.length === 0) {
    warn_unspecified_edition = false;
  } else if (args.length === 1 && args[0]!.startsWith("-")) {
    // We explicitly don't emit the note if we're consuming code from stdin, or passing non-file
    // flags. This can happen on some cargo invocations too.
    warn_unspecified_edition = false;
  } else if (args.length === 1) {
    warn_unspecified_edition = true;
  } else {
    warn_unspecified_edition = false;
  }
  const handled = handle_options(default_early_dcx, args);
  let matches: getopts.Matches;
  let help_only: boolean;
  switch (handled.$) {
    case "None":
      return;
    case "Normal":
      [matches, help_only] = [handled._0, false];
      break;
    case "HelpOnly":
      [matches, help_only] = [handled._0, true];
      break;
  }

  const sopts = build_session_options(default_early_dcx, matches, warn_unspecified_edition);
  const ice_file = ice_path_with_config(sopts.unstable_opts);

  const code = matches.opt_str("explain");
  if (code !== undefined) {
    handle_explain(default_early_dcx, code, sopts.color);
    return;
  }

  const input = make_input(default_early_dcx, matches.free);
  const has_input = input !== undefined;
  const [odir, ofile] = make_output(matches);

  // drop(default_early_dcx);
  default_early_dcx.dcx.inner.drop();

  const config: Config = {
    opts: sopts,
    crate_cfg: matches.opt_strs("cfg"),
    crate_check_cfg: matches.opt_strs("check-cfg"),
    input: input ?? { $: "File", _0: "" },
    output_file: ofile,
    output_dir: odir,
    ice_file,
    file_loader: undefined,
    lint_caps: new Map(),
    psess_created: undefined,
    track_state: undefined,
    register_lints: undefined,
    override_queries: undefined,
    extra_symbols: [],
    make_codegen_backend: undefined,
    using_internal_features: USING_INTERNAL_FEATURES,
  };

  callbacks.config(config);

  const registered_lints = config.register_lints !== undefined;

  run_compiler(config, (compiler) => {
    const sess = compiler.sess;
    const codegen_backend = compiler.codegen_backend;

    // This implements `-Whelp`. It should be handled very early, like
    // `--help`/`-Zhelp`/`-Chelp`. This is the earliest it can run, because
    // it must happen after lints are registered, during session creation.
    if (sess.opts.describe_lints) {
      describe_lints(sess, registered_lints);
      return;
    }

    // We have now handled all help options, exit
    if (help_only) {
      return;
    }

    if (print_crate_info(codegen_backend, sess, has_input) === "Stop") {
      return;
    }

    if (!has_input) {
      sess.dcx().fatal("no input filename given"); // this is fatal
    }

    if (sess.opts.unstable_opts.ls.length !== 0) {
      // `list_metadata(sess, &*codegen_backend.metadata_loader())`
      unported("rustc_driver_impl::list_metadata (-Z ls)");
      return;
    }

    if (sess.opts.unstable_opts.link_only) {
      // `process_rlink(sess, compiler)`
      unported("rustc_driver_impl::process_rlink (-Z link-only)");
      return;
    }

    // Parse the crate root source code (doesn't parse submodules yet)
    // Everything else is parsed during macro expansion.
    const krate = passes.parse(sess);

    // If pretty printing is requested: Figure out the representation, print it and exit
    const pp_mode = sess.opts.pretty;
    if (pp_mode !== undefined) {
      if (PpMode.needs_ast_map(pp_mode)) {
        passes.create_and_enter_global_ctxt(compiler, krate, (tcx) => {
          tcx.ensure_ok().early_lint_checks(null);
          pretty.print(sess, pp_mode, { $: "NeedsAstMap", tcx });
          passes.write_dep_info(tcx);
        });
      } else {
        pretty.print(sess, pp_mode, { $: "AfterParsing", krate });
      }
      // trace!("finished pretty-printing");
      return;
    }

    if (Callbacks_provided.after_crate_root_parsing(callbacks, compiler, krate) === "Stop") {
      return;
    }

    if (sess.opts.unstable_opts.parse_crate_root_only) {
      return;
    }

    const [linker, incr_comp_session] = passes.create_and_enter_global_ctxt(compiler, krate, (tcx): undefined => {
      // Make sure name resolution and macro expansion is run.
      void tcx.resolver_for_lowering();

      if (Callbacks_provided.after_expansion(callbacks, compiler, tcx) === "Stop") {
        return undefined;
      }

      passes.write_dep_info(tcx);

      passes.write_interface(tcx);

      if (sess.opts.output_types.contains_key("DepInfo") && sess.opts.output_types.len() === 1) {
        return undefined;
      }

      if (sess.opts.unstable_opts.no_analysis) {
        return undefined;
      }

      tcx.ensure_ok().analysis(null);

      if (Callbacks_provided.after_analysis(callbacks, compiler, tcx) === "Stop") {
        return undefined;
      }

      // `pretty::emit_mir` (`--emit=mir`), `Linker::codegen_and_build_linker`, `dump_feature_usage_metrics`,
      // `tcx.report_unused_features()`: after analysis (M3+).
      return unported("rustc_interface::queue::Linker::codegen_and_build_linker (analysis, codegen; M3+)");
    });

    // Linking is done outside the `compiler.enter()` so that the
    // `GlobalCtxt` within `Queries` can be freed as early as possible.
    if (linker !== undefined) {
      void incr_comp_session;
      unported("rustc_interface::queue::Linker::link");
    }
  });
}

// `dump_feature_usage_metrics` (lib.rs:356): not ported (rustc_middle).

/// Extract output directory and file from matches.
// rustc: compiler/rustc_driver_impl/src/lib.rs:370 make_output
function make_output(matches: getopts.Matches): [PathBuf | undefined, OutFileName | undefined] {
  const odir = matches.opt_str("out-dir");
  const o = matches.opt_str("o");
  const ofile: OutFileName | undefined = o === undefined ? undefined : o === "-" ? { $: "Stdout" } : { $: "Real", _0: o };
  return [odir, ofile];
}

/// Extract input (string or file and optional path) from matches.
/// This handles reading from stdin if `-` is provided.
// rustc: compiler/rustc_driver_impl/src/lib.rs:381 make_input
function make_input(early_dcx: EarlyDiagCtxt, free_matches: readonly string[]): Input | undefined {
  if (free_matches.length === 0) {
    return undefined; // no input: we will exit early,
  } else if (free_matches.length === 1 && free_matches[0] === "-") {
    // read from stdin as `Input::Str`
    const input = stdin_read_to_string();
    if (input === undefined) {
      // Immediately stop compilation if there was an issue reading
      // the input (for example if the input stream is not UTF-8).
      early_dcx.early_fatal("couldn't read from stdin, as it did not contain valid UTF-8");
    }

    const path = env_var("UNSTABLE_RUSTDOC_TEST_PATH");
    if (path.$ === "Ok") {
      const line_r = env_var("UNSTABLE_RUSTDOC_TEST_LINE");
      if (line_r.$ === "Err") {
        panic(`when UNSTABLE_RUSTDOC_TEST_PATH is set UNSTABLE_RUSTDOC_TEST_LINE also needs to be set: ${line_r._0}`);
      }
      const line = parse_isize(line_r._0);
      if (line.$ === "Err") panic(`UNSTABLE_RUSTDOC_TEST_LINE needs to be a number: ParseIntError { kind: ${line._0} }`);
      return { $: "DocTestStr", file: path._0, line: line._0, input };
    } else {
      const name = FileName.anon_source_code(input);
      return { $: "Str", name, input };
    }
  } else if (free_matches.length === 1) {
    return { $: "File", _0: free_matches[0]! };
  } else {
    return early_dcx.early_fatal(
      `multiple input filenames provided (first two filenames are \`${free_matches[0]}\` and \`${free_matches[1]}\`)`,
    );
  }
}

/** `io::stdin().read_to_string(&mut input)`: `undefined` when it is an `Err` (invalid UTF-8 or a
 *  read error). PORT: a closed stdin (EBADF) reads as empty, as std's `handle_ebadf` does. */
function stdin_read_to_string(): string | undefined {
  let bytes: Uint8Array;
  try {
    bytes = readFileSync(0);
  } catch (e) {
    if ((e as { code?: string }).code === "EBADF") return "";
    return undefined;
  }
  const r = from_utf8(bytes);
  return r.$ === "Ok" ? r._0 : undefined;
}

/** `env::var(key)`: `Err` carries the `VarError` Debug (`NotPresent`; `NotUnicode(..)` cannot be
 *  told apart in JS, see src/std/env.ts). */
function env_var(key: string): { $: "Ok"; _0: string } | { $: "Err"; _0: string } {
  const v = process.env[key];
  return v === undefined ? { $: "Err", _0: "NotPresent" } : { $: "Ok", _0: v };
}

/** `str::parse::<isize>()` (64-bit): the value, or the `IntErrorKind` name. */
function parse_isize(s: string): { $: "Ok"; _0: number } | { $: "Err"; _0: string } {
  if (s === "") return { $: "Err", _0: "Empty" };
  let digits = s;
  let neg = false;
  if (s[0] === "+" || s[0] === "-") {
    neg = s[0] === "-";
    digits = s.slice(1);
    if (digits === "") return { $: "Err", _0: "InvalidDigit" };
  }
  if (!/^[0-9]+$/.test(digits)) return { $: "Err", _0: "InvalidDigit" };
  const v = neg ? -BigInt(digits) : BigInt(digits);
  if (v > 0x7fff_ffff_ffff_ffffn) return { $: "Err", _0: "PosOverflow" };
  if (v < -0x8000_0000_0000_0000n) return { $: "Err", _0: "NegOverflow" };
  // PORT: `isize` line numbers beyond 2^53 lose precision (a doctest line number never gets there).
  return { $: "Ok", _0: Number(v) };
}

/// Whether to stop or continue compilation.
// #[derive(Copy, Clone, Debug, Eq, PartialEq)]
export type Compilation = "Stop" | "Continue";

// `handle_explain` (lib.rs:426), `show_md_content_with_pager` (471), `show_colored_md_content` (534),
// `process_rlink` (557), `list_metadata` (597): not ported (error-code docs registry, pager, markdown
// rendering, rustc_metadata).
function handle_explain(_early_dcx: EarlyDiagCtxt, code: string, _color: unknown): void {
  unported(`rustc_driver_impl::handle_explain (--explain ${code})`);
}

// rustc: compiler/rustc_driver_impl/src/lib.rs:629 print_crate_info
export function print_crate_info(codegen_backend: CodegenBackend, sess: Session, parse_attrs: boolean): Compilation {
  // use rustc_session::config::PrintKind::*;
  // This import prevents the following code from using the printing macros
  // used by the rest of the module. Within this function, we only write to
  // the output specified by `sess.io.output_file`.
  // #[allow(unused_imports)]
  // use {do_not_use_safe_print as safe_print, do_not_use_safe_print as safe_println};

  // NativeStaticLibs and LinkArgs are special - printed during linking
  // (empty iterator returns true)
  if (sess.opts.prints.every((p) => p.kind === "NativeStaticLibs" || p.kind === "LinkArgs")) {
    return "Continue";
  }

  let attrs: AttrVec | undefined;
  if (parse_attrs) {
    const result = parse_crate_attrs(sess);
    switch (result.$) {
      case "Ok":
        attrs = result._0;
        break;
      case "Err": {
        const parse_error = result._0;
        parse_error.emit();
        return "Stop";
      }
    }
  } else {
    attrs = undefined;
  }

  for (const req of sess.opts.prints) {
    let crate_info = "";
    // macro println_info
    const println_info = (s: string): void => {
      crate_info += `${s}\n`;
    };

    switch (req.kind) {
      case "TargetList": {
        const targets = [...target_spec.TARGETS];
        targets.sort(str_cmp);
        println_info(targets.join("\n"));
        break;
      }
      case "HostTuple":
        println_info(host_tuple());
        break;
      case "WasmProcMacroTuple":
        println_info(TargetTuple.display(sess.wasm_proc_macro_tuple));
        break;
      case "Sysroot":
        println_info(sess.opts.sysroot.path());
        break;
      case "TargetLibdir":
        println_info(sess.target_tlib_path.dir);
        break;
      case "TargetSpecJson":
        println_info(to_string_pretty(Target_to_json(sess.target)));
        break;
      case "TargetSpecJsonSchema":
        // `rustc_target::spec::json_schema()` (schemars)
        return unported("rustc_target::spec::json_schema (--print target-spec-json-schema)");
      case "AllTargetSpecsJson": {
        const targets = new JsonObject();
        for (const name of target_spec.TARGETS) {
          const triple = TargetTuple.from_tuple(name);
          const target = target_spec.Target.expect_builtin(triple);
          targets.insert(name, Target_to_json(target));
        }
        println_info(to_string_pretty(targets));
        break;
      }
      case "FileNames":
        if (attrs === undefined) {
          // no crate attributes, print out an error and exit
          return "Continue";
        }
        {
          const t_outputs = build_output_filenames(attrs, sess);
          const crate_name = passes.get_crate_name(sess, attrs);
          const crate_types = passes.collect_crate_types(sess, codegen_backend.supported_crate_types(sess), codegen_backend.name(), attrs, DUMMY_SP);
          for (const style of crate_types) {
            const fname = filename_for_input(sess, style, crate_name, t_outputs);
            const file_name = path_file_name(fname.$ === "Real" ? fname._0 : "stdout");
            if (file_name === undefined) panic("called `Option::unwrap()` on a `None` value");
            println_info(file_name);
          }
        }
        break;
      case "CrateName":
        if (attrs === undefined) {
          // no crate attributes, print out an error and exit
          return "Continue";
        }
        println_info(Symbol.as_str(passes.get_crate_name(sess, attrs)));
        break;
      case "CrateRootLintLevels":
        if (attrs === undefined) {
          // no crate attributes, print out an error and exit
          return "Continue";
        }
        // rustc_lint `LintLevelsBuilder::crate_root`, rustc_expand `features`, rustc_resolve tools
        return unported("rustc_driver_impl::print_crate_info (--print crate-root-lint-levels)");
      case "Cfg": {
        const cfgs = sess.config
          .iter()
          .map(([name, value]) => {
            // On stable, exclude unstable flags.
            if (!sess.is_nightly_build() && find_gated_cfg(name) !== undefined) {
              return undefined;
            }

            if (value !== undefined) {
              return `${Symbol.as_str(name)}="${Symbol.as_str(value)}"`;
            } else {
              return Symbol.as_str(name);
            }
          })
          .filter((c): c is string => c !== undefined);

        cfgs.sort(str_cmp);
        for (const cfg of cfgs) {
          println_info(cfg);
        }
        break;
      }
      case "CheckCfg": {
        const check_cfgs: string[] = [];

        // INSTABILITY: We are sorting the output below.
        // #[allow(rustc::potential_query_instability)]
        for (const [name, expected_values] of sess.check_config.expecteds) {
          switch (expected_values.$) {
            case "Any":
              check_cfgs.push(`cfg(${Symbol.as_str(name)}, values(any()))`);
              break;
            case "Some": {
              const values = [...expected_values._0].map((value) => {
                if (value !== undefined) {
                  return `"${Symbol.as_str(value)}"`;
                } else {
                  return "none()";
                }
              });

              values.sort(str_cmp);

              const values_ = values.join(", ");

              check_cfgs.push(`cfg(${Symbol.as_str(name)}, values(${values_}))`);
              break;
            }
          }
        }

        check_cfgs.sort(str_cmp);
        if (!sess.check_config.exhaustive_names && sess.check_config.exhaustive_values) {
          println_info("cfg(any())");
        }
        for (const check_cfg of check_cfgs) {
          println_info(check_cfg);
        }
        break;
      }
      case "CallingConventions":
        // `rustc_abi::all_names()`
        return unported("rustc_abi::all_names (--print calling-conventions)");
      case "BackendHasMnemonic":
        // `codegen_backend.has_mnemonic(sess, req.arg)`
        return unported("rustc_codegen_llvm::llvm_util::target_has_mnemonic (--print backend-has-mnemonic)");
      case "BackendHasZstd":
        // `codegen_backend.has_zstd()`
        return unported("rustc_codegen_llvm::LLVMRustLLVMHasZstdCompression (--print backend-has-zstd)");
      case "RelocationModels":
      case "CodeModels":
      case "TlsModels":
      case "TargetCPUs":
      case "StackProtectorStrategies":
      case "TargetFeatures":
        // `codegen_backend.print(req, &mut crate_info, sess)`
        void codegen_backend;
        return unported(`rustc_codegen_llvm::LlvmCodegenBackend::print (--print ${req.kind})`);
      // Any output here interferes with Cargo's parsing of other printed output
      case "NativeStaticLibs":
        break;
      case "LinkArgs":
        break;
      case "SplitDebuginfo": {
        // use rustc_target::spec::SplitDebuginfo::{Off, Packed, Unpacked};

        for (const split of ["Off", "Packed", "Unpacked"] as const) {
          if (sess.target.options.supported_split_debuginfo.includes(split)) {
            println_info(target_spec.SplitDebuginfo.display(split));
          }
        }
        break;
      }
      case "DeploymentTarget":
        if (sess.target.is_like_darwin) {
          // `deployment_target_env_var(&sess.target.os)` = `sess.apple_deployment_target().fmt_pretty()`
          return unported("rustc_session::session::EarlySession::apple_deployment_target (--print deployment-target)");
        } else {
          sess.dcx().fatal("only Apple targets currently support deployment version info");
        }
        break;
      case "SupportedCrateTypes":
      {
        // `BTreeSet<Symbol>`: `Symbol`'s `Ord` is its index (all predefined here).
        const supported_crate_types = [
          ...new Set(
            CrateTypeC.all()
              .filter(([, crate_type]) => !invalid_output_for_target(sess, crate_type))
              .filter(([, crate_type]) => crate_type !== "Sdylib")
              .map(([crate_type_sym]) => crate_type_sym),
          ),
        ].sort((a, b) => Symbol.as_u32(a) - Symbol.as_u32(b));
        for (const supported_crate_type of supported_crate_types) {
          println_info(Symbol.as_str(supported_crate_type));
        }
        break;
      }
    }

    OutFileNameImpl.overwrite(req.out, crate_info, sess);
  }
  return "Stop";
}

/// Prints version information
///
/// NOTE: this is a macro to support drivers built at a different time than the main `rustc_driver` crate.
// `pub macro version($early_dcx, $binary, $matches)`
export function version(early_dcx: EarlyDiagCtxt, binary: string, matches: getopts.Matches): void {
  // rustc: compiler/rustc_driver_impl/src/lib.rs:877 unw
  const unw = (x: string | undefined): string => x ?? "unknown";
  version_at_macro_invocation(early_dcx, binary, matches, unw(CFG_VERSION), unw(CFG_VER_HASH), unw(CFG_VER_DATE), unw(CFG_RELEASE));
}

// #[doc(hidden)] // use the macro instead
// rustc: compiler/rustc_driver_impl/src/lib.rs:892 version_at_macro_invocation
export function version_at_macro_invocation(
  early_dcx: EarlyDiagCtxt,
  binary: string,
  matches: getopts.Matches,
  version0: string,
  commit_hash: string,
  commit_date: string,
  release0: string,
): void {
  const verbose = matches.opt_present("verbose");

  let version = version0;
  let release = release0;
  const force_version = process.env.RUSTC_OVERRIDE_VERSION_STRING;
  if (force_version !== undefined) {
    version = force_version;
    release = force_version;
  }

  safe_println(`${binary} ${version}`);

  if (verbose) {
    safe_println(`binary: ${binary}`);
    safe_println(`commit-hash: ${commit_hash}`);
    safe_println(`commit-date: ${commit_date}`);
    safe_println(`host: ${host_tuple()}`);
    safe_println(`release: ${release}`);

    get_backend_from_raw_matches(early_dcx, matches).print_version();
  }
}

// rustc: compiler/rustc_driver_impl/src/lib.rs:925 usage
function usage(verbose: boolean, include_unstable_options: boolean, nightly_build: boolean): void {
  const options = getopts.Options.new();
  for (const option of rustc_optgroups()
    .filter((x) => verbose || !x.is_verbose_help_only)
    .filter((x) => include_unstable_options || x.is_stable())) {
    option.apply(options);
  }
  const message = "Usage: rustc [OPTIONS] INPUT";
  const nightly_help = nightly_build ? "\n    -Z help             Print unstable compiler options" : "";
  const verbose_help = verbose ? "" : "\n    --help -v           Print the full set of options rustc accepts";
  const at_path = verbose ? "    @path               Read newline separated options from `path`\n" : "";
  safe_println(
    `${options.usage(message)}${at_path}\nAdditional help:
    -C help             Print codegen options
    -W help             Print 'lint' options and default settings${nightly_help}${verbose_help}\n`,
  );
}

// rustc: compiler/rustc_driver_impl/src/lib.rs:962 print_wall_help
function print_wall_help(): void {
  safe_println(`
The flag \`-Wall\` does not exist in \`rustc\`. Most useful lints are enabled by
default. Use \`rustc -W help\` to see all available lints. It's more common to put
warning settings in the crate root using \`#![warn(LINT_NAME)]\` instead of using
the command line flag directly.
`);
}

/// Write to stdout lint command options, together with a list of all available lints
// `describe_lints` (lib.rs:974): not ported (needs the lint store, rustc_lint).
export function describe_lints(_sess: Session, _registered_lints: boolean): void {
  unported("rustc_driver_impl::describe_lints (-W help)");
}

/// Show help for flag categories shared between rustdoc and rustc.
///
/// Returns whether a help option was printed.
// rustc: compiler/rustc_driver_impl/src/lib.rs:1102 describe_flag_categories
export function describe_flag_categories(early_dcx: EarlyDiagCtxt, matches: getopts.Matches): boolean {
  // Handle the special case of -Wall.
  const wall = matches.opt_strs("W");
  if (wall.some((x) => x === "all")) {
    print_wall_help();
    return true;
  }

  // Don't handle -W help here, because we might first load additional lints.
  const debug_flags = matches.opt_strs("Z");
  if (debug_flags.some((x) => x === "help")) {
    describe_unstable_flags();
    return true;
  }

  const cg_flags = matches.opt_strs("C");
  if (cg_flags.some((x) => x === "help")) {
    describe_codegen_flags();
    return true;
  }

  if (cg_flags.some((x) => x === "passes=list")) {
    get_backend_from_raw_matches(early_dcx, matches).print_passes();
    return true;
  }

  return false;
}

/// Get the codegen backend based on the raw [`Matches`].
///
/// `rustc -vV` and `rustc -Cpasses=list` need to get the codegen backend before we have parsed all
/// arguments and created a [`Session`]. This function reads `-Zcodegen-backend`, `--target` and
/// `--sysroot` without validating any other arguments and loads the codegen backend based on these
/// arguments.
// rustc: compiler/rustc_driver_impl/src/lib.rs:1137 get_backend_from_raw_matches
function get_backend_from_raw_matches(early_dcx: EarlyDiagCtxt, matches: getopts.Matches): CodegenBackend {
  const debug_flags = matches.opt_strs("Z");
  let backend_name: string | undefined;
  for (const x of debug_flags) {
    if (x.startsWith("codegen-backend=")) {
      backend_name = x.slice("codegen-backend=".length);
      break;
    }
    if (x.startsWith("codegen_backend=")) {
      backend_name = x.slice("codegen_backend=".length);
      break;
    }
  }
  const unstable_options = debug_flags.find((x) => x === "unstable-options") !== undefined;
  const target_tuple = parse_target_triple(early_dcx, matches);
  const sysroot = Sysroot.new(matches.opt_str("sysroot"));
  const target = build_target_config(early_dcx, target_tuple, sysroot.path(), unstable_options);

  return get_codegen_backend(early_dcx, sysroot, backend_name, target);
}

// rustc: compiler/rustc_driver_impl/src/lib.rs:1153 describe_unstable_flags
function describe_unstable_flags(): void {
  safe_println("\nAvailable unstable options:\n");
  print_flag_list("-Z", Z_OPTIONS);
}

// rustc: compiler/rustc_driver_impl/src/lib.rs:1158 describe_codegen_flags
function describe_codegen_flags(): void {
  safe_println("\nAvailable codegen options:\n");
  print_flag_list("-C", CG_OPTIONS);
}

// rustc: compiler/rustc_driver_impl/src/lib.rs:1163 print_flag_list
function print_flag_list<T>(cmdline_opt: string, flag_list: readonly OptionDesc<T>[]): void {
  let max_len = 0;
  for (const opt_desc of flag_list) max_len = Math.max(max_len, Array.from(OptionDescC.name(opt_desc)).length);

  for (const opt_desc of flag_list) {
    const name = OptionDescC.name(opt_desc).replaceAll("_", "-");
    // `{:>width$}`: right-aligned, padded with spaces to `width` chars.
    const pad = " ".repeat(Math.max(0, max_len - Array.from(name).length));
    safe_println(`    ${cmdline_opt} ${pad}${name}=val -- ${OptionDescC.desc(opt_desc)}`);
  }
}

export type HandledOptions =
  /// Parsing failed, or we parsed a flag causing an early exit
  | { readonly $: "None" }
  /// Successful parsing
  | { readonly $: "Normal"; readonly _0: getopts.Matches }
  /// Parsing succeeded, but we received one or more 'help' flags
  /// The compiler should proceed only until a possible `-W help` flag has been processed
  | { readonly $: "HelpOnly"; readonly _0: getopts.Matches };

/// Process command line options. Emits messages as appropriate. If compilation
/// should continue, returns a getopts::Matches object parsed from args,
/// otherwise returns `None`.
///
/// The compiler's handling of options is a little complicated as it ties into
/// our stability story. The current intention of each compiler option is to
/// have one of two modes:
///
/// 1. An option is stable and can be used everywhere.
/// 2. An option is unstable, and can only be used on nightly.
///
/// Like unstable library and language features, however, unstable options have
/// always required a form of "opt in" to indicate that you're using them. This
/// provides the easy ability to scan a code base to check to see if anything
/// unstable is being used. Currently, this "opt in" is the `-Z` "zed" flag.
///
/// All options behind `-Z` are considered unstable by default. Other top-level
/// options can also be considered unstable, and they were unlocked through the
/// `-Z unstable-options` flag. Note that `-Z` remains to be the root of
/// instability in both cases, though.
///
/// So with all that in mind, the comments below have some more detail about the
/// contortions done here to get things to work out correctly.
///
/// This does not need to be `pub` for rustc itself, but @chaosite needs it to
/// be public when using rustc as a library, see
/// <https://github.com/rust-lang/rust/commit/2b4c33817a5aaecabf4c6598d41e190080ec119e>
// rustc: compiler/rustc_driver_impl/src/lib.rs:1215 handle_options
export function handle_options(early_dcx: EarlyDiagCtxt, args: readonly string[]): HandledOptions {
  // Parse with *all* options defined in the compiler, we don't worry about
  // option stability here we just want to parse as much as possible.
  const options = getopts.Options.new();
  const optgroups = rustc_optgroups();
  for (const option of optgroups) {
    option.apply(options);
  }
  const parsed = options.parse(args);
  if (parsed.$ === "Err") {
    const e = parsed._0;
    let msg: string | undefined;
    switch (e.$) {
      case "UnrecognizedOption": {
        const opt = e._0;
        const all: [string, string][] = [
          ...CG_OPTIONS.map((opt_desc): [string, string] => ["C", OptionDescC.name(opt_desc)]),
          ...Z_OPTIONS.map((opt_desc): [string, string] => ["Z", OptionDescC.name(opt_desc)]),
        ];
        const found = all.find(([_, name]) => opt === name.replaceAll("_", "-"));
        msg = found === undefined ? undefined : `${getopts.display_Fail(e)}. Did you mean \`-${found[0]} ${opt}\`?`;
        break;
      }
      case "ArgumentMissing": {
        const opt = e._0;
        const option = optgroups.find((option) => option.name === opt);
        if (option !== undefined) {
          // Print the help just for the option in question.
          const options = getopts.Options.new();
          option.apply(options);
          // getopt requires us to pass a function for joining an iterator of
          // strings, even though in this case we expect exactly one string.
          msg = options.usage_with_format((it) => {
            let a = `${getopts.display_Fail(e)}\nUsage:`;
            for (const b of it) a = `${a}\n${b}`;
            return a;
          });
        } else {
          msg = undefined;
        }
        break;
      }
      default:
        msg = undefined;
    }
    early_dcx.early_fatal(msg ?? getopts.display_Fail(e));
  }
  const matches = parsed._0;

  // For all options we just parsed, we check a few aspects:
  //
  // * If the option is stable, we're all good
  // * If the option wasn't passed, we're all good
  // * If `-Z unstable-options` wasn't passed (and we're not a -Z option
  //   ourselves), then we require the `-Z unstable-options` flag to unlock
  //   this option that was passed.
  // * If we're a nightly compiler, then unstable options are now unlocked, so
  //   we're good to go.
  // * Otherwise, if we're an unstable option then we generate an error
  //   (unstable option being used on stable)
  nightly_options.check_nightly_options(early_dcx, matches, rustc_optgroups());

  // Handle the special case of -Wall.
  const wall = matches.opt_strs("W");
  if (wall.some((x) => x === "all")) {
    print_wall_help();
    return { $: "None" };
  }

  if (handle_help(matches, args)) {
    return { $: "HelpOnly", _0: matches };
  }

  if (matches.opt_strs("C").some((x) => x === "passes=list")) {
    get_backend_from_raw_matches(early_dcx, matches).print_passes();
    return { $: "None" };
  }

  if (matches.opt_present("version")) {
    version(early_dcx, "rustc", matches);
    return { $: "None" };
  }

  warn_on_confusing_output_filename_flag(early_dcx, matches, args);

  return { $: "Normal", _0: matches };
}

/// Handle help options in the order they are provided, ignoring other flags. Returns if any options were handled
/// Handled options:
/// - `-h`/`--help`/empty arguments
/// - `-Z help`
/// - `-C help`
/// NOTE: `-W help` is NOT handled here, as additional lints may be loaded.
// rustc: compiler/rustc_driver_impl/src/lib.rs:1293 handle_help
export function handle_help(matches: getopts.Matches, args: readonly string[]): boolean {
  const opt_pos = (opt: string): number | undefined => matches.opt_positions(opt)[0];
  const opt_help_pos = (opt: string): number | undefined => {
    for (const [pos, oval] of matches.opt_strs_pos(opt)) {
      if (oval === "help") return pos;
    }
    return undefined;
  };
  const help_pos = args.length === 0 ? 0 : (opt_pos("h") ?? opt_pos("help"));
  const zhelp_pos = opt_help_pos("Z");
  const chelp_pos = opt_help_pos("C");
  const print_help = (): void => {
    // Only show unstable options in --help if we accept unstable options.
    const unstable_enabled = nightly_options.is_unstable_enabled(matches);
    const nightly_build = nightly_options.match_is_nightly_build(matches);
    usage(matches.opt_present("verbose"), unstable_enabled, nightly_build);
  };

  const helps: [number | undefined, () => void][] = [
    [help_pos, print_help],
    [zhelp_pos, describe_unstable_flags],
    [chelp_pos, describe_codegen_flags],
  ];
  // `sort_by_key(|(pos, _)| pos.clone())`: stable; `None` sorts before `Some`.
  helps.sort((a, b) => (a[0] === undefined ? (b[0] === undefined ? 0 : -1) : b[0] === undefined ? 1 : a[0] - b[0]));
  let printed_any = false;
  for (const [pos, printer] of helps) {
    if (pos === undefined) continue;
    printer();
    printed_any = true;
  }
  return printed_any;
}

/// Warn if `-o` is used without a space between the flag name and the value
/// and the value is a high-value confusables,
/// e.g. `-optimize` instead of `-o optimize`, see issue #142812.
// rustc: compiler/rustc_driver_impl/src/lib.rs:1329 warn_on_confusing_output_filename_flag
function warn_on_confusing_output_filename_flag(early_dcx: EarlyDiagCtxt, matches: getopts.Matches, args: readonly string[]): void {
  // rustc: compiler/rustc_driver_impl/src/lib.rs:1334 eq_ignore_separators
  function eq_ignore_separators(s1: string, s2: string): boolean {
    const a = s1.replaceAll("-", "_");
    const b = s2.replaceAll("-", "_");
    return a === b;
  }

  const name = matches.opt_str("o");
  const suspect = name === undefined ? undefined : args.find((arg) => arg.startsWith("-o") && arg !== "-o");
  if (name !== undefined && suspect !== undefined) {
    const filename = suspect.startsWith("-") ? suspect.slice(1) : suspect;
    const optgroups = rustc_optgroups();
    const fake_args = ["optimize", "o0", "o1", "o2", "o3", "ofast", "og", "os", "oz"];

    // Check if provided filename might be confusing in conjunction with `-o` flag,
    // i.e. consider `-o{filename}` such as `-optimize` with `filename` being `ptimize`.
    // There are high-value confusables, for example:
    // - Long name of flags, e.g. `--out-dir` vs `-out-dir`
    // - C compiler flag, e.g. `optimize`, `o0`, `o1`, `o2`, `o3`, `ofast`.
    // - Codegen flags, e.g. `pt-level` of `-opt-level`.
    if (
      optgroups.some((option) => eq_ignore_separators(option.long_name(), filename)) ||
      CG_OPTIONS.some((option) => eq_ignore_separators(OptionDescC.name(option), filename)) ||
      fake_args.some((arg) => eq_ignore_separators(arg, filename))
    ) {
      early_dcx
        .early_struct_warn("option `-o` has no space between flag name and value, which can be confusing")
        .with_note(`output filename \`-o ${name}\` is applied instead of a flag named \`o${name}\``)
        .with_help(`insert a space between \`-o\` and \`${name}\` if this is intentional: \`-o ${name}\``)
        .emit();
    }
  }
}

// rustc: compiler/rustc_driver_impl/src/lib.rs:1372 parse_crate_attrs
function parse_crate_attrs(sess: Session): PResult<AttrVec> {
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
  return parser.parse_inner_attributes();
}

/// Variant of `catch_fatal_errors` for the `interface::Result` return type
/// that also computes the exit code.
// rustc: compiler/rustc_driver_impl/src/lib.rs:1391 catch_with_exit_code
export function catch_with_exit_code(f: () => void): number {
  const r = catch_fatal_errors(f);
  if (r.$ === "Ok") {
    // `().report()` -> `ExitCode::SUCCESS`
    return EXIT_SUCCESS;
  }
  return EXIT_FAILURE;
}

/** `static ICE_PATH: OnceLock<Option<PathBuf>>` */
let ICE_PATH: { value: PathBuf | undefined } | undefined;

// This function should only be called from the ICE hook.
//
// The intended behavior is that `compiler_entrypoint` will invoke `ice_path_with_config` early in the
// initialization process to properly initialize the ICE_PATH static based on parsed CLI flags.
//
// Subsequent calls to either function will then return the proper ICE path as configured by
// the environment and cli flags
// rustc: compiler/rustc_driver_impl/src/lib.rs:1407 ice_path
export function ice_path(): PathBuf | undefined {
  return ice_path_with_config(undefined);
}

// rustc: compiler/rustc_driver_impl/src/lib.rs:1411 ice_path_with_config
function ice_path_with_config(config: UnstableOptions | undefined): PathBuf | undefined {
  // `if ICE_PATH.get().is_some() && config.is_some() && cfg!(debug_assertions) { tracing::warn!(..) }`:
  // rustc ships without debug assertions.

  ICE_PATH ??= {
    value: ((): PathBuf | undefined => {
      if (!UnstableFeatures.is_nightly_build(UnstableFeatures.from_environment(undefined))) {
        return undefined;
      }
      let path: PathBuf;
      const s = process.env.RUSTC_ICE;
      if (s !== undefined) {
        if (s === "0") {
          // Explicitly opting out of writing ICEs to disk.
          return undefined;
        }
        if (config !== undefined && config.metrics_dir !== undefined) {
          tracing.warn("rustc_driver_impl", () => "ignoring -Zmetrics-dir in favor of RUSTC_ICE for destination of ICE report files");
        }
        path = s;
      } else {
        path = config?.metrics_dir ?? process.cwd();
      }
      // Don't use a standard datetime format because Windows doesn't support `:` in paths
      const file_now = strftime_ice(new Date());
      const pid = process.pid;
      return path_push(path, `rustc-ice-${file_now}-${pid}.txt`);
    })(),
  };
  return ICE_PATH.value;
}

/** `jiff::Zoned::now().strftime("%Y-%m-%dT%H_%M_%S")` (local time). */
function strftime_ice(d: Date): string {
  const p = (n: number, w = 2): string => String(n).padStart(w, "0");
  return `${p(d.getFullYear(), 4)}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}_${p(d.getMinutes())}_${p(d.getSeconds())}`;
}

/** `PathBuf::push` of a relative file name. */
function path_push(base: PathBuf, name: string): PathBuf {
  if (base === "") return name;
  const sep = process.platform === "win32" ? "\\" : "/";
  return base.endsWith("/") || (process.platform === "win32" && base.endsWith("\\")) ? `${base}${name}` : `${base}${sep}${name}`;
}

/** `pub static USING_INTERNAL_FEATURES: AtomicBool` */
export const USING_INTERNAL_FEATURES: { value: boolean } = { value: false };

/// Installs a panic hook that will print the ICE message on unexpected panics.
///
/// The hook is intended to be useable even by external tools. You can pass a custom
/// `bug_report_url`, or report arbitrary info in `extra_info`. Note that `extra_info` is called in
/// a context where *the thread is currently panicking*, so it must not panic or the process will
/// abort.
///
/// If you have no extra info to report, pass the empty closure `|_| ()` as the argument to
/// extra_info.
///
/// A custom rustc driver can skip calling this to set up a custom ICE hook.
// rustc: compiler/rustc_driver_impl/src/lib.rs:1459 install_ice_hook
export function install_ice_hook(_bug_report_url: string, _extra_info: unknown): void {
  // If the user has not explicitly overridden "RUST_BACKTRACE", then produce
  // full backtraces. When a compiler ICE happens, we want to gather
  // as much information as possible to present in the issue opened
  // by the user. Compiler developers and other rustc users can
  // opt in to less-verbose backtraces by manually setting "RUST_BACKTRACE"
  // (e.g. `RUST_BACKTRACE=1`)
  if (process.env.RUST_BACKTRACE === undefined) {
    // HACK: this check is extremely dumb, but we don't really need it to be smarter since this should only happen in the test suite anyway.
    // PORT: `std::env::args()` panics on a non-Unicode argument (before the hook below exists), which
    // is how rustc reacts to one when `RUST_BACKTRACE` is unset.
    const ui_testing = env.args().some((arg) => arg === "-Zui-testing");
    // PORT: `panic::set_backtrace_style(Short | Full)` has no observable counterpart: rust-ts prints
    // no Rust backtraces.
    void (CFG_RELEASE_CHANNEL === "dev" && !ui_testing);
  }

  // `panic::update_hook(..)` with `report_ice` (lib.rs:1538): PORT: not ported. An ICE (uncaught
  // `Panic`) is reported by src/rust_ts/main.ts (exit 101); the upstream report embeds the Rust panic
  // location and backtrace, which rust-ts cannot reproduce.
}

/** `env!("CFG_RELEASE_CHANNEL")` of the oracle toolchain. */
const CFG_RELEASE_CHANNEL: string = "nightly";

/// This allows tools to enable rust logging without having to magically match rustc's
/// tracing crate version.
// rustc: compiler/rustc_driver_impl/src/lib.rs:1630 init_rustc_env_logger
export function init_rustc_env_logger(early_dcx: EarlyDiagCtxt): void {
  init_logger(early_dcx, rustc_log.LoggerConfig.from_env("RUSTC_LOG"));
}

/// This allows tools to enable rust logging without having to magically match rustc's
/// tracing crate version. In contrast to `init_rustc_env_logger` it allows you to choose
/// the logger config directly rather than having to set an environment variable.
// rustc: compiler/rustc_driver_impl/src/lib.rs:1637 init_logger
export function init_logger(early_dcx: EarlyDiagCtxt, cfg: rustc_log.LoggerConfig): void {
  const r = rustc_log.init_logger(cfg);
  if (r.$ === "Err") {
    const error = r._0;
    early_dcx.early_fatal(rustc_log.display_Error(error));
  }
}

// `init_logger_with_additional_layer` (1648): not ported (no caller; tools only).

/// Install our usual `ctrlc` handler, which sets [`rustc_const_eval::CTRL_C_RECEIVED`].
/// Making this handler optional lets tools can install a different handler, if they wish.
// PORT: not ported (no marker). The handler sets `rustc_const_eval::CTRL_C_RECEIVED` (rustc_const_eval is
// unported), sleeps 100 ms and exits with status 1. A JS signal handler only runs when the event loop
// is idle, i.e. after the synchronous compilation has finished, so installing one would make Ctrl-C
// ineffective; the default SIGINT action applies instead (the process dies by SIGINT, not exit 1).

// rustc: compiler/rustc_driver_impl/src/lib.rs:1677 main
export function main(): number {
  // let start_time = Instant::now();
  // let start_rss = get_resident_set_size();

  const early_dcx = EarlyDiagCtxt.new(ErrorOutputType.default());

  init_rustc_env_logger(early_dcx);
  signal_handler.install();
  const callbacks = TimePassesCallbacks.default();
  install_ice_hook(DEFAULT_BUG_REPORT_URL, () => {});
  // `install_ctrlc_handler()`: see above.

  const exit_code = catch_with_exit_code(() => compiler_entrypoint(raw_args(early_dcx), callbacks));

  if (callbacks.time_passes !== undefined) {
    // `print_time_passes_entry("total", start_time.elapsed(), start_rss, end_rss, format)`
    unported("rustc_data_structures::profiling::print_time_passes_entry (-Z time-passes)");
  }

  return exit_code;
}
