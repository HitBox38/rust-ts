// Port of compiler/rustc_ast_lowering/src/asm.rs
//
// The `impl LoweringContext` methods of this file are declared in ./decls.ts (the contract) and assigned
// onto `LoweringContext.prototype` here, in upstream order, each with its `// rustc:` marker.
// Init order: top-level code here may touch only `./decls.ts` and other crates; every other
// rustc_ast_lowering export (lib.ts, ...) is read inside function bodies only.
//
// PORT: the target-arch module `rustc_target::asm` is `target_asm` here (the parameter `asm: &InlineAsm` keeps
// its name, as session.ts does).
import {
  clone_InlineAsmTemplatePiece,
  clone_Path,
  clone_QSelf,
  Expr,
  InlineAsmOptions,
  type InlineAsm,
  type InlineAsmRegOrRegClass,
} from "../rustc_ast/lib.ts";
import { msg } from "../rustc_errors/lib.ts";
import {
  debug_InlineAsmOperand,
  InlineAsm as hir_InlineAsm,
  InlineAsmOperand as hir_InlineAsmOperand,
  InlineAsmRegOrRegClass as hir_InlineAsmRegOrRegClass,
} from "../rustc_hir/lib.ts";
import { feature_err } from "../rustc_session/diagnostics.ts";
import { SyntaxContext } from "../rustc_span/hygiene.ts";
import { Span } from "../rustc_span/lib.ts";
import { sym, Symbol } from "../rustc_span/symbol.ts";
import * as target_asm from "../rustc_target/asm/mod.ts";
import { PLAIN } from "../std/fmt.ts";
import { assert, panic, unported, unreachable, unwrap } from "../std/panic.ts";
import { LoweringContext } from "./decls.ts";
import * as diagnostics from "./diagnostics.ts";
import { DiagSymbolList_from } from "../rustc_errors/diagnostic_impls.ts";
import type { SpanSnippetError } from "../rustc_span/lib.ts";
import type { Str } from "../std/str.ts";
import type { Result } from "../std/result.ts";
import type * as hir from "./hir_shim.ts";

/**
 * `Result<String, SpanSnippetError> != Result<String, SpanSnippetError>` (derived `PartialEq`). The `Err` arms
 * compare structurally in Rust; that comparison is not written yet, so two errors stop as UNPORTED. Not a port of
 * an upstream fn.
 */
function snippet_ne(a: Result<Str, SpanSnippetError>, b: Result<Str, SpanSnippetError>): boolean {
  if (a.$ === "Ok" && b.$ === "Ok") return a._0.toString() !== b._0.toString();
  if (a.$ !== b.$) return true;
  return unported("PartialEq for rustc_span::SpanSnippetError");
}

// rustc: compiler/rustc_ast_lowering/src/asm.rs:25 lower_inline_asm
LoweringContext.prototype.lower_inline_asm = function (this: LoweringContext, sp: Span, asm: InlineAsm): hir.InlineAsm {
  // Rustdoc needs to support asm! from foreign architectures: don't try
  // lowering the register constraints in this case.
  const asm_arch = this.tcx.sess.opts.actually_rustdoc ? undefined : this.tcx.sess.asm_arch;
  if (asm_arch === undefined && !this.tcx.sess.opts.actually_rustdoc) {
    this.dcx().emit_err(diagnostics.InlineAsmUnsupportedTarget_diagnostic({ span: sp }));
  }
  if (asm_arch !== undefined) {
    // Inline assembly is currently only stable for these architectures.
    // (See also compiletest's `has_asm_support`.)
    const is_stable =
      asm_arch === "X86" ||
      asm_arch === "X86_64" ||
      asm_arch === "Arm" ||
      asm_arch === "AArch64" ||
      asm_arch === "Arm64EC" ||
      asm_arch === "RiscV32" ||
      asm_arch === "RiscV64" ||
      asm_arch === "LoongArch32" ||
      asm_arch === "LoongArch64" ||
      asm_arch === "S390x" ||
      asm_arch === "PowerPC" ||
      asm_arch === "PowerPC64";
    // PORT: the `&&` chain is nested so that `outer_expn_data` is read only when upstream reads it.
    if (!is_stable && !this.tcx.features().asm_experimental_arch()) {
      const allow_internal_unstable = SyntaxContext.outer_expn_data(Span.ctxt(sp)).allow_internal_unstable;
      if (!(allow_internal_unstable !== undefined && allow_internal_unstable.includes(sym.asm_experimental_arch))) {
        feature_err(
          this.tcx.sess,
          sym.asm_experimental_arch,
          sp,
          msg("inline assembly is not stable yet on this architecture"),
        ).emit();
      }
    }
  }
  const allow_experimental_reg = this.tcx.features().asm_experimental_reg();
  if (
    InlineAsmOptions.contains(asm.options, InlineAsmOptions.ATT_SYNTAX) &&
    !(asm_arch === "X86" || asm_arch === "X86_64") &&
    !this.tcx.sess.opts.actually_rustdoc
  ) {
    this.dcx().emit_err(diagnostics.AttSyntaxOnlyX86_diagnostic({ span: sp }));
  }
  if (InlineAsmOptions.contains(asm.options, InlineAsmOptions.MAY_UNWIND) && !this.tcx.features().asm_unwind()) {
    feature_err(this.tcx.sess, sym.asm_unwind, sp, msg("the `may_unwind` option is unstable")).emit();
  }

  // PORT: `FxIndexMap<InlineAsmClobberAbi, (Symbol, Span)>`: a JS `Map` (insertion-ordered; the key is a string).
  const clobber_abis = new Map<target_asm.InlineAsmClobberAbi, [Symbol, Span]>();
  if (asm_arch !== undefined) {
    for (const [abi_name, abi_span] of asm.clobber_abis) {
      const r = target_asm.InlineAsmClobberAbi.parse(
        asm_arch,
        this.tcx.sess.target,
        this.tcx.sess.internal_target_features,
        abi_name,
      );
      if (r.$ === "Ok") {
        const abi = r._0;
        // If the abi was already in the list, emit an error
        const prev = clobber_abis.get(abi);
        if (prev !== undefined) {
          const [prev_name, prev_sp] = prev;
          // Multiple different abi names may actually be the same ABI
          // If the specified ABIs are not the same name, alert the user that they resolve to the same ABI
          const source_map = this.tcx.sess.source_map();
          const equivalent = snippet_ne(source_map.span_to_snippet(prev_sp), source_map.span_to_snippet(abi_span));

          this.dcx().emit_err(
            diagnostics.AbiSpecifiedMultipleTimes_diagnostic({ abi_span, prev_name, prev_span: prev_sp, equivalent }),
          );
        } else {
          clobber_abis.set(abi, [abi_name, abi_span]);
        }
      } else if (r._0.length === 0) {
        this.dcx().emit_err(diagnostics.ClobberAbiNotSupported_diagnostic({ abi_span }));
      } else {
        const supported_abis = r._0;
        this.dcx().emit_err(diagnostics.InvalidAbiClobberAbi_diagnostic({ abi_span, supported_abis: DiagSymbolList_from([...supported_abis]) }));
      }
    }
  }

  // Lower operands to HIR. We use dummy register classes if an error
  // occurs during lowering because we still need to be able to produce a
  // valid HIR.
  const sess = this.tcx.sess;
  const operands: [hir.InlineAsmOperand, Span][] = asm.operands.map(([op, op_sp]) => {
    const lower_reg = (reg_: InlineAsmRegOrRegClass): hir.InlineAsmRegOrRegClass => {
      switch (reg_.$) {
        case "Reg": {
          const reg = reg_._0;
          let lowered: target_asm.InlineAsmReg;
          if (asm_arch !== undefined) {
            const parsed = target_asm.InlineAsmReg.parse(asm_arch, reg);
            if (parsed.$ === "Ok") {
              lowered = parsed._0;
            } else {
              const error = parsed._0;
              this.dcx().emit_err(diagnostics.InvalidRegister_diagnostic({ op_span: op_sp, reg, error }));
              lowered = target_asm.InlineAsmReg.Err;
            }
          } else {
            lowered = target_asm.InlineAsmReg.Err;
          }
          return { $: "Reg", reg: lowered, source_name: reg };
        }
        case "RegClass": {
          const reg_class = reg_._0;
          let lowered: target_asm.InlineAsmRegClass;
          if (asm_arch !== undefined) {
            const parsed = target_asm.InlineAsmRegClass.parse(asm_arch, reg_class);
            if (parsed.$ === "Ok") {
              lowered = parsed._0;
            } else {
              const supported_register_classes = parsed._0;
              this.dcx().emit_err(
                diagnostics.InvalidRegisterClass_diagnostic({
                  op_span: op_sp,
                  reg_class,
                  supported_register_classes: DiagSymbolList_from([...supported_register_classes]),
                }),
              );
              lowered = target_asm.InlineAsmRegClass.Err;
            }
          } else {
            lowered = target_asm.InlineAsmRegClass.Err;
          }
          return { $: "RegClass", _0: lowered };
        }
      }
    };

    let lowered_op: hir.InlineAsmOperand;
    switch (op.$) {
      case "In":
        lowered_op = { $: "In", reg: lower_reg(op.reg), expr: this.lower_expr(op.expr) };
        break;
      case "Out":
        lowered_op = {
          $: "Out",
          reg: lower_reg(op.reg),
          late: op.late,
          expr: op.expr !== undefined ? this.lower_expr(op.expr) : undefined,
        };
        break;
      case "InOut":
        lowered_op = { $: "InOut", reg: lower_reg(op.reg), late: op.late, expr: this.lower_expr(op.expr) };
        break;
      case "SplitInOut":
        lowered_op = {
          $: "SplitInOut",
          reg: lower_reg(op.reg),
          late: op.late,
          in_expr: this.lower_expr(op.in_expr),
          out_expr: op.out_expr !== undefined ? this.lower_expr(op.out_expr) : undefined,
        };
        break;
      case "Const":
        lowered_op = { $: "Const", anon_const: this.lower_const_block(op.anon_const) };
        break;
      case "Sym": {
        const sym_ = op.sym;
        const partial_res = this.get_partial_res(sym_.id);
        const res = partial_res !== undefined ? partial_res.full_res() : undefined;
        const static_def_id = res !== undefined && res.$ === "Def" && res._0.$ === "Static" ? res._1 : undefined;

        if (static_def_id !== undefined) {
          const def_id = static_def_id;
          // PORT: `ParamMode::Optional`, `AllowReturnTypeNotation::No`,
          // `ImplTraitContext::Disallowed(ImplTraitPosition::Path)` in the PORTING §5 enum encoding (lib.rs types
          // are `unknown` aliases until codegen set rustc_ast_lowering generates lib.gen.ts).
          const path = this.lower_qpath(
            sym_.id,
            sym_.qself,
            sym_.path,
            "Optional",
            "No",
            { $: "Disallowed", _0: "Path" },
            undefined,
          );
          lowered_op = { $: "SymStatic", path, def_id };
        } else {
          // Replace the InlineAsmSym AST node with an
          // Expr using the name node id.
          const expr = new Expr(
            sym_.id,
            { $: "Path", _0: sym_.qself !== undefined ? clone_QSelf(sym_.qself) : undefined, _1: clone_Path(sym_.path) },
            op_sp,
            [],
            undefined,
          );

          lowered_op = { $: "SymFn", expr: this.lower_expr(expr) };
        }
        break;
      }
      case "Label":
        lowered_op = { $: "Label", block: this.lower_block(op.block, false) };
        break;
    }
    return [lowered_op, this.lower_span(op_sp)];
  });

  // Validate template modifiers against the register classes for the operands
  for (const p of asm.template) {
    if (p.$ === "Placeholder" && p.modifier !== undefined) {
      const operand_idx = p.operand_idx;
      const modifier = p.modifier;
      const placeholder_span = p.span;
      const op_sp = asm.operands[operand_idx]![1];
      const op = operands[operand_idx]![0];
      switch (op.$) {
        case "In":
        case "Out":
        case "InOut":
        case "SplitInOut": {
          const reg = op.reg;
          const class_ = hir_InlineAsmRegOrRegClass.reg_class(reg);
          if (class_ === target_asm.InlineAsmRegClass.Err) {
            continue;
          }
          const valid_modifiers = target_asm.InlineAsmRegClass.valid_modifiers(class_, unwrap(asm_arch));
          if (!valid_modifiers.includes(modifier)) {
            const sub: diagnostics.InvalidAsmTemplateModifierRegClassSub =
              valid_modifiers.length === 0
                ? { $: "DoesNotSupportModifier", class_name: target_asm.InlineAsmRegClass.name(class_) }
                : {
                    $: "SupportModifier",
                    class_name: target_asm.InlineAsmRegClass.name(class_),
                    modifiers: DiagSymbolList_from([...valid_modifiers]),
                  };
            this.dcx().emit_err(
              diagnostics.InvalidAsmTemplateModifierRegClass_diagnostic({
                placeholder_span,
                op_span: op_sp,
                modifier: String.fromCodePoint(modifier),
                sub,
              }),
            );
          }
          break;
        }
        case "Const":
          this.dcx().emit_err(diagnostics.InvalidAsmTemplateModifierConst_diagnostic({ placeholder_span, op_span: op_sp }));
          break;
        case "SymFn":
        case "SymStatic":
          this.dcx().emit_err(diagnostics.InvalidAsmTemplateModifierSym_diagnostic({ placeholder_span, op_span: op_sp }));
          break;
        case "Label":
          this.dcx().emit_err(diagnostics.InvalidAsmTemplateModifierLabel_diagnostic({ placeholder_span, op_span: op_sp }));
          break;
      }
    }
  }

  // PORT: `FxHashMap<asm::InlineAsmReg, usize>`: a JS `Map` (registers are interned singletons; never iterated).
  const used_input_regs = new Map<target_asm.InlineAsmReg, number>();
  const used_output_regs = new Map<target_asm.InlineAsmReg, number>();

  for (let idx = 0; idx < operands.length; idx++) {
    const [op, op_sp] = operands[idx]!;
    const reg = hir_InlineAsmOperand.reg(op);
    if (reg !== undefined) {
      const reg_class = hir_InlineAsmRegOrRegClass.reg_class(reg);
      if (reg_class === target_asm.InlineAsmRegClass.Err) {
        continue;
      }

      // Some register classes can only be used as clobbers. This
      // means that we disallow passing a value in/out of the asm and
      // require that the operand name an explicit register, not a
      // register class.
      if (
        target_asm.InlineAsmRegClass.is_clobber_only(reg_class, unwrap(asm_arch), allow_experimental_reg) &&
        !hir_InlineAsmOperand.is_clobber(op)
      ) {
        if (allow_experimental_reg || target_asm.InlineAsmRegClass.is_clobber_only(reg_class, unwrap(asm_arch), true)) {
          // always clobber-only
          this.dcx().emit_err(
            diagnostics.RegisterClassOnlyClobber_diagnostic({
              op_span: op_sp,
              reg_class_name: target_asm.InlineAsmRegClass.name(reg_class),
            }),
          );
        } else {
          // clobber-only in stable
          this.tcx.sess
            .create_feature_err(
              diagnostics.RegisterClassOnlyClobberStable_diagnostic({
                op_span: op_sp,
                reg_class_name: target_asm.InlineAsmRegClass.name(reg_class),
              }),
              sym.asm_experimental_reg,
            )
            .emit();
        }
        continue;
      }

      // Check for conflicts between explicit register operands.
      if (reg.$ === "Reg") {
        const reg_ = reg.reg;
        let input: boolean;
        let output: boolean;
        switch (op.$) {
          case "In":
            [input, output] = [true, false];
            break;

          // Late output do not conflict with inputs, but normal outputs do
          case "Out":
            [input, output] = [!op.late, true];
            break;

          case "InOut":
          case "SplitInOut":
            [input, output] = [true, true];
            break;

          case "Const":
          case "SymFn":
          case "SymStatic":
          case "Label":
            return unreachable(
              `internal error: entered unreachable code: ${debug_InlineAsmOperand(op, PLAIN)} is not a register operand`,
            );
        }

        // Flag to output the error only once per operand
        let skip = false;

        const check = (used_regs: Map<target_asm.InlineAsmReg, number>, input: boolean, r: target_asm.InlineAsmReg): void => {
          const o = used_regs.get(r);
          if (o !== undefined) {
            if (skip) {
              return;
            }
            skip = true;

            const idx2 = o;
            const [op2, op_sp2] = operands[idx2]!;

            let in_out: Span | undefined;
            if ((op.$ === "In" && op2.$ === "Out") || (op.$ === "Out" && op2.$ === "In")) {
              const late = op.$ === "Out" ? op.late : op2.$ === "Out" ? op2.late : unreachable();
              assert(!late, "assertion failed: !*late");
              const out_op_sp = input ? op_sp2 : op_sp;
              in_out = out_op_sp;
            } else {
              in_out = undefined;
            }
            const reg1 = hir_InlineAsmOperand.reg(op);
            const reg1_name =
              (reg1 !== undefined ? hir_InlineAsmRegOrRegClass.source_name(reg1) : undefined) ??
              panic("{op:?} has no source register name");

            const reg2 = hir_InlineAsmOperand.reg(op2);
            const reg2_name =
              (reg2 !== undefined ? hir_InlineAsmRegOrRegClass.source_name(reg2) : undefined) ??
              panic("{op2:?} has no source register name");

            this.dcx().emit_err(
              diagnostics.RegisterConflict_diagnostic({
                op_span1: op_sp,
                op_span2: op_sp2,
                reg1_name: Symbol.as_str(reg1_name),
                reg2_name: Symbol.as_str(reg2_name),
                in_out,
              }),
            );
          } else {
            if (r === reg_) {
              used_regs.set(r, idx);
            }
          }
        };
        const overlapping_with: target_asm.InlineAsmReg[] = [];
        target_asm.InlineAsmReg.overlapping_regs(reg_, (r) => {
          overlapping_with.push(r);
        });
        for (const r of overlapping_with) {
          if (input) {
            check(used_input_regs, true, r);
          }
          if (output) {
            check(used_output_regs, false, r);
          }
        }
      }
    }
  }

  // If a clobber_abi is specified, add the necessary clobbers to the
  // operands list.
  // PORT: `FxHashSet<asm::InlineAsmReg>`: a JS `Set` (interned singletons; never iterated).
  const clobbered = new Set<target_asm.InlineAsmReg>();
  for (const [abi, [, abi_span]] of clobber_abis) {
    for (const clobber of target_asm.InlineAsmClobberAbi.clobbered_regs(abi)) {
      // Don't emit a clobber for a register already clobbered
      if (clobbered.has(clobber)) {
        continue;
      }

      const overlapping_with: target_asm.InlineAsmReg[] = [];
      target_asm.InlineAsmReg.overlapping_regs(clobber, (reg) => {
        overlapping_with.push(reg);
      });
      const output_used = overlapping_with.some((reg) => used_output_regs.has(reg));

      if (!output_used) {
        operands.push([
          {
            $: "Out",
            reg: { $: "Reg", reg: clobber, source_name: undefined },
            late: true,
            expr: undefined,
          },
          this.lower_span(abi_span),
        ]);
        clobbered.add(clobber);
      }
    }
  }

  // Feature gate checking for `asm_goto_with_outputs`.
  const label_op = operands.find(([op]) => op.$ === "Label");
  if (label_op !== undefined) {
    const op_sp = label_op[1];
    // Check if an output operand is used.
    const output_operand_used = operands.some(
      ([op]) =>
        (op.$ === "Out" && op.expr !== undefined) ||
        op.$ === "InOut" ||
        (op.$ === "SplitInOut" && op.out_expr !== undefined),
    );
    if (output_operand_used && !this.tcx.features().asm_goto_with_outputs()) {
      feature_err(
        sess,
        sym.asm_goto_with_outputs,
        op_sp,
        msg("using both label and output operands for inline assembly is unstable"),
      ).emit();
    }
  }

  const operands_ = this.arena.alloc_from_iter(operands);
  const template = this.arena.alloc_from_iter(asm.template.map(clone_InlineAsmTemplatePiece));
  const template_strs = this.arena.alloc_from_iter(
    asm.template_strs.map(([sym_, snippet, span]): [Symbol, Symbol | undefined, Span] => [sym_, snippet, this.lower_span(span)]),
  );
  const line_spans = this.arena.alloc_from_iter(asm.line_spans.map((span) => this.lower_span(span)));
  const hir_asm = new hir_InlineAsm(asm.asm_macro, template, template_strs, operands_, asm.options, line_spans);
  return this.arena.alloc(hir_asm);
};
