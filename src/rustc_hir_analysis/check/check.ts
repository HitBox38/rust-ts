// Port of compiler/rustc_hir_analysis/src/check/check.rs (lane check-check, wave 17).
//
// Init order: top-level code here touches only other crates; every rustc_hir_analysis export (./mod.ts, ../collect.ts,
// ../diagnostics.ts) is read inside function bodies only.
import { display_ExternAbi, ExternAbi } from "../../rustc_abi/extern_abi.ts";
import { Diag, type DiagCtxtHandle, type Diagnostic, type Level } from "../../rustc_errors/lib.ts";
import type { HirId } from "../../rustc_hir_id/lib.ts";
import { UNSUPPORTED_CALLING_CONVENTIONS } from "../../rustc_lint_defs/builtin.gen.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { Span } from "../../rustc_span/lib.ts";
import { AbiMap } from "../../rustc_target/spec/abi_map.ts";

// rustc: compiler/rustc_hir_analysis/src/check/check.rs:48 add_abi_diag_help
function add_abi_diag_help(abi: ExternAbi, diag: Diag): void {
  if (abi.$ === "Cdecl") {
    const unwind = abi.unwind;
    const c_abi = ExternAbi.C(unwind);
    diag.help(`use \`extern ${display_ExternAbi(c_abi)}\` instead`);
  } else if (abi.$ === "Stdcall") {
    const unwind = abi.unwind;
    const c_abi = ExternAbi.C(unwind);
    const system_abi = ExternAbi.System(unwind);
    diag.help(
      `if you need \`extern ${display_ExternAbi(abi)}\` on win32 and \`extern ${display_ExternAbi(c_abi)}\` everywhere else, ` +
        `use \`extern ${display_ExternAbi(system_abi)}\``,
    );
  }
}

// rustc: compiler/rustc_hir_analysis/src/check/check.rs:62 check_abi
export function check_abi(tcx: TyCtxt, hir_id: HirId, span: Span, abi: ExternAbi): void {
  // struct UnsupportedCallingConventions { abi: ExternAbi }
  interface UnsupportedCallingConventions {
    abi: ExternAbi;
  }

  // impl<'a> Diagnostic<'a> for UnsupportedCallingConventions
  // rustc: compiler/rustc_hir_analysis/src/check/check.rs:68 into_diag
  function UnsupportedCallingConventions_into_diag(self: UnsupportedCallingConventions, dcx: DiagCtxtHandle, level: Level): Diag {
    const { abi } = self;
    const lint = Diag.new(dcx, level, `${display_ExternAbi(abi)} is not a supported ABI for the current target`);
    add_abi_diag_help(abi, lint);
    return lint;
  }
  const UnsupportedCallingConventions_diagnostic = (self: UnsupportedCallingConventions): Diagnostic => ({
    into_diag: (dcx, level) => UnsupportedCallingConventions_into_diag(self, dcx, level),
  });
  // FIXME: This should be checked earlier, e.g. in `rustc_ast_lowering`, as this
  // currently only guards function imports, function definitions, and function pointer types.
  // Functions in trait declarations can still use "deprecated" ABIs without any warning.

  const mapping = AbiMap.from_target(tcx.sess.target).canonize_abi(abi, false);
  switch (mapping.$) {
    case "Direct":
      break;
    // already erred in rustc_ast_lowering
    case "Invalid": {
      tcx.dcx().span_delayed_bug(span, `${display_ExternAbi(abi)} should be rejected in ast_lowering`);
      break;
    }
    case "Deprecated": {
      tcx.emit_node_span_lint(UNSUPPORTED_CALLING_CONVENTIONS, hir_id, span, UnsupportedCallingConventions_diagnostic({ abi }));
      break;
    }
  }
}
