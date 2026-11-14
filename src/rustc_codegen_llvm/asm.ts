// compiler/rustc_codegen_llvm/src/asm.rs: the SKELETON (lane cg-contract). The fill lane cg-asm (plan-m7 §8 wave 43) owns this file and ports
// asm.rs here, replacing each `Stub (cg-contract)` with its port.
//
// What is here: `impl AsmBuilderMethods for Builder` and `impl AsmCodegenMethods for CodegenCx`, as typed stubs attached with PORTING §5's extension pattern (lib.ts imports this file after the
// class's own module).
import type { InlineAsmOptions, InlineAsmTemplatePiece } from "../rustc_ast/lib.ts";
import type { AsmBuilderMethods, AsmCodegenMethods, GlobalAsmOperandRef, InlineAsmOperandRef } from "../rustc_codegen_ssa/traits/asm.ts";
import type { Instance } from "../rustc_middle/ty/instance.ts";
import { Span } from "../rustc_span/lib.ts";
import type { Session } from "../rustc_session/session.ts";
import { ReturnSlot } from "../rustc_codegen_ssa/traits/builder.ts";
import type { Funclet, LlvmTypes } from "./common.ts";
import type { AsmDialect, BasicBlock, Metadata, Type, Value } from "./llvm/mod.ts";
import * as llvm from "./llvm/mod.ts";
import { assert, unported, unwrap } from "../std/panic.ts";
import { utf8_len } from "../std/str.ts";
import { Builder } from "./builder.ts";
import { CodegenCx } from "./context.ts";

// ---- impl AsmCodegenMethods for CodegenCx (asm.rs:411) ----
declare module "./context.ts" {
  interface CodegenCx {
    codegen_global_asm(template: readonly InlineAsmTemplatePiece[], operands: readonly GlobalAsmOperandRef[], options: InlineAsmOptions, line_spans: readonly Span[], extra_rust_target_features: readonly string[]): void;
    mangled_name(instance: Instance): string;
  }
}

// Stub (cg-contract): AsmCodegenMethods::codegen_global_asm
CodegenCx.prototype.codegen_global_asm = function (this: CodegenCx, _template: readonly InlineAsmTemplatePiece[], _operands: readonly GlobalAsmOperandRef[], _options: InlineAsmOptions, _line_spans: readonly Span[], _extra_rust_target_features: readonly string[]): void {
  return unported("cg-asm: compiler/rustc_codegen_llvm/src/asm.rs codegen_global_asm");
};

// Stub (cg-contract): AsmCodegenMethods::mangled_name
CodegenCx.prototype.mangled_name = function (this: CodegenCx, _instance: Instance): string {
  return unported("cg-asm: compiler/rustc_codegen_llvm/src/asm.rs mangled_name");
};

// ---- impl AsmBuilderMethods for Builder (asm.rs:27) ----
declare module "./builder.ts" {
  interface Builder {
    codegen_inline_asm(template: readonly InlineAsmTemplatePiece[], operands: readonly InlineAsmOperandRef<LlvmTypes>[], options: InlineAsmOptions, line_spans: readonly Span[], instance: Instance, dest: BasicBlock | undefined, catch_funclet: readonly [BasicBlock, Funclet | undefined] | undefined): void;
  }
}

// Stub (cg-contract): AsmBuilderMethods::codegen_inline_asm
Builder.prototype.codegen_inline_asm = function (this: Builder, _template: readonly InlineAsmTemplatePiece[], _operands: readonly InlineAsmOperandRef<LlvmTypes>[], _options: InlineAsmOptions, _line_spans: readonly Span[], _instance: Instance, _dest: BasicBlock | undefined, _catch_funclet: readonly [BasicBlock, Funclet | undefined] | undefined): void {
  return unported("cg-asm: compiler/rustc_codegen_llvm/src/asm.rs codegen_inline_asm");
};

// Cross-lane surface (cg-contract, review F2)
// PORT (lane cg-register): ported ahead of cg-asm, as `black_box` (intrinsic.rs) calls it from every std program's
// `__rust_begin_short_backtrace`, so `ir-hello` stops here otherwise. Ported whole; the rest of the file stays cg-asm's.
// rustc: compiler/rustc_codegen_llvm/src/asm.rs:536 inline_asm_call
export function inline_asm_call(
  bx: Builder,
  asm: string,
  cons: string,
  inputs: readonly Value[],
  output: Type,
  labels: readonly BasicBlock[],
  volatile: boolean,
  alignstack: boolean,
  dia: AsmDialect,
  line_spans: readonly Span[],
  unwind: boolean,
  dest: BasicBlock | undefined,
  catch_funclet: readonly [BasicBlock, Funclet | undefined] | undefined,
): Value | undefined {
  const argtys = inputs.map((v) => {
    // debug!("Asm Input Type: {:?}", *v);
    return bx.cx_.val_ty(v);
  });

  // debug!("Asm Output Type: {:?}", output);
  const fty = bx.cx_.type_func(argtys, output);

  // Ask LLVM to verify that the constraints are well-formed.
  const constraints_ok = llvm.LLVMRustInlineAsmVerify(fty, cons, utf8_len(cons));
  // debug!("constraint verification result: {:?}", constraints_ok);
  if (!constraints_ok) {
    // LLVM has detected an issue with our constraints, so bail out.
    return undefined;
  }

  const v = llvm.LLVMGetInlineAsm(
    fty,
    asm,
    utf8_len(asm),
    cons,
    utf8_len(cons),
    llvm.to_llvm_bool(volatile),
    llvm.to_llvm_bool(alignstack),
    dia,
    llvm.to_llvm_bool(unwind),
  );

  let call: Value;
  if (labels.length !== 0) {
    assert(catch_funclet === undefined, "assertion failed: catch_funclet.is_none()");
    call = bx.callbr(fty, undefined, undefined, v, inputs, unwrap(dest), labels, undefined, undefined);
  } else if (catch_funclet !== undefined) {
    const [catch_, funclet] = catch_funclet;
    call = bx.invoke(fty, undefined, undefined, v, ReturnSlot.Direct, inputs, unwrap(dest), catch_, funclet, undefined);
  } else {
    call = bx.call(fty, undefined, undefined, v, ReturnSlot.Direct, inputs, undefined, undefined);
  }

  // Store mark in a metadata node so we can map LLVM errors
  // back to source locations. See #17552.
  const key = "srcloc";
  const kind = bx.get_md_kind_id(key);

  if (allow_raw_span_inline_asm_srcloc(bx.cx_.tcx.sess, bx.cx_.bitcode_needed)) {
    // `srcloc` contains one 64-bit integer for each line of assembly code,
    // where the lower 32 bits hold the lo byte position and the upper 32 bits
    // hold the hi byte position.
    const srcloc: Metadata[] = [];
    if (dia === "Intel" && line_spans.length > 1) {
      // LLVM inserts an extra line to add the ".intel_syntax", so add
      // a dummy srcloc entry for it.
      //
      // Don't do this if we only have 1 line span since that may be
      // due to the asm template string coming from a macro. LLVM will
      // default to the first srcloc for lines that don't have an
      // associated srcloc.
      srcloc.push(llvm.LLVMValueAsMetadata(bx.const_u64(0n)));
    }
    for (const span of line_spans) {
      srcloc.push(llvm.LLVMValueAsMetadata(bx.const_u64(BigInt(Span.lo(span)) | (BigInt(Span.hi(span)) << 32n))));
    }
    bx.cx_.set_metadata_node(call, kind, srcloc);
  }

  return call;
}

/// Whenever inline assembly bitcode is built, its `srcloc` contains the raw span numbers
/// as location cookies. This is problematic since that is nondeterministic when using
/// the parallel frontend. Even without parallelism, the cookies are meaningless in another
/// rustc session.
///
/// Discussion about replacing the cookies with something stable: rust-lang/rust#150451
// rustc: compiler/rustc_codegen_llvm/src/asm.rs:641 allow_raw_span_inline_asm_srcloc
function allow_raw_span_inline_asm_srcloc(sess: Session, bitcode_needed: boolean): boolean {
  // even for Lto::ThinLocal, where the bitcode isn't serialized into files, the changes in
  // raw span positions would reflect in the LTO module hashes, which could lead to
  // nondeterminism
  return sess.lto() === "No" && !bitcode_needed;
}
