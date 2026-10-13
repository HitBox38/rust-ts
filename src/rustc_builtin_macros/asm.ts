// Port of compiler/rustc_builtin_macros/src/asm.rs
import { ast, AsmMacro, type tokenstream } from "../rustc_ast/lib.ts";
import type { ErrorGuaranteed, PResult } from "../rustc_errors/lib.ts";
import { DummyResult, type ExpandResult, type ExtCtxt, MacEager, type MacroExpanderResult } from "../rustc_expand/base.ts";
import { StripUnconfigured } from "../rustc_expand/config.ts";
import { BAD_ASM_STYLE } from "../rustc_lint_defs/builtin.gen.ts";
import { type AsmArg, HasAttrs_AsmAttrVec, HasTokens_AsmAttrVec, parse_asm_args } from "../rustc_parse/parser/asm.ts";
import * as parse from "../rustc_parse_format/lib.ts";
import { InnerSpan, Span } from "../rustc_span/lib.ts";
import { Symbol, sym } from "../rustc_span/symbol.ts";
import { unreachable, unwrap } from "../std/panic.ts";
import { Err, Ok, type Result } from "../std/result.ts";
import { Str, str_find_pred } from "../std/str.ts";
import * as diagnostics from "./diagnostics.ts";
import { type ExprToSpannedString, expr_to_spanned_string } from "./util.ts";

type TokenStream = tokenstream.TokenStream;
const { InlineAsmOptions } = ast;
type InlineAsmOptions = ast.InlineAsmOptions;

/**
 * PORT: `rustc_index::bit_set::GrowableBitSet<usize>` (not ported): the set bits, iterated in
 * ascending order like the bit set.
 */
class GrowableBitSet {
  constructor(public bits: Set<number>) {}
  static default(): GrowableBitSet {
    return new GrowableBitSet(new Set());
  }
  insert(elem: number): boolean {
    const had = this.bits.has(elem);
    this.bits.add(elem);
    return !had;
  }
  contains(elem: number): boolean {
    return this.bits.has(elem);
  }
  is_empty(): boolean {
    return this.bits.size === 0;
  }
  count(): number {
    return this.bits.size;
  }
  iter(): number[] {
    return [...this.bits].sort((a, b) => a - b);
  }
}

/// Validated assembly arguments, ready for macro expansion.
interface ValidatedAsmArgs {
  templates: ast.Expr[];
  operands: [ast.InlineAsmOperand, Span][];
  named_args: Map<Symbol, number>;
  reg_args: GrowableBitSet;
  clobber_abis: [Symbol, Span][];
  options: InlineAsmOptions;
  options_spans: Span[];
}

// rustc: compiler/rustc_builtin_macros/src/asm.rs:29 parse_args
function parse_args(ecx: ExtCtxt, sp: Span, tts: TokenStream, asm_macro: AsmMacro): PResult<ValidatedAsmArgs> {
  const args = parse_asm_args(ecx.new_parser_from_tts(tts), sp, asm_macro);
  if (args.$ === "Err") return args;
  return validate_asm_args(ecx, asm_macro, args._0);
}

// rustc: compiler/rustc_builtin_macros/src/asm.rs:39 validate_asm_args
function validate_asm_args(ecx: ExtCtxt, asm_macro: AsmMacro, args: AsmArg[]): PResult<ValidatedAsmArgs> {
  const dcx = ecx.dcx();

  const strip_unconfigured = new StripUnconfigured(ecx.sess, ecx.ecfg.features, false, ecx.current_expansion.lint_node_id);

  const validated: ValidatedAsmArgs = {
    templates: [],
    operands: [],
    named_args: new Map(),
    reg_args: GrowableBitSet.default(),
    clobber_abis: [],
    options: InlineAsmOptions.empty(),
    options_spans: [],
  };

  let allow_templates = true;

  for (const arg of args) {
    for (const attr of arg.attributes._0) {
      const name = attr.name();
      if (!(name === sym.cfg || name === sym.cfg_attr)) {
        ecx.dcx().emit_err(diagnostics.AsmAttributeNotSupported_diagnostic({ span: attr.span }));
      }
    }

    // Skip arguments that are configured out.
    if (strip_unconfigured.configure(arg.attributes, HasTokens_AsmAttrVec, HasAttrs_AsmAttrVec) === undefined) {
      continue;
    }

    const kind = arg.kind;
    switch (kind.$) {
      case "Template": {
        const template = kind._0;
        // The error for the first template is delayed.
        if (!allow_templates) {
          const tk = template.kind;
          if (tk.$ === "Lit" && (tk._0.kind.$ === "Str" || tk._0.kind.$ === "StrRaw")) {
            // ok
          } else if (tk.$ === "MacCall") {
            // ok
          } else {
            const err = dcx.create_err(
              diagnostics.AsmExpectedOther_diagnostic({ span: template.span, is_inline_asm: asm_macro === AsmMacro.Asm }),
            );
            return Err(err);
          }
        }

        validated.templates.push(template);
        break;
      }
      case "Operand": {
        const [name, op] = [kind._0, kind._1];
        allow_templates = false;

        const reg = ast.InlineAsmOperand.reg(op);
        const explicit_reg = reg !== undefined && reg.$ === "Reg";
        const span = arg.span;
        const slot = validated.operands.length;
        validated.operands.push([op, span]);

        // Validate the order of named, positional & explicit register operands and
        // clobber_abi/options. We do this at the end once we have the full span
        // of the argument available.

        if (explicit_reg) {
          if (name !== undefined) {
            dcx.emit_err(diagnostics.AsmExplicitRegisterName_diagnostic({ span }));
          }
          validated.reg_args.insert(slot);
        } else if (name !== undefined) {
          const prev = validated.named_args.get(name);
          if (prev !== undefined) {
            dcx.emit_err(diagnostics.AsmDuplicateArg_diagnostic({ span, name, prev: validated.operands[prev]![1] }));
            continue;
          }
          validated.named_args.set(name, slot);
        } else if (validated.named_args.size !== 0 || !validated.reg_args.is_empty()) {
          const named = [...validated.named_args.values()].map((p) => validated.operands[p]![1]);
          const explicit = validated.reg_args.iter().map((p) => validated.operands[p]![1]);

          dcx.emit_err(diagnostics.AsmPositionalAfter_diagnostic({ span, named, explicit }));
        }
        break;
      }
      case "Options": {
        const new_options = kind._0;
        allow_templates = false;

        for (const asm_option of new_options) {
          const { span, symbol, span_with_comma, options } = asm_option;

          if (!AsmMacro.is_supported_option(asm_macro, options)) {
            // Tool-only output.
            dcx.emit_err(
              diagnostics.AsmUnsupportedOption_diagnostic({ span, symbol, span_with_comma, macro_name: AsmMacro.macro_name(asm_macro) }),
            );
          } else if (InlineAsmOptions.contains(validated.options, options)) {
            // Tool-only output.
            dcx.emit_err(diagnostics.AsmOptAlreadyprovided_diagnostic({ span, symbol, span_with_comma }));
          } else {
            validated.options = InlineAsmOptions.union(validated.options, asm_option.options);
          }
        }

        validated.options_spans.push(arg.span);
        break;
      }
      case "ClobberAbi": {
        const new_abis = kind._0;
        allow_templates = false;

        if (new_abis.length === 0) {
          // This should have errored above during parsing.
          return unreachable();
        } else if (new_abis.length === 1) {
          const [abi, _span] = new_abis[0]!;
          validated.clobber_abis.push([abi, arg.span]);
        } else {
          validated.clobber_abis.push(...new_abis);
        }
        break;
      }
    }
  }

  if (InlineAsmOptions.contains(validated.options, InlineAsmOptions.NOMEM) && InlineAsmOptions.contains(validated.options, InlineAsmOptions.READONLY)) {
    const spans = validated.options_spans.slice();
    dcx.emit_err(diagnostics.AsmMutuallyExclusive_diagnostic({ spans, opt1: "nomem", opt2: "readonly" }));
  }
  if (InlineAsmOptions.contains(validated.options, InlineAsmOptions.PURE) && InlineAsmOptions.contains(validated.options, InlineAsmOptions.NORETURN)) {
    const spans = validated.options_spans.slice();
    dcx.emit_err(diagnostics.AsmMutuallyExclusive_diagnostic({ spans, opt1: "pure", opt2: "noreturn" }));
  }
  if (
    InlineAsmOptions.contains(validated.options, InlineAsmOptions.PURE) &&
    !InlineAsmOptions.intersects(validated.options, InlineAsmOptions.union(InlineAsmOptions.NOMEM, InlineAsmOptions.READONLY))
  ) {
    const spans = validated.options_spans.slice();
    dcx.emit_err(diagnostics.AsmPureCombine_diagnostic({ spans }));
  }

  let have_real_output = false;
  const outputs_sp: Span[] = [];
  const regclass_outputs: Span[] = [];
  const labels_sp: Span[] = [];
  for (const [op, op_sp] of validated.operands) {
    switch (op.$) {
      case "Out":
      case "SplitInOut": {
        const reg = op.reg;
        const expr = op.$ === "Out" ? op.expr : op.out_expr;
        outputs_sp.push(op_sp);
        have_real_output ||= expr !== undefined;
        if (reg.$ === "RegClass") {
          regclass_outputs.push(op_sp);
        }
        break;
      }
      case "InOut": {
        const reg = op.reg;
        outputs_sp.push(op_sp);
        have_real_output = true;
        if (reg.$ === "RegClass") {
          regclass_outputs.push(op_sp);
        }
        break;
      }
      case "Label": {
        labels_sp.push(op_sp);
        break;
      }
      default:
        break;
    }
  }
  if (InlineAsmOptions.contains(validated.options, InlineAsmOptions.PURE) && !have_real_output) {
    dcx.emit_err(diagnostics.AsmPureNoOutput_diagnostic({ spans: validated.options_spans.slice() }));
  }
  if (InlineAsmOptions.contains(validated.options, InlineAsmOptions.NORETURN) && outputs_sp.length !== 0 && labels_sp.length === 0) {
    const err = dcx.create_err(diagnostics.AsmNoReturn_diagnostic({ outputs_sp }));
    // Bail out now since this is likely to confuse MIR
    return Err(err);
  }
  if (InlineAsmOptions.contains(validated.options, InlineAsmOptions.MAY_UNWIND) && labels_sp.length !== 0) {
    dcx.emit_err(diagnostics.AsmMayUnwind_diagnostic({ labels_sp }));
  }

  if (validated.clobber_abis.length !== 0) {
    switch (asm_macro) {
      case "GlobalAsm":
      case "NakedAsm": {
        const err = dcx.create_err(
          diagnostics.AsmUnsupportedClobberAbi_diagnostic({
            spans: validated.clobber_abis.map(([_, span]) => span),
            macro_name: AsmMacro.macro_name(asm_macro),
          }),
        );

        // Bail out now since this is likely to confuse later stages
        return Err(err);
      }
      case "Asm": {
        if (regclass_outputs.length !== 0) {
          dcx.emit_err(
            diagnostics.AsmClobberNoReg_diagnostic({
              spans: regclass_outputs,
              clobbers: validated.clobber_abis.map(([_, span]) => span),
            }),
          );
        }
        break;
      }
    }
  }

  return Ok(validated);
}

// rustc: compiler/rustc_builtin_macros/src/asm.rs:265 expand_preparsed_asm
function expand_preparsed_asm(
  ecx: ExtCtxt,
  asm_macro: AsmMacro,
  args: ValidatedAsmArgs,
): ExpandResult<Result<ast.InlineAsm, ErrorGuaranteed>, undefined> {
  const template: ast.InlineAsmTemplatePiece[] = [];
  // Register operands are implicitly used since they are not allowed to be
  // referenced in the template string.
  const used: boolean[] = new Array<boolean>(args.operands.length).fill(false);
  for (const pos of args.reg_args.iter()) {
    used[pos] = true;
  }
  const named_pos: Map<number, Symbol> = new Map([...args.named_args].map(([sym, idx]) => [idx, sym]));
  const line_spans: Span[] = [];
  let curarg = 0;

  const template_strs: [Symbol, Symbol | undefined, Span][] = [];

  for (const [i, template_expr] of args.templates.entries()) {
    if (i !== 0) {
      template.push({ $: "String", _0: "\n" });
    }

    const msg = "asm template must be a string literal";
    const template_sp = template_expr.span;
    const template_is_mac_call = template_expr.kind.$ === "MacCall";

    // Gets the span inside `template_sp` corresponding to the given range
    const span_in_template = (range: { start: number; end: number }): Span => {
      if (template_is_mac_call) {
        // When the template is a macro call we can't reliably get inner spans
        // so just use the entire template span (see ICEs #129503, #131292)
        return template_sp;
      } else {
        return Span.from_inner(template_sp, InnerSpan.new(range.start, range.end));
      }
    };

    let spanned: ExprToSpannedString;
    {
      const r = expr_to_spanned_string(ecx, template_expr, msg);
      if (r.$ !== "Ready") {
        return { $: "Retry", _0: undefined };
      }
      const mac = r._0;
      if (mac.$ === "Ok") {
        spanned = mac._0;
      } else {
        const err = mac._0;
        return { $: "Ready", _0: Err(err.$ === "Ok" ? err._0[0].emit_err() : err._0) };
      }
    }
    const { symbol: template_sym, style: template_style, span: template_span } = spanned;

    let str_style: number | undefined;
    switch (template_style.$) {
      case "Cooked":
        str_style = undefined;
        break;
      case "Raw":
        str_style = template_style._0;
        break;
    }

    const snippet_r = ecx.source_map().span_to_snippet(template_sp);
    const template_snippet: Str | undefined = snippet_r.$ === "Ok" ? snippet_r._0 : undefined;
    template_strs.push([template_sym, template_snippet === undefined ? undefined : Symbol.intern(template_snippet.toString()), template_sp]);
    const template_str = Symbol.as_str(template_sym);

    // PORT: `InlineAsmArch` (rustc_target::asm) is not ported; `Session::asm_arch` is a deferred field
    // (reading it is `unported`) holding the fieldless variant's name.
    const asm_arch = ecx.sess.asm_arch as string | undefined;
    if (asm_arch === "X86" || asm_arch === "X86_64") {
      const find_span = (needle: string): Span => {
        if (template_snippet !== undefined) {
          const snippet = template_snippet;
          const pos = snippet.find(needle);
          if (pos !== undefined) {
            const rest = snippet.slice(pos);
            const end =
              pos +
              (str_find_pred(rest, (c) => c === 0x0a /* '\n' */ || c === 0x3b /* ';' */ || c === 0x5c /* '\\' */ || c === 0x22 /* '"' */) ??
                rest.len() - 1);
            const inner = InnerSpan.new(pos, end);
            return Span.from_inner(template_sp, inner);
          }
        }
        return template_sp;
      };

      if (template_str.includes(".intel_syntax")) {
        ecx
          .psess()
          .buffer_lint(BAD_ASM_STYLE, find_span(".intel_syntax"), ecx.current_expansion.lint_node_id, diagnostics.AvoidIntelSyntax_diagnostic({}));
      }
      if (template_str.includes(".att_syntax")) {
        ecx
          .psess()
          .buffer_lint(BAD_ASM_STYLE, find_span(".att_syntax"), ecx.current_expansion.lint_node_id, diagnostics.AvoidAttSyntax_diagnostic({}));
      }
    }

    // Don't treat raw asm as a format string.
    if (InlineAsmOptions.contains(args.options, InlineAsmOptions.RAW)) {
      template.push({ $: "String", _0: template_str });
      const template_num_lines = 1 + count_newlines(template_str);
      for (let k = 0; k < template_num_lines; k++) line_spans.push(template_sp);
      continue;
    }

    const parser = parse.Parser.new(Str.from(template_str), str_style, template_snippet, false, parse.ParseMode.InlineAsm);
    parser.curarg = curarg;

    const unverified_pieces: parse.Piece[] = [];
    for (let piece = parser.next(); piece !== undefined; piece = parser.next()) {
      if (parser.errors.length !== 0) {
        break;
      } else {
        unverified_pieces.push(piece);
      }
    }

    if (parser.errors.length !== 0) {
      const err = unwrap(parser.errors.shift());

      const err_sp = span_in_template(err.span);

      const msg = `invalid asm template string: ${err.description}`;
      const e = ecx.dcx().struct_span_err(err_sp, msg);
      e.span_label(err_sp, err.label + " in asm template string");
      if (err.note !== undefined) {
        e.note(err.note);
      }
      if (err.secondary_label !== undefined) {
        const [label, span] = err.secondary_label;
        e.span_label(span_in_template(span), label);
      }
      const guar = e.emit_err();
      return { $: "Ready", _0: Err(guar) };
    }

    curarg = parser.curarg;

    // PORT: the lazy `arg_spans` iterator over `parser.arg_places` is an index.
    let arg_spans_pos = 0;
    const arg_spans_next = (): Span | undefined => {
      const span = parser.arg_places[arg_spans_pos];
      if (span === undefined) return undefined;
      arg_spans_pos++;
      return Span.from_inner(template_span, InnerSpan.new(span.start, span.end));
    };
    for (const piece of unverified_pieces) {
      switch (piece.$) {
        case "Lit": {
          template.push({ $: "String", _0: piece._0 });
          break;
        }
        case "NextArgument": {
          const arg = piece._0;
          const span = arg_spans_next() ?? template_sp;

          let operand_idx: number | undefined;
          const position = arg.position;
          switch (position.$) {
            case "ArgumentIs":
            case "ArgumentImplicitlyIs": {
              const idx = position._0;
              if (idx >= args.operands.length || named_pos.has(idx) || args.reg_args.contains(idx)) {
                const msg = `invalid reference to argument at index ${idx}`;
                const err = ecx.dcx().struct_span_err(span, msg);
                err.span_label(span, "from here");

                const positional_args = args.operands.length - args.named_args.size - args.reg_args.count();
                const positional = positional_args !== args.operands.length ? "positional " : "";
                let msg2: string;
                switch (positional_args) {
                  case 0:
                    msg2 = `no ${positional}arguments were given`;
                    break;
                  case 1:
                    msg2 = `there is 1 ${positional}argument`;
                    break;
                  default:
                    msg2 = `there are ${positional_args} ${positional}arguments`;
                }
                err.note(msg2);

                if (named_pos.has(idx)) {
                  err.span_label(args.operands[idx]![1], "named argument");
                  err.span_note(args.operands[idx]![1], "named arguments cannot be referenced by position");
                } else if (args.reg_args.contains(idx)) {
                  err.span_label(args.operands[idx]![1], "explicit register argument");
                  err.span_note(args.operands[idx]![1], "explicit register arguments cannot be used in the asm template");
                  err.span_help(args.operands[idx]![1], "use the register name directly in the assembly code");
                }
                err.emit();
                operand_idx = undefined;
              } else {
                operand_idx = idx;
              }
              break;
            }
            case "ArgumentNamed": {
              const name = position._0;
              const idx = args.named_args.get(Symbol.intern(name));
              if (idx !== undefined) {
                operand_idx = idx;
              } else {
                const span = arg.position_span;
                ecx.dcx().emit_err(diagnostics.AsmNoMatchedArgumentName_diagnostic({ name, span: span_in_template(span) }));
                operand_idx = undefined;
              }
              break;
            }
          }

          const chars = arg.format.ty[globalThis.Symbol.iterator]();
          const first = chars.next();
          let modifier: number | undefined = first.done === true ? undefined : first.value.codePointAt(0);
          if (chars.next().done !== true) {
            const span = arg.format.ty_span === undefined ? template_sp : span_in_template(arg.format.ty_span);
            ecx.dcx().emit_err(diagnostics.AsmModifierInvalid_diagnostic({ span }));
            modifier = undefined;
          }

          if (operand_idx !== undefined) {
            used[operand_idx] = true;
            template.push({ $: "Placeholder", operand_idx, modifier, span });
          }
          break;
        }
      }
    }

    if (parser.line_spans.length === 0) {
      const template_num_lines = 1 + count_newlines(template_str);
      for (let k = 0; k < template_num_lines; k++) line_spans.push(template_sp);
    } else {
      line_spans.push(...parser.line_spans.map((span) => Span.from_inner(template_span, InnerSpan.new(span.start, span.end))));
    }
  }

  const unused_operands: [Span, string][] = [];
  let help_str = "";
  for (const [idx, used_] of used.entries()) {
    if (!used_) {
      let msg: string;
      const sym = named_pos.get(idx);
      if (sym !== undefined) {
        help_str += ` {${Symbol.as_str(sym)}}`;
        msg = "named argument never used";
      } else {
        help_str += ` {${idx}}`;
        msg = "argument never used";
      }
      unused_operands.push([args.operands[idx]![1], msg]);
    }
  }
  if (unused_operands.length === 0) {
    // nothing
  } else if (unused_operands.length === 1) {
    const [sp, msg] = unused_operands[0]!;
    ecx
      .dcx()
      .struct_span_err(sp, msg)
      .with_span_label(sp, msg)
      .with_help(`if this argument is intentionally unused, consider using it in an asm comment: \`"/*${help_str} */"\``)
      .emit();
  } else {
    const err = ecx.dcx().struct_span_err(
      unused_operands.map(([sp, _]) => sp),
      "multiple unused asm arguments",
    );
    for (const [sp, msg] of unused_operands) {
      err.span_label(sp, msg);
    }
    err.help(`if these arguments are intentionally unused, consider using them in an asm comment: \`"/*${help_str} */"\``);
    err.emit();
  }

  return {
    $: "Ready",
    _0: Ok({
      asm_macro,
      template,
      template_strs,
      operands: args.operands,
      clobber_abis: args.clobber_abis,
      options: args.options,
      line_spans,
    }),
  };
}

// rustc: compiler/rustc_builtin_macros/src/asm.rs:580 expand_asm
export function expand_asm(ecx: ExtCtxt, sp: Span, tts: TokenStream): MacroExpanderResult {
  const r = parse_args(ecx, sp, tts, AsmMacro.Asm);
  if (r.$ === "Ok") {
    const args = r._0;
    const m = expand_preparsed_asm(ecx, AsmMacro.Asm, args);
    if (m.$ !== "Ready") {
      return { $: "Retry", _0: undefined };
    }
    const mac = m._0;
    const expr = mac.$ === "Ok" ? ecx.expr(sp, { $: "InlineAsm", _0: mac._0 }) : DummyResult.raw_expr(sp, mac._0);
    return { $: "Ready", _0: MacEager.expr(expr) };
  } else {
    const err = r._0;
    const guar = err.emit_err();
    return { $: "Ready", _0: DummyResult.any(sp, guar) };
  }
}

// rustc: compiler/rustc_builtin_macros/src/asm.rs:603 expand_naked_asm
export function expand_naked_asm(ecx: ExtCtxt, sp: Span, tts: TokenStream): MacroExpanderResult {
  const r = parse_args(ecx, sp, tts, AsmMacro.NakedAsm);
  if (r.$ === "Ok") {
    const args = r._0;
    const m = expand_preparsed_asm(ecx, AsmMacro.NakedAsm, args);
    if (m.$ !== "Ready") {
      return { $: "Retry", _0: undefined };
    }
    const mac = m._0;
    const expr = mac.$ === "Ok" ? ecx.expr(sp, { $: "InlineAsm", _0: mac._0 }) : DummyResult.raw_expr(sp, mac._0);
    return { $: "Ready", _0: MacEager.expr(expr) };
  } else {
    const err = r._0;
    const guar = err.emit_err();
    return { $: "Ready", _0: DummyResult.any(sp, guar) };
  }
}

// rustc: compiler/rustc_builtin_macros/src/asm.rs:627 expand_global_asm
export function expand_global_asm(ecx: ExtCtxt, sp: Span, tts: TokenStream): MacroExpanderResult {
  const r = parse_args(ecx, sp, tts, AsmMacro.GlobalAsm);
  if (r.$ === "Ok") {
    const args = r._0;
    const m = expand_preparsed_asm(ecx, AsmMacro.GlobalAsm, args);
    if (m.$ !== "Ready") {
      return { $: "Retry", _0: undefined };
    }
    const mac = m._0;
    if (mac.$ === "Ok") {
      return { $: "Ready", _0: MacEager.items([ecx.item(sp, [], { $: "GlobalAsm", _0: mac._0 })]) };
    } else {
      return { $: "Ready", _0: DummyResult.any(sp, mac._0) };
    }
  } else {
    const err = r._0;
    const guar = err.emit_err();
    return { $: "Ready", _0: DummyResult.any(sp, guar) };
  }
}

/** `str::matches('\n').count()` */
function count_newlines(s: string): number {
  let n = 0;
  for (let i = s.indexOf("\n"); i >= 0; i = s.indexOf("\n", i + 1)) n++;
  return n;
}
