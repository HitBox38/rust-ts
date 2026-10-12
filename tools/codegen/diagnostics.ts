// `#[derive(Diagnostic)]` / `#[derive(Subdiagnostic)]` generator: a port of the semantics of
// compiler/rustc_macros/src/diagnostics/{diagnostic,diagnostic_builder,subdiagnostic,utils,message,error}.rs
// at the pin (PORTING.md §5 "Macros inside rustc"). `LintDiagnostic` does not exist at the pin.
//
// The proc macro turns attributes into a token stream; this port turns the same attributes (the
// `typedefs` probe's attribute token trees) into a small statement IR that mirrors the macro's
// `quote!` output statement for statement, in the same order. The IR has two renderers:
//   - `renderTs`: the TS `into_diag` / `add_to_diag` bodies emitted into `.gen.ts` files (types.ts);
//   - `renderRust`: the Rust text the macro would produce, used by tools/codegen/diag-expand.ts to
//     check the IR against the real expansion (`rustc -Zunpretty=expanded` with upstream rustc_macros).
// Type-dependent parts of the TS output (which `IntoDiagArg` impl, Display for `format!`, the
// `Subdiagnostic` impl of a field type, error-code constants) come from a `DiagTsCtx` that types.ts
// implements with its path resolution.
//
// The macro's error paths (`span_err(..).emit()`, `throw_span_err!`, syn parse errors) become
// generator errors: upstream compiles, so none of them can fire on pinned sources; they are kept so
// that a wrong reading of an attribute fails loudly instead of producing different code.
import { FluentResource } from "../../src/vendor/fluent_bundle/resource.ts";
import type { Expression, InlineExpression, Message as FltMessage, PatternElement } from "../../src/vendor/fluent_syntax/ast/mod.ts";
import type { PAttr, PField, PFields, PItem, PType } from "./types.ts";

// ---- probe tokens ---------------------------------------------------------------------------------

/** One token tree of an attribute's `(...)` arguments (tools/probes/typedefs `tokens_json`). */
export interface Tok {
  t: "ident" | "punct" | "lit" | "group";
  v?: string;
  /** string literal value (syn `LitStr::value`) and suffix */
  str?: string;
  suffix?: string;
  joint?: boolean;
  delim?: string;
  tokens?: Tok[];
  line: number;
  col: number;
}
/** A probe attribute with the token data this generator needs. */
export type DAttr = PAttr & { tokens?: Tok[]; line?: number; col?: number };

/** A source position for messages: `file:line:col` (col 1-based, like rustc). */
type Span = string;

class DiagnosticDeriveError extends Error {}
class SynError extends DiagnosticDeriveError {}

/** Error sink: what `span_err(..).emit()` reports at macro expansion time. */
export interface DiagErrors {
  error(msg: string): void;
}

// ---- IR ----------------------------------------------------------------------------------------------

export type Expr =
  | { k: "binding"; name: string }
  | { k: "tuple_field"; base: Expr; idx: number }
  | { k: "clone"; e: Expr }
  /** `rustc_errors::DiagMessage::Inline(std::borrow::Cow::Borrowed(value))` */
  | { k: "msg"; value: string }
  | { k: "local"; name: string }
  | { k: "applicability"; v: string }
  | { k: "style"; v: string }
  /** a `code = <expr>` argument of `#[diag(..)]`, as written */
  | { k: "code_expr"; toks: Tok[]; at: Span }
  /** `format!(input, name = value, ...)` (build_format); `tys` are the field types of the values */
  | { k: "format"; input: string; args: { name: string; value: Expr; ty: PType | undefined }[]; at: Span }
  /** `[a, b].into_iter()` */
  | { k: "array_iter"; elems: Expr[] }
  | { k: "string_new" }
  | { k: "iter_empty" }
  /** `rustc_errors::format_diag_message(&msg, &sub_args)` */
  | { k: "format_diag_message"; msg: Expr };

export type Stmt =
  /** `let mut diag = rustc_errors::Diag::new(dcx, level, msg);` */
  | { k: "diag_new"; msg: Expr }
  /** a lone `;` */
  | { k: "empty" }
  /** `diag.<method>(args);` */
  | { k: "call"; method: string; args: Expr[] }
  /** `diag.arg("name", value);` */
  | { k: "arg"; name: string; value: Expr; ty: PType }
  /** `let [mut] name = value;` */
  | { k: "let"; name: string; value: Expr; mut?: boolean }
  /** `if let Some(b) = b {..}` / `for b in b {..}` / `if b {..}` (FieldInnerTy::with) */
  | { k: "if_some" | "for_in" | "if"; binding: string; outer: PType; body: Stmt[] }
  /** `let mut suggestions = Vec::new();` */
  | { k: "suggestions_new" }
  /** `suggestions.push((span, code));` */
  | { k: "push_suggestion"; span: Expr; code: Expr }
  /** `let mut sub_args = rustc_errors::DiagArgMap::default();` */
  | { k: "sub_args_new" }
  /** `sub_args.insert("name".into(), rustc_errors::IntoDiagArg::into_diag_arg(value, &mut diag.long_ty_path));` */
  | { k: "sub_arg"; name: string; value: Expr; ty: PType }
  /** `value.add_to_diag(diag);` (a `#[subdiagnostic]` field of a subdiagnostic) */
  | { k: "add_to_diag"; value: Expr; ty: PType }
  /** `diag.subdiagnostic(value);` (a `#[subdiagnostic]` field of a diagnostic) */
  | { k: "subdiagnostic"; value: Expr; ty: PType }
  /** `{ unreachable!(); }` (DiagnosticDeriveError::ErrorHandled.to_compile_error()) */
  | { k: "unreachable" };

/** One `match self` arm: the variant (undefined for a struct) and its bindings. */
export interface Arm {
  variant: string | undefined;
  style: PFields["style"];
  /** field name (or index for tuple fields) per binding, in declaration order */
  bindings: { field: string; binding: string; ty: PType }[];
  body: Stmt[];
}
export interface DeriveImpl {
  kind: "Diagnostic" | "Subdiagnostic";
  item: string;
  line: number;
  arms: Arm[];
}

// ---- error.rs ------------------------------------------------------------------------------------------

// rustc_macros: diagnostics/error.rs:45 path_to_string
function path_to_string(path: string): string {
  return path;
}

/// Returns an error diagnostic on span `span` with msg `msg`.
// rustc_macros: diagnostics/error.rs:58 span_err
function span_err(errs: DiagErrors, span: Span, msg: string, ...children: string[]): void {
  errs.error(`${span}: derive(Diagnostic): ${msg}${children.map((c) => ` (${c})`).join("")}`);
}

/** `throw_span_err!`: emit, then `return Err(ErrorHandled)`. */
function throw_span_err(errs: DiagErrors, span: Span, msg: string, ...children: string[]): never {
  span_err(errs, span, msg, ...children);
  throw new DiagnosticDeriveError(msg);
}

/// Returns an error diagnostic for an invalid attribute.
// rustc_macros: diagnostics/error.rs:77 invalid_attr
function invalid_attr(errs: DiagErrors, attr: DAttr, at: string, ...children: string[]): void {
  const span = attrSpan(attr, at);
  const path = path_to_string(attr.path);
  switch (metaKind(attr)) {
    case "Path":
      return span_err(errs, span, `\`#[${path}]\` is not a valid attribute`, ...children);
    case "NameValue":
      return span_err(errs, span, `\`#[${path} = ...]\` is not a valid attribute`, ...children);
    case "List":
      return span_err(errs, span, `\`#[${path}(...)]\` is not a valid attribute`, ...children);
  }
}

/** `throw_invalid_attr!` */
function throw_invalid_attr(errs: DiagErrors, attr: DAttr, at: string, ...children: string[]): never {
  invalid_attr(errs, attr, at, ...children);
  throw new DiagnosticDeriveError(`invalid attribute #[${attr.path}]`);
}

// ---- syn stand-ins ----------------------------------------------------------------------------------------

function metaKind(attr: DAttr): "Path" | "NameValue" | "List" {
  if (attr.tokens !== undefined) return "List";
  if (attr.value !== undefined) return "NameValue";
  return "Path";
}
/** `attr.path().segments.last().unwrap().ident.to_string()` */
function attrName(attr: DAttr): string {
  return attr.path.split("::").pop()!;
}
function attrSpan(attr: DAttr, at: string): Span {
  return attr.line !== undefined ? `${at.split(":")[0]}:${attr.line}:${(attr.col ?? 0) + 1}` : at;
}
function tokSpan(t: Tok | undefined, at: string): Span {
  return t ? `${at.split(":")[0]}:${t.line}:${t.col + 1}` : at;
}

/** syn `ParseStream` over the probe's token trees (only what the derive's parsers use). */
class ParseStream {
  private i = 0;
  constructor(
    private readonly toks: readonly Tok[],
    readonly at: string,
  ) {}
  is_empty(): boolean {
    return this.i >= this.toks.length;
  }
  span(): Span {
    return tokSpan(this.toks[this.i] ?? this.toks[this.toks.length - 1], this.at);
  }
  private err(what: string): never {
    throw new SynError(`${this.span()}: ${what}`);
  }
  /** `input.peek(LitStr)` */
  peek_lit_str(): boolean {
    const t = this.toks[this.i];
    return t !== undefined && t.t === "lit" && t.str !== undefined;
  }
  /** `input.parse::<LitStr>()` */
  parse_lit_str(): { value: string; suffix: string; span: Span } {
    const t = this.toks[this.i];
    if (!t || t.t !== "lit" || t.str === undefined) this.err("expected string literal");
    this.i++;
    return { value: t.str!, suffix: t.suffix ?? "", span: tokSpan(t, this.at) };
  }
  /** `input.peek(Token![c])` */
  peek_punct(c: string): boolean {
    const t = this.toks[this.i];
    return t !== undefined && t.t === "punct" && t.v === c;
  }
  /** `input.parse::<Token![c]>()` */
  parse_punct(c: string): void {
    if (!this.peek_punct(c)) this.err(`expected \`${c}\``);
    this.i++;
  }
  /** `input.parse::<Ident>()` */
  parse_ident(): { name: string; span: Span } {
    const t = this.toks[this.i];
    if (!t || t.t !== "ident") this.err("expected identifier");
    this.i++;
    return { name: t.v!, span: tokSpan(t, this.at) };
  }
  /** `input.parse::<Path>()` (mod-style paths: `a::b::c`, optional leading `::`) */
  parse_path(): { segments: string[]; span: Span } {
    const span = this.span();
    const segments: string[] = [];
    const colon2 = () => {
      const a = this.toks[this.i];
      const b = this.toks[this.i + 1];
      return a?.t === "punct" && a.v === ":" && a.joint && b?.t === "punct" && b.v === ":";
    };
    if (colon2()) {
      this.i += 2;
      segments.push("");
    }
    for (;;) {
      segments.push(this.parse_ident().name);
      if (this.peek_punct("<")) this.err("generic arguments in a path are not supported here");
      if (!colon2()) break;
      this.i += 2;
    }
    return { segments, span };
  }
  /** `input.parse::<syn::Expr>()`: the tokens up to the next top-level `,` */
  parse_expr(): Tok[] {
    const start = this.i;
    while (!this.is_empty() && !this.peek_punct(",")) this.i++;
    if (this.i === start) this.err("expected an expression");
    return this.toks.slice(start, this.i);
  }
  /** `input.parse::<TokenStream>()` */
  parse_rest(): void {
    this.i = this.toks.length;
  }
  /** `parenthesized!(content in input)` */
  parenthesized(): ParseStream {
    const t = this.toks[this.i];
    if (!t || t.t !== "group" || t.delim !== "(") this.err("expected parentheses");
    this.i++;
    return new ParseStream(t.tokens!, this.at);
  }
}

/** `attr.parse_args_with(f)` / `list.parse_args_with(f)`: `f` must consume every token. */
function parse_args_with<T>(attr: DAttr, at: string, f: (input: ParseStream) => T): T {
  const input = new ParseStream(attr.tokens ?? [], at);
  const r = f(input);
  if (!input.is_empty()) throw new SynError(`${input.span()}: unexpected token`);
  return r;
}

/** `path.require_ident()` */
function require_ident(path: { segments: string[]; span: Span }): { name: string; span: Span } {
  if (path.segments.length !== 1 || path.segments[0] === "") throw new SynError(`${path.span}: expected this path to be an identifier`);
  return { name: path.segments[0]!, span: path.span };
}

// ---- message.rs -------------------------------------------------------------------------------------------

type FieldMap = Map<string, { ident: string; binding: string; ty: PType }>;

export class Message {
  constructor(
    readonly attr_span: Span,
    readonly attr_col: number,
    readonly message_span: Span,
    readonly value: string,
  ) {}

  // rustc_macros: diagnostics/message.rs:21 new
  static new(
    errs: DiagErrors,
    attr_span: Span,
    attr_col: number,
    message_span: Span,
    message_str: string,
    field_map: FieldMap,
    used_fields: Set<string>,
  ): Message {
    // Parse the fluent message
    const GENERATED_MSG_ID = "generated_msg";
    const resource = FluentResource.try_new(`${GENERATED_MSG_ID} = ${message_str}\n`);
    if (resource.$ === "Err") throw new DiagnosticDeriveError(`${message_span}: called \`Result::unwrap()\` on an \`Err\` value (Fluent parse error)`);
    if (resource._0.entries().length !== 1) throw new DiagnosticDeriveError(`${message_span}: assertion failed: resource.entries().count() == 1`);
    const entry = resource._0.get_entry(0);
    if (entry?.$ !== "Message") throw new DiagnosticDeriveError(`${message_span}: Did not parse into a message`);
    const flt_message = entry._0;

    const fields = new Map<string, [string, boolean]>();
    for (const [, { ident }] of field_map) fields.set(unraw(ident), [ident, false]);
    for (const variable of variable_references(flt_message)) {
      const f = fields.get(variable);
      if (f) f[1] = true;
      else
        span_err(
          errs,
          message_span,
          `Variable \`${variable}\` not found in diagnostic `,
          `Available fields: ${JSON.stringify([...fields.keys()].join(", "))}`,
        );
    }
    for (const [name, seen] of fields.values()) if (seen) used_fields.add(name);
    return new Message(attr_span, attr_col, message_span, message_str);
  }

  /// Get the diagnostic message for this diagnostic
  // rustc_macros: diagnostics/message.rs:69 diag_message
  diag_message(errs: DiagErrors): Expr {
    const message = this.value;
    this.verify(errs);
    return { k: "msg", value: message };
  }

  // rustc_macros: diagnostics/message.rs:75 verify
  verify(errs: DiagErrors): void {
    verify_message_style(errs, this.message_span, this.value);
    verify_message_formatting(errs, this.attr_col, this.message_span, this.value);
  }
}

// rustc_macros: diagnostics/message.rs:81 variable_references
function variable_references(msg: FltMessage): string[] {
  const refs: string[] = [];
  if (msg.value !== undefined) for (const elt of msg.value.elements) traverse_pattern(elt, refs);
  for (const attr of msg.attributes) for (const elt of attr.value.elements) traverse_pattern(elt, refs);

  // rustc_macros: diagnostics/message.rs:95 traverse_pattern
  function traverse_pattern(elem: PatternElement, refs: string[]): void {
    switch (elem.$) {
      case "TextElement":
        return;
      case "Placeable":
        return traverse_expression(elem.expression, refs);
    }
  }
  // rustc_macros: diagnostics/message.rs:101 traverse_expression
  function traverse_expression(expr: Expression, refs: string[]): void {
    switch (expr.$) {
      case "Select":
        traverse_inline_expr(expr.selector, refs);
        for (const variant of expr.variants) for (const pattern of variant.value.elements) traverse_pattern(pattern, refs);
        return;
      case "Inline":
        return traverse_inline_expr(expr._0, refs);
    }
  }
  // rustc_macros: diagnostics/message.rs:116 traverse_inline_expr
  function traverse_inline_expr(elem: InlineExpression, refs: string[]): void {
    if (elem.$ === "VariableReference") refs.push(elem.id.name.toString());
  }
  return refs;
}

const ALLOWED_CAPITALIZED_WORDS = ["ABI", "ABIs", "ADT", "C-variadic", "CGU-reuse", "Cargo", "Ferris", "GCC", "LLVM", "MIR", "NaNs", "OK", "Rust", "ThinLTO", "Unicode", "VS"];

/// See: https://rustc-dev-guide.rust-lang.org/diagnostics.html#diagnostic-output-style-guide
// rustc_macros: diagnostics/message.rs:148 verify_message_style
function verify_message_style(errs: DiagErrors, msg_span: Span, message: string): void {
  // Verify that message starts with lowercase char
  const first_word = message.split(/[\s\u0085]+/).find((w) => w !== ""); // PORT: `split_whitespace` (Unicode White_Space; U+FEFF is not)
  if (first_word === undefined) {
    span_err(errs, msg_span, "message must not be empty");
    return;
  }
  const first_char = String.fromCodePoint(first_word.codePointAt(0)!);
  // PORT: `char::is_uppercase` approximated by the Unicode `Lu`/`Other_Uppercase` test of JS.
  if (/\p{Uppercase}/u.test(first_char) && !ALLOWED_CAPITALIZED_WORDS.includes(first_word)) {
    span_err(errs, msg_span, "message `{value}` starts with an uppercase letter. Fix it or add it to `ALLOWED_CAPITALIZED_WORDS`");
    return;
  }
  // Verify that message does not end in `.`
  if (message.endsWith(".") && !message.endsWith("...")) {
    span_err(errs, msg_span, "message `{value}` ends with a period");
    return;
  }
}

/// Verifies that the message is properly indented into the code
// rustc_macros: diagnostics/message.rs:168 verify_message_formatting
function verify_message_formatting(errs: DiagErrors, attr_col0: number, msg_span: Span, message: string): void {
  // Find the indent at the start of the message (`column()` is one-indexed)
  const start = attr_col0;
  // `str::lines`: split on `\n`, strip one trailing `\r`, no final empty line
  const lines = message.split("\n").map((l) => (l.endsWith("\r") ? l.slice(0, -1) : l));
  if (message.endsWith("\n")) lines.pop();
  for (const line of lines.slice(1)) {
    if (line === "") continue;
    if (line.trim().startsWith("{") && line.includes("found ")) continue;
    let indent = 0;
    while (line[indent] === " ") indent++;
    if (indent < start) {
      span_err(errs, msg_span, `message is not properly indented. ${indent} < ${start}`);
      return;
    }
    if (indent % 4 !== 0) {
      span_err(errs, msg_span, "message is not indented with a multiple of 4 spaces");
      return;
    }
  }
}

// ---- utils.rs ------------------------------------------------------------------------------------------------

/// Returns an ident of the form `__code_N` where `N` is incremented once with every call.
// PORT: the thread-local counter of the proc-macro server is a field of the generation state.
// rustc_macros: diagnostics/utils.rs:26 new_code_ident
function new_code_ident(st: GenState): string {
  return `__code_${st.code_ident_count++}`;
}

/** `ty` as the macro sees it (`syn::Type`): parentheses and invisible groups are already gone. */
function tyPath(ty: PType): string[] | undefined {
  return ty.kind === "path" && !ty.qself ? ty.path!.segments.map((s) => s.name) : undefined;
}

/// Checks whether the type name of `ty` matches `name`.
///
/// Given some struct at `a::b::c::Foo`, this will return true for `c::Foo`, `b::c::Foo`, or
/// `a::b::c::Foo`. This reasonably allows qualified names to be used in the macro.
// rustc_macros: diagnostics/utils.rs:38 type_matches_path
export function type_matches_path(ty: PType, name: readonly string[]): boolean {
  const segs = tyPath(ty);
  if (!segs) return false;
  const a = [...segs].reverse();
  const b = [...name].reverse();
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return false;
  return true;
}

/// Checks whether the type `ty` is `()`.
// rustc_macros: diagnostics/utils.rs:53 type_is_unit
function type_is_unit(ty: PType): boolean {
  return ty.kind === "tuple" && ty.elems!.length === 0;
}

/// Checks whether the type `ty` is `bool`.
// rustc_macros: diagnostics/utils.rs:58 type_is_bool
function type_is_bool(ty: PType): boolean {
  return type_matches_path(ty, ["bool"]);
}

/// Reports a type error for field with `attr`.
// rustc_macros: diagnostics/utils.rs:63 report_type_error
function report_type_error(errs: DiagErrors, attr: DAttr, at: string, ty_name: string): never {
  const name = attrName(attr);
  const meta = metaKind(attr);
  throw_span_err(
    errs,
    attrSpan(attr, at),
    `the \`#[${name}${meta === "Path" ? "" : meta === "NameValue" ? " = ..." : "(...)"}]\` attribute can only be applied to fields of type ${ty_name}`,
  );
}

/// Reports an error if the field's type does not match `path`.
// rustc_macros: diagnostics/utils.rs:86 report_error_if_not_applied_to_ty
function report_error_if_not_applied_to_ty(errs: DiagErrors, attr: DAttr, at: string, info: FieldInfo, path: string[], ty_name: string): void {
  if (!type_matches_path(info.ty.inner_type(), path)) report_type_error(errs, attr, at, ty_name);
}

/// Reports an error if the field's type is not `Applicability`.
// rustc_macros: diagnostics/utils.rs:100 report_error_if_not_applied_to_applicability
function report_error_if_not_applied_to_applicability(errs: DiagErrors, attr: DAttr, at: string, info: FieldInfo): void {
  report_error_if_not_applied_to_ty(errs, attr, at, info, ["rustc_errors", "Applicability"], "`Applicability`");
}

/// Reports an error if the field's type is not `Span`.
// rustc_macros: diagnostics/utils.rs:113 report_error_if_not_applied_to_span
function report_error_if_not_applied_to_span(errs: DiagErrors, attr: DAttr, at: string, info: FieldInfo): void {
  if (!type_matches_path(info.ty.inner_type(), ["rustc_span", "Span"]) && !type_matches_path(info.ty.inner_type(), ["rustc_errors", "MultiSpan"])) {
    report_type_error(errs, attr, at, "`Span` or `MultiSpan`");
  }
}

/// Inner type of a field and type of wrapper.
class FieldInnerTy {
  private constructor(
    readonly kind: "Option" | "Vec" | "Plain",
    readonly ty: PType,
    /** the field's own (outer) type */
    readonly outer: PType,
  ) {}

  /// Returns inner type for a field, if there is one.
  // rustc_macros: diagnostics/utils.rs:143 from_type
  static from_type(ty: PType): FieldInnerTy {
    // rustc_macros: diagnostics/utils.rs:144 single_generic_type
    const single_generic_type = (ty: PType): PType => {
      if (ty.kind !== "path") throw new DiagnosticDeriveError("expected path type");
      const seg = ty.path!.segments[ty.path!.segments.length - 1]!;
      if (seg.args.length !== 1) throw new DiagnosticDeriveError(`assertion failed: bracketed.args.len() == 1 (${ty.text})`);
      const a = seg.args[0]!;
      if (a.kind !== "type") throw new DiagnosticDeriveError("expected generic parameter to be a type generic");
      return a.ty!;
    };
    if (type_matches_path(ty, ["std", "option", "Option"])) return new FieldInnerTy("Option", single_generic_type(ty), ty);
    if (type_matches_path(ty, ["std", "vec", "Vec"])) return new FieldInnerTy("Vec", single_generic_type(ty), ty);
    return new FieldInnerTy("Plain", ty, ty);
  }

  /// Returns `true` if `FieldInnerTy::with` will result in iteration for this inner type (i.e.
  /// that cloning might be required for values moved in the loop body).
  // rustc_macros: diagnostics/utils.rs:175 will_iterate
  will_iterate(): boolean {
    return this.kind === "Vec";
  }

  /// Returns the inner type.
  // rustc_macros: diagnostics/utils.rs:183 inner_type
  inner_type(): PType {
    return this.ty;
  }

  /// Surrounds `inner` with destructured wrapper type, exposing inner type as `binding`.
  // rustc_macros: diagnostics/utils.rs:192 with
  with(binding: string, inner: Stmt[]): Stmt[] {
    switch (this.kind) {
      case "Option":
        return [{ k: "if_some", binding, outer: this.outer, body: inner }];
      case "Vec":
        return [{ k: "for_in", binding, outer: this.outer, body: inner }];
      case "Plain":
        if (type_is_bool(this.ty)) return [{ k: "if", binding, outer: this.outer, body: inner }];
        return inner;
    }
  }
}

/// Field information passed to the builder. Deliberately omits attrs to discourage the
/// `generate_*` methods from walking the attributes themselves.
interface FieldInfo {
  binding: BindingInfo;
  ty: FieldInnerTy;
  span: Span;
}

/** synstructure `BindingInfo`: a field and its `__binding_N` binding. */
interface BindingInfo {
  binding: string;
  field: PField;
}

/// An [`Option<T>`] that keeps track of the span that caused it to be set; used with [`SetOnce`].
type SpannedOption<T> = [T, Span] | undefined;

// rustc_macros: diagnostics/utils.rs:241 set_once
function set_once<T>(errs: DiagErrors, self: { v: SpannedOption<T> }, value: T, span: Span): void {
  if (self.v === undefined) self.v = [value, span];
  else span_err(errs, span, "attribute specified multiple times", `previously specified here: ${self.v[1]}`);
}
/** `SetOnce::value` */
const value_of = <T>(o: SpannedOption<T>): T | undefined => (o === undefined ? undefined : o[0]);

/// In the strings in the attributes supplied to this macro, we want callers to be able to
/// reference fields in the format string (`code = "{lhs} == {rhs}"`). This function builds the
/// entire call to `format!`.
// rustc_macros: diagnostics/utils.rs:287 build_format
function build_format(errs: DiagErrors, field_map: FieldMap, input: string, span: Span): Expr {
  // This set is used later to generate the final format string. To keep builds reproducible,
  // the iteration order needs to be deterministic, hence why we use a `BTreeSet` here
  // instead of a `HashSet`.
  const referenced_fields = new Set<string>();
  const it = [...input]; // chars
  let i = 0;
  const next = () => it[i++];
  const peek = () => it[i];
  // Once the start of a format string has been found, process the format string and spit out
  // the referenced fields. Leaves `it` sitting on the closing brace of the format string, so
  // the next call to `it.next()` retrieves the next character.
  for (let c = next(); c !== undefined; c = next()) {
    if (c !== "{") continue;
    if ((peek() ?? "\0") === "{") {
      next();
      continue;
    }
    // rustc_macros: diagnostics/utils.rs:311 eat_argument
    const eat_argument = (): string | undefined => {
      let result = "";
      // Format specifiers look like:
      //
      //   format   := '{' [ argument ] [ ':' format_spec ] '}' .
      //
      // Therefore, we only need to eat until ':' or '}' to find the argument.
      for (let c = next(); c !== undefined; c = next()) {
        result += c;
        const n = peek() ?? "\0";
        if (n === "}") break;
        else if (n === ":") {
          // Eat the ':' character.
          next();
          break;
        }
      }
      // Eat until (and including) the matching '}'
      for (;;) {
        const c = next();
        if (c === undefined) return undefined;
        if (c === "}") break;
      }
      return result;
    };
    const referenced_field = eat_argument();
    if (referenced_field !== undefined) referenced_fields.add(referenced_field);
  }

  // At this point, `referenced_fields` contains a set of the unique fields that were
  // referenced in the format string. Generate the corresponding "x = self.x" format
  // string parameters:
  const sorted = [...referenced_fields].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)); // BTreeSet<String>: byte order
  const args = sorted.map((field) => {
    const value = field_map.get(field);
    if (value === undefined) {
      // This field doesn't exist. Emit a diagnostic.
      span_err(errs, span, `\`${field}\` doesn't refer to a field on this type`);
      return { name: field, value: { k: "local", name: `"{${field}}"` } as Expr, ty: undefined };
    }
    return { name: field, value: { k: "binding", name: value.binding } as Expr, ty: value.ty };
  });
  return { k: "format", input, args, at: span };
}

/// `Applicability` of a suggestion - mirrors `rustc_errors::Applicability` - and used to represent
/// the user's selection of applicability if specified in an attribute.
type Applicability = "MachineApplicable" | "MaybeIncorrect" | "HasPlaceholders" | "Unspecified";

// rustc_macros: diagnostics/utils.rs:379 from_str
function Applicability_from_str(s: string): Applicability | undefined {
  switch (s) {
    case "machine-applicable":
      return "MachineApplicable";
    case "maybe-incorrect":
      return "MaybeIncorrect";
    case "has-placeholders":
      return "HasPlaceholders";
    case "unspecified":
      return "Unspecified";
    default:
      return undefined;
  }
}

/// Build the mapping of field names to fields. This allows attributes to peek values from
/// other fields.
// rustc_macros: diagnostics/utils.rs:411 build_field_mapping
function build_field_mapping(variant: VariantInfo): FieldMap {
  const fields_map: FieldMap = new Map();
  for (const binding of variant.bindings) {
    const ident = binding.field.name;
    if (ident !== null) fields_map.set(ident, { ident, binding: binding.binding, ty: binding.field.ty });
  }
  return fields_map;
}

type AllowMultipleAlternatives = "No" | "Yes";

// rustc_macros: diagnostics/utils.rs:427 parse_suggestion_values
function parse_suggestion_values(errs: DiagErrors, nested: ParseStream, allow_multiple: AllowMultipleAlternatives): { value: string; span: Span }[] {
  if (nested.peek_punct("=")) {
    nested.parse_punct("=");
    return [nested.parse_lit_str()];
  }
  const content = nested.parenthesized();
  if (allow_multiple === "No") {
    span_err(errs, content.span(), "expected exactly one string literal for `code = ...`");
    return [];
  }
  // `Punctuated::<LitStr, Token![,]>::parse_terminated(&content)`
  const literals: { value: string; span: Span }[] = [];
  try {
    while (!content.is_empty()) {
      literals.push(content.parse_lit_str());
      if (content.is_empty()) break;
      content.parse_punct(",");
    }
  } catch (e) {
    if (!(e instanceof SynError)) throw e;
    span_err(errs, content.span(), "`code(...)` must contain only string literals");
    return [];
  }
  if (literals.length === 0) {
    span_err(errs, content.span(), "expected at least one string literal for `code(...)`");
    return [];
  }
  return literals;
}

/// Constructs the `format!()` invocation(s) necessary for a `#[suggestion*(code = "foo")]` or
/// `#[suggestion*(code("foo", "bar"))]` attribute field
// rustc_macros: diagnostics/utils.rs:464 build_suggestion_code
function build_suggestion_code(errs: DiagErrors, code_field: string, nested: ParseStream, fields: FieldMap, allow_multiple: AllowMultipleAlternatives): Stmt[] {
  const values = parse_suggestion_values(errs, nested, allow_multiple);
  if (allow_multiple === "Yes") {
    const formatted_strings = values.map((value) => build_format(errs, fields, value.value, value.span));
    return [{ k: "let", name: code_field, value: { k: "array_iter", elems: formatted_strings } }];
  } else if (values.length === 1) {
    const formatted_str = build_format(errs, fields, values[0]!.value, values[0]!.span);
    return [{ k: "let", name: code_field, value: formatted_str }];
  } else {
    // error handled previously
    return [{ k: "let", name: code_field, value: { k: "string_new" } }];
  }
}

/// Possible styles for suggestion subdiagnostics.
type SuggestionKind = "Normal" | "Short" | "Hidden" | "Verbose" | "ToolOnly";

// rustc_macros: diagnostics/utils.rs:500 from_str
function SuggestionKind_from_str(s: string): SuggestionKind | undefined {
  switch (s) {
    case "normal":
      return "Normal";
    case "short":
      return "Short";
    case "hidden":
      return "Hidden";
    case "verbose":
      return "Verbose";
    case "tool-only":
      return "ToolOnly";
    default:
      return undefined;
  }
}

// rustc_macros: diagnostics/utils.rs:525 to_suggestion_style
function to_suggestion_style(k: SuggestionKind): Expr {
  switch (k) {
    case "Normal":
      return { k: "style", v: "ShowCode" };
    case "Short":
      return { k: "style", v: "HideCodeInline" };
    case "Hidden":
      return { k: "style", v: "HideCodeAlways" };
    case "Verbose":
      return { k: "style", v: "ShowAlways" };
    case "ToolOnly":
      return { k: "style", v: "CompletelyHidden" };
  }
}

/// Types of subdiagnostics that can be created using attributes
type SubdiagnosticKind =
  | { $: "Label" }
  | { $: "Note" }
  | { $: "NoteOnce" }
  | { $: "Help" }
  | { $: "HelpOnce" }
  | { $: "Warn" }
  | {
      $: "Suggestion";
      suggestion_kind: SuggestionKind;
      applicability: SpannedOption<Applicability>;
      /// Identifier for variable used for formatted code, e.g. `___code_0`.
      code_field: string;
      /// Initialization logic for `code_field`'s variable.
      code_init: Stmt[];
    }
  | { $: "MultipartSuggestion"; suggestion_kind: SuggestionKind; applicability: SpannedOption<Applicability> };

interface SubdiagnosticVariant {
  kind: SubdiagnosticKind;
  message: Message | undefined;
}

/// Constructs a `SubdiagnosticVariant` from a field or type attribute such as `#[note]`,
/// `#[error("add parenthesis")]` or `#[suggestion(code = "...")]`. Returns the
/// `SubdiagnosticKind` and the diagnostic message, if specified.
// rustc_macros: diagnostics/utils.rs:588 from_attr
function SubdiagnosticVariant_from_attr(st: GenState, attr: DAttr, at: string, fields: FieldMap, used_fields: Set<string>): SubdiagnosticVariant | undefined {
  const errs = st.errs;
  // Always allow documentation comments.
  if (is_doc_comment(attr)) return undefined;

  const span = attrSpan(attr, at);
  const name = attrName(attr);
  let kind: SubdiagnosticKind;
  switch (name) {
    case "label":
      kind = { $: "Label" };
      break;
    case "note":
      kind = { $: "Note" };
      break;
    case "note_once":
      kind = { $: "NoteOnce" };
      break;
    case "help":
      kind = { $: "Help" };
      break;
    case "help_once":
      kind = { $: "HelpOnce" };
      break;
    case "warning":
      kind = { $: "Warn" };
      break;
    case "suggestion":
      kind = { $: "Suggestion", suggestion_kind: "Normal", applicability: undefined, code_field: new_code_ident(st), code_init: [] };
      break;
    case "multipart_suggestion":
      kind = { $: "MultipartSuggestion", suggestion_kind: "Normal", applicability: undefined };
      break;
    default:
      throw_invalid_attr(errs, attr, at);
  }

  switch (metaKind(attr)) {
    case "List":
      // An attribute with properties, such as `#[suggestion(code = "...")]` or
      // `#[error("message")]`
      break;
    case "Path":
      // An attribute without a message or other properties, such as `#[note]` - return
      // without further processing.
      //
      // Only allow this if there are no mandatory properties, such as `code = "..."` in
      // `#[suggestion(...)]`
      if (kind.$ === "Suggestion") throw_span_err(errs, span, 'suggestion without `code = "..."`');
      return { kind, message: undefined };
    default:
      throw_invalid_attr(errs, attr, at);
  }

  const code: { v: SpannedOption<Stmt[]> } = { v: undefined };
  const suggestion_kind: { v: SpannedOption<SuggestionKind> } = { v: undefined };
  let message: Message | undefined;

  parse_args_with(attr, at, (input) => {
    let is_first = true;
    while (!input.is_empty()) {
      // Try to parse an inline diagnostic message
      if (input.peek_lit_str()) {
        const inline_message = input.parse_lit_str();
        if (inline_message.suffix !== "") span_err(errs, inline_message.span, "Inline message is not allowed to have a suffix");
        if (!input.is_empty()) input.parse_punct(",");
        if (is_first) {
          message = Message.new(errs, span, attr.col ?? 0, inline_message.span, inline_message.value, fields, used_fields);
          is_first = false;
        } else {
          span_err(errs, inline_message.span, "a diagnostic message must be the first argument to the attribute");
        }
        continue;
      }
      is_first = false;

      // Try to parse an argument
      const arg_name = input.parse_path();
      const arg_name_span = arg_name.span;
      const arg = require_ident(arg_name).name;
      if (arg === "code" && kind.$ === "Suggestion") {
        const code_init = build_suggestion_code(errs, kind.code_field, input, fields, "Yes");
        set_once(errs, code, code_init, arg_name_span);
      } else if (arg === "applicability" && (kind.$ === "Suggestion" || kind.$ === "MultipartSuggestion")) {
        input.parse_punct("=");
        const value = input.parse_lit_str();
        let a = Applicability_from_str(value.value);
        if (a === undefined) {
          span_err(errs, value.span, "invalid applicability");
          a = "Unspecified";
        }
        const slot = { v: kind.applicability };
        set_once(errs, slot, a, span);
        kind.applicability = slot.v;
      } else if (arg === "style" && (kind.$ === "Suggestion" || kind.$ === "MultipartSuggestion")) {
        input.parse_punct("=");
        const value = input.parse_lit_str();
        let v = SuggestionKind_from_str(value.value);
        if (v === undefined) {
          span_err(errs, value.span, "invalid suggestion style", "valid styles are `normal`, `short`, `hidden`, `verbose` and `tool-only`");
          v = "Normal";
        }
        set_once(errs, suggestion_kind, v, span);
      }
      // Invalid nested attribute
      else if (kind.$ === "Suggestion") {
        span_err(errs, arg_name_span, "invalid nested attribute", "only `style`, `code` and `applicability` are valid nested attributes");
        // Consume the rest of the input to avoid spamming errors
        input.parse_rest();
      } else if (kind.$ === "MultipartSuggestion") {
        span_err(errs, arg_name_span, "invalid nested attribute", "only `style` and `applicability` are valid nested attributes");
        // Consume the rest of the input to avoid spamming errors
        input.parse_rest();
      } else {
        span_err(errs, arg_name_span, "no nested attribute expected here");
        // Consume the rest of the input to avoid spamming errors
        input.parse_rest();
      }

      if (input.is_empty()) break;
      input.parse_punct(",");
    }
  });

  switch (kind.$) {
    case "Suggestion": {
      const k = value_of(suggestion_kind.v);
      if (k !== undefined) kind.suggestion_kind = k;
      const init = value_of(code.v);
      if (init !== undefined) kind.code_init = init;
      else {
        span_err(errs, span, 'suggestion without `code = "..."`');
        kind.code_init = [{ k: "let", name: kind.code_field, value: { k: "iter_empty" } }];
      }
      break;
    }
    case "MultipartSuggestion": {
      const k = value_of(suggestion_kind.v);
      if (k !== undefined) kind.suggestion_kind = k;
      break;
    }
    default:
      break;
  }
  return { kind, message };
}

/** `impl quote::IdentFragment for SubdiagnosticKind` */
// rustc_macros: diagnostics/utils.rs:804 fmt
function SubdiagnosticKind_fmt(k: SubdiagnosticKind): string {
  switch (k.$) {
    case "Label":
      return "label";
    case "Note":
      return "note";
    case "NoteOnce":
      return "note_once";
    case "Help":
      return "help";
    case "HelpOnce":
      return "help_once";
    case "Warn":
      return "warn";
    case "Suggestion":
      return "suggestions_with_style";
    case "MultipartSuggestion":
      return "multipart_suggestion_with_style";
  }
}

/// Returns `true` if `field` should generate a `arg` call rather than any other diagnostic
/// call (like `span_label`).
// rustc_macros: diagnostics/utils.rs:826 should_generate_arg
function should_generate_arg(field: PField): boolean {
  // Perhaps this should be an exhaustive list...
  return field.attrs.every((attr) => is_doc_comment(attr));
}

// rustc_macros: diagnostics/utils.rs:831 is_doc_comment
function is_doc_comment(attr: DAttr): boolean {
  // PORT: the probe lists doc comments separately (`docs`), never among `attrs`.
  return attrName(attr) === "doc";
}

function unraw(s: string): string {
  return s.startsWith("r#") ? s.slice(2) : s;
}

// ---- synstructure stand-ins ------------------------------------------------------------------------------

interface VariantInfo {
  /** the variant name (undefined: the struct itself) */
  name: string | undefined;
  attrs: DAttr[];
  fields: PFields;
  bindings: BindingInfo[];
  line: number;
}

function variantsOf(item: PItem): VariantInfo[] {
  const mk = (name: string | undefined, attrs: DAttr[], fields: PFields, line: number): VariantInfo => ({
    name,
    attrs,
    fields,
    line,
    bindings: fields.fields.map((field, i) => ({ binding: `__binding_${i}`, field })),
  });
  if (item.kind === "enum") return item.variants!.map((v) => mk(v.name, v.attrs as DAttr[], v.fields, v.line));
  // derive input attributes: the `#[derive(..)]` attributes themselves are not part of it
  return [mk(undefined, (item.attrs as DAttr[]).filter((a) => a.path !== "derive"), item.fields!, item.line)];
}

function armOf(v: VariantInfo, body: Stmt[]): Arm {
  return {
    variant: v.name,
    style: v.fields.style,
    bindings: v.bindings.map((b) => ({ field: b.field.name ?? String(b.field.index), binding: b.binding, ty: b.field.ty })),
    body,
  };
}

interface GenState {
  errs: DiagErrors;
  /** CODE_IDENT_COUNT (utils.rs:22) */
  code_ident_count: number;
  file: string;
}

// ---- diagnostic_builder.rs / diagnostic.rs -----------------------------------------------------------------

/// Tracks persistent information required for a specific variant when building up individual calls
/// to diagnostic methods for generated diagnostic derives.
class DiagnosticDeriveVariantBuilder {
  /// Initialization of format strings for code suggestions.
  formatting_init: Stmt[] = [];
  /// Message is a mandatory part of the struct attribute as corresponds to the Fluent message that
  /// has the actual diagnostic message.
  message: Message | undefined = undefined;
  /// Error codes are a optional part of the struct attribute - this is only set to detect
  /// multiple specifications.
  code: { v: SpannedOption<null> } = { v: undefined };
  used_fields = new Set<string>();

  constructor(
    readonly st: GenState,
    /// Span of the struct or the enum variant.
    readonly span: Span,
    /// Store a map of field name to its corresponding field.
    readonly field_map: FieldMap,
  ) {}

  // rustc_macros: diagnostics/diagnostic_builder.rs:94 primary_message
  primary_message(): Message | undefined {
    if (this.message === undefined) {
      span_err(
        this.st.errs,
        this.span,
        "diagnostic message not specified",
        'specify the message as the first argument to the `#[diag(...)]` attribute, such as `#[diag("Example error")]`',
      );
      return undefined;
    }
    return this.message;
  }

  /// Generates calls to `code` and similar functions based on the attributes on the type or
  /// variant.
  // rustc_macros: diagnostics/diagnostic_builder.rs:111 preamble
  preamble(variant: VariantInfo): Stmt[] {
    const out: Stmt[] = [];
    for (const attr of variant.attrs) out.push(...this.catching(() => this.generate_structure_code_for_attr(attr, variant)));
    out.push({ k: "empty" });
    return out;
  }

  /// Generates calls to `span_label` and similar functions based on the attributes on fields or
  /// calls to `arg` when no attributes are present.
  // rustc_macros: diagnostics/diagnostic_builder.rs:125 body
  body(variant: VariantInfo): Stmt[] {
    const body: Stmt[] = [];
    const second_part: Stmt[] = [];
    // Subdiagnostic additions.
    for (const binding of variant.bindings.filter((bi) => !should_generate_arg(bi.field))) {
      second_part.push(...this.generate_field_attrs_code(binding, variant));
    }
    // Generate `arg` calls first..
    for (const binding of variant.bindings.filter((bi) => should_generate_arg(bi.field))) {
      if (this.is_used_in_message(binding)) body.push(...this.generate_field_code(binding, variant));
    }
    body.push(...second_part);
    return body;
  }

  // rustc_macros: diagnostics/diagnostic_builder.rs:143 is_used_in_message
  is_used_in_message(binding: BindingInfo): boolean {
    return binding.field.name !== null && this.used_fields.has(binding.field.name);
  }

  /** `.unwrap_or_else(|v| v.to_compile_error())` */
  private catching(f: () => Stmt[]): Stmt[] {
    try {
      return f();
    } catch (e) {
      if (e instanceof SynError) {
        this.st.errs.error(`derive(Diagnostic): ${e.message}`);
        return [{ k: "unreachable" }];
      }
      if (e instanceof DiagnosticDeriveError) return [{ k: "unreachable" }];
      throw e;
    }
  }

  /// Parse a `SubdiagnosticKind` from an `Attribute`.
  // rustc_macros: diagnostics/diagnostic_builder.rs:148 parse_subdiag_attribute
  parse_subdiag_attribute(attr: DAttr, at: string): [SubdiagnosticKind, Message, boolean] | undefined {
    const subdiag = SubdiagnosticVariant_from_attr(this.st, attr, at, this.field_map, this.used_fields);
    if (subdiag === undefined) {
      // Some attributes aren't errors - like documentation comments - but also aren't
      // subdiagnostics.
      return undefined;
    }
    if (subdiag.kind.$ === "MultipartSuggestion") throw_invalid_attr(this.st.errs, attr, at, "consider creating a `Subdiagnostic` instead");
    if (subdiag.message === undefined) throw_invalid_attr(this.st.errs, attr, at, "subdiagnostic message is missing");
    return [subdiag.kind, subdiag.message, false];
  }

  /// Establishes state in the `DiagnosticDeriveBuilder` resulting from the struct
  /// attributes like `#[diag(..)]`, such as the message and error code. Generates
  /// diagnostic builder calls for setting error code and creating note/help messages.
  // rustc_macros: diagnostics/diagnostic_builder.rs:175 generate_structure_code_for_attr
  generate_structure_code_for_attr(attr: DAttr, variant: VariantInfo): Stmt[] {
    const errs = this.st.errs;
    const at = `${this.st.file}:${variant.line}`;
    // Always allow documentation comments.
    if (is_doc_comment(attr)) return [];

    const name = attrName(attr);

    if (name === "diag") {
      const tokens: Stmt[] = [];
      parse_args_with(attr, at, (input) => {
        if (input.peek_lit_str()) {
          // Parse an inline message
          const message = input.parse_lit_str();
          if (message.suffix !== "") span_err(errs, message.span, "Inline message is not allowed to have a suffix");
          this.message = Message.new(errs, attrSpan(attr, at), attr.col ?? 0, message.span, message.value, this.field_map, this.used_fields);
        }
        // Parse arguments
        while (!input.is_empty()) {
          input.parse_punct(",");
          // Allow trailing comma
          if (input.is_empty()) break;
          const arg_name = input.parse_path();
          if (input.peek_punct(",")) {
            span_err(errs, arg_name.span, "diagnostic message must be the first argument");
            continue;
          }
          const ident = require_ident(arg_name);
          input.parse_punct("=");
          const arg_value = input.parse_expr();
          switch (ident.name) {
            case "code":
              set_once(errs, this.code, null, ident.span);
              tokens.push({ k: "call", method: "code", args: [{ k: "code_expr", toks: arg_value, at: ident.span }] });
              break;
            default:
              span_err(errs, ident.span, "unknown argument", "only the `code` parameter is valid after the message");
          }
        }
      });
      return tokens;
    }

    const parsed = this.parse_subdiag_attribute(attr, at);
    if (parsed === undefined) {
      // Some attributes aren't errors - like documentation comments - but also aren't
      // subdiagnostics.
      return [];
    }
    const [subdiag, message] = parsed;
    const fn_ident = SubdiagnosticKind_fmt(subdiag);
    switch (subdiag.$) {
      case "Note":
      case "NoteOnce":
      case "Help":
      case "HelpOnce":
      case "Warn":
        return this.add_subdiagnostic(fn_ident, message);
      case "Label":
      case "Suggestion":
        return throw_invalid_attr(errs, attr, at, "`#[label]` and `#[suggestion]` can only be applied to fields");
      case "MultipartSuggestion":
        throw new Error("internal error: entered unreachable code");
    }
  }

  // rustc_macros: diagnostics/diagnostic_builder.rs:269 generate_field_code
  generate_field_code(binding_info: BindingInfo, variant: VariantInfo): Stmt[] {
    const field = binding_info.field;
    const ident = field.name;
    if (ident === null) {
      span_err(this.st.errs, `${this.st.file}:${field.line}`, "tuple structs are not supported");
      return [];
    }
    void variant;
    // strip `r#` prefix, if present
    return [{ k: "arg", name: unraw(ident), value: { k: "binding", name: binding_info.binding }, ty: field.ty }];
  }

  // rustc_macros: diagnostics/diagnostic_builder.rs:288 generate_field_attrs_code
  generate_field_attrs_code(binding_info: BindingInfo, variant: VariantInfo): Stmt[] {
    const field = binding_info.field;
    const field_binding = binding_info.binding;
    const at = `${this.st.file}:${field.line}`;
    let inner_ty: FieldInnerTy;
    try {
      inner_ty = FieldInnerTy.from_type(field.ty);
    } catch (e) {
      if (!(e instanceof DiagnosticDeriveError)) throw e;
      this.st.errs.error(`${at}: proc macro panicked: ${e.message}`);
      return [{ k: "unreachable" }];
    }
    let seen_label = false;
    const out: Stmt[] = [];
    void variant;
    for (const attr of field.attrs as DAttr[]) {
      // Always allow documentation comments.
      if (is_doc_comment(attr)) continue;
      const name = attrName(attr);
      if (name === "primary_span" && seen_label) {
        span_err(this.st.errs, attrSpan(attr, at), "`#[primary_span]` must be placed before labels, since it overwrites the span of the diagnostic");
      }
      if (name === "label") seen_label = true;

      const needs_clone = name === "primary_span" && inner_ty.kind === "Vec";
      // `primary_span` can accept a `Vec<Span>` so don't destructure that.
      const [binding, needs_destructure]: [Expr, boolean] = needs_clone
        ? [{ k: "clone", e: { k: "binding", name: field_binding } }, false]
        : [{ k: "binding", name: field_binding }, true];

      const generated_code = this.catching(() => this.generate_inner_field_code(attr, at, { binding: binding_info, ty: inner_ty, span: at }, binding));
      if (needs_destructure) out.push(...inner_ty.with(field_binding, generated_code));
      else out.push(...generated_code);
    }
    return out;
  }

  // rustc_macros: diagnostics/diagnostic_builder.rs:339 generate_inner_field_code
  generate_inner_field_code(attr: DAttr, at: string, info: FieldInfo, binding: Expr): Stmt[] {
    const errs = this.st.errs;
    const name = attrName(attr);
    const meta = metaKind(attr);
    if (meta === "Path" && name === "primary_span") {
      report_error_if_not_applied_to_span(errs, attr, at, info);
      return [{ k: "call", method: "span", args: [binding] }];
    }
    if (meta === "Path" && name === "context") {
      report_error_if_not_applied_to_span(errs, attr, at, info);
      return [{ k: "call", method: "span_context", args: [binding] }];
    }
    if (meta === "Path" && name === "subdiagnostic") {
      return [{ k: "subdiagnostic", value: binding, ty: info.ty.inner_type() }];
    }

    const parsed = this.parse_subdiag_attribute(attr, at);
    if (parsed === undefined) {
      // Some attributes aren't errors - like documentation comments - but also aren't
      // subdiagnostics.
      return [];
    }
    const [subdiag, message] = parsed;
    const fn_ident = SubdiagnosticKind_fmt(subdiag);
    switch (subdiag.$) {
      case "Label":
        report_error_if_not_applied_to_span(errs, attr, at, info);
        return this.add_spanned_subdiagnostic(binding, fn_ident, message);
      case "Note":
      case "NoteOnce":
      case "Help":
      case "HelpOnce":
      case "Warn": {
        const inner = info.ty.inner_type();
        if (type_matches_path(inner, ["rustc_span", "Span"]) || type_matches_path(inner, ["rustc_span", "MultiSpan"])) {
          return this.add_spanned_subdiagnostic(binding, fn_ident, message);
        } else if (type_is_unit(inner) || (info.ty.kind === "Plain" && type_is_bool(inner))) {
          return this.add_subdiagnostic(fn_ident, message);
        } else {
          return report_type_error(errs, attr, at, "`Span`, `MultiSpan`, `bool` or `()`");
        }
      }
      case "Suggestion": {
        if (info.ty.kind === "Vec") {
          throw_invalid_attr(
            errs,
            attr,
            at,
            "note: `#[suggestion(...)]` applied to `Vec` field is ambiguous",
            "help: to show a suggestion consisting of multiple parts, use a `Subdiagnostic` annotated with `#[multipart_suggestion(...)]`",
            "help: to show a variable set of suggestions, use a `Vec` of `Subdiagnostic`s annotated with `#[suggestion(...)]`",
          );
        }
        const [span_field, applicability0] = this.span_and_applicability_of_ty(info);
        const applicability = { v: applicability0 };
        if (subdiag.applicability !== undefined) {
          const [static_applicability, span] = subdiag.applicability;
          set_once(errs, applicability, { k: "applicability", v: static_applicability } as Expr, span);
        }
        const msg = message.diag_message(errs);
        const appl: Expr = value_of(applicability.v) ?? { k: "applicability", v: "Unspecified" };
        const style = to_suggestion_style(subdiag.suggestion_kind);
        this.formatting_init.push(...subdiag.code_init);
        return [{ k: "call", method: "span_suggestions_with_style", args: [span_field, msg, { k: "local", name: subdiag.code_field }, appl, style] }];
      }
      case "MultipartSuggestion":
        throw new Error("internal error: entered unreachable code");
    }
  }

  /// Adds a spanned subdiagnostic by generating a `diag.span_$kind` call with the current message
  /// and `fluent_attr_identifier`.
  // rustc_macros: diagnostics/diagnostic_builder.rs:439 add_spanned_subdiagnostic
  add_spanned_subdiagnostic(field_binding: Expr, kind: string, message: Message): Stmt[] {
    const fn_name = `span_${kind}`;
    const msg = message.diag_message(this.st.errs);
    return [{ k: "call", method: fn_name, args: [field_binding, msg] }];
  }

  /// Adds a subdiagnostic by generating a `diag.span_$kind` call with the current message
  /// and `fluent_attr_identifier`.
  // rustc_macros: diagnostics/diagnostic_builder.rs:457 add_subdiagnostic
  add_subdiagnostic(kind: string, message: Message): Stmt[] {
    const msg = message.diag_message(this.st.errs);
    return [{ k: "call", method: kind, args: [msg] }];
  }

  // rustc_macros: diagnostics/diagnostic_builder.rs:464 span_and_applicability_of_ty
  span_and_applicability_of_ty(info: FieldInfo): [Expr, SpannedOption<Expr>] {
    const errs = this.st.errs;
    const ty = info.ty.inner_type();
    const binding: Expr = { k: "binding", name: info.binding.binding };
    // If `ty` is `Span` w/out applicability, then use `Applicability::Unspecified`.
    if (ty.kind === "path" && type_matches_path(ty, ["rustc_span", "Span"])) return [binding, undefined];
    // If `ty` is `(Span, Applicability)` then return tokens accessing those.
    if (ty.kind === "tuple") {
      const span_idx = { v: undefined as SpannedOption<number> };
      const applicability_idx = { v: undefined as SpannedOption<number> };
      // rustc_macros: diagnostics/diagnostic_builder.rs:479 type_err
      const type_err = (span: Span): never =>
        throw_span_err(errs, span, "wrong types for suggestion", "`#[suggestion(...)]` on a tuple field must be applied to fields of type `(Span, Applicability)`");
      ty.elems!.forEach((elem, idx) => {
        if (type_matches_path(elem, ["rustc_span", "Span"])) set_once(errs, span_idx, idx, info.span);
        else if (type_matches_path(elem, ["rustc_errors", "Applicability"])) set_once(errs, applicability_idx, idx, info.span);
        else type_err(info.span);
      });
      if (span_idx.v === undefined) type_err(info.span);
      if (applicability_idx.v === undefined) type_err(info.span);
      const [si] = span_idx.v!;
      const [ai, applicability_span] = applicability_idx.v!;
      return [
        { k: "tuple_field", base: binding, idx: si },
        [{ k: "tuple_field", base: binding, idx: ai }, applicability_span],
      ];
    }
    // If `ty` isn't a `Span` or `(Span, Applicability)` then emit an error.
    throw_span_err(errs, info.span, "wrong field type for suggestion", "`#[suggestion(...)]` should be applied to fields of type `Span` or `(Span, Applicability)`");
  }
}

// rustc_macros: diagnostics/diagnostic_builder.rs:23 each_variant
// rustc_macros: diagnostics/diagnostic.rs:20 into_tokens
/** `#[derive(Diagnostic)]` of `item`: `DiagnosticDerive::new(s).into_tokens()`. */
export function diagnostic_derive(item: PItem, file: string, errs: DiagErrors, state?: { code_ident_count: number }): DeriveImpl {
  const st: GenState = { errs, code_ident_count: state?.code_ident_count ?? 0, file };
  const at = `${file}:${item.line}`;
  if (item.kind === "union") span_err(errs, at, "diagnostic derives can only be used on structs and enums");
  if (item.kind === "enum") {
    for (const attr of (item.attrs as DAttr[]).filter((a) => a.path !== "derive")) span_err(errs, attrSpan(attr, at), "unsupported type attribute for diagnostic derive enum");
    for (const _ of item.docs ?? []) span_err(errs, at, "unsupported type attribute for diagnostic derive enum");
  }
  const arms: Arm[] = [];
  for (const variant of variantsOf(item)) {
    // There isn't a good way to get the span of the variant, so the variant's name will need to do.
    const span = item.kind === "struct" ? at : `${file}:${variant.line}`;
    const builder = new DiagnosticDeriveVariantBuilder(st, span, build_field_mapping(variant));
    // DiagnosticDerive::into_tokens closure
    const preamble = builder.preamble(variant);
    const body = builder.body(variant);
    const message = builder.primary_message();
    if (message === undefined) {
      arms.push(armOf(variant, [{ k: "unreachable" }]));
      continue;
    }
    const msg = message.diag_message(errs);
    const init: Stmt = { k: "diag_new", msg };
    arms.push(armOf(variant, [init, ...builder.formatting_init, ...preamble, ...body]));
  }
  if (state) state.code_ident_count = st.code_ident_count;
  return { kind: "Diagnostic", item: item.name, line: item.line, arms };
}

// ---- subdiagnostic.rs ---------------------------------------------------------------------------------------

/// Provides frequently-needed information about the diagnostic kinds being derived for this type.
interface KindsStatistics {
  has_multipart_suggestion: boolean;
  all_multipart_suggestions: boolean;
  has_normal_suggestion: boolean;
  all_applicabilities_static: boolean;
}

// rustc_macros: diagnostics/subdiagnostic.rs:157 from_iter
function KindsStatistics_from_iter(kinds: Iterable<SubdiagnosticKind>): KindsStatistics {
  const ret: KindsStatistics = {
    has_multipart_suggestion: false,
    all_multipart_suggestions: true,
    has_normal_suggestion: false,
    all_applicabilities_static: true,
  };
  for (const kind of kinds) {
    if ((kind.$ === "MultipartSuggestion" || kind.$ === "Suggestion") && kind.applicability === undefined) ret.all_applicabilities_static = false;
    if (kind.$ === "MultipartSuggestion") ret.has_multipart_suggestion = true;
    else ret.all_multipart_suggestions = false;
    if (kind.$ === "Suggestion") ret.has_normal_suggestion = true;
  }
  return ret;
}

/// Tracks persistent information required for building up the call to add to the diagnostic
/// for the final generated method.
class SubdiagnosticDeriveVariantBuilder {
  /// Initialization of format strings for code suggestions.
  formatting_init: Stmt[] = [];
  /// Store a map of field name to its corresponding field.
  readonly fields: FieldMap;
  /// Identifier for the binding to the `#[primary_span]` field.
  span_field: { v: SpannedOption<string> } = { v: undefined };
  /// The binding to the `#[applicability]` field, if present.
  applicability: { v: SpannedOption<Expr> } = { v: undefined };
  /// Set to true when a `#[suggestion_part]` field is encountered.
  has_suggestion_parts = false;
  /// Set to true when a `#[subdiagnostic]` field is encountered.
  has_subdiagnostic = false;

  constructor(
    readonly st: GenState,
    /// Info for the current variant (or the type if not an enum).
    readonly variant: VariantInfo,
    /// Span for the entire type.
    readonly span: Span,
    /// Set to true when this variant is an enum variant rather than just the body of a struct.
    readonly is_enum: boolean,
    readonly used_fields: Set<string>,
  ) {
    this.fields = build_field_mapping(variant);
  }

  // rustc_macros: diagnostics/subdiagnostic.rs:186 identify_kind
  identify_kind(): [SubdiagnosticKind, Message][] {
    const kind_messages: [SubdiagnosticKind, Message][] = [];
    const at = `${this.st.file}:${this.variant.line}`;
    for (const attr of this.variant.attrs) {
      const r = SubdiagnosticVariant_from_attr(this.st, attr, at, this.fields, this.used_fields);
      if (r === undefined) {
        // Some attributes aren't errors - like documentation comments - but also aren't
        // subdiagnostics.
        continue;
      }
      const { kind, message } = r;
      if (message === undefined) {
        const name = attrName(attr);
        throw_span_err(this.st.errs, attrSpan(attr, at), `diagnostic message must be first argument of a \`#[${name}(...)]\` attribute`);
      }
      kind_messages.push([kind, message]);
    }
    return kind_messages;
  }

  /// Generates the code for a field with no attributes.
  // rustc_macros: diagnostics/subdiagnostic.rs:219 generate_field_arg
  generate_field_arg(binding_info: BindingInfo): Stmt[] {
    const field = binding_info.field;
    const ident = field.name;
    if (ident === null) throw new Error("called `Option::unwrap()` on a `None` value");
    // strip `r#` prefix, if present
    return [{ k: "sub_arg", name: unraw(ident), value: { k: "binding", name: binding_info.binding }, ty: field.ty }];
  }

  /// Generates the necessary code for all attributes on a field.
  // rustc_macros: diagnostics/subdiagnostic.rs:238 generate_field_attr_code
  generate_field_attr_code(binding: BindingInfo, kind_stats: KindsStatistics): Stmt[] {
    const ast = binding.field;
    if (!(ast.attrs.length > 0)) throw new Error("field without attributes generating attr code");
    // Abstract over `Vec<T>` and `Option<T>` fields using `FieldInnerTy`, which will
    // apply the generated code on each element in the `Vec` or `Option`.
    const inner_ty = FieldInnerTy.from_type(ast.ty);
    const out: Stmt[] = [];
    const at = `${this.st.file}:${ast.line}`;
    for (const attr of ast.attrs as DAttr[]) {
      // Always allow documentation comments.
      if (is_doc_comment(attr)) continue;
      const info: FieldInfo = { binding, ty: inner_ty, span: at };
      let generated: Stmt[];
      try {
        generated = this.generate_field_code_inner(kind_stats, attr, at, info, inner_ty.will_iterate());
      } catch (e) {
        if (e instanceof SynError) {
          this.st.errs.error(`derive(Diagnostic): ${e.message}`);
          generated = [{ k: "unreachable" }];
        } else if (e instanceof DiagnosticDeriveError) generated = [{ k: "unreachable" }];
        else throw e;
      }
      out.push(...inner_ty.with(binding.binding, generated));
    }
    return out;
  }

  // rustc_macros: diagnostics/subdiagnostic.rs:268 generate_field_code_inner
  generate_field_code_inner(kind_stats: KindsStatistics, attr: DAttr, at: string, info: FieldInfo, clone_suggestion_code: boolean): Stmt[] {
    switch (metaKind(attr)) {
      case "Path":
        return this.generate_field_code_inner_path(kind_stats, attr, at, info);
      case "List":
        return this.generate_field_code_inner_list(kind_stats, attr, at, info, clone_suggestion_code);
      default:
        throw_invalid_attr(this.st.errs, attr, at);
    }
  }

  /// Generates the code for a `[Meta::Path]`-like attribute on a field (e.g. `#[primary_span]`).
  // rustc_macros: diagnostics/subdiagnostic.rs:291 generate_field_code_inner_path
  generate_field_code_inner_path(kind_stats: KindsStatistics, attr: DAttr, at: string, info: FieldInfo): Stmt[] {
    const errs = this.st.errs;
    const span = attrSpan(attr, at);
    const name = attrName(attr);
    switch (name) {
      case "primary_span": {
        if (kind_stats.has_multipart_suggestion) {
          invalid_attr(errs, attr, at, "help: multipart suggestions use one or more `#[suggestion_part]`s rather than one `#[primary_span]`");
        } else {
          report_error_if_not_applied_to_span(errs, attr, at, info);
          const binding = info.binding.binding;
          // FIXME(#100717): support `Option<Span>` on `primary_span` like in the
          // diagnostic derive
          if (!(info.ty.kind === "Plain" || info.ty.kind === "Option")) {
            throw_invalid_attr(
              errs,
              attr,
              at,
              "note: there must be exactly one primary span",
              ...(kind_stats.has_normal_suggestion ? ["help: to create a suggestion with multiple spans, use `#[multipart_suggestion]` instead"] : []),
            );
          }
          set_once(errs, this.span_field, binding, span);
        }
        return [];
      }
      case "suggestion_part": {
        this.has_suggestion_parts = true;
        if (kind_stats.has_multipart_suggestion) {
          span_err(errs, span, '`#[suggestion_part(...)]` attribute without `code = "..."`');
        } else {
          invalid_attr(errs, attr, at, "help: `#[suggestion_part(...)]` is only valid in multipart suggestions, use `#[primary_span]` instead");
        }
        return [];
      }
      case "applicability": {
        if (kind_stats.has_multipart_suggestion || kind_stats.has_normal_suggestion) {
          report_error_if_not_applied_to_applicability(errs, attr, at, info);
          if (kind_stats.all_applicabilities_static) {
            span_err(
              errs,
              span,
              '`#[applicability]` has no effect if all `#[suggestion]`/`#[multipart_suggestion]` attributes have a static `applicability = "..."`',
            );
          }
          const binding = info.binding.binding;
          set_once(errs, this.applicability, { k: "binding", name: binding } as Expr, span);
        } else {
          span_err(errs, span, "`#[applicability]` is only valid on suggestions");
        }
        return [];
      }
      case "subdiagnostic": {
        const binding = info.binding.binding;
        this.has_subdiagnostic = true;
        return [{ k: "add_to_diag", value: { k: "binding", name: binding }, ty: info.ty.inner_type() }];
      }
      default: {
        const span_attrs: string[] = [];
        if (kind_stats.has_multipart_suggestion) span_attrs.push("suggestion_part");
        if (!kind_stats.all_multipart_suggestions) span_attrs.push("primary_span");
        invalid_attr(errs, attr, at, `help: only \`${span_attrs.join(", ")}\`, \`applicability\` is a valid field attribute`);
        return [];
      }
    }
  }

  /// Generates the code for a `[Meta::List]`-like attribute on a field (e.g.
  /// `#[suggestion_part(code = "...")]`).
  // rustc_macros: diagnostics/subdiagnostic.rs:405 generate_field_code_inner_list
  generate_field_code_inner_list(kind_stats: KindsStatistics, attr: DAttr, at: string, info: FieldInfo, clone_suggestion_code: boolean): Stmt[] {
    const errs = this.st.errs;
    const span = attrSpan(attr, at);
    const name = attrName(attr);
    switch (name) {
      case "suggestion_part": {
        if (!kind_stats.has_multipart_suggestion) throw_invalid_attr(errs, attr, at, "help: `#[suggestion_part(...)]` is only valid in multipart suggestions");
        this.has_suggestion_parts = true;
        report_error_if_not_applied_to_span(errs, attr, at, info);

        const code = { v: undefined as SpannedOption<[string, Stmt[]]> };
        parse_args_with(attr, at, (input) => {
          while (!input.is_empty()) {
            const arg_name = input.parse_ident();
            switch (arg_name.name) {
              case "code": {
                const code_field = new_code_ident(this.st);
                const formatting_init = build_suggestion_code(errs, code_field, input, this.fields, "No");
                set_once(errs, code, [code_field, formatting_init], arg_name.span);
                break;
              }
              default:
                span_err(errs, arg_name.span, "`code` is the only valid nested attribute");
            }
            if (input.is_empty()) break;
            input.parse_punct(",");
          }
        });
        const c = value_of(code.v);
        if (c === undefined) {
          span_err(errs, span, '`#[suggestion_part(...)]` attribute without `code = "..."`');
          return [];
        }
        const [code_field, formatting_init] = c;
        const binding = info.binding;
        this.formatting_init.push(...formatting_init);
        const code_expr: Expr = clone_suggestion_code ? { k: "clone", e: { k: "local", name: code_field } } : { k: "local", name: code_field };
        return [{ k: "push_suggestion", span: { k: "binding", name: binding.binding }, code: code_expr }];
      }
      default: {
        const span_attrs: string[] = [];
        if (kind_stats.has_multipart_suggestion) span_attrs.push("suggestion_part");
        if (!kind_stats.all_multipart_suggestions) span_attrs.push("primary_span");
        throw_invalid_attr(errs, attr, at, `help: only \`${span_attrs.join(", ")}\`, \`applicability\` is a valid field attribute`);
      }
    }
  }

  /**
   * `applicability.value().map(|a| quote! { #a }).or_else(|| self.applicability.take().value())
   * .unwrap_or_else(|| quote! { rustc_errors::Applicability::Unspecified })`
   */
  private applicability_of(static_: SpannedOption<Applicability>): Expr {
    const a = value_of(static_);
    if (a !== undefined) return { k: "applicability", v: a };
    const taken = this.applicability.v;
    this.applicability.v = undefined;
    return value_of(taken) ?? { k: "applicability", v: "Unspecified" };
  }

  // rustc_macros: diagnostics/subdiagnostic.rs:499 is_used_in_message
  is_used_in_message(binding: BindingInfo): boolean {
    return binding.field.name !== null && this.used_fields.has(binding.field.name);
  }

  // rustc_macros: diagnostics/subdiagnostic.rs:503 into_tokens
  into_tokens(): Stmt[] {
    const kind_messages = this.identify_kind();
    const kind_stats = KindsStatistics_from_iter(kind_messages.map(([kind]) => kind));
    const init: Stmt[] = kind_stats.has_multipart_suggestion ? [{ k: "suggestions_new" }] : [];

    const attr_args: Stmt[] = [];
    for (const binding of this.variant.bindings.filter((b) => !should_generate_arg(b.field))) {
      attr_args.push(...this.generate_field_attr_code(binding, kind_stats));
    }

    if (kind_messages.length === 0 && !this.has_subdiagnostic) {
      if (this.is_enum) {
        // It's okay for a variant to not be a subdiagnostic at all..
        return [];
      } else {
        // ..but structs should always be _something_.
        throw_span_err(this.st.errs, `${this.st.file}:${this.variant.line}`, "subdiagnostic kind not specified");
      }
    }

    const plain_args: Stmt[] = [{ k: "sub_args_new" }];
    for (const binding of this.variant.bindings) {
      if (should_generate_arg(binding.field) && this.is_used_in_message(binding)) plain_args.push(...this.generate_field_arg(binding));
    }

    const span_field = value_of(this.span_field.v);
    const calls: Stmt[] = [];
    for (const [kind, messages] of kind_messages) {
      const message = "__message";
      const message_stream = messages.diag_message(this.st.errs);
      calls.push({ k: "let", name: message, value: { k: "format_diag_message", msg: message_stream } });

      const name = `${span_field !== undefined ? "span_" : ""}${SubdiagnosticKind_fmt(kind)}`;
      const msg: Expr = { k: "local", name: message };
      let call: Stmt[];
      switch (kind.$) {
        case "Suggestion": {
          this.formatting_init.push(...kind.code_init);
          const applicability = this.applicability_of(kind.applicability);
          if (span_field !== undefined) {
            const style = to_suggestion_style(kind.suggestion_kind);
            call = [{ k: "call", method: name, args: [{ k: "binding", name: span_field }, msg, { k: "local", name: kind.code_field }, applicability, style] }];
          } else {
            span_err(this.st.errs, this.span, "suggestion without `#[primary_span]` field");
            call = [{ k: "unreachable" }];
          }
          break;
        }
        case "MultipartSuggestion": {
          const applicability = this.applicability_of(kind.applicability);
          if (!this.has_suggestion_parts) span_err(this.st.errs, this.span, "multipart suggestion without any `#[suggestion_part(...)]` fields");
          const style = to_suggestion_style(kind.suggestion_kind);
          call = [{ k: "call", method: name, args: [msg, { k: "local", name: "suggestions" }, applicability, style] }];
          break;
        }
        case "Label":
          if (span_field !== undefined) call = [{ k: "call", method: name, args: [{ k: "binding", name: span_field }, msg] }];
          else {
            span_err(this.st.errs, this.span, "label without `#[primary_span]` field");
            call = [{ k: "unreachable" }];
          }
          break;
        default:
          if (span_field !== undefined) call = [{ k: "call", method: name, args: [{ k: "binding", name: span_field }, msg] }];
          else call = [{ k: "call", method: name, args: [msg] }];
      }
      calls.push(...call);
    }

    // For #[derive(Subdiagnostic)]
    //
    // - Store args of the main diagnostic for later restore.
    // - Add args of subdiagnostic.
    // - Generate the calls, such as note, label, etc.
    // - Restore the arguments for allowing main and subdiagnostic share the same fields.
    return [...init, ...this.formatting_init, ...attr_args, ...plain_args, ...calls];
  }
}

// rustc_macros: diagnostics/subdiagnostic.rs:35 into_tokens
/** `#[derive(Subdiagnostic)]` of `item`: `SubdiagnosticDerive::new().into_tokens(s)`. */
export function subdiagnostic_derive(item: PItem, file: string, errs: DiagErrors, state?: { code_ident_count: number }): DeriveImpl {
  const st: GenState = { errs, code_ident_count: state?.code_ident_count ?? 0, file };
  const span = `${file}:${item.line}`;
  if (item.kind === "union") span_err(errs, span, "`#[derive(Subdiagnostic)]` can only be used on structs and enums");
  const is_enum = item.kind === "enum";
  if (is_enum) {
    for (const attr of (item.attrs as DAttr[]).filter((a) => a.path !== "derive")) {
      // Always allow documentation comments.
      if (is_doc_comment(attr)) continue;
      span_err(errs, attrSpan(attr, span), "unsupported type attribute for subdiagnostic enum");
    }
  }
  const used_fields = new Set<string>();
  const arms: Arm[] = [];
  for (const variant of variantsOf(item)) {
    const builder = new SubdiagnosticDeriveVariantBuilder(st, variant, span, is_enum, used_fields);
    let body: Stmt[];
    try {
      body = builder.into_tokens();
    } catch (e) {
      if (e instanceof SynError) {
        errs.error(`derive(Subdiagnostic): ${e.message}`);
        body = [{ k: "unreachable" }];
      } else if (e instanceof DiagnosticDeriveError) body = [{ k: "unreachable" }];
      else throw e;
    }
    arms.push(armOf(variant, body));
  }
  if (state) state.code_ident_count = st.code_ident_count;
  return { kind: "Subdiagnostic", item: item.name, line: item.line, arms };
}

// ---- Rust format strings --------------------------------------------------------------------------------------

/** A parsed `format!` template: literal text and `{name}` arguments (no format specs). */
export type FmtPiece = { lit: string } | { arg: string; spec: string };

/**
 * Parse a Rust format string (std::fmt syntax) into pieces. Only `{{`, `}}`, `{name}`, `{N}` and
 * `{name:spec}` are recognised; the caller decides which specs it supports.
 */
export function parseFormatString(s: string): FmtPiece[] | string {
  const out: FmtPiece[] = [];
  let lit = "";
  for (let i = 0; i < s.length; ) {
    const c = s[i]!;
    if (c === "{") {
      if (s[i + 1] === "{") {
        lit += "{";
        i += 2;
        continue;
      }
      const j = s.indexOf("}", i);
      if (j < 0) return `unterminated format argument in ${JSON.stringify(s)}`;
      const inner = s.slice(i + 1, j);
      const colon = inner.indexOf(":");
      const arg = (colon < 0 ? inner : inner.slice(0, colon)).trim();
      const spec = colon < 0 ? "" : inner.slice(colon + 1);
      if (lit) out.push({ lit });
      lit = "";
      out.push({ arg, spec });
      i = j + 1;
    } else if (c === "}") {
      if (s[i + 1] !== "}") return `unmatched \`}\` in format string ${JSON.stringify(s)}`;
      lit += "}";
      i += 2;
    } else {
      lit += c;
      i++;
    }
  }
  if (lit) out.push({ lit });
  return out;
}

// ---- Rust renderer (verification against the real expansion) ---------------------------------------------

/** Rust string literal (escape_debug-like; only the value matters to the comparison). */
export function rustStr(s: string): string {
  let out = '"';
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (ch === '"') out += '\\"';
    else if (ch === "\\") out += "\\\\";
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (ch === "\t") out += "\\t";
    else if (c === 0) out += "\\0";
    else if (c < 0x20 || c === 0x7f) out += `\\u{${c.toString(16)}}`;
    else out += ch;
  }
  return out + '"';
}

function rustExpr(e: Expr): string {
  switch (e.k) {
    case "binding":
      return e.name;
    case "tuple_field":
      return `${rustExpr(e.base)}.${e.idx}`;
    case "clone":
      return `${rustExpr(e.e)}.clone()`;
    case "msg":
      return `rustc_errors::DiagMessage::Inline(std::borrow::Cow::Borrowed(${rustStr(e.value)}))`;
    case "local":
      return e.name;
    case "applicability":
      return `rustc_errors::Applicability::${e.v}`;
    case "style":
      return `rustc_errors::SuggestionStyle::${e.v}`;
    case "code_expr":
      return e.toks.map((t) => t.v).join("");
    case "format":
      return `format!(${[rustStr(e.input), ...e.args.map((a) => `${a.name} = ${rustExpr(a.value)}`)].join(", ")})`;
    case "array_iter":
      return `[${e.elems.map(rustExpr).join(", ")}].into_iter()`;
    case "string_new":
      return "String::new()";
    case "iter_empty":
      return "std::iter::empty()";
    case "format_diag_message":
      return `rustc_errors::format_diag_message(&${rustExpr(e.msg)}, &sub_args)`;
  }
}

function rustStmts(stmts: Stmt[], ind: string): string[] {
  const out: string[] = [];
  for (const s of stmts) {
    switch (s.k) {
      case "diag_new":
        out.push(`${ind}let mut diag = rustc_errors::Diag::new(dcx, level, ${rustExpr(s.msg)});`);
        break;
      case "empty":
        out.push(`${ind};`);
        break;
      case "call":
        out.push(`${ind}diag.${s.method}(${s.args.map(rustExpr).join(", ")});`);
        break;
      case "arg":
        out.push(`${ind}diag.arg(${rustStr(s.name)}, ${rustExpr(s.value)});`);
        break;
      case "let":
        out.push(`${ind}let ${s.mut ? "mut " : ""}${s.name} = ${rustExpr(s.value)};`);
        break;
      case "if_some":
        out.push(`${ind}if let Some(${s.binding}) = ${s.binding} {`, ...rustStmts(s.body, ind + "    "), `${ind}}`);
        break;
      case "for_in":
        out.push(`${ind}for ${s.binding} in ${s.binding} {`, ...rustStmts(s.body, ind + "    "), `${ind}}`);
        break;
      case "if":
        out.push(`${ind}if ${s.binding} {`, ...rustStmts(s.body, ind + "    "), `${ind}}`);
        break;
      case "suggestions_new":
        out.push(`${ind}let mut suggestions = Vec::new();`);
        break;
      case "push_suggestion":
        out.push(`${ind}suggestions.push((${rustExpr(s.span)}, ${rustExpr(s.code)}));`);
        break;
      case "sub_args_new":
        out.push(`${ind}let mut sub_args = rustc_errors::DiagArgMap::default();`);
        break;
      case "sub_arg":
        out.push(`${ind}sub_args.insert(${rustStr(s.name)}.into(), rustc_errors::IntoDiagArg::into_diag_arg(${rustExpr(s.value)}, &mut diag.long_ty_path));`);
        break;
      case "add_to_diag":
        out.push(`${ind}${rustExpr(s.value)}.add_to_diag(diag);`);
        break;
      case "subdiagnostic":
        out.push(`${ind}diag.subdiagnostic(${rustExpr(s.value)});`);
        break;
      case "unreachable":
        out.push(`${ind}{ unreachable!(); }`);
        break;
    }
  }
  return out;
}

/** The `match self` arms of the expansion, as Rust text (`Pat => { body }` per arm). */
export function renderRust(d: DeriveImpl): { pat: string; body: string }[] {
  return d.arms.map((arm) => {
    const path = arm.variant === undefined ? d.item : `${d.item}::${arm.variant}`;
    let pat: string;
    if (arm.style === "named") pat = `${path} { ${arm.bindings.map((b) => `${b.field}: ${b.binding}`).join(", ")} }`;
    else if (arm.style === "unnamed") pat = `${path}(${arm.bindings.map((b) => b.binding).join(", ")})`;
    else pat = path;
    const body = rustStmts(arm.body, "");
    if (d.kind === "Diagnostic" && !arm.body.some((s) => s.k === "unreachable")) body.push("diag");
    return { pat, body: body.join("\n") };
  });
}

// ---- TS renderer -------------------------------------------------------------------------------------------------

/** Type-dependent parts of the TS output, provided by the type generator (types.ts). */
export interface DiagTsCtx {
  /** local name of a value/type imported from a repo module (`src/...`) */
  use(module: string, name: string, kind: "type" | "value"): string;
  /** expression of a `(self: T, path) => DiagArgValue` function: the `IntoDiagArg` impl of `ty` */
  intoDiagArg(ty: PType, at: string): string;
  /** TS expression for `format!("{}", v)` (Display) of a value of type `ty` */
  display(ty: PType, v: string, at: string): string;
  /** `Subdiagnostic` impl of `ty`: `<T>_add_to_diag` / `<T>_subdiagnostic` function names */
  subdiagnosticFns(ty: PType, at: string): { add_to_diag: string; subdiagnostic: string };
  /** TS expression of an error code expression (`code = E0178`) */
  errCode(toks: Tok[], at: string): string;
  /** whether the TS type of `ty` can itself be `undefined` (Option<undefined-able> rule) */
  nullable(ty: PType): boolean;
  /** TS type text of `ty` */
  tsType(ty: PType, at: string): string;
  error(msg: string): void;
}

const ERRORS = "src/rustc_errors/lib.ts";

/** TS of one derive: the impl function(s) for `item` (generated into the item's .gen.ts). */
export function renderTs(d: DeriveImpl, ctx: DiagTsCtx, file: string, selfType: string, repr: "struct" | "data" | "fieldless"): string[] {
  const isEnum = repr !== "struct";
  const at = `${file}:${d.line}`;
  const name = d.item;
  const out: string[] = [];
  const Diag = ctx.use(ERRORS, "Diag", "value");
  const lines = (arm: Arm, ind: string): string[] => {
    const env = new Map<string, string>(arm.bindings.map((b) => [b.binding, b.binding]));
    const tys = new Map<string, PType>(arm.bindings.map((b) => [b.binding, b.ty]));
    const body: string[] = [];
    if (arm.bindings.length) {
      const fieldKey = (f: string) => (arm.style === "unnamed" ? `_${f}` : unraw(f));
      body.push(`${ind}const { ${arm.bindings.map((b) => `${fieldKey(b.field)}: ${b.binding}`).join(", ")} } = self;`);
    }
    body.push(...tsStmts(arm.body, ind, env, tys, ctx, at, { declared: new Set() }));
    if (d.kind === "Diagnostic" && !arm.body.some((s) => s.k === "unreachable")) body.push(`${ind}return diag;`);
    return body;
  };
  const switchArms = (ind: string): string[] => {
    const o: string[] = [`${ind}switch (${repr === "fieldless" ? "self" : "self.$"}) {`];
    for (const arm of d.arms) {
      o.push(`${ind}  case ${JSON.stringify(unraw(arm.variant!))}: {`, ...lines(arm, ind + "    "));
      if (d.kind === "Subdiagnostic") o.push(`${ind}    return;`);
      o.push(`${ind}  }`);
    }
    o.push(`${ind}}`);
    return o;
  };
  if (d.kind === "Diagnostic") {
    const DiagCtxtHandle = ctx.use(ERRORS, "DiagCtxtHandle", "type");
    const Level = ctx.use(ERRORS, "Level", "type");
    const Diagnostic = ctx.use(ERRORS, "Diagnostic", "type");
    out.push(`/** \`#[derive(Diagnostic)]\`: \`impl<'_sess> Diagnostic<'_sess> for ${name}\` */`);
    out.push(`// rustc-derive: ${at} Diagnostic ${name}`);
    out.push(`export function ${name}_into_diag(self: ${selfType}, dcx: ${DiagCtxtHandle}, level: ${Level}): ${Diag} {`);
    out.push(...(isEnum ? switchArms("  ") : lines(d.arms[0]!, "  ")));
    out.push("}");
    out.push(`/** \`${name}\` as a \`Diagnostic\` trait object. */`);
    out.push(`export function ${name}_diagnostic(self: ${selfType}): ${Diagnostic} {`);
    out.push(`  return { into_diag: (dcx, level) => ${name}_into_diag(self, dcx, level) };`);
    out.push("}");
  } else {
    const Subdiagnostic = ctx.use(ERRORS, "Subdiagnostic", "type");
    out.push(`/** \`#[derive(Subdiagnostic)]\`: \`impl Subdiagnostic for ${name}\` */`);
    out.push(`// rustc-derive: ${at} Subdiagnostic ${name}`);
    out.push(`export function ${name}_add_to_diag(self: ${selfType}, diag: ${Diag}): void {`);
    out.push(...(isEnum ? switchArms("  ") : lines(d.arms[0]!, "  ")));
    out.push("}");
    out.push(`/** \`${name}\` as a \`Subdiagnostic\` trait object. */`);
    out.push(`export function ${name}_subdiagnostic(self: ${selfType}): ${Subdiagnostic} {`);
    out.push(`  return { add_to_diag: (diag) => ${name}_add_to_diag(self, diag) };`);
    out.push("}");
  }
  return out;
}

function tsExpr(e: Expr, env: Map<string, string>, tys: Map<string, PType>, ctx: DiagTsCtx, at: string): string {
  switch (e.k) {
    case "binding":
      return env.get(e.name) ?? e.name;
    case "tuple_field":
      return `${tsExpr(e.base, env, tys, ctx, at)}[${e.idx}]`;
    case "clone":
      // `Vec<Span>::clone` (primary_span) / `String::clone` (suggestion code): a copy of the array,
      // strings are values
      return e.e.k === "local" ? tsExpr(e.e, env, tys, ctx, at) : `${tsExpr(e.e, env, tys, ctx, at)}.slice()`;
    case "msg":
      return `{ $: "Inline", _0: ${JSON.stringify(e.value)} }`;
    case "local":
      return e.name;
    case "applicability":
    case "style":
      return JSON.stringify(e.v);
    case "code_expr":
      return ctx.errCode(e.toks, e.at);
    case "format": {
      const pieces = parseFormatString(e.input);
      if (typeof pieces === "string") {
        ctx.error(`${e.at}: format!: ${pieces}`);
        return `unported_format(${JSON.stringify(e.input)})`;
      }
      if (pieces.length === 0) return '""';
      const parts = pieces.map((p) => {
        if ("lit" in p) return JSON.stringify(p.lit);
        const a = e.args.find((x) => x.name === p.arg);
        if (!a || !a.ty || p.spec !== "") {
          ctx.error(`${e.at}: format!: unsupported argument {${p.arg}${p.spec ? ":" + p.spec : ""}} in ${JSON.stringify(e.input)}`);
          return `unported_format(${JSON.stringify(e.input)})`;
        }
        return ctx.display(a.ty, tsExpr(a.value, env, tys, ctx, at), e.at);
      });
      return parts.join(" + ");
    }
    case "array_iter":
      return `[${e.elems.map((x) => tsExpr(x, env, tys, ctx, at)).join(", ")}]`;
    case "string_new":
      return '""';
    case "iter_empty":
      return "[]";
    case "format_diag_message":
      return `${ctx.use(ERRORS, "format_diag_message", "value")}(${tsExpr(e.msg, env, tys, ctx, at)}, sub_args)`;
  }
}

function tsStmts(
  stmts: Stmt[],
  ind: string,
  env: Map<string, string>,
  tys: Map<string, PType>,
  ctx: DiagTsCtx,
  at: string,
  scope: { declared: Set<string> },
): string[] {
  const out: string[] = [];
  const x = (e: Expr) => tsExpr(e, env, tys, ctx, at);
  const decl = (name: string) => {
    if (scope.declared.has(name)) return `${name} =`;
    scope.declared.add(name);
    return `let ${name} =`;
  };
  for (const s of stmts) {
    switch (s.k) {
      case "diag_new":
        out.push(`${ind}const diag = ${ctx.use(ERRORS, "Diag", "value")}.new(dcx, level, ${x(s.msg)});`);
        break;
      case "empty":
        break;
      case "call":
        out.push(`${ind}diag.${s.method}(${s.args.map(x).join(", ")});`);
        break;
      case "arg":
        out.push(`${ind}diag.arg(${JSON.stringify(s.name)}, ${ctx.use(ERRORS, "IntoDiagArg", "value")}.of(${x(s.value)}, ${ctx.intoDiagArg(s.ty, at)}));`);
        break;
      case "let":
        out.push(`${ind}${decl(s.name)} ${x(s.value)};`);
        break;
      case "if_some":
      case "for_in":
      case "if": {
        const outer = env.get(s.binding) ?? s.binding;
        const inner = FieldInnerTy.from_type(s.outer).inner_type();
        const env2 = new Map(env);
        const tys2 = new Map(tys);
        tys2.set(s.binding, inner);
        const head: string[] = [];
        if (s.k === "if_some") {
          head.push(`${ind}if (${outer} !== undefined) {`);
          if (ctx.nullable(inner)) {
            env2.set(s.binding, `${s.binding}_some`);
            head.push(`${ind}  const ${s.binding}_some = ${outer}._0;`);
          }
        } else if (s.k === "for_in") {
          env2.set(s.binding, `${s.binding}_item`);
          head.push(`${ind}for (const ${s.binding}_item of ${outer}) {`);
        } else head.push(`${ind}if (${outer}) {`);
        out.push(...head, ...tsStmts(s.body, ind + "  ", env2, tys2, ctx, at, { declared: new Set(scope.declared) }), `${ind}}`);
        break;
      }
      case "suggestions_new":
        out.push(`${ind}const suggestions: [${ctx.use("src/rustc_span/lib.ts", "Span", "type")}, string][] = [];`);
        break;
      case "push_suggestion":
        out.push(`${ind}suggestions.push([${x(s.span)}, ${x(s.code)}]);`);
        break;
      case "sub_args_new":
        out.push(`${ind}const sub_args: ${ctx.use(ERRORS, "DiagArgMap", "type")} = new Map();`);
        break;
      case "sub_arg":
        out.push(`${ind}sub_args.set(${JSON.stringify(s.name)}, ${ctx.intoDiagArg(s.ty, at)}(${x(s.value)}, diag.long_ty_path()));`);
        break;
      case "add_to_diag":
        out.push(`${ind}${ctx.subdiagnosticFns(s.ty, at).add_to_diag}(${x(s.value)}, diag);`);
        break;
      case "subdiagnostic":
        out.push(`${ind}diag.subdiagnostic(${ctx.subdiagnosticFns(s.ty, at).subdiagnostic}(${x(s.value)}));`);
        break;
      case "unreachable":
        out.push(`${ind}${ctx.use("src/std/panic.ts", "unreachable", "value")}();`);
        break;
    }
  }
  return out;
}

/** Derives of an item this generator implements (`Diagnostic`, `Subdiagnostic`). */
export function diagDerives(derives: string[]): ("Diagnostic" | "Subdiagnostic")[] {
  const out: ("Diagnostic" | "Subdiagnostic")[] = [];
  for (const d of derives) {
    const last = d.split("::").pop();
    if (last === "Diagnostic" || last === "Subdiagnostic") out.push(last);
    if (last === "LintDiagnostic") throw new Error("derive(LintDiagnostic) does not exist at the pin");
  }
  return out;
}
