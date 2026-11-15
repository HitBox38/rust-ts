// Port of compiler/rustc_codegen_llvm/src/asm.rs (skeleton: lane cg-contract; `inline_asm_call`: lane cg-register; the rest:
// lane cg-asm, plan-m7 M7c wave 40s).
//
// `impl AsmBuilderMethods for Builder` and `impl AsmCodegenMethods for CodegenCx` are attached with PORTING §5's extension
// pattern (lib.ts imports this file after the class's own module).
//
// PORT (cg-asm):
// - `use InlineAsmRegClass::*; match reg { X86(X86InlineAsmRegClass::reg) => .. }` is a `switch` on the arch tag, then on the
//   arch's class name. rust-ts ports the register classes of x86, AArch64 and wasm only (rustc_target/asm, lane target-asm);
//   the other arch modules are opaque stubs whose class and register values are their upstream variant names, so their arms
//   compare against those names. No built-in target reaches them.
// - `reg as u32` of `X86InlineAsmReg` (a fieldless enum) is `X86InlineAsmReg.discriminant(reg)`.
// - `SparcInlineAsmReg::dreg_number` / `qreg_number` are methods of a stub module: they stop `unported`.
// - **Inherent before trait** (builder.ts header): `self` here is a concrete `Builder`, so `bx.bitcast(..)` and `bx.trunc(..)`
//   are `bitcast_inherent` / `trunc_inherent` (identical bodies).
// - `self.tcx` (autoderef to the `CodegenCx` field) is `this.cx_.tcx`; `self.cx` is `this.cx_`.
// - `FxHashMap<usize, usize>` `op_idx` is a `Map`; `op_idx[&idx]` panics when absent, as `index_op_idx` does.
// - `char` modifiers are code points (`number`), as `InlineAsmTemplatePiece::Placeholder::modifier` is.
// - `u64` lane counts are `number` (at most `MAX_SIMD_LANES`).
import { type BackendRepr, type Float, Float as FloatC, type Primitive, Scalar, Size, Size_eq } from "../rustc_abi/lib.ts";
import { InlineAsmOptions, type InlineAsmTemplatePiece } from "../rustc_ast/lib.ts";
import { asm_const_to_str } from "../rustc_codegen_ssa/common.ts";
import { escape_symbol_name } from "../rustc_codegen_ssa/back/symbol_export.ts";
import { OperandValue } from "../rustc_codegen_ssa/mir/operand.ts";
import type { AsmBuilderMethods, AsmCodegenMethods, GlobalAsmOperandRef, InlineAsmOperandRef } from "../rustc_codegen_ssa/traits/asm.ts";
import { CtfeProvenance, PointerArithmetic_provided } from "../rustc_middle/mir/interpret/pointer.ts";
import { Instance } from "../rustc_middle/ty/instance.ts";
import type { TyAndLayout } from "../rustc_middle/ty/layout.ts";
import { Span } from "../rustc_span/lib.ts";
import { bug, span_bug } from "../rustc_span/macros.ts";
import { type Symbol, sym } from "../rustc_span/symbol.ts";
import type { Session } from "../rustc_session/session.ts";
import {
  AArch64InlineAsmReg,
  type InlineAsmArch,
  InlineAsmReg,
  InlineAsmRegClass,
  InlineAsmRegOrRegClass,
  X86InlineAsmReg,
} from "../rustc_target/asm/mod.ts";
import { ReturnSlot } from "../rustc_codegen_ssa/traits/builder.ts";
import type { Funclet, LlvmTypes } from "./common.ts";
import type { AsmDialect, Attribute, BasicBlock, Metadata, Type, Value } from "./llvm/mod.ts";
import * as llvm from "./llvm/mod.ts";
import * as attributes from "./attributes.ts";
import * as llvm_util from "./llvm_util.ts";
import { assert, panic, unported, unreachable, unwrap } from "../std/panic.ts";
import { debug_int } from "../std/fmt.ts";
import { expect_result, unwrap_result } from "../std/result.ts";
import { utf8, utf8_len } from "../std/str.ts";
import { Builder } from "./builder.ts";
import { CodegenCx } from "./context.ts";
import { debug_Value } from "./value.ts";

/** `op_idx[&idx]` (`Index` of `FxHashMap` panics on a missing key). */
function index_op_idx(op_idx: Map<number, number>, idx: number): number {
  const v = op_idx.get(idx);
  if (v === undefined) return panic("key not found in op_idx");
  return v;
}

/** `char::from_u32(c)` for display (`push(c)` / `{}` of a `char`). */
function chr(c: number): string {
  return String.fromCodePoint(c);
}

/** `{offset:+}` of an `i64`. */
function fmt_signed_plus(v: bigint): string {
  return v >= 0n ? `+${v}` : `${v}`;
}

// ---- impl AsmBuilderMethods for Builder (asm.rs:27) ----
declare module "./builder.ts" {
  interface Builder {
    codegen_inline_asm(template: readonly InlineAsmTemplatePiece[], operands: readonly InlineAsmOperandRef<LlvmTypes>[], options: InlineAsmOptions, line_spans: readonly Span[], instance: Instance, dest: BasicBlock | undefined, catch_funclet: readonly [BasicBlock, Funclet | undefined] | undefined): void;
  }
}

// rustc: compiler/rustc_codegen_llvm/src/asm.rs:28 codegen_inline_asm
Builder.prototype.codegen_inline_asm = function (
  this: Builder,
  template: readonly InlineAsmTemplatePiece[],
  operands: readonly InlineAsmOperandRef<LlvmTypes>[],
  options: InlineAsmOptions,
  line_spans: readonly Span[],
  instance: Instance,
  dest: BasicBlock | undefined,
  catch_funclet: readonly [BasicBlock, Funclet | undefined] | undefined,
): void {
  const asm_arch = unwrap(this.cx_.tcx.sess.asm_arch);

  // Collect the types of output operands
  const constraints: string[] = [];
  const clobbers: string[] = [];
  const output_types: Type[] = [];
  const op_idx = new Map<number, number>();
  let clobbered_x87 = false;
  for (let idx = 0; idx < operands.length; idx++) {
    const op = operands[idx]!;
    switch (op.$) {
      case "Out": {
        const { reg, late, place } = op;
        const is_target_supported = (reg_class: InlineAsmRegClass): boolean => {
          for (const [, feature] of InlineAsmRegClass.supported_types(reg_class, asm_arch, true)) {
            if (feature !== undefined) {
              if (this.cx_.tcx.asm_target_features(Instance.def_id(instance)).has(feature)) {
                return true;
              }
            } else {
              // Register class is unconditionally supported
              return true;
            }
          }
          return false;
        };

        let layout: TyAndLayout | undefined = undefined;
        let ty: Type;
        const reg_class = InlineAsmRegOrRegClass.reg_class(reg);
        if (place !== undefined) {
          layout = place.layout;
          ty = llvm_fixup_output_type(this.cx_, reg_class, place.layout, instance);
        } else if (reg_class.$ === "X86" && (reg_class._0 === "mmx_reg" || reg_class._0 === "x87_reg")) {
          // Special handling for x87/mmx registers: we always
          // clobber the whole set if one register is marked as
          // clobbered. This is due to the way LLVM handles the
          // FP stack in inline assembly.
          if (!clobbered_x87) {
            clobbered_x87 = true;
            clobbers.push("~{st}");
            for (let i = 1; i <= 7; i++) {
              clobbers.push(`~{st(${i})}`);
            }
          }
          continue;
        } else if (!is_target_supported(reg_class) || InlineAsmRegClass.is_clobber_only(reg_class, asm_arch, true)) {
          // We turn discarded outputs into clobber constraints
          // if the target feature needed by the register class is
          // disabled. This is necessary otherwise LLVM will try
          // to actually allocate a register for the dummy output.
          assert(reg.$ === "Reg", "assertion failed: matches!(reg, InlineAsmRegOrRegClass::Reg(_))");
          clobbers.push(`~${reg_to_llvm(reg, undefined)}`);
          continue;
        } else {
          // If the output is discarded, we don't really care what
          // type is used. We're just using this to tell LLVM to
          // reserve the register.
          ty = dummy_output_type(this.cx_, reg_class);
        }
        output_types.push(ty);
        op_idx.set(idx, constraints.length);
        const prefix = late ? "=" : "=&";
        constraints.push(`${prefix}${reg_to_llvm(reg, layout)}`);
        break;
      }
      case "InOut": {
        const { reg, late, in_value, out_place } = op;
        let layout: TyAndLayout;
        if (out_place !== undefined) {
          layout = out_place.layout;
        } else {
          // LLVM required tied operands to have the same type,
          // so we just use the type of the input.
          layout = in_value.layout;
        }
        const ty = llvm_fixup_output_type(this.cx_, InlineAsmRegOrRegClass.reg_class(reg), layout, instance);
        output_types.push(ty);
        op_idx.set(idx, constraints.length);
        const prefix = late ? "=" : "=&";
        constraints.push(`${prefix}${reg_to_llvm(reg, layout)}`);
        break;
      }
      default:
        break;
    }
  }

  // Collect input operands
  const inputs: Value[] = [];
  for (let idx = 0; idx < operands.length; idx++) {
    const op = operands[idx]!;
    switch (op.$) {
      case "In": {
        const { reg, value } = op;
        const llval = llvm_fixup_input(this, value.immediate(debug_Value), InlineAsmRegOrRegClass.reg_class(reg), value.layout, instance);
        inputs.push(llval);
        op_idx.set(idx, constraints.length);
        constraints.push(reg_to_llvm(reg, value.layout));
        break;
      }
      case "InOut": {
        const { reg, late, in_value } = op;
        const value = llvm_fixup_input(this, in_value.immediate(debug_Value), InlineAsmRegOrRegClass.reg_class(reg), in_value.layout, instance);
        inputs.push(value);

        // In the case of fixed registers, we have the choice of
        // either using a tied operand or duplicating the constraint.
        // We prefer the latter because it matches the behavior of
        // Clang.
        if (late && reg.$ === "Reg") {
          constraints.push(reg_to_llvm(reg, in_value.layout));
        } else {
          constraints.push(`${index_op_idx(op_idx, idx)}`);
        }
        break;
      }
      case "Const": {
        const value = op.value;
        switch (value.$) {
          case "Int":
            break;
          case "Ptr": {
            const [prov] = value._0.prov_and_relative_offset();
            const global_alloc = this.cx_.tcx.global_alloc(CtfeProvenance.alloc_id(prov));
            const llval = unwrap_result(this.cx_.alloc_to_backend(global_alloc, false, undefined), debug_int);
            inputs.push(llval);
            op_idx.set(idx, constraints.length);
            constraints.push("s");
            break;
          }
        }
        break;
      }
      case "SymThreadLocalStatic": {
        inputs.push(this.cx_.get_static(op.def_id));
        op_idx.set(idx, constraints.length);
        constraints.push("s");
        break;
      }
      default:
        break;
    }
  }

  // Build the template string
  const labels: BasicBlock[] = [];
  let template_str = "";
  for (const piece of template) {
    switch (piece.$) {
      case "String": {
        const s = piece._0;
        if (s.includes("$")) {
          for (const c of s) {
            if (c === "$") {
              template_str += "$$";
            } else {
              template_str += c;
            }
          }
        } else {
          template_str += s;
        }
        break;
      }
      case "Placeholder": {
        const { operand_idx, modifier, span } = piece;
        const operand = operands[operand_idx]!;
        switch (operand.$) {
          case "In":
          case "Out":
          case "InOut": {
            const modifier_ = modifier_to_llvm(asm_arch, InlineAsmRegOrRegClass.reg_class(operand.reg), modifier);
            if (modifier_ !== undefined) {
              template_str += `\${${index_op_idx(op_idx, operand_idx)}:${chr(modifier_)}}`;
            } else {
              template_str += `\${${index_op_idx(op_idx, operand_idx)}}`;
            }
            break;
          }
          case "Const": {
            const { value, ty } = operand;
            switch (value.$) {
              case "Int": {
                const int = value._0;
                // Const operands get injected directly into the template
                const string = asm_const_to_str(this.cx_.tcx, span, int, this.layout_of(ty));
                template_str += string;
                break;
              }
              case "Ptr": {
                const [, offset] = value._0.prov_and_relative_offset();

                // Only emit the raw symbol name
                template_str += `\${${index_op_idx(op_idx, operand_idx)}:c}`;

                if (!Size_eq(offset, Size.ZERO)) {
                  const offset_ = PointerArithmetic_provided.sign_extend_to_target_isize(this.cx_, offset.bytes_u64());
                  template_str += fmt_signed_plus(offset_);
                }
                break;
              }
            }
            break;
          }
          case "SymThreadLocalStatic": {
            // Only emit the raw symbol name
            template_str += `\${${index_op_idx(op_idx, operand_idx)}:c}`;
            break;
          }
          case "Label": {
            template_str += `\${${constraints.length}:l}`;
            constraints.push("!i");
            labels.push(operand.label);
            break;
          }
        }
        break;
      }
    }
  }

  constraints.push(...clobbers);
  clobbers.length = 0;
  if (!InlineAsmOptions.contains(options, InlineAsmOptions.PRESERVES_FLAGS)) {
    switch (asm_arch) {
      case "AArch64":
      case "Arm64EC":
      case "Arm":
        constraints.push("~{cc}");
        break;
      case "Amdgpu":
        break;
      case "X86":
      case "X86_64":
        constraints.push("~{dirflag}", "~{fpsr}", "~{flags}");
        break;
      case "RiscV32":
      case "RiscV64":
        constraints.push("~{fflags}", "~{vtype}", "~{vl}", "~{vxsat}", "~{vxrm}");
        break;
      case "Avr":
        constraints.push("~{sreg}");
        break;
      case "Nvptx64":
        break;
      case "PowerPC":
      case "PowerPC64":
        break;
      case "Hexagon":
        break;
      case "LoongArch32":
      case "LoongArch64":
        constraints.push("~{$fcc0}", "~{$fcc1}", "~{$fcc2}", "~{$fcc3}", "~{$fcc4}", "~{$fcc5}", "~{$fcc6}", "~{$fcc7}");
        break;
      case "Mips":
      case "Mips64":
        break;
      case "S390x":
        constraints.push("~{cc}");
        break;
      case "Sparc":
      case "Sparc64":
        // In LLVM, ~{icc} represents icc and xcc in 64-bit code.
        // https://github.com/llvm/llvm-project/blob/llvmorg-19.1.0/llvm/lib/Target/Sparc/SparcRegisterInfo.td#L64
        constraints.push("~{icc}");
        constraints.push("~{fcc0}");
        constraints.push("~{fcc1}");
        constraints.push("~{fcc2}");
        constraints.push("~{fcc3}");
        break;
      case "SpirV":
        break;
      case "Wasm32":
      case "Wasm64":
        break;
      case "Xtensa":
        break;
      case "Bpf":
        break;
      case "Msp430":
        constraints.push("~{sr}");
        break;
      case "M68k":
        constraints.push("~{ccr}");
        break;
      case "CSKY":
        constraints.push("~{psr}");
        break;
    }
  }
  if (!InlineAsmOptions.contains(options, InlineAsmOptions.NOMEM)) {
    // This is actually ignored by LLVM, but it's probably best to keep
    // it just in case. LLVM instead uses the ReadOnly/ReadNone
    // attributes on the call instruction to optimize.
    constraints.push("~{memory}");
  }
  const volatile = !InlineAsmOptions.contains(options, InlineAsmOptions.PURE);
  const alignstack = !InlineAsmOptions.contains(options, InlineAsmOptions.NOSTACK);
  let output_type: Type;
  if (output_types.length === 0) {
    output_type = this.type_void();
  } else if (output_types.length === 1) {
    output_type = output_types[0]!;
  } else {
    output_type = this.type_struct(output_types, false);
  }
  let dialect: AsmDialect;
  if ((asm_arch === "X86" || asm_arch === "X86_64") && !InlineAsmOptions.contains(options, InlineAsmOptions.ATT_SYNTAX)) {
    dialect = "Intel";
  } else {
    dialect = "Att";
  }
  const result_ = inline_asm_call(
    this,
    template_str,
    constraints.join(","),
    inputs,
    output_type,
    labels,
    volatile,
    alignstack,
    dialect,
    line_spans,
    InlineAsmOptions.contains(options, InlineAsmOptions.MAY_UNWIND),
    dest,
    catch_funclet,
  );
  const result = result_ ?? span_bug(line_spans[0]!, "LLVM asm constraint validation failed");

  const attrs: Attribute[] = [];
  if (InlineAsmOptions.contains(options, InlineAsmOptions.PURE)) {
    if (InlineAsmOptions.contains(options, InlineAsmOptions.NOMEM)) {
      attrs.push(llvm.MemoryEffects_impl.create_attr(llvm.MemoryEffects.None, this.cx_.llcx()));
    } else if (InlineAsmOptions.contains(options, InlineAsmOptions.READONLY)) {
      attrs.push(llvm.MemoryEffects_impl.create_attr(llvm.MemoryEffects.ReadOnly, this.cx_.llcx()));
    }
    attrs.push(llvm.AttributeKind_impl.create_attr(llvm.AttributeKind.WillReturn, this.cx_.llcx()));
  } else if (InlineAsmOptions.contains(options, InlineAsmOptions.NOMEM)) {
    attrs.push(llvm.MemoryEffects_impl.create_attr(llvm.MemoryEffects.InaccessibleMemOnly, this.cx_.llcx()));
  } else if (InlineAsmOptions.contains(options, InlineAsmOptions.READONLY)) {
    attrs.push(llvm.MemoryEffects_impl.create_attr(llvm.MemoryEffects.ReadOnlyNotPure, this.cx_.llcx()));
  }
  attributes.apply_to_callsite(result, llvm.AttributePlace.Function, attrs);

  // Write results to outputs. We need to do this for all possible control flow.
  //
  // Note that `dest` maybe populated with unreachable_block when asm goto with outputs
  // is used (because we need to codegen callbr which always needs a destination), so
  // here we use the NORETURN option to determine if `dest` should be used.
  const blocks: (BasicBlock | undefined)[] = [];
  if (!InlineAsmOptions.contains(options, InlineAsmOptions.NORETURN)) blocks.push(dest);
  for (const l of labels) blocks.push(l);
  for (const block of blocks) {
    if (block !== undefined) {
      this.switch_to_block(block);
    }

    for (let idx = 0; idx < operands.length; idx++) {
      const op = operands[idx]!;
      let reg: InlineAsmRegOrRegClass;
      let place;
      if (op.$ === "Out" && op.place !== undefined) {
        reg = op.reg;
        place = op.place;
      } else if (op.$ === "InOut" && op.out_place !== undefined) {
        reg = op.reg;
        place = op.out_place;
      } else {
        continue;
      }
      let value: Value;
      if (output_types.length === 1) {
        value = result;
      } else {
        value = this.extract_value(result, index_op_idx(op_idx, idx));
      }
      value = llvm_fixup_output(this, value, InlineAsmRegOrRegClass.reg_class(reg), place.layout, instance);
      OperandValue.store({ $: "Immediate", _0: value }, this, place);
    }
  }
};

// ---- impl AsmCodegenMethods for CodegenCx (asm.rs:411) ----
declare module "./context.ts" {
  interface CodegenCx {
    codegen_global_asm(template: readonly InlineAsmTemplatePiece[], operands: readonly GlobalAsmOperandRef[], options: InlineAsmOptions, line_spans: readonly Span[], extra_rust_target_features: readonly string[]): void;
    mangled_name(instance: Instance): string;
  }
}

// rustc: compiler/rustc_codegen_llvm/src/asm.rs:412 codegen_global_asm
CodegenCx.prototype.codegen_global_asm = function (
  this: CodegenCx,
  template: readonly InlineAsmTemplatePiece[],
  operands: readonly GlobalAsmOperandRef[],
  options: InlineAsmOptions,
  _line_spans: readonly Span[],
  extra_rust_target_features: readonly string[],
): void {
  const asm_arch = unwrap(this.tcx.sess.asm_arch);

  // Build the template string
  let template_str = "";

  // On X86 platforms there are two assembly syntaxes. Rust uses intel by default,
  // but AT&T can be specified explicitly.
  if (asm_arch === "X86" || asm_arch === "X86_64") {
    if (InlineAsmOptions.contains(options, InlineAsmOptions.ATT_SYNTAX)) {
      template_str += ".att_syntax\n";
    } else {
      template_str += ".intel_syntax\n";
    }
  }

  for (const piece of template) {
    switch (piece.$) {
      case "String":
        template_str += piece._0;
        break;
      case "Placeholder": {
        const { operand_idx, span } = piece;
        // use rustc_codegen_ssa::back::symbol_export::escape_symbol_name;
        const operand = operands[operand_idx]!;
        switch (operand.$) {
          case "Const": {
            const { value, ty } = operand;
            switch (value.$) {
              case "Int": {
                const int = value._0;
                // Const operands get injected directly into the
                // template. Note that we don't need to escape $
                // here unlike normal inline assembly.
                const string = asm_const_to_str(this.tcx, span, int, this.layout_of(ty));
                template_str += string;
                break;
              }

              case "Ptr": {
                const [prov, offset] = value._0.prov_and_relative_offset();
                const global_alloc = this.tcx.global_alloc(CtfeProvenance.alloc_id(prov));
                const llval = unwrap_result(this.alloc_to_backend(global_alloc, true, undefined), debug_int);

                this.add_compiler_used_global(llval);
                const symbol = expect_result(
                  llvm.build_string((s) => {
                    llvm.LLVMRustGetMangledName(llval, s);
                  }),
                  "symbol is not valid UTF-8",
                  llvm.debug_FromUtf8Error,
                );
                template_str += escape_symbol_name(this.tcx, symbol, span);

                if (!Size_eq(offset, Size.ZERO)) {
                  const offset_ = PointerArithmetic_provided.sign_extend_to_target_isize(this, offset.bytes_u64());
                  template_str += fmt_signed_plus(offset_);
                }
                break;
              }
            }
            break;
          }
          case "SymThreadLocalStatic": {
            const def_id = operand.def_id;
            const llval = this.renamed_statics.get(def_id) ?? this.get_static(def_id);
            this.add_compiler_used_global(llval);
            const symbol = expect_result(
              llvm.build_string((s) => {
                llvm.LLVMRustGetMangledName(llval, s);
              }),
              "symbol is not valid UTF-8",
              llvm.debug_FromUtf8Error,
            );
            template_str += escape_symbol_name(this.tcx, symbol, span);
            break;
          }
        }
        break;
      }
    }
  }

  // Just to play it safe, if intel was used, reset the assembly syntax to att.
  if ((asm_arch === "X86" || asm_arch === "X86_64") && !InlineAsmOptions.contains(options, InlineAsmOptions.ATT_SYNTAX)) {
    template_str += "\n.att_syntax\n";
  }

  // Globally-enabled features that are already in the backend format.
  const global_features = this.tcx.sess.global_backend_features;

  // Features enabled on a particular instance, in the rust format.
  // These need to be translated to the LLVM format.
  const function_features: string[] = extra_rust_target_features
    .flatMap((feat) => {
      const f = llvm_util.to_llvm_features(this.tcx.sess.target, feat);
      return f === undefined ? [] : [f];
    })
    .flatMap((feat) => feat.into_iter().map((f) => `+${f}`));

  const target_features = [...global_features, ...function_features].join(",");

  llvm.append_module_inline_asm(this.llmod(), utf8(template_str), target_features, llvm_util.target_cpu(this.tcx.sess.early_sess));
};

// rustc: compiler/rustc_codegen_llvm/src/asm.rs:527 mangled_name
CodegenCx.prototype.mangled_name = function (this: CodegenCx, instance: Instance): string {
  const llval = this.get_fn(instance);
  return expect_result(
    llvm.build_string((s) => {
      llvm.LLVMRustGetMangledName(llval, s);
    }),
    "symbol is not valid UTF-8",
    llvm.debug_FromUtf8Error,
  );
};

// PORT (lane cg-register): ported ahead of cg-asm, as `black_box` (intrinsic.rs) calls it from every std program's
// `__rust_begin_short_backtrace`.
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

/// If the register is an xmm/ymm/zmm register then return its index.
// rustc: compiler/rustc_codegen_llvm/src/asm.rs:649 xmm_reg_index
function xmm_reg_index(reg: InlineAsmReg): number | undefined {
  // use X86InlineAsmReg::*;
  const d = X86InlineAsmReg.discriminant;
  if (reg.$ === "X86" && d(reg._0) >= d("xmm0") && d(reg._0) <= d("xmm15")) {
    return d(reg._0) - d("xmm0");
  }
  if (reg.$ === "X86" && d(reg._0) >= d("ymm0") && d(reg._0) <= d("ymm15")) {
    return d(reg._0) - d("ymm0");
  }
  if (reg.$ === "X86" && d(reg._0) >= d("zmm0") && d(reg._0) <= d("zmm31")) {
    return d(reg._0) - d("zmm0");
  }
  return undefined;
}

/// If the register is an AArch64 integer register then return its index.
// rustc: compiler/rustc_codegen_llvm/src/asm.rs:666 a64_reg_index
function a64_reg_index(reg: InlineAsmReg): number | undefined {
  switch (reg.$) {
    case "AArch64":
      return AArch64InlineAsmReg.reg_index(reg._0);
    default:
      return undefined;
  }
}

/// If the register is an AArch64 vector register then return its index.
// rustc: compiler/rustc_codegen_llvm/src/asm.rs:674 a64_vreg_index
function a64_vreg_index(reg: InlineAsmReg): number | undefined {
  switch (reg.$) {
    case "AArch64":
      return AArch64InlineAsmReg.vreg_index(reg._0);
    default:
      return undefined;
  }
}

/// If the register is a Hexagon register pair then return its LLVM double register index.
/// LLVM uses `d0`, `d1`, ... for Hexagon double registers in inline asm constraints,
/// not the assembly-printed `r1:0`, `r3:2`, ... format.
// rustc: compiler/rustc_codegen_llvm/src/asm.rs:684 hexagon_reg_pair_index
function hexagon_reg_pair_index(reg: InlineAsmReg): number | undefined {
  if (reg.$ !== "Hexagon") return undefined;
  switch (reg._0 as string) {
    case "r1_0":
      return 0;
    case "r3_2":
      return 1;
    case "r5_4":
      return 2;
    case "r7_6":
      return 3;
    case "r9_8":
      return 4;
    case "r11_10":
      return 5;
    case "r13_12":
      return 6;
    case "r15_14":
      return 7;
    case "r17_16":
      return 8;
    case "r21_20":
      return 10;
    case "r23_22":
      return 11;
    case "r25_24":
      return 12;
    case "r27_26":
      return 13;
    default:
      return undefined;
  }
}

/// If the register is a Hexagon HVX vector pair then return its LLVM W-register index.
/// LLVM uses `w0`, `w1`, ... for Hexagon vector pair registers in inline asm constraints.
// rustc: compiler/rustc_codegen_llvm/src/asm.rs:705 hexagon_vreg_pair_index
function hexagon_vreg_pair_index(reg: InlineAsmReg): number | undefined {
  if (reg.$ !== "Hexagon") return undefined;
  switch (reg._0 as string) {
    case "v1_0":
      return 0;
    case "v3_2":
      return 1;
    case "v5_4":
      return 2;
    case "v7_6":
      return 3;
    case "v9_8":
      return 4;
    case "v11_10":
      return 5;
    case "v13_12":
      return 6;
    case "v15_14":
      return 7;
    case "v17_16":
      return 8;
    case "v19_18":
      return 9;
    case "v21_20":
      return 10;
    case "v23_22":
      return 11;
    case "v25_24":
      return 12;
    case "v27_26":
      return 13;
    case "v29_28":
      return 14;
    case "v31_30":
      return 15;
    default:
      return undefined;
  }
}

/** `llvm_util::get_version() < (major, minor, patch)` (tuple order). */
function llvm_version_lt(major: number, minor: number, patch: number): boolean {
  const [a, b, c] = llvm_util.get_version();
  return a !== major ? a < major : b !== minor ? b < minor : c < patch;
}

/// Converts a register class to an LLVM constraint code.
// rustc: compiler/rustc_codegen_llvm/src/asm.rs:728 reg_to_llvm
function reg_to_llvm(reg: InlineAsmRegOrRegClass, layout: TyAndLayout | undefined): string {
  // use InlineAsmRegClass::*;
  switch (reg.$) {
    // For vector registers LLVM wants the register name to match the type size.
    case "Reg": {
      const r = reg._0;
      let idx: number | undefined;
      if ((idx = xmm_reg_index(r)) !== undefined) {
        let class_: string;
        if (layout !== undefined) {
          switch (layout.size.bytes()) {
            case 64:
              class_ = "z";
              break;
            case 32:
              class_ = "y";
              break;
            default:
              class_ = "x";
              break;
          }
        } else {
          // We use f32 as the type for discarded outputs
          class_ = "x";
        }
        return `{${class_}mm${idx}}`;
      } else if ((idx = a64_reg_index(r)) !== undefined) {
        let class_: string;
        if (layout !== undefined) {
          switch (layout.size.bytes()) {
            case 8:
              class_ = "x";
              break;
            default:
              class_ = "w";
              break;
          }
        } else {
          // We use i32 as the type for discarded outputs
          class_ = "w";
        }

        if (class_ === "x" && r === InlineAsmReg.AArch64("x30") && llvm_version_lt(23, 0, 0)) {
          // FIXME(llvm): LLVM <23 does not recognize `x30` as a register name.
          // This workaround can be removed when support for LLVM 22 is dropped.
          return "{lr}";
        } else {
          return `{${class_}${idx}}`;
        }
      } else if ((idx = a64_vreg_index(r)) !== undefined) {
        let class_: string;
        if (layout !== undefined && layout.backend_repr.$ === "SimdScalableVector") {
          class_ = "z";
        } else if (layout !== undefined) {
          switch (layout.size.bytes()) {
            case 16:
              class_ = "q";
              break;
            case 8:
              class_ = "d";
              break;
            case 4:
              class_ = "s";
              break;
            case 2:
              class_ = "h";
              break;
            case 1:
              class_ = "d"; // We fixup i8 to i8x8
              break;
            default:
              return unreachable();
          }
        } else {
          // We use i64x2 as the type for discarded outputs
          class_ = "q";
        }
        return `{${class_}${idx}}`;
      } else if ((idx = hexagon_reg_pair_index(r)) !== undefined) {
        // LLVM uses `dN` for Hexagon double registers, not the `rN+1:N` asm syntax.
        return `{d${idx}}`;
      } else if ((idx = hexagon_vreg_pair_index(r)) !== undefined) {
        // LLVM uses `wN` for Hexagon HVX vector pair registers.
        return `{w${idx}}`;
      } else if (r.$ === "Arm" && (r._0 as string) === "r14") {
        // FIXME(llvm): LLVM <23 does not recognize `r14` as a register name
        // in inline assembly.
        // We can make this branch fallthrough again for LLVM 23+ when https://github.com/llvm/llvm-project/pull/225746 gets released.
        return "{lr}";
      } else if (r.$ === "Sparc") {
        // `if let InlineAsmReg::Sparc(reg) = reg && let Some(num) = reg.dreg_number()` => `{d{num / 2}}` (LLVM numbers d
        // registers sequentially: d0 => d0, d2 => d1, d4 => d2 etc.), then `qreg_number()` => `{q{num / 4}}` (q0 => q0,
        // q4 => q1, q8 => q2 etc.), else the name. PORT: `SparcInlineAsmReg` is a stub module (see the header).
        return unported("rustc_target::asm::sparc::SparcInlineAsmReg::dreg_number");
      } else {
        return `{${InlineAsmReg.name(r)}}`;
      }
    }
    // The constraints can be retrieved from
    // https://llvm.org/docs/LangRef.html#supported-constraint-code-list
    case "RegClass": {
      const c = reg._0;
      const s = c.$ === "Err" ? undefined : (c._0 as string);
      switch (c.$) {
        case "AArch64":
          switch (s) {
            case "reg":
              return "r";
            case "vreg":
              return "w";
            case "vreg_low16":
              return "x";
            // Although the above link suggests its just 'Upa', llvm's own tests seem to suggest its
            // '@3Upa'. (see "src/llvm-project/clang/test/CodeGen/AArch64/sve-inline-asm-datatypes.c" line 139)
            case "preg":
              return "@3Upa";
            case "ffr":
              return unreachable("clobber-only");
          }
          break;
        case "Arm":
          switch (s) {
            case "reg":
              return "r";
            case "sreg":
            case "dreg_low16":
            case "qreg_low8":
              return "t";
            case "sreg_low16":
            case "dreg_low8":
            case "qreg_low4":
              return "x";
            case "dreg":
            case "qreg":
              return "w";
          }
          break;
        case "Amdgpu":
          // `Sgpr(_)` / `Vgpr(_)` carry a size; the stub module's values are opaque.
          return unported("rustc_target::asm::amdgpu::AmdgpuInlineAsmRegClass (reg_to_llvm)");
        case "Hexagon":
          switch (s) {
            case "reg":
              return "r";
            case "reg_pair":
              return "r";
            case "preg":
              return unreachable("clobber-only");
            case "vreg":
              return "v";
            case "vreg_pair":
              return "v";
            case "qreg":
              return unreachable("clobber-only");
          }
          break;
        case "LoongArch":
          switch (s) {
            case "reg":
              return "r";
            case "freg":
            case "vreg":
            case "xreg":
              return "f";
          }
          break;
        case "Mips":
          switch (s) {
            case "reg":
              return "r";
            case "freg":
            case "wreg":
              return "f";
          }
          break;
        case "Nvptx":
          switch (s) {
            case "reg16":
              return "h";
            case "reg32":
              return "r";
            case "reg64":
              return "l";
          }
          break;
        case "PowerPC":
          switch (s) {
            case "reg":
              return "r";
            case "reg_nonzero":
              return "b";
            case "freg":
              return "f";
            case "vreg":
              return "v";
            case "vsreg":
              return "^wa";
            case "cr":
            case "ctr":
            case "lr":
            case "xer":
            case "spe_acc":
              return unreachable("clobber-only");
          }
          break;
        case "RiscV":
          switch (s) {
            case "reg":
              return "r";
            case "freg":
              return "f";
            case "vreg":
              return unreachable("clobber-only");
          }
          break;
        case "X86":
          switch (c._0) {
            case "reg":
              return "r";
            case "reg_abcd":
              return "Q";
            case "reg_byte":
              return "q";
            case "xmm_reg":
            case "ymm_reg":
              return "x";
            case "zmm_reg":
              return "v";
            case "kreg":
              return "^Yk";
            case "x87_reg":
            case "mmx_reg":
            case "kreg0":
            case "tmm_reg":
              return unreachable("clobber-only");
          }
          break;
        case "Xtensa":
          switch (s) {
            case "freg":
              return "f";
            case "reg":
              return "r";
            case "sreg":
            case "breg":
              return unreachable("clobber-only");
          }
          break;
        case "Wasm":
          switch (c._0) {
            case "local":
              return "r";
          }
          break;
        case "Bpf":
          switch (s) {
            case "reg":
              return "r";
            case "wreg":
              return "w";
          }
          break;
        case "Avr":
          switch (s) {
            case "reg":
              return "r";
            case "reg_upper":
              return "d";
            case "reg_pair":
              return "r";
            case "reg_iw":
              return "w";
            case "reg_ptr":
              return "e";
          }
          break;
        case "S390x":
          switch (s) {
            case "reg":
              return "r";
            case "reg_addr":
              return "a";
            case "freg":
              return "f";
            case "vreg":
              return "v";
            case "areg":
              return unreachable("clobber-only");
          }
          break;
        case "Sparc":
          switch (s) {
            case "reg":
              return "r";
            case "freg":
              return "f";
            case "dreg":
            case "qreg":
              return "e";
            case "yreg":
              return unreachable("clobber-only");
          }
          break;
        case "Msp430":
          switch (s) {
            case "reg":
              return "r";
          }
          break;
        case "M68k":
          switch (s) {
            case "reg":
              return "r";
            case "reg_addr":
              return "a";
            case "reg_data":
              return "d";
          }
          break;
        case "CSKY":
          switch (s) {
            case "reg":
              return "r";
            case "freg":
              return "f";
          }
          break;
        case "SpirV":
          switch (s) {
            case "reg":
              return bug("LLVM backend does not support SPIR-V");
          }
          break;
        case "Err":
          return unreachable();
      }
      // PORT: the arch enums are exhaustive upstream; a class name not listed above cannot exist.
      return unreachable();
    }
  }
}

/// Converts a modifier into LLVM's equivalent modifier.
// rustc: compiler/rustc_codegen_llvm/src/asm.rs:915 modifier_to_llvm
function modifier_to_llvm(arch: InlineAsmArch, reg: InlineAsmRegClass, modifier: number | undefined): number | undefined {
  // use InlineAsmRegClass::*;
  // The modifiers can be retrieved from
  // https://llvm.org/docs/LangRef.html#asm-template-argument-modifiers
  const C = (c: string): number => c.codePointAt(0)!;
  const s = reg.$ === "Err" ? undefined : (reg._0 as string);
  switch (reg.$) {
    case "AArch64":
      switch (s) {
        case "reg":
          return modifier;
        case "vreg":
        case "vreg_low16":
          if (modifier === C("v")) {
            return undefined;
          } else {
            return modifier;
          }
        case "preg":
        case "ffr":
          return undefined;
      }
      break;
    case "Arm":
      switch (s) {
        case "reg":
          return undefined;
        case "sreg":
        case "sreg_low16":
          return undefined;
        case "dreg":
        case "dreg_low16":
        case "dreg_low8":
          return C("P");
        case "qreg":
        case "qreg_low8":
        case "qreg_low4":
          if (modifier === undefined) {
            return C("q");
          } else {
            return modifier;
          }
      }
      break;
    case "Amdgpu":
      return undefined;
    case "Hexagon":
      return undefined;
    case "LoongArch":
      switch (s) {
        case "reg":
          return undefined;
        case "freg":
          return modifier;
        case "vreg":
          if (modifier === undefined) {
            return C("w");
          } else {
            return modifier;
          }
        case "xreg":
          if (modifier === undefined) {
            return C("u");
          } else {
            return modifier;
          }
      }
      break;
    case "Mips":
      switch (s) {
        case "reg":
          return undefined;
        case "freg":
          return modifier;
        case "wreg":
          return C("w");
      }
      break;
    case "Nvptx":
      return undefined;
    case "PowerPC":
      if (s === "vsreg") {
        // The documentation for the 'x' modifier is missing for llvm, and the gcc
        // documentation is simply "use this for any vsx argument". It is needed
        // to ensure the correct vsx register number is used.
        if (modifier === undefined) {
          return C("x");
        } else {
          return modifier;
        }
      }
      return undefined;
    case "RiscV":
      switch (s) {
        case "reg":
        case "freg":
          return undefined;
        case "vreg":
          return unreachable("clobber-only");
      }
      break;
    case "X86":
      switch (reg._0) {
        case "reg":
        case "reg_abcd":
          if (modifier === undefined && arch === "X86_64") return C("q");
          if (modifier === undefined) return C("k");
          if (modifier === C("l")) return C("b");
          if (modifier === C("h")) return C("h");
          if (modifier === C("x")) return C("w");
          if (modifier === C("e")) return C("k");
          if (modifier === C("r")) return C("q");
          return unreachable();
        case "reg_byte":
          return undefined;
        case "xmm_reg":
        case "ymm_reg":
        case "zmm_reg": {
          const reg_ = reg._0;
          if (reg_ === "xmm_reg" && modifier === undefined) return C("x");
          if (reg_ === "ymm_reg" && modifier === undefined) return C("t");
          if (reg_ === "zmm_reg" && modifier === undefined) return C("g");
          if (modifier === C("x")) return C("x");
          if (modifier === C("y")) return C("t");
          if (modifier === C("z")) return C("g");
          return unreachable();
        }
        case "kreg":
          return undefined;
        case "x87_reg":
        case "mmx_reg":
        case "kreg0":
        case "tmm_reg":
          return unreachable("clobber-only");
      }
      break;
    case "Xtensa":
      return undefined;
    case "Wasm":
      switch (reg._0) {
        case "local":
          return undefined;
      }
      break;
    case "Bpf":
      return undefined;
    case "Avr":
      switch (s) {
        case "reg_pair":
        case "reg_iw":
        case "reg_ptr":
          if (modifier === C("h")) return C("B");
          if (modifier === C("l")) return C("A");
          return undefined;
      }
      return undefined;
    case "S390x":
      return undefined;
    case "Sparc":
      return undefined;
    case "Msp430":
      return undefined;
    case "SpirV":
      if (s === "reg") return bug("LLVM backend does not support SPIR-V");
      break;
    case "M68k":
      return undefined;
    case "CSKY":
      return undefined;
    case "Err":
      return unreachable();
  }
  // PORT: the arch enums are exhaustive upstream; a class name not listed above cannot exist.
  return unreachable();
}

/// Type to use for outputs that are discarded. It doesn't really matter what
/// the type is, as long as it is valid for the constraint code.
// rustc: compiler/rustc_codegen_llvm/src/asm.rs:1030 dummy_output_type
function dummy_output_type(cx: CodegenCx, reg: InlineAsmRegClass): Type {
  // use InlineAsmRegClass::*;
  const s = reg.$ === "Err" ? undefined : (reg._0 as string);
  switch (reg.$) {
    case "AArch64":
      switch (s) {
        case "reg":
          return cx.type_i32();
        case "vreg":
        case "vreg_low16":
          return cx.type_vector(cx.type_i64(), 2);
        case "preg":
          return cx.type_scalable_vector(cx.type_i1(), 16);
        case "ffr":
          return unreachable("clobber-only");
      }
      break;
    case "Arm":
      switch (s) {
        case "reg":
          return cx.type_i32();
        case "sreg":
        case "sreg_low16":
          return cx.type_f32();
        case "dreg":
        case "dreg_low16":
        case "dreg_low8":
          return cx.type_f64();
        case "qreg":
        case "qreg_low8":
        case "qreg_low4":
          return cx.type_vector(cx.type_i64(), 2);
      }
      break;
    case "Amdgpu":
      return cx.type_i32();
    case "Hexagon":
      switch (s) {
        case "reg":
          return cx.type_i32();
        case "reg_pair":
          return cx.type_i64();
        case "preg":
          return unreachable("clobber-only");
        case "vreg":
          // HVX vector register size depends on the HVX mode.
          // LLVM's "v" constraint requires the exact vector width.
          if (cx.tcx.sess.internal_target_features.has(sym.hvx_length128b)) {
            return cx.type_vector(cx.type_i32(), 32); // 1024-bit for 128B mode
          } else {
            return cx.type_vector(cx.type_i32(), 16); // 512-bit for 64B mode
          }
        case "vreg_pair":
          if (cx.tcx.sess.internal_target_features.has(sym.hvx_length128b)) {
            return cx.type_vector(cx.type_i32(), 64); // 2048-bit for 128B mode
          } else {
            return cx.type_vector(cx.type_i32(), 32); // 1024-bit for 64B mode
          }
        case "qreg":
          return unreachable("clobber-only");
      }
      break;
    case "LoongArch":
      switch (s) {
        case "reg":
          return cx.type_i32();
        case "freg":
          return cx.type_f32();
        case "vreg":
          return cx.type_vector(cx.type_i32(), 4);
        case "xreg":
          return cx.type_vector(cx.type_i32(), 8);
      }
      break;
    case "Mips":
      switch (s) {
        case "reg":
          return cx.type_i32();
        case "freg":
          return cx.type_f32();
        case "wreg":
          return cx.type_vector(cx.type_i32(), 4);
      }
      break;
    case "Nvptx":
      switch (s) {
        case "reg16":
          return cx.type_i16();
        case "reg32":
          return cx.type_i32();
        case "reg64":
          return cx.type_i64();
      }
      break;
    case "PowerPC":
      switch (s) {
        case "reg":
          return cx.type_i32();
        case "reg_nonzero":
          return cx.type_i32();
        case "freg":
          return cx.type_f64();
        case "vreg":
          return cx.type_vector(cx.type_i32(), 4);
        case "vsreg":
          return cx.type_vector(cx.type_i32(), 4);
        case "cr":
        case "ctr":
        case "lr":
        case "xer":
        case "spe_acc":
          return unreachable("clobber-only");
      }
      break;
    case "RiscV":
      switch (s) {
        case "reg":
          return cx.type_i32();
        case "freg":
          return cx.type_f32();
        case "vreg":
          return unreachable("clobber-only");
      }
      break;
    case "X86":
      switch (reg._0) {
        case "reg":
        case "reg_abcd":
          return cx.type_i32();
        case "reg_byte":
          return cx.type_i8();
        case "xmm_reg":
        case "ymm_reg":
        case "zmm_reg":
          return cx.type_f32();
        case "kreg":
          return cx.type_i16();
        case "x87_reg":
        case "mmx_reg":
        case "kreg0":
        case "tmm_reg":
          return unreachable("clobber-only");
      }
      break;
    case "Xtensa":
      switch (s) {
        case "reg":
          return cx.type_i32();
        case "freg":
          return cx.type_f32();
        case "sreg":
        case "breg":
          return unreachable("clobber-only");
      }
      break;
    case "Wasm":
      switch (reg._0) {
        case "local":
          return cx.type_i32();
      }
      break;
    case "Bpf":
      switch (s) {
        case "reg":
          return cx.type_i64();
        case "wreg":
          return cx.type_i32();
      }
      break;
    case "Avr":
      switch (s) {
        case "reg":
          return cx.type_i8();
        case "reg_upper":
          return cx.type_i8();
        case "reg_pair":
          return cx.type_i16();
        case "reg_iw":
          return cx.type_i16();
        case "reg_ptr":
          return cx.type_i16();
      }
      break;
    case "S390x":
      switch (s) {
        case "reg":
        case "reg_addr":
          return cx.type_i32();
        case "freg":
          return cx.type_f64();
        case "vreg":
          return cx.type_vector(cx.type_i64(), 2);
        case "areg":
          return unreachable("clobber-only");
      }
      break;
    case "Sparc":
      switch (s) {
        case "reg":
          return cx.type_i32();
        case "freg":
          return cx.type_f32();
        case "dreg":
          return cx.type_f64();
        case "qreg":
          return cx.type_f128();
        case "yreg":
          return unreachable("clobber-only");
      }
      break;
    case "Msp430":
      switch (s) {
        case "reg":
          return cx.type_i16();
      }
      break;
    case "M68k":
      switch (s) {
        case "reg":
          return cx.type_i32();
        case "reg_addr":
          return cx.type_i32();
        case "reg_data":
          return cx.type_i32();
      }
      break;
    case "CSKY":
      switch (s) {
        case "reg":
          return cx.type_i32();
        case "freg":
          return cx.type_f32();
      }
      break;
    case "SpirV":
      if (s === "reg") return bug("LLVM backend does not support SPIR-V");
      break;
    case "Err":
      return unreachable();
  }
  // PORT: the arch enums are exhaustive upstream; a class name not listed above cannot exist.
  return unreachable();
}

/// Helper function to get the LLVM type for a Scalar. Pointers are returned as
/// the equivalent integer type.
// rustc: compiler/rustc_codegen_llvm/src/asm.rs:1144 llvm_asm_scalar_type
function llvm_asm_scalar_type(cx: CodegenCx, scalar: Scalar): Type {
  const dl = cx.tcx.data_layout();
  const p = Scalar.primitive(scalar);
  switch (p.$) {
    case "Int":
      switch (p._0) {
        case "I8":
          return cx.type_i8();
        case "I16":
          return cx.type_i16();
        case "I32":
          return cx.type_i32();
        case "I64":
          return cx.type_i64();
        default:
          return unreachable();
      }
    case "Float":
      switch (p._0) {
        case "F16":
          return cx.type_f16();
        case "F32":
          return cx.type_f32();
        case "F64":
          return cx.type_f64();
        case "F128":
          return cx.type_f128();
        default:
          return unreachable();
      }
    // FIXME(erikdesjardins): handle non-default addrspace ptr sizes
    case "Pointer":
      return cx.type_from_integer(dl.ptr_sized_integer());
  }
}

// rustc: compiler/rustc_codegen_llvm/src/asm.rs:1161 any_target_feature_enabled
function any_target_feature_enabled(cx: CodegenCx, instance: Instance, features: readonly Symbol[]): boolean {
  const enabled = cx.tcx.asm_target_features(Instance.def_id(instance));
  return features.some((feat) => enabled.has(feat));
}

/** `Primitive::Int(Integer::I*, _)` of a scalar. */
function is_int(s: Scalar, i: "I8" | "I16" | "I32" | "I64"): boolean {
  const p = Scalar.primitive(s);
  return p.$ === "Int" && p._0 === i;
}

/** `s.primitive() == Primitive::Float(f)`. */
function is_float(s: Scalar, f: Float): boolean {
  const p = Scalar.primitive(s);
  return p.$ === "Float" && p._0 === f;
}

/** `reg` is `$arch($class)` for one of `classes`. */
function is_class(reg: InlineAsmRegClass, arch: InlineAsmRegClass["$"], ...classes: string[]): boolean {
  return reg.$ === arch && reg.$ !== "Err" && classes.includes(reg._0 as string);
}

/** `count.as_u64()` of a `BackendLaneCount`. */
function lanes(repr: Extract<BackendRepr, { $: "SimdVector" }>): number {
  return repr.count as number;
}

/// Fix up an input value to work around LLVM bugs.
// rustc: compiler/rustc_codegen_llvm/src/asm.rs:1171 llvm_fixup_input
function llvm_fixup_input(bx: Builder, value: Value, reg: InlineAsmRegClass, layout: TyAndLayout, instance: Instance): Value {
  // use InlineAsmRegClass::*;
  const dl = bx.cx_.tcx.data_layout();
  const repr = layout.backend_repr;
  const X86_VEC = ["xmm_reg", "ymm_reg", "zmm_reg"];
  if (is_class(reg, "AArch64", "vreg") && repr.$ === "Scalar") {
    const s = repr._0;
    if (is_int(s, "I8")) {
      const vec_ty = bx.cx_.type_vector(bx.cx_.type_i8(), 8);
      return bx.insert_element(bx.const_undef(vec_ty), value, bx.const_i32(0));
    } else {
      return value;
    }
  } else if (is_class(reg, "AArch64", "vreg_low16") && repr.$ === "Scalar" && !is_float(repr._0, "F128")) {
    const s = repr._0;
    const elem_ty = llvm_asm_scalar_type(bx.cx_, s);
    const count = 16 / layout.size.bytes();
    const vec_ty = bx.cx_.type_vector(elem_ty, count);
    // FIXME(erikdesjardins): handle non-default addrspace ptr sizes
    if (Scalar.primitive(s).$ === "Pointer") {
      const t = bx.type_from_integer(dl.ptr_sized_integer());
      value = bx.ptrtoint(value, t);
    }
    return bx.insert_element(bx.const_undef(vec_ty), value, bx.const_i32(0));
  } else if (is_class(reg, "AArch64", "vreg_low16") && repr.$ === "SimdVector" && layout.size.bytes() === 8) {
    const elem_ty = llvm_asm_scalar_type(bx.cx_, repr.element);
    const count = lanes(repr);
    const vec_ty = bx.cx_.type_vector(elem_ty, count);
    const indices: Value[] = [];
    for (let x = 0; x < count * 2; x++) indices.push(bx.const_u32(x));
    return bx.shuffle_vector(value, bx.const_undef(vec_ty), bx.const_vector(indices));
  } else if (is_class(reg, "X86", "reg_abcd") && repr.$ === "Scalar" && is_float(repr._0, "F64")) {
    return bx.bitcast_inherent(value, bx.cx_.type_i64());
  } else if (is_class(reg, "X86", "xmm_reg", "zmm_reg") && repr.$ === "SimdVector" && layout.size.bytes() === 64) {
    return bx.bitcast_inherent(value, bx.cx_.type_vector(bx.cx_.type_f64(), 8));
  } else if (is_class(reg, "X86", ...X86_VEC) && repr.$ === "Scalar" && bx.sess().asm_arch === "X86" && is_float(repr._0, "F128")) {
    return bx.bitcast_inherent(value, bx.type_vector(bx.type_i32(), 4));
  } else if (is_class(reg, "X86", ...X86_VEC) && repr.$ === "Scalar" && is_float(repr._0, "F16")) {
    const value_ = bx.insert_element(bx.const_undef(bx.type_vector(bx.type_f16(), 8)), value, bx.const_usize(0n));
    return bx.bitcast_inherent(value_, bx.type_vector(bx.type_i16(), 8));
  } else if (is_class(reg, "X86", ...X86_VEC) && repr.$ === "SimdVector" && (lanes(repr) === 8 || lanes(repr) === 16) && is_float(repr.element, "F16")) {
    return bx.bitcast_inherent(value, bx.type_vector(bx.type_i16(), lanes(repr)));
  } else if (is_class(reg, "Arm", "sreg", "sreg_low16") && repr.$ === "Scalar") {
    if (is_int(repr._0, "I32")) {
      return bx.bitcast_inherent(value, bx.cx_.type_f32());
    } else {
      return value;
    }
  } else if (is_class(reg, "Arm", "dreg", "dreg_low8", "dreg_low16") && repr.$ === "Scalar") {
    if (is_int(repr._0, "I64")) {
      return bx.bitcast_inherent(value, bx.cx_.type_f64());
    } else {
      return value;
    }
  } else if (
    is_class(reg, "Arm", "dreg", "dreg_low8", "dreg_low16", "qreg", "qreg_low4", "qreg_low8") &&
    repr.$ === "SimdVector" &&
    (lanes(repr) === 4 || lanes(repr) === 8) &&
    is_float(repr.element, "F16")
  ) {
    return bx.bitcast_inherent(value, bx.type_vector(bx.type_i16(), lanes(repr)));
  } else if (is_class(reg, "LoongArch", "freg") && repr.$ === "Scalar" && is_float(repr._0, "F16")) {
    // The LoongArch psABI only requires the upper bits to be widened to
    // GRLEN, leaving them undefined. We NaN-box instead (set all upper
    // bits to 1), matching LLVM's own codegen, to avoid an `f16` value
    // being mistaken for a valid `f32` value.
    let value_ = bx.bitcast_inherent(value, bx.type_i16());
    value_ = bx.zext(value_, bx.type_i32());
    value_ = bx.or(value_, bx.const_u32(0xffff_0000));
    return bx.bitcast_inherent(value_, bx.type_f32());
  } else if (is_class(reg, "Mips", "reg") && repr.$ === "Scalar") {
    const p = Scalar.primitive(repr._0);
    // MIPS only supports register-length arithmetics.
    if (p.$ === "Int" && (p._0 === "I8" || p._0 === "I16")) {
      return bx.zext(value, bx.type_i32());
    } else if (p.$ === "Float" && p._0 === "F16") {
      const value_ = bx.bitcast_inherent(value, bx.type_i16());
      return bx.zext(value_, bx.type_i32());
    } else if (p.$ === "Float" && p._0 === "F32") {
      return bx.bitcast_inherent(value, bx.type_i32());
    } else if (p.$ === "Float" && p._0 === "F64") {
      return bx.bitcast_inherent(value, bx.type_i64());
    } else {
      return value;
    }
  } else if (is_class(reg, "Mips", "freg", "wreg") && repr.$ === "Scalar" && is_float(repr._0, "F16")) {
    let value_ = bx.bitcast_inherent(value, bx.type_i16());
    value_ = bx.zext(value_, bx.type_i32());
    return bx.bitcast_inherent(value_, bx.type_f32());
  } else if (
    is_class(reg, "RiscV", "freg") &&
    repr.$ === "Scalar" &&
    is_float(repr._0, "F16") &&
    !any_target_feature_enabled(bx.cx_, instance, [sym.zfhmin, sym.zfh])
  ) {
    // Smaller floats are always "NaN-boxed" inside larger floats on RISC-V.
    let value_ = bx.bitcast_inherent(value, bx.type_i16());
    value_ = bx.zext(value_, bx.type_i32());
    value_ = bx.or(value_, bx.const_u32(0xffff_0000));
    return bx.bitcast_inherent(value_, bx.type_f32());
  } else if (
    is_class(reg, "PowerPC", "vreg", "vsreg") &&
    repr.$ === "Scalar" &&
    (is_float(repr._0, "F16") || is_float(repr._0, "F32") || is_float(repr._0, "F64"))
  ) {
    const float = (Scalar.primitive(repr._0) as Extract<Primitive, { $: "Float" }>)._0;
    const num_lanes = 16 / FloatC.size(float).bytes();
    // `f16` is located in the rightmost halfword of doubleword 0 per section 7.3.2.5 of
    // "Power Instruction Set Architecture", version 3.1C.
    const offset = float === "F16" ? 3 : 0;
    return bx.insert_element(
      bx.const_undef(bx.type_vector(bx.type_from_float(float), num_lanes)),
      value,
      bx.const_usize(BigInt(bx.target_spec().endian === "Little" ? num_lanes - 1 - offset : offset)),
    );
  } else if (is_class(reg, "PowerPC", "vreg", "vsreg") && repr.$ === "Scalar" && is_float(repr._0, "F128")) {
    return bx.bitcast_inherent(value, bx.type_vector(bx.type_f64(), 2));
  } else {
    return value;
  }
}

/// Fix up an output value to work around LLVM bugs.
// rustc: compiler/rustc_codegen_llvm/src/asm.rs:1374 llvm_fixup_output
function llvm_fixup_output(bx: Builder, value: Value, reg: InlineAsmRegClass, layout: TyAndLayout, instance: Instance): Value {
  // use InlineAsmRegClass::*;
  const repr = layout.backend_repr;
  const X86_VEC = ["xmm_reg", "ymm_reg", "zmm_reg"];
  if (is_class(reg, "AArch64", "vreg") && repr.$ === "Scalar") {
    if (is_int(repr._0, "I8")) {
      return bx.extract_element(value, bx.const_i32(0));
    } else {
      return value;
    }
  } else if (is_class(reg, "AArch64", "vreg_low16") && repr.$ === "Scalar" && !is_float(repr._0, "F128")) {
    value = bx.extract_element(value, bx.const_i32(0));
    if (Scalar.primitive(repr._0).$ === "Pointer") {
      value = bx.inttoptr(value, layout.llvm_type(bx.cx_));
    }
    return value;
  } else if (is_class(reg, "AArch64", "vreg_low16") && repr.$ === "SimdVector" && layout.size.bytes() === 8) {
    const elem_ty = llvm_asm_scalar_type(bx.cx_, repr.element);
    const count = lanes(repr);
    const vec_ty = bx.cx_.type_vector(elem_ty, count * 2);
    const indices: Value[] = [];
    for (let x = 0; x < count; x++) indices.push(bx.const_i32(x));
    return bx.shuffle_vector(value, bx.const_undef(vec_ty), bx.const_vector(indices));
  } else if (is_class(reg, "X86", "reg_abcd") && repr.$ === "Scalar" && is_float(repr._0, "F64")) {
    return bx.bitcast_inherent(value, bx.cx_.type_f64());
  } else if (is_class(reg, "X86", "xmm_reg", "zmm_reg") && repr.$ === "SimdVector" && layout.size.bytes() === 64) {
    return bx.bitcast_inherent(value, layout.llvm_type(bx.cx_));
  } else if (is_class(reg, "X86", ...X86_VEC) && repr.$ === "Scalar" && bx.sess().asm_arch === "X86" && is_float(repr._0, "F128")) {
    return bx.bitcast_inherent(value, bx.type_f128());
  } else if (is_class(reg, "X86", ...X86_VEC) && repr.$ === "Scalar" && is_float(repr._0, "F16")) {
    const value_ = bx.bitcast_inherent(value, bx.type_vector(bx.type_f16(), 8));
    return bx.extract_element(value_, bx.const_usize(0n));
  } else if (is_class(reg, "X86", ...X86_VEC) && repr.$ === "SimdVector" && (lanes(repr) === 8 || lanes(repr) === 16) && is_float(repr.element, "F16")) {
    return bx.bitcast_inherent(value, bx.type_vector(bx.type_f16(), lanes(repr)));
  } else if (is_class(reg, "Arm", "sreg", "sreg_low16") && repr.$ === "Scalar") {
    if (is_int(repr._0, "I32")) {
      return bx.bitcast_inherent(value, bx.cx_.type_i32());
    } else {
      return value;
    }
  } else if (is_class(reg, "Arm", "dreg", "dreg_low8", "dreg_low16") && repr.$ === "Scalar") {
    if (is_int(repr._0, "I64")) {
      return bx.bitcast_inherent(value, bx.cx_.type_i64());
    } else {
      return value;
    }
  } else if (
    is_class(reg, "Arm", "dreg", "dreg_low8", "dreg_low16", "qreg", "qreg_low4", "qreg_low8") &&
    repr.$ === "SimdVector" &&
    (lanes(repr) === 4 || lanes(repr) === 8) &&
    is_float(repr.element, "F16")
  ) {
    return bx.bitcast_inherent(value, bx.type_vector(bx.type_f16(), lanes(repr)));
  } else if (is_class(reg, "LoongArch", "freg") && repr.$ === "Scalar" && is_float(repr._0, "F16")) {
    let value_ = bx.bitcast_inherent(value, bx.type_i32());
    value_ = bx.trunc_inherent(value_, bx.type_i16());
    return bx.bitcast_inherent(value_, bx.type_f16());
  } else if (is_class(reg, "Mips", "reg") && repr.$ === "Scalar") {
    const p = Scalar.primitive(repr._0);
    // MIPS only supports register-length arithmetics.
    if (p.$ === "Int" && p._0 === "I8") {
      return bx.trunc_inherent(value, bx.type_i8());
    } else if (p.$ === "Int" && p._0 === "I16") {
      return bx.trunc_inherent(value, bx.type_i16());
    } else if (p.$ === "Float" && p._0 === "F16") {
      const value_ = bx.trunc_inherent(value, bx.type_i16());
      return bx.bitcast_inherent(value_, bx.type_f16());
    } else if (p.$ === "Float" && p._0 === "F32") {
      return bx.bitcast_inherent(value, bx.type_f32());
    } else if (p.$ === "Float" && p._0 === "F64") {
      return bx.bitcast_inherent(value, bx.type_f64());
    } else {
      return value;
    }
  } else if (is_class(reg, "Mips", "freg", "wreg") && repr.$ === "Scalar" && is_float(repr._0, "F16")) {
    let value_ = bx.bitcast_inherent(value, bx.type_i32());
    value_ = bx.trunc_inherent(value_, bx.type_i16());
    return bx.bitcast_inherent(value_, bx.type_f16());
  } else if (
    is_class(reg, "RiscV", "freg") &&
    repr.$ === "Scalar" &&
    is_float(repr._0, "F16") &&
    !any_target_feature_enabled(bx.cx_, instance, [sym.zfhmin, sym.zfh])
  ) {
    let value_ = bx.bitcast_inherent(value, bx.type_i32());
    value_ = bx.trunc_inherent(value_, bx.type_i16());
    return bx.bitcast_inherent(value_, bx.type_f16());
  } else if (
    is_class(reg, "PowerPC", "vreg", "vsreg") &&
    repr.$ === "Scalar" &&
    (is_float(repr._0, "F16") || is_float(repr._0, "F32") || is_float(repr._0, "F64"))
  ) {
    const float = (Scalar.primitive(repr._0) as Extract<Primitive, { $: "Float" }>)._0;
    const num_lanes = 16 / FloatC.size(float).bytes();
    // `f16` is located in the rightmost halfword of doubleword 0 per section 7.3.2.5 of
    // "Power Instruction Set Architecture", version 3.1C.
    const offset = float === "F16" ? 3 : 0;
    return bx.extract_element(value, bx.const_usize(BigInt(bx.target_spec().endian === "Little" ? num_lanes - 1 - offset : offset)));
  } else if (is_class(reg, "PowerPC", "vreg", "vsreg") && repr.$ === "Scalar" && is_float(repr._0, "F128")) {
    return bx.bitcast_inherent(value, bx.type_f128());
  } else {
    return value;
  }
}

/// Output type to use for llvm_fixup_output.
// rustc: compiler/rustc_codegen_llvm/src/asm.rs:1558 llvm_fixup_output_type
function llvm_fixup_output_type(cx: CodegenCx, reg: InlineAsmRegClass, layout: TyAndLayout, instance: Instance): Type {
  // use InlineAsmRegClass::*;
  const repr = layout.backend_repr;
  const X86_VEC = ["xmm_reg", "ymm_reg", "zmm_reg"];
  if (is_class(reg, "AArch64", "vreg") && repr.$ === "Scalar") {
    if (is_int(repr._0, "I8")) {
      return cx.type_vector(cx.type_i8(), 8);
    } else {
      return layout.llvm_type(cx);
    }
  } else if (is_class(reg, "AArch64", "vreg_low16") && repr.$ === "Scalar" && !is_float(repr._0, "F128")) {
    const elem_ty = llvm_asm_scalar_type(cx, repr._0);
    const count = 16 / layout.size.bytes();
    return cx.type_vector(elem_ty, count);
  } else if (is_class(reg, "AArch64", "vreg_low16") && repr.$ === "SimdVector" && layout.size.bytes() === 8) {
    const elem_ty = llvm_asm_scalar_type(cx, repr.element);
    return cx.type_vector(elem_ty, lanes(repr) * 2);
  } else if (is_class(reg, "X86", "reg_abcd") && repr.$ === "Scalar" && is_float(repr._0, "F64")) {
    return cx.type_i64();
  } else if (is_class(reg, "X86", "xmm_reg", "zmm_reg") && repr.$ === "SimdVector" && layout.size.bytes() === 64) {
    return cx.type_vector(cx.type_f64(), 8);
  } else if (is_class(reg, "X86", ...X86_VEC) && repr.$ === "Scalar" && cx.sess().asm_arch === "X86" && is_float(repr._0, "F128")) {
    return cx.type_vector(cx.type_i32(), 4);
  } else if (is_class(reg, "X86", ...X86_VEC) && repr.$ === "Scalar" && is_float(repr._0, "F16")) {
    return cx.type_vector(cx.type_i16(), 8);
  } else if (is_class(reg, "X86", ...X86_VEC) && repr.$ === "SimdVector" && (lanes(repr) === 8 || lanes(repr) === 16) && is_float(repr.element, "F16")) {
    return cx.type_vector(cx.type_i16(), lanes(repr));
  } else if (is_class(reg, "Arm", "sreg", "sreg_low16") && repr.$ === "Scalar") {
    if (is_int(repr._0, "I32")) {
      return cx.type_f32();
    } else {
      return layout.llvm_type(cx);
    }
  } else if (is_class(reg, "Arm", "dreg", "dreg_low8", "dreg_low16") && repr.$ === "Scalar") {
    if (is_int(repr._0, "I64")) {
      return cx.type_f64();
    } else {
      return layout.llvm_type(cx);
    }
  } else if (
    is_class(reg, "Arm", "dreg", "dreg_low8", "dreg_low16", "qreg", "qreg_low4", "qreg_low8") &&
    repr.$ === "SimdVector" &&
    (lanes(repr) === 4 || lanes(repr) === 8) &&
    is_float(repr.element, "F16")
  ) {
    return cx.type_vector(cx.type_i16(), lanes(repr));
  } else if (is_class(reg, "LoongArch", "freg") && repr.$ === "Scalar" && is_float(repr._0, "F16")) {
    return cx.type_f32();
  } else if (is_class(reg, "Mips", "reg") && repr.$ === "Scalar") {
    const p = Scalar.primitive(repr._0);
    // MIPS only supports register-length arithmetics.
    if (p.$ === "Int" && (p._0 === "I8" || p._0 === "I16")) {
      return cx.type_i32();
    } else if (p.$ === "Float" && (p._0 === "F16" || p._0 === "F32")) {
      return cx.type_i32();
    } else if (p.$ === "Float" && p._0 === "F64") {
      return cx.type_i64();
    } else {
      return layout.llvm_type(cx);
    }
  } else if (is_class(reg, "Mips", "freg", "wreg") && repr.$ === "Scalar" && is_float(repr._0, "F16")) {
    return cx.type_f32();
  } else if (
    is_class(reg, "RiscV", "freg") &&
    repr.$ === "Scalar" &&
    is_float(repr._0, "F16") &&
    !any_target_feature_enabled(cx, instance, [sym.zfhmin, sym.zfh])
  ) {
    return cx.type_f32();
  } else if (
    is_class(reg, "PowerPC", "vreg", "vsreg") &&
    repr.$ === "Scalar" &&
    (is_float(repr._0, "F16") || is_float(repr._0, "F32") || is_float(repr._0, "F64"))
  ) {
    const float = (Scalar.primitive(repr._0) as Extract<Primitive, { $: "Float" }>)._0;
    return cx.type_vector(cx.type_from_float(float), 16 / FloatC.size(float).bytes());
  } else if (is_class(reg, "PowerPC", "vreg", "vsreg") && repr.$ === "Scalar" && is_float(repr._0, "F128")) {
    return cx.type_vector(cx.type_f64(), 2);
  } else {
    return layout.llvm_type(cx);
  }
}
