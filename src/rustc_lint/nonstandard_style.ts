// compiler/rustc_lint/src/nonstandard_style.rs. The lint statics and `declare_lint_pass!` expansions are generated
// (nonstandard_style.lints.gen.ts). The early pass (NonCamelCaseTypes) and the late passes (NonSnakeCase,
// NonUpperCaseGlobals) are ported.
import type { ast } from "../rustc_ast/lib.ts";
import { find_attr } from "../rustc_attr_ir/lib.ts";
import { AttributeParser } from "../rustc_attr_parsing/lib.ts";
import type { Diag, DiagCtxtHandle, Diagnostic, Level } from "../rustc_errors/lib.ts";
import { Res } from "../rustc_hir/def.ts";
import type * as hir from "../rustc_hir/hir.ts";
import { ParamName } from "../rustc_hir/hir.ts";
import { type FnKind, type HirTyCtxt, Visitor } from "../rustc_hir/intravisit.ts";
import type { HirId } from "../rustc_hir_id/lib.ts";
import { TyCtxt_as_HirTyCtxt } from "../rustc_middle/hir/map.ts";
import { All } from "../rustc_middle/hir/nested_filter.ts";
import type { AssocItem } from "../rustc_middle/ty/assoc.gen.ts";
import { HasAttrs_LocalDefId } from "../rustc_middle/ty/mod.ts";
import { CRATE_MOD_ID, type DefId, DefId_eq, LocalDefId, type LocalModId } from "../rustc_span/def_id.ts";
import { BytePos, Span } from "../rustc_span/lib.ts";
import { Ident, Symbol, sym, type Symbol as SymbolT } from "../rustc_span/symbol.ts";
import { is_lowercase, is_titlecase, is_uppercase, to_lowercase, to_uppercase } from "../std/char.ts";
import { str_to_lowercase, str_to_uppercase } from "../std/unicode/str_case.ts";
import type { EarlyContext, LateContext } from "./context.ts";
import {
  NonCamelCaseType_diagnostic,
  type NonCamelCaseTypeSub,
  NonSnakeCaseDiag_diagnostic,
  type NonSnakeCaseDiagSub,
  type NonUpperCaseGlobal,
  NonUpperCaseGlobal_into_diag,
  type NonUpperCaseGlobalSub,
  type NonUpperCaseGlobalSubTool,
} from "./diagnostics.gen.ts";
import { NON_CAMEL_CASE_TYPES, NON_SNAKE_CASE, NON_UPPER_CASE_GLOBALS, NonCamelCaseTypes, NonSnakeCase, NonUpperCaseGlobals } from "./nonstandard_style.lints.gen.ts";
import type { EarlyLintPass, LateLintPass } from "./passes.ts";

export * from "./nonstandard_style.lints.gen.ts";

declare module "./nonstandard_style.lints.gen.ts" {
  interface NonCamelCaseTypes extends EarlyLintPass {
    check_case(cx: EarlyContext, sort: string, ident: Ident): void;
  }
  interface NonSnakeCase extends LateLintPass {
    check_snake_case(cx: LateContext, sort: string, ident: Ident): void;
  }
  interface NonUpperCaseGlobals extends LateLintPass {}
}

// ---- `char::to_titlecase` (std) ----
// PORT: `char::to_titlecase` (unstable `titlecase`, library/core/src/char/methods.rs:1604) is not in src/std yet;
// lane-owned stand-in until root moves it to src/std/char.ts with an oracle-generated table.
// `conversions::to_title` (library/core/src/unicode/unicode_data.rs:1104) is
// `lookup(c, &TITLECASE_LUT).or_else(|| lookup(c, &UPPERCASE_LUT))`; `to_upper` is the same `UPPERCASE_LUT` lookup
// (plus its ASCII/Latin-1 fast paths, which agree with the table), so this is `TITLECASE_LUT` falling back to
// `to_uppercase`. `TITLECASE_LUT` (unicode_data.rs:1489) is transcribed below: `singles` as
// [start, end, delta] (all `step_by_1`/`singleton`), `multis` and `exceptions` as [c, m0, m1, m2] (0 = no char).
// Checked against the oracle's `to_titlecase` for every char (lane lint-early-b).
const TITLECASE_SINGLES: readonly (readonly [number, number, number])[] = [
  [0x01c4, 0x01c4, 1], [0x01c5, 0x01c5, 0], [0x01c6, 0x01c6, -1], [0x01c7, 0x01c7, 1],
  [0x01c8, 0x01c8, 0], [0x01c9, 0x01c9, -1], [0x01ca, 0x01ca, 1], [0x01cb, 0x01cb, 0],
  [0x01cc, 0x01cc, -1], [0x01f1, 0x01f1, 1], [0x01f2, 0x01f2, 0], [0x01f3, 0x01f3, -1],
  [0x10d0, 0x10fa, 0], [0x10fd, 0x10ff, 0], [0x1f80, 0x1f87, 8], [0x1f88, 0x1f8f, 0],
  [0x1f90, 0x1f97, 8], [0x1f98, 0x1f9f, 0], [0x1fa0, 0x1fa7, 8], [0x1fa8, 0x1faf, 0],
  [0x1fb3, 0x1fb3, 9], [0x1fbc, 0x1fbc, 0], [0x1fc3, 0x1fc3, 9], [0x1fcc, 0x1fcc, 0],
  [0x1ff3, 0x1ff3, 9], [0x1ffc, 0x1ffc, 0],
];
const TITLECASE_MULTIS: readonly (readonly [number, number, number, number])[] = [
  [0x00df, 0x0053, 0x0073, 0x0000], [0x0587, 0x0535, 0x0582, 0x0000], [0x1fb2, 0x1fba, 0x0345, 0x0000],
  [0x1fb4, 0x0386, 0x0345, 0x0000], [0x1fb7, 0x0391, 0x0342, 0x0345], [0x1fc2, 0x1fca, 0x0345, 0x0000],
  [0x1fc4, 0x0389, 0x0345, 0x0000], [0x1fc7, 0x0397, 0x0342, 0x0345], [0x1ff2, 0x1ffa, 0x0345, 0x0000],
  [0x1ff4, 0x038f, 0x0345, 0x0000], [0x1ff7, 0x03a9, 0x0342, 0x0345], [0xfb00, 0x0046, 0x0066, 0x0000],
  [0xfb01, 0x0046, 0x0069, 0x0000], [0xfb02, 0x0046, 0x006c, 0x0000], [0xfb03, 0x0046, 0x0066, 0x0069],
  [0xfb04, 0x0046, 0x0066, 0x006c], [0xfb05, 0x0053, 0x0074, 0x0000], [0xfb06, 0x0053, 0x0074, 0x0000],
  [0xfb13, 0x0544, 0x0576, 0x0000], [0xfb14, 0x0544, 0x0565, 0x0000], [0xfb15, 0x0544, 0x056b, 0x0000],
  [0xfb16, 0x054e, 0x0576, 0x0000], [0xfb17, 0x0544, 0x056d, 0x0000],
  // `l2_luts[1].exceptions`: (0xdf95, ['S', 's', '\u{0}']) in plane 1.
  [0x1df95, 0x0053, 0x0073, 0x0000],
];

/** `c.to_titlecase()`, as the array of the chars the `ToTitlecase` iterator yields. */
export function to_titlecase(c: number): number[] {
  for (const [start, end, delta] of TITLECASE_SINGLES) {
    if (c >= start && c <= end) return [c + delta];
  }
  for (const [k, m0, m1, m2] of TITLECASE_MULTIS) {
    if (c === k) return m2 !== 0 ? [m0, m1, m2] : m1 !== 0 ? [m0, m1] : [m0];
  }
  return to_uppercase(c);
}

/** `Iterator::eq` over two case-mapping iterators. */
function chars_eq(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((c, i) => c === b[i]);
}

/** `s.chars()` */
function chars(s: string): number[] {
  const out: number[] = [];
  for (const c of s) out.push(c.codePointAt(0)!);
  return out;
}

/** `s.trim_matches('_')` */
function trim_underscores(s: string): string {
  let a = 0;
  let b = s.length;
  while (a < b && s[a] === "_") a++;
  while (b > a && s[b - 1] === "_") b--;
  return s.slice(a, b);
}

/// Some unicode characters *have* case, are considered upper, title, or lower case, but they *can't*
/// be title cased or lower cased. For the purposes of the lint suggestion, we care about being able
/// to change the char's case.
// rustc: compiler/rustc_lint/src/nonstandard_style.rs:53 char_has_case
function char_has_case(c: number): boolean {
  return !chars_eq(to_lowercase(c), to_titlecase(c));
}

/// FIXME: we should add a more efficient version
/// in the stdlib for this
// rustc: compiler/rustc_lint/src/nonstandard_style.rs:59 changes_when_titlecased
function changes_when_titlecased(c: number): boolean {
  return !chars_eq(to_titlecase(c), [c]);
}

// contains a capitalisable character followed by, or preceded by, an underscore,
// or contains an uppercase character that changes when titlecased,
// or contains `__`
// rustc: compiler/rustc_lint/src/nonstandard_style.rs:66 not_camel_case
function not_camel_case(s: string): boolean {
  const UNDERSCORE = 0x5f;
  let last = 0; // '\0'
  return chars(s).some((snd) => {
    const fst = last;
    last = snd;
    if (fst === UNDERSCORE && snd === UNDERSCORE) return true;
    if (fst === UNDERSCORE && char_has_case(snd)) return true;
    if (snd === UNDERSCORE && char_has_case(fst)) return true;
    return is_uppercase(snd) && changes_when_titlecased(snd);
  });
}

// rustc: compiler/rustc_lint/src/nonstandard_style.rs:79 is_upper_camel_case
export function is_upper_camel_case(name_: string): boolean {
  const name = trim_underscores(name_);
  const first = chars(name)[0];
  if (first === undefined) {
    return true;
  }

  // some scripts don't have a concept of upper/lowercase
  return !(changes_when_titlecased(first) || not_camel_case(name));
}

// rustc: compiler/rustc_lint/src/nonstandard_style.rs:89 to_upper_camel_case
export function to_upper_camel_case(s: string): string {
  const SIGMA = 0x3a3; // 'Σ'
  const FINAL_SIGMA = 0x3c2; // 'ς'
  return trim_underscores(s)
    .split("_")
    .filter((component) => component.length !== 0)
    .map((component) => {
      let camel_cased_component: number[] = [];

      let new_word = true;
      let prev_is_lower_case = true;
      let prev_is_lowercased_sigma = false;

      for (const c of chars(component)) {
        // Preserve the case if an uppercase letter follows a lowercase letter, so that
        // `camelCase` is converted to `CamelCase`.
        if (prev_is_lower_case && (is_uppercase(c) || is_titlecase(c))) {
          new_word = true;
        }

        if (new_word) {
          camel_cased_component.push(...to_titlecase(c));
        } else {
          camel_cased_component.push(...to_lowercase(c));
        }

        prev_is_lower_case = is_lowercase(c) || is_titlecase(c);
        prev_is_lowercased_sigma = !new_word && c === SIGMA;
        new_word = false;
      }

      if (prev_is_lowercased_sigma) {
        camel_cased_component.pop();
        camel_cased_component.push(FINAL_SIGMA);
      }

      return String.fromCodePoint(...camel_cased_component);
    })
    .reduce<[string, string | undefined]>(
      ([acc, prev], next) => {
        // separate two components with an underscore if their boundary cannot
        // be distinguished using an uppercase/lowercase case distinction
        let join: boolean;
        if (prev !== undefined) {
          const pc = chars(prev);
          const l = pc[pc.length - 1]!;
          const f = chars(next)[0]!;
          join = !char_has_case(l) && !char_has_case(f);
        } else {
          join = false;
        }
        return [acc + (join ? "_" : "") + next, next];
      },
      ["", undefined],
    )[0];
}

// impl NonCamelCaseTypes
// rustc: compiler/rustc_lint/src/nonstandard_style.rs:141 check_case
NonCamelCaseTypes.prototype.check_case = function (this: NonCamelCaseTypes, cx: EarlyContext, sort: string, ident: Ident): void {
  const name = Symbol.as_str(ident.name);

  if (!is_upper_camel_case(name)) {
    const cc = to_upper_camel_case(name);
    const sub: NonCamelCaseTypeSub = name !== cc ? { $: "Suggestion", span: ident.span, replace: cc } : { $: "Label", span: ident.span };
    cx.emit_span_lint(NON_CAMEL_CASE_TYPES, ident.span, NonCamelCaseType_diagnostic({ sort, name, sub }));
  }
};

// impl EarlyLintPass for NonCamelCaseTypes
// rustc: compiler/rustc_lint/src/nonstandard_style.rs:161 check_item
NonCamelCaseTypes.prototype.check_item = function (this: NonCamelCaseTypes, cx: EarlyContext, it: ast.Item): void {
  const parsed = AttributeParser.parse_limited_sym(cx.sess(), it.attrs, [sym.repr]);
  const has_repr_c =
    parsed !== undefined && parsed.$ === "Parsed" && parsed._0.$ === "Repr" && parsed._0.reprs.some(([r, _]) => r.$ === "ReprC");

  if (has_repr_c) {
    return;
  }

  const kind = it.kind;
  switch (kind.$) {
    case "TyAlias":
      this.check_case(cx, "type", kind._0.ident);
      break;
    case "Enum":
    case "Struct":
    case "Union":
      this.check_case(cx, "type", kind._0);
      break;
    case "Trait":
      this.check_case(cx, "trait", kind._0.ident);
      break;
    case "TraitAlias":
      this.check_case(cx, "trait alias", kind._0.ident);
      break;

    // N.B. This check is only for inherent associated types, so that we don't lint against
    // trait impls where we should have warned for the trait definition already.
    case "Impl":
      if (kind._0.of_trait === undefined) {
        for (const it of kind._0.items) {
          // FIXME: this doesn't respect `#[allow(..)]` on the item itself.
          if (it.kind.$ === "Type") {
            const alias = it.kind._0;
            this.check_case(cx, "associated type", alias.ident);
          }
        }
      }
      break;
    default:
      break;
  }
};

// rustc: compiler/rustc_lint/src/nonstandard_style.rs:195 check_trait_item
NonCamelCaseTypes.prototype.check_trait_item = function (this: NonCamelCaseTypes, cx: EarlyContext, it: ast.AssocItem): void {
  if (it.kind.$ === "Type") {
    const alias = it.kind._0;
    this.check_case(cx, "associated type", alias.ident);
  }
};

// rustc: compiler/rustc_lint/src/nonstandard_style.rs:201 check_variant
NonCamelCaseTypes.prototype.check_variant = function (this: NonCamelCaseTypes, cx: EarlyContext, v: ast.Variant): void {
  this.check_case(cx, "variant", v.ident);
};

// rustc: compiler/rustc_lint/src/nonstandard_style.rs:205 check_generic_param
NonCamelCaseTypes.prototype.check_generic_param = function (this: NonCamelCaseTypes, cx: EarlyContext, param: ast.GenericParam): void {
  if (param.kind.$ === "Type") {
    this.check_case(cx, "type parameter", param.ident);
  }
};


// impl NonSnakeCase
// PORT: `NonSnakeCase::to_snake_case` (an associated fn without `self`) is the module function `to_snake_case`; the
// pass class is generated (nonstandard_style.lints.gen.ts), so it cannot take a static here.
// rustc: compiler/rustc_lint/src/nonstandard_style.rs:237 to_snake_case
export function to_snake_case(name_: string): string {
  let name = name_;
  const words: string[] = [];
  // Preserve leading underscores
  let start = 0;
  while (start < name.length && name[start] === "_") {
    words.push("");
    start++;
  }
  name = name.slice(start);
  for (const s of name.split("_")) {
    let last_upper = false;
    let buf = "";
    if (s.length === 0) {
      continue;
    }
    for (const ch of chars(s)) {
      if (buf.length !== 0 && buf !== "'" && (is_uppercase(ch) || is_titlecase(ch)) && !last_upper) {
        // We lowercase only at the end, to handle final sigma correctly
        words.push(str_to_lowercase(buf));
        buf = "";
      }
      last_upper = is_uppercase(ch) || is_titlecase(ch);
      buf += String.fromCodePoint(ch);
    }
    // We lowercase only at the end, to handle final sigma correctly
    words.push(str_to_lowercase(buf));
  }
  return words.join("_");
}

/// Checks if a given identifier is snake case, and reports a diagnostic if not.
// rustc: compiler/rustc_lint/src/nonstandard_style.rs:274 check_snake_case
NonSnakeCase.prototype.check_snake_case = function (this: NonSnakeCase, cx: LateContext, sort: string, ident: Ident): void {
  // rustc: compiler/rustc_lint/src/nonstandard_style.rs:275 is_snake_case
  function is_snake_case(ident_: string): boolean {
    if (ident_.length === 0) {
      return true;
    }
    let ident = ident_.replace(/^'+/, "");
    ident = trim_underscores(ident);

    if (ident.includes("__")) {
      return false;
    }

    // This correctly handles letters in languages with and without
    // cases, as well as numbers and underscores.
    // FIXME: we should add a standard library impl of `c.to_lowercase().eq([c])`
    return chars(ident).every((c) => chars_eq(to_lowercase(c), [c]));
  }

  const name = Symbol.as_str(ident.name);

  if (!is_snake_case(name)) {
    const span = ident.span;
    const sc = to_snake_case(name);
    // We cannot provide meaningful suggestions
    // if the characters are in the category of "Uppercase Letter".
    let sub: NonSnakeCaseDiagSub;
    if (name !== sc) {
      // We have a valid span in almost all cases, but we don't have one when linting a
      // crate name provided via the command line.
      if (!Span.is_dummy(span)) {
        const sc_ident = Ident.from_str_and_span(sc, span);
        if (sc_ident.is_reserved()) {
          // We shouldn't suggest a reserved identifier to fix non-snake-case
          // identifiers. Instead, recommend renaming the identifier entirely or, if
          // permitted, escaping it to create a raw identifier.
          if (Symbol.can_be_raw(sc_ident.name)) {
            sub = { $: "RenameOrConvertSuggestion", span, suggestion: sc_ident };
          } else {
            sub = { $: "SuggestionAndNote", sc, span };
          }
        } else {
          sub = { $: "ConvertSuggestion", span, suggestion: sc };
        }
      } else {
        sub = { $: "Help", sc };
      }
    } else {
      sub = { $: "Label", span };
    }
    cx.emit_span_lint(NON_SNAKE_CASE, span, NonSnakeCaseDiag_diagnostic({ sort, name, sub }));
  }
};

// impl LateLintPass for NonSnakeCase
// rustc: compiler/rustc_lint/src/nonstandard_style.rs:331 check_mod
NonSnakeCase.prototype.check_mod = function (this: NonSnakeCase, cx: LateContext, _: hir.Mod, id: LocalModId): void {
  if (id !== CRATE_MOD_ID) {
    return;
  }

  // Issue #45127: don't enforce `snake_case` for binary crates as binaries are not intended
  // to be distributed and depended on like libraries. The lint is not suppressed for cdylib
  // or staticlib because it's not clear what the desired lint behavior for those are.
  if (cx.tcx.crate_types().every((crate_type) => crate_type === "Executable")) {
    return;
  }

  let crate_ident: Ident | undefined;
  const crate_name = cx.tcx.sess.opts.crate_name;
  if (crate_name !== undefined) {
    const name = crate_name;
    crate_ident = Ident.from_str(name);
  } else {
    const found = find_attr(cx.tcx.hir_krate_attrs(), (k) =>
      k.$ === "CrateName" ? ([k.name, k.name_span] as [SymbolT, Span]) : undefined,
    );
    if (found !== undefined) {
      const [name, span] = found;
      // Discard the double quotes surrounding the literal.
      let sp: Span = span;
      const snippet = cx.sess().source_map().span_to_snippet(span);
      if (snippet.$ === "Ok") {
        const s = snippet._0;
        const left = s.find('"');
        if (left !== undefined) {
          const rpos = s.rfind('"');
          if (rpos !== undefined) {
            const right = s.len() - rpos;
            sp = Span.with_hi(Span.with_lo(span, BytePos(Span.lo(span) + left + 1)), BytePos(Span.hi(span) - right));
          }
        }
      }

      crate_ident = Ident.new(name, sp);
    }
  }

  if (crate_ident !== undefined) {
    const ident = crate_ident;
    this.check_snake_case(cx, "crate", ident);
  }
};

// rustc: compiler/rustc_lint/src/nonstandard_style.rs:375 check_generic_param
NonSnakeCase.prototype.check_generic_param = function (this: NonSnakeCase, cx: LateContext, param: hir.GenericParam): void {
  if (param.kind.$ === "Lifetime") {
    this.check_snake_case(cx, "lifetime", ParamName.ident(param.name));
  }
};

// rustc: compiler/rustc_lint/src/nonstandard_style.rs:381 check_fn
NonSnakeCase.prototype.check_fn = function (
  this: NonSnakeCase,
  cx: LateContext,
  fk: FnKind,
  _: hir.FnDecl,
  __: hir.Body,
  ___: Span,
  id: LocalDefId,
): void {
  switch (fk.$) {
    case "Method": {
      const ident = fk._0;
      const sig = fk._1;
      const container = (cx.tcx.associated_item(id) as AssocItem).container;
      switch (container.$) {
        case "InherentImpl":
          if (sig.header.abi.$ !== "Rust" && find_attr(HasAttrs_LocalDefId.get_attrs(id, cx.tcx), (k) => (k.$ === "NoMangle" ? null : undefined)) !== undefined) {
            return;
          }
          this.check_snake_case(cx, "method", ident);
          break;
        case "Trait":
          this.check_snake_case(cx, "trait method", ident);
          break;
        case "TraitImpl":
          break;
      }
      break;
    }
    case "ItemFn": {
      const ident = fk._0;
      const header = fk._2;
      // Skip foreign-ABI #[no_mangle] functions (Issue #31924)
      if (header.abi.$ !== "Rust" && find_attr(HasAttrs_LocalDefId.get_attrs(id, cx.tcx), (k) => (k.$ === "NoMangle" ? null : undefined)) !== undefined) {
        return;
      }
      this.check_snake_case(cx, "function", ident);
      break;
    }
    case "Closure":
      break;
  }
};

// rustc: compiler/rustc_lint/src/nonstandard_style.rs:414 check_item
NonSnakeCase.prototype.check_item = function (this: NonSnakeCase, cx: LateContext, it: hir.Item): void {
  if (it.kind.$ === "Mod") {
    const ident = it.kind._0;
    this.check_snake_case(cx, "module", ident);
  }
};

// rustc: compiler/rustc_lint/src/nonstandard_style.rs:420 check_ty
NonSnakeCase.prototype.check_ty = function (this: NonSnakeCase, cx: LateContext, ty: hir.Ty<hir.AmbigArg>): void {
  if (ty.kind.$ === "FnPtr") {
    const { param_idents } = ty.kind._0;
    for (const param_ident of param_idents) {
      if (param_ident !== undefined) {
        this.check_snake_case(cx, "variable", param_ident);
      }
    }
  }
};

// rustc: compiler/rustc_lint/src/nonstandard_style.rs:430 check_trait_item
NonSnakeCase.prototype.check_trait_item = function (this: NonSnakeCase, cx: LateContext, item: hir.TraitItem): void {
  if (item.kind.$ === "Fn" && item.kind._1.$ === "Required") {
    const param_idents = item.kind._1._0;
    this.check_snake_case(cx, "trait method", item.ident);
    for (const param_ident of param_idents) {
      if (param_ident !== undefined) {
        this.check_snake_case(cx, "variable", param_ident);
      }
    }
  }
};

// rustc: compiler/rustc_lint/src/nonstandard_style.rs:441 check_pat
NonSnakeCase.prototype.check_pat = function (this: NonSnakeCase, cx: LateContext, p: hir.Pat): void {
  if (p.kind.$ === "Binding") {
    const hid = p.kind._1;
    const ident = p.kind._2;
    const parent = cx.tcx.parent_hir_node(hid);
    if (parent.$ === "PatField") {
      const field = parent._0;
      if (!field.is_shorthand) {
        // Only check if a new name has been introduced, to avoid warning
        // on both the struct definition and this pattern.
        this.check_snake_case(cx, "variable", ident);
      }
      return;
    }
    this.check_snake_case(cx, "variable", ident);
  }
};

// rustc: compiler/rustc_lint/src/nonstandard_style.rs:455 check_field_def
NonSnakeCase.prototype.check_field_def = function (this: NonSnakeCase, cx: LateContext, field: hir.FieldDef): void {
  this.check_snake_case(cx, "structure field", field.ident);
};

// PORT: `struct NonUpperCaseGlobalGenerator<'a, F: FnOnce() -> NonUpperCaseGlobal<'a>> { callback: F }` with
// `F = () => NonUpperCaseGlobal`.
// rustc-type: compiler/rustc_lint/src/nonstandard_style.rs:483 NonUpperCaseGlobalGenerator
class NonUpperCaseGlobalGenerator implements Diagnostic {
  constructor(public callback: () => NonUpperCaseGlobal) {}

  // rustc: compiler/rustc_lint/src/nonstandard_style.rs:490 into_diag
  into_diag(dcx: DiagCtxtHandle, level: Level): Diag {
    const { callback } = this;
    return NonUpperCaseGlobal_into_diag(callback(), dcx, level);
  }
}

// impl NonUpperCaseGlobals
// PORT: `NonUpperCaseGlobals::check_upper_case` (an associated fn without `self`) is the module function
// `check_upper_case` (the pass class is generated).
// rustc: compiler/rustc_lint/src/nonstandard_style.rs:497 check_upper_case
function check_upper_case(cx: LateContext, sort: string, did: LocalDefId | undefined, ident: Ident): void {
  const name = Symbol.as_str(ident.name);
  // FIXME: we should add a more efficient version
  // in the stdlib for `c.to_uppercase().eq([c])`
  if (!chars(name).every((c) => chars_eq(to_uppercase(c), [c]))) {
    const uc = str_to_uppercase(to_snake_case(name));

    // If the item is exported, suggesting changing its name would be a breaking change
    // and could break users without a "nice" applicable fix, so let's avoid it.
    let can_change_usages: boolean;
    if (did !== undefined) {
      can_change_usages = !cx.tcx.effective_visibilities(null).is_exported(did);
    } else {
      can_change_usages = false;
    }

    // We cannot provide meaningful suggestions
    // if the characters are in the category of "Lowercase Letter".
    const sub: NonUpperCaseGlobalSub =
      name !== uc
        ? {
            $: "Suggestion",
            span: ident.span,
            replace: uc,
            applicability: can_change_usages ? "MachineApplicable" : "MaybeIncorrect",
          }
        : { $: "Label", span: ident.span };

    // rustc-type: compiler/rustc_lint/src/nonstandard_style.rs:528 UsageCollector
    class UsageCollector extends Visitor {
      // `type NestedFilter = All;`
      override NestedFilter = All;

      constructor(
        public cx: LateContext,
        public did: DefId,
        public collected: Span[],
      ) {
        super();
      }

      // rustc: compiler/rustc_lint/src/nonstandard_style.rs:537 maybe_tcx
      override maybe_tcx(): HirTyCtxt {
        return TyCtxt_as_HirTyCtxt(this.cx.tcx);
      }

      // rustc: compiler/rustc_lint/src/nonstandard_style.rs:541 visit_path
      override visit_path(path: hir.Path, _id: HirId): undefined {
        const final_seg = path.segments[path.segments.length - 1];
        if (final_seg !== undefined) {
          const res_did = Res.opt_def_id(final_seg.res);
          if (res_did !== undefined && DefId_eq(res_did, this.did)) {
            this.collected.push(final_seg.ident.span);
          }
        }
        return undefined;
      }
    }

    const callback = (): NonUpperCaseGlobal => {
      // Compute usages lazily as it can expansive and useless when the lint is allowed.
      // cf. https://github.com/rust-lang/rust/pull/142645#issuecomment-2993024625
      let usages: NonUpperCaseGlobalSubTool[];
      if (can_change_usages && name !== uc && did !== undefined) {
        const usage_collector = new UsageCollector(cx, LocalDefId.to_def_id(did), []);
        cx.tcx.hir_walk_toplevel_module(usage_collector);
        usages = usage_collector.collected.map((span) => ({ span, replace: uc }));
      } else {
        usages = [];
      }

      return { sort, name, sub, usages };
    };
    cx.emit_span_lint(NON_UPPER_CASE_GLOBALS, ident.span, new NonUpperCaseGlobalGenerator(callback));
  }
}

// impl LateLintPass for NonUpperCaseGlobals
// rustc: compiler/rustc_lint/src/nonstandard_style.rs:585 check_item
NonUpperCaseGlobals.prototype.check_item = function (this: NonUpperCaseGlobals, cx: LateContext, it: hir.Item): void {
  const attrs = cx.tcx.hir_attrs(it.hir_id());
  const kind = it.kind;
  if (kind.$ === "Static" && !(find_attr(attrs, (k) => (k.$ === "NoMangle" ? null : undefined)) !== undefined)) {
    const ident = kind._1;
    check_upper_case(cx, "static variable", it.owner_id.def_id, ident);
  } else if (kind.$ === "Const") {
    const ident = kind._0;
    check_upper_case(cx, "constant", it.owner_id.def_id, ident);
  }
};

// rustc: compiler/rustc_lint/src/nonstandard_style.rs:608 check_trait_item
NonUpperCaseGlobals.prototype.check_trait_item = function (this: NonUpperCaseGlobals, cx: LateContext, ti: hir.TraitItem): void {
  if (ti.kind.$ === "Const") {
    check_upper_case(cx, "associated constant", undefined, ti.ident);
  }
};

// rustc: compiler/rustc_lint/src/nonstandard_style.rs:614 check_impl_item
NonUpperCaseGlobals.prototype.check_impl_item = function (this: NonUpperCaseGlobals, cx: LateContext, ii: hir.ImplItem): void {
  if (ii.kind.$ === "Const" && ii.impl_kind.$ === "Inherent") {
    check_upper_case(cx, "associated constant", undefined, ii.ident);
  }
};

// rustc: compiler/rustc_lint/src/nonstandard_style.rs:622 check_pat
NonUpperCaseGlobals.prototype.check_pat = function (this: NonUpperCaseGlobals, cx: LateContext, p: hir.Pat): void {
  // Lint for constants that look like binding identifiers (#7526)
  if (p.kind.$ === "Expr" && p.kind._0.kind.$ === "Path" && p.kind._0.kind._0.$ === "Resolved" && p.kind._0.kind._0._0 === undefined) {
    const path = p.kind._0.kind._0._1;
    if (path.res.$ === "Def" && path.res._0.$ === "Const" && path.segments.length === 1) {
      const segment = path.segments[0]!;
      check_upper_case(cx, "constant in pattern", undefined, segment.ident);
    }
  }
};

// rustc: compiler/rustc_lint/src/nonstandard_style.rs:642 check_generic_param
NonUpperCaseGlobals.prototype.check_generic_param = function (this: NonUpperCaseGlobals, cx: LateContext, param: hir.GenericParam): void {
  if (param.kind.$ === "Const") {
    check_upper_case(cx, "const parameter", param.def_id, ParamName.ident(param.name));
  }
};
