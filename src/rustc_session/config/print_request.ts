//! Code for dealing with `--print` requests.
// Port of compiler/rustc_session/src/config/print_request.rs.
// LOAD ORDER (see config.ts header): options.ts before config.ts.
import "../options.ts";
import { type Debug, debug_option, debug_str, debug_struct } from "../../std/fmt.ts";
import type { CodegenOptions, UnstableOptions } from "../options.ts";
import type { EarlyDiagCtxt } from "../stand_ins.ts";
import type { Matches } from "../../vendor/getopts/lib.ts";
import { type OutFileName, OutFileName as OutFileNameC, debug_OutFileName, nightly_options, split_out_file_name } from "../config.ts";

// #[derive(Clone, PartialEq, Debug)]
export interface PrintRequest {
  kind: PrintKind;
  out: OutFileName;
  arg: string | undefined;
}
export const debug_PrintRequest: Debug<PrintRequest> = (v, f) =>
  debug_struct(f, "PrintRequest", [
    ["kind", debug_PrintKind(v.kind, f)],
    ["out", debug_OutFileName(v.out, f)],
    ["arg", debug_option(v.arg, f, (s) => debug_str(s))],
  ]);

// #[derive(Copy, Clone, PartialEq, Eq, Debug)]
// #[derive(AllVariants)]
export type PrintKind =
  // tidy-alphabetical-start
  /// All target JSON specifications.
  | "AllTargetSpecsJson"
  /// Does the backend supports the [`PrintRequest::arg`] `asm!()` mnemonic? (perma-unstable)
  | "BackendHasMnemonic"
  /// Does the backend supports Zstd compression? (perma-unstable)
  | "BackendHasZstd"
  /// List of all calling conventions supported by rustc.
  | "CallingConventions"
  /// List of cfg values.
  | "Cfg"
  /// List of check-cfg values.
  | "CheckCfg"
  /// List of available code models for the current backend.
  | "CodeModels"
  /// Name of the crate being compiled.
  | "CrateName"
  /// Lint levels of the crate's root module.
  | "CrateRootLintLevels"
  /// The current selected deployment target. (Apple only)
  | "DeploymentTarget"
  /// The names of the files created by the `--emit=link` option. (e.g. `libfoo.a`)
  | "FileNames"
  /// Target-tuple of the host compiler.
  | "HostTuple"
  /// Linker invocations.
  | "LinkArgs"
  /// When compiling a `staticlib` crate, print the linker flags used.
  | "NativeStaticLibs"
  /// List of available relocation models for the current backend.
  | "RelocationModels"
  /// List of available split debuginfos for the current target.
  | "SplitDebuginfo"
  /// List of available stack protector strategies for the current backend.
  | "StackProtectorStrategies"
  /// List of available crate types for the current target.
  | "SupportedCrateTypes"
  /// Path to the sysroot.
  | "Sysroot"
  /// List of available CPU values for the current target.
  | "TargetCPUs"
  /// List of available target features for the current target.
  | "TargetFeatures"
  /// Path to the target libdir.
  | "TargetLibdir"
  /// List of supported targets.
  | "TargetList"
  /// Current target JSON specification.
  | "TargetSpecJson"
  /// Target JSON specification schema.
  | "TargetSpecJsonSchema"
  /// List of available TLS models for the current backend.
  | "TlsModels"
  /// Target-tuple for WebAssembly's proc-macro crates.
  | "WasmProcMacroTuple";
// tidy-alphabetical-end
export const debug_PrintKind: Debug<PrintKind> = (v) => v;

// #[derive(Copy, Clone, PartialEq, Eq, Debug)]
// #[derive(AllVariants)]
export type PrintCategory = "Target" | "Codegen" | "Linker" | "Crate";
export const PrintCategory = {
  Target: "Target",
  Codegen: "Codegen",
  Linker: "Linker",
  Crate: "Crate",
  /** `#[derive(AllVariants)]` (macros.rs): declaration order. */
  ALL_VARIANTS: ["Target", "Codegen", "Linker", "Crate"] as readonly PrintCategory[],
} as const;

export const PrintKind = {
  /** `#[derive(AllVariants)]` (macros.rs): declaration order. */
  ALL_VARIANTS: [
    "AllTargetSpecsJson",
    "BackendHasMnemonic",
    "BackendHasZstd",
    "CallingConventions",
    "Cfg",
    "CheckCfg",
    "CodeModels",
    "CrateName",
    "CrateRootLintLevels",
    "DeploymentTarget",
    "FileNames",
    "HostTuple",
    "LinkArgs",
    "NativeStaticLibs",
    "RelocationModels",
    "SplitDebuginfo",
    "StackProtectorStrategies",
    "SupportedCrateTypes",
    "Sysroot",
    "TargetCPUs",
    "TargetFeatures",
    "TargetLibdir",
    "TargetList",
    "TargetSpecJson",
    "TargetSpecJsonSchema",
    "TlsModels",
    "WasmProcMacroTuple",
  ] as readonly PrintKind[],

  // rustc: compiler/rustc_session/src/config/print_request.rs:118 name
  name(self: PrintKind): string {
    switch (self) {
      // tidy-alphabetical-start
      case "AllTargetSpecsJson":
        return "all-target-specs-json";
      case "BackendHasMnemonic":
        return "backend-has-mnemonic";
      case "BackendHasZstd":
        return "backend-has-zstd";
      case "CallingConventions":
        return "calling-conventions";
      case "Cfg":
        return "cfg";
      case "CheckCfg":
        return "check-cfg";
      case "CodeModels":
        return "code-models";
      case "CrateName":
        return "crate-name";
      case "CrateRootLintLevels":
        return "crate-root-lint-levels";
      case "DeploymentTarget":
        return "deployment-target";
      case "FileNames":
        return "file-names";
      case "HostTuple":
        return "host-tuple";
      case "LinkArgs":
        return "link-args";
      case "NativeStaticLibs":
        return "native-static-libs";
      case "RelocationModels":
        return "relocation-models";
      case "SplitDebuginfo":
        return "split-debuginfo";
      case "StackProtectorStrategies":
        return "stack-protector-strategies";
      case "SupportedCrateTypes":
        return "supported-crate-types";
      case "Sysroot":
        return "sysroot";
      case "TargetCPUs":
        return "target-cpus";
      case "TargetFeatures":
        return "target-features";
      case "TargetLibdir":
        return "target-libdir";
      case "TargetList":
        return "target-list";
      case "TargetSpecJson":
        return "target-spec-json";
      case "TargetSpecJsonSchema":
        return "target-spec-json-schema";
      case "TlsModels":
        return "tls-models";
      case "WasmProcMacroTuple":
        return "wasm-proc-macro-tuple";
      // tidy-alphabetical-end
    }
  },

  // rustc: compiler/rustc_session/src/config/print_request.rs:153 category
  category(self: PrintKind): PrintCategory {
    switch (self) {
      case "TargetList":
      case "TargetSpecJsonSchema":
      case "AllTargetSpecsJson":
      case "TargetSpecJson":
      case "TargetCPUs":
      case "TargetFeatures":
      case "DeploymentTarget":
      case "HostTuple":
      case "SupportedCrateTypes":
      case "Sysroot":
      case "TargetLibdir":
      case "Cfg":
      case "CheckCfg":
      case "WasmProcMacroTuple":
        return "Target";

      case "BackendHasMnemonic":
      case "BackendHasZstd":
      case "CallingConventions":
      case "CodeModels":
      case "SplitDebuginfo":
      case "StackProtectorStrategies":
      case "TlsModels":
      case "RelocationModels":
        return "Codegen";

      case "LinkArgs":
      case "NativeStaticLibs":
        return "Linker";

      case "CrateName":
      case "CrateRootLintLevels":
      case "FileNames":
        return "Crate";
    }
  },

  // rustc: compiler/rustc_session/src/config/print_request.rs:175 is_stable
  is_stable(self: PrintKind): boolean {
    switch (self) {
      // Stable values:
      case "CallingConventions":
      case "Cfg":
      case "CodeModels":
      case "CrateName":
      case "DeploymentTarget":
      case "FileNames":
      case "HostTuple":
      case "LinkArgs":
      case "NativeStaticLibs":
      case "RelocationModels":
      case "SplitDebuginfo":
      case "StackProtectorStrategies":
      case "Sysroot":
      case "TargetCPUs":
      case "TargetFeatures":
      case "TargetLibdir":
      case "TargetList":
      case "TlsModels":
        return true;

      // Unstable values:
      case "AllTargetSpecsJson":
        return false;
      case "BackendHasMnemonic":
        return false; // (perma-unstable, for use by compiletest)
      case "BackendHasZstd":
        return false; // (perma-unstable, for use by compiletest)
      case "CheckCfg":
        return false;
      case "CrateRootLintLevels":
        return false;
      case "SupportedCrateTypes":
        return false;
      case "TargetSpecJson":
        return false;
      case "TargetSpecJsonSchema":
        return false;
      case "WasmProcMacroTuple":
        return false;
    }
  },

  // rustc: compiler/rustc_session/src/config/print_request.rs:211 from_str
  from_str(s: string): PrintKind | undefined {
    return PrintKind.ALL_VARIANTS.find((kind) => PrintKind.name(kind) === s);
  },
} as const;

/** `impl fmt::Display for PrintKind` */
// rustc: compiler/rustc_session/src/config/print_request.rs:217 fmt
export function display_PrintKind(self: PrintKind): string {
  return PrintKind.name(self);
}

// pub(crate) static PRINT_HELP: LazyLock<String>
let PRINT_HELP_: string | undefined;
export function PRINT_HELP(): string {
  if (PRINT_HELP_ === undefined) {
    const print_kinds = PrintKind.ALL_VARIANTS.map((kind) => PrintKind.name(kind)).join("|");
    PRINT_HELP_ = `Compiler information to print on stdout (or to a file)\nINFO may be one of <${print_kinds}>.`;
  }
  return PRINT_HELP_;
}

// rustc: compiler/rustc_session/src/config/print_request.rs:231 collect_print_requests
export function collect_print_requests(
  early_dcx: EarlyDiagCtxt,
  cg: CodegenOptions,
  unstable_opts: UnstableOptions,
  matches: Matches,
  allowed: readonly PrintCategory[],
): PrintRequest[] {
  const prints: PrintRequest[] = [];
  if (cg.target_cpu === "help") {
    prints.push({ kind: "TargetCPUs", out: OutFileNameC.Stdout, arg: undefined });
    cg.target_cpu = undefined;
  }
  if (cg.target_feature === "help") {
    prints.push({ kind: "TargetFeatures", out: OutFileNameC.Stdout, arg: undefined });
    cg.target_feature = "";
  }

  // We disallow reusing the same path in multiple prints, such as `--print
  // cfg=output.txt --print link-args=output.txt`, because outputs are printed
  // by disparate pieces of the compiler, and keeping track of which files
  // need to be overwritten vs appended to is annoying.
  const printed_paths = new Set<string>();

  for (const req0 of matches.opt_strs("print")) {
    const [req, out0] = split_out_file_name(req0);

    let kind: PrintKind;
    let arg: string | undefined;
    const print_kind = PrintKind.from_str(req);
    if (req.startsWith("backend-has-mnemonic")) {
      const mnemonic0 = req.slice("backend-has-mnemonic".length);
      check_print_request_stability(early_dcx, unstable_opts, "BackendHasMnemonic");
      // BackendHasMnemonic requires a mnemonic argument
      if (mnemonic0.startsWith(":") && mnemonic0.length > 1) {
        const mnemonic = mnemonic0.slice(1);
        [kind, arg] = ["BackendHasMnemonic", mnemonic];
      } else {
        early_dcx.early_fatal(
          "expected mnemonic name after `--print=backend-has-mnemonic:`, for example: `--print=backend-has-mnemonic:RET`",
        );
      }
    } else if (print_kind !== undefined && allowed.includes(PrintKind.category(print_kind))) {
      check_print_request_stability(early_dcx, unstable_opts, print_kind);
      [kind, arg] = [print_kind, undefined];
    } else {
      const is_nightly = nightly_options.match_is_nightly_build(matches);
      emit_unknown_print_request_help(early_dcx, req, is_nightly, allowed);
    }

    const out = out0 ?? OutFileNameC.Stdout;
    if (out.$ === "Real") {
      const path = out._0;
      if (printed_paths.has(path)) {
        early_dcx.early_fatal(`cannot print multiple outputs to the same path: ${path}`);
      }
      printed_paths.add(path);
    }

    prints.push({ kind, out, arg });
  }

  return prints;
}

// rustc: compiler/rustc_session/src/config/print_request.rs:304 check_print_request_stability
function check_print_request_stability(early_dcx: EarlyDiagCtxt, unstable_opts: UnstableOptions, print_kind: PrintKind): void {
  if (!PrintKind.is_stable(print_kind) && !unstable_opts.unstable_options) {
    early_dcx.early_fatal(
      `the \`-Z unstable-options\` flag must also be passed to enable the \`${display_PrintKind(print_kind)}\` print option`,
    );
  }
}

// rustc: compiler/rustc_session/src/config/print_request.rs:316 emit_unknown_print_request_help
function emit_unknown_print_request_help(
  early_dcx: EarlyDiagCtxt,
  req: string,
  is_nightly: boolean,
  allowed: readonly PrintCategory[],
): never {
  const prints = PrintKind.ALL_VARIANTS
    // If we're not on nightly, we don't want to print unstable options
    .filter((kind) => is_nightly || PrintKind.is_stable(kind))
    .filter((kind) => allowed.includes(PrintKind.category(kind)))
    .map((kind) => `\`${display_PrintKind(kind)}\``)
    .join(", ");

  const diag = early_dcx.early_struct_fatal(`unknown print request: \`${req}\``);
  diag.help(`valid print requests are: ${prints}`);

  if (req === "lints") {
    diag.help("use `-Whelp` to print a list of lints");
  }

  if (
    allowed.length === PrintCategory.ALL_VARIANTS.length &&
    allowed.every((c, i) => c === PrintCategory.ALL_VARIANTS[i])
  ) {
    diag.help(
      "for more information, see the rustc book: https://doc.rust-lang.org/rustc/command-line-arguments.html#--print-print-compiler-information",
    );
  }

  return diag.emit_fatal();
}
