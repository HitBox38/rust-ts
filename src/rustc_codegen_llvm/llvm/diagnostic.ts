//! LLVM diagnostic reports.
// Port of compiler/rustc_codegen_llvm/src/llvm/diagnostic.rs (lane cg-lto-diag, plan-m7 §2b "LTO, diagnostics").
//
// PORT:
// - `pub(crate) use self::Diagnostic::*;` re-exports the variants; here they are the `$` tags of `Diagnostic`.
// - The structs with inherent methods are classes (constructor fields in declaration order); `Diagnostic::unpack` is on the
//   companion const (PORTING §8). `#[derive(Clone)]` on `InlineAsmDiagnostic` is not written (codegen's).
// - `cookie: u64` is a `bigint`; `c_uint` is `number`.
// - The FFI calls reached here are the IR model's (`LLVMRustGetDiagInfoKind`, `LLVMRustUnpackOptimizationDiagnostic`,
//   `LLVMRustUnpackInlineAsmDiagnostic`, `LLVMRustGetSMDiagnostic`, `LLVMRustUnpackSMDiagnostic`,
//   `LLVMRustWriteTwineToString`): today they are its stops (`llir: <name>`). The model emits no diagnostics yet: nothing calls
//   `diagnostic_handler` (back/write.ts) until a pinned tool's stderr is turned into one.
import { InnerSpan } from "../../rustc_span/lib.ts";
import type { Debug } from "../../std/fmt.ts";
import { unwrap } from "../../std/panic.ts";
import { expect_result } from "../../std/result.ts";
import * as llvm from "./mod.ts";
import { type DiagnosticInfo, type MutRef, type SMDiagnostic, type Twine, type Value, debug_FromUtf8Error } from "./mod.ts";

export type OptimizationDiagnosticKind =
  | "OptimizationRemark"
  | "OptimizationMissed"
  | "OptimizationAnalysis"
  | "OptimizationAnalysisFPCommute"
  | "OptimizationAnalysisAliasing"
  | "OptimizationFailure"
  | "OptimizationRemarkOther";
export const OptimizationDiagnosticKind = {
  OptimizationRemark: "OptimizationRemark",
  OptimizationMissed: "OptimizationMissed",
  OptimizationAnalysis: "OptimizationAnalysis",
  OptimizationAnalysisFPCommute: "OptimizationAnalysisFPCommute",
  OptimizationAnalysisAliasing: "OptimizationAnalysisAliasing",
  OptimizationFailure: "OptimizationFailure",
  OptimizationRemarkOther: "OptimizationRemarkOther",
} as const;
/** `#[derive(Debug)]`: the variant name. */
export const debug_OptimizationDiagnosticKind: Debug<OptimizationDiagnosticKind> = (v) => v;

export class OptimizationDiagnostic {
  constructor(
    public kind: OptimizationDiagnosticKind,
    public pass_name: string,
    // #[expect(dead_code)]
    public function_: Value,
    public line: number,
    public column: number,
    public filename: string,
    public message: string,
  ) {}

  // impl<'ll> OptimizationDiagnostic<'ll>
  // rustc: compiler/rustc_codegen_llvm/src/llvm/diagnostic.rs:34 unpack
  static unpack(kind: OptimizationDiagnosticKind, di: DiagnosticInfo): OptimizationDiagnostic {
    const function_: MutRef<Value | undefined> = { value: undefined };
    const line: MutRef<number> = { value: 0 };
    const column: MutRef<number> = { value: 0 };

    let message: string | undefined = undefined;
    let filename: string | undefined = undefined;
    const pass_name_r = llvm.build_string((pass_name) => {
      const message_r = llvm.build_string((message_) => {
        const filename_r = llvm.build_string((filename_) => {
          // unsafe {
          llvm.LLVMRustUnpackOptimizationDiagnostic(di, pass_name, function_, line, column, filename_, message_);
          // }
        });
        filename = filename_r.$ === "Ok" ? filename_r._0 : undefined;
      });
      message = message_r.$ === "Ok" ? message_r._0 : undefined;
    });
    const pass_name = pass_name_r.$ === "Ok" ? pass_name_r._0 : undefined;

    let filename_ = (filename as string | undefined) ?? "";
    if (filename_ === "") {
      filename_ += "<unknown file>";
    }

    return new OptimizationDiagnostic(
      /* kind */ kind,
      /* pass_name */ unwrap(pass_name, "got a non-UTF8 pass name from LLVM"),
      /* function */ unwrap(function_.value),
      /* line */ line.value,
      /* column */ column.value,
      /* filename */ filename_,
      /* message */ unwrap(message as string | undefined, "got a non-UTF8 OptimizationDiagnostic message from LLVM"),
    );
  }
}

export class SrcMgrDiagnostic {
  constructor(
    public level: llvm.DiagnosticLevel,
    public message: string,
    public source: [string, InnerSpan[]] | undefined,
  ) {}

  // impl SrcMgrDiagnostic
  // rustc: compiler/rustc_codegen_llvm/src/llvm/diagnostic.rs:84 unpack
  static unpack(diag: SMDiagnostic): SrcMgrDiagnostic {
    // Recover the post-substitution assembly code from LLVM for better
    // diagnostics.
    let have_source = false;
    let buffer = "";
    const level: MutRef<llvm.DiagnosticLevel> = { value: "Error" };
    const loc: MutRef<number> = { value: 0 };
    const ranges: number[] = [0, 0, 0, 0, 0, 0, 0, 0];
    const num_ranges: MutRef<number> = { value: ranges.length / 2 };
    const message = expect_result(
      llvm.build_string((message_) => {
        buffer = expect_result(
          llvm.build_string((buffer_) => {
            // unsafe {
            // PORT: `ranges.as_mut_ptr()` points at the 8-element array. ffi.ts (generated) types `*mut c_uint` as
            // `MutRef<number>`, so the array goes through a cast; an implementation writes `ranges[0..2 * num_ranges]`.
            have_source = llvm.LLVMRustUnpackSMDiagnostic(diag, message_, buffer_, level, loc, ranges as unknown as MutRef<number>, num_ranges);
            // }
          }),
          "non-UTF8 inline asm",
          debug_FromUtf8Error,
        );
      }),
      "non-UTF8 SMDiagnostic",
      debug_FromUtf8Error,
    );

    let source: [string, InnerSpan[]] | undefined;
    if (have_source) {
      const spans = [InnerSpan.new(loc.value, loc.value)];
      for (let i = 0; i < num_ranges.value; i++) {
        spans.push(InnerSpan.new(ranges[i * 2]!, ranges[i * 2 + 1]!));
      }
      source = [buffer, spans];
    } else {
      source = undefined;
    }
    return new SrcMgrDiagnostic(/* level */ level.value, /* message */ message, /* source */ source);
  }
}

export class InlineAsmDiagnostic {
  constructor(
    public level: llvm.DiagnosticLevel,
    public cookie: bigint,
    public message: string,
    public source: [string, InnerSpan[]] | undefined,
  ) {}

  // impl InlineAsmDiagnostic
  // rustc: compiler/rustc_codegen_llvm/src/llvm/diagnostic.rs:132 unpackInlineAsm
  static unpackInlineAsm(di: DiagnosticInfo): InlineAsmDiagnostic {
    const cookie: MutRef<bigint> = { value: 0n };
    const message: MutRef<Twine | undefined> = { value: undefined };
    const level: MutRef<llvm.DiagnosticLevel> = { value: "Error" };

    // unsafe {
    llvm.LLVMRustUnpackInlineAsmDiagnostic(di, level, cookie, message);
    // }

    return new InlineAsmDiagnostic(
      /* level */ level.value,
      /* cookie */ cookie.value,
      /* message */ llvm.twine_to_string(unwrap(message.value)),
      /* source */ undefined,
    );
  }

  // rustc: compiler/rustc_codegen_llvm/src/llvm/diagnostic.rs:149 unpackSrcMgr
  static unpackSrcMgr(di: DiagnosticInfo): InlineAsmDiagnostic {
    const cookie: MutRef<bigint> = { value: 0n };
    const smdiag = SrcMgrDiagnostic.unpack(llvm.LLVMRustGetSMDiagnostic(di, cookie));
    return new InlineAsmDiagnostic(/* level */ smdiag.level, /* cookie */ cookie.value, /* message */ smdiag.message, /* source */ smdiag.source);
  }
}

export type Diagnostic =
  | { readonly $: "Optimization"; readonly _0: OptimizationDiagnostic }
  | { readonly $: "InlineAsm"; readonly _0: InlineAsmDiagnostic }
  | { readonly $: "PGO"; readonly _0: DiagnosticInfo }
  | { readonly $: "Linker"; readonly _0: DiagnosticInfo }
  | { readonly $: "Unsupported"; readonly _0: DiagnosticInfo }
  /// LLVM has other types that we do not wrap here.
  // #[expect(dead_code)]
  | { readonly $: "UnknownDiagnostic"; readonly _0: DiagnosticInfo };

// impl<'ll> Diagnostic<'ll>
export const Diagnostic = {
  // rustc: compiler/rustc_codegen_llvm/src/llvm/diagnostic.rs:175 unpack
  unpack(di: DiagnosticInfo): Diagnostic {
    // use super::DiagnosticKind as Dk;

    // unsafe {
    const kind = llvm.LLVMRustGetDiagInfoKind(di);
    switch (kind) {
      case "InlineAsm":
        return { $: "InlineAsm", _0: InlineAsmDiagnostic.unpackInlineAsm(di) };

      case "OptimizationRemark":
        return { $: "Optimization", _0: OptimizationDiagnostic.unpack("OptimizationRemark", di) };
      case "OptimizationRemarkOther":
        return { $: "Optimization", _0: OptimizationDiagnostic.unpack("OptimizationRemarkOther", di) };
      case "OptimizationRemarkMissed":
        return { $: "Optimization", _0: OptimizationDiagnostic.unpack("OptimizationMissed", di) };

      case "OptimizationRemarkAnalysis":
        return { $: "Optimization", _0: OptimizationDiagnostic.unpack("OptimizationAnalysis", di) };

      case "OptimizationRemarkAnalysisFPCommute":
        return { $: "Optimization", _0: OptimizationDiagnostic.unpack("OptimizationAnalysisFPCommute", di) };

      case "OptimizationRemarkAnalysisAliasing":
        return { $: "Optimization", _0: OptimizationDiagnostic.unpack("OptimizationAnalysisAliasing", di) };

      case "OptimizationFailure":
        return { $: "Optimization", _0: OptimizationDiagnostic.unpack("OptimizationFailure", di) };

      case "PGOProfile":
        return { $: "PGO", _0: di };
      case "Linker":
        return { $: "Linker", _0: di };
      case "Unsupported":
        return { $: "Unsupported", _0: di };

      case "SrcMgr":
        return { $: "InlineAsm", _0: InlineAsmDiagnostic.unpackSrcMgr(di) };

      default:
        return { $: "UnknownDiagnostic", _0: di };
    }
    // }
  },
} as const;
