// Unit tests of lane thir-pattern: thir/pattern/const_to_pat.rs and the THIR Debug of patterns / literals, on
// hand-built values (pattern lowering from HIR needs typeck, which is not ported yet). The expected texts are upstream's
// own output, tests/ui/thir-print/str-patterns.stdout (`-Zunpretty=thir-flat`, i.e. `{:#?}` of the `Thir`), with the
// test's source file in the source map so that spans print as there:
// - the first arm's pattern `"hello"` is `PatCtxt::const_to_pat` of `lit_to_const`'s value at the pattern's type `&str`
//   (as `PatCtxt::lower_pat_expr` lowers it): a `Deref` of a `str` `Constant`;
// - `CONSTANT`'s body expression `e0` is an `ExprKind::Literal` (`hir::Lit` = `Spanned<LitKind>` Debug).
// Both are compared at their nesting depth in the stdout file.
import { describe, expect, test } from "bun:test";
import "../../lib.ts";
// `Const::new_value` (ty/consts.rs) for `ValTree::from_raw_bytes`: an extension module of rustc_middle.
import "../../../rustc_middle/ty/consts.ts";
import { HirId, ItemLocalId, OwnerId } from "../../../rustc_hir_id/lib.ts";
import { debug_Expr, debug_Pat, type Expr } from "../../../rustc_middle/thir.ts";
import { CommonLifetimes, CommonTypes, CtxtInterners, type GlobalCtxt, TyCtxt } from "../../../rustc_middle/ty/context.ts";
import * as tls from "../../../rustc_middle/ty/context/tls.ts";
import { Ty } from "../../../rustc_middle/ty/mod.ts";
import { LocalDefId } from "../../../rustc_span/def_id.ts";
import { BytePos, create_session_globals_then, Span, with_session_globals } from "../../../rustc_span/lib.ts";
import { DEFAULT_EDITION } from "../../../rustc_span/edition.ts";
import { FilePathMapping, RealFileLoader } from "../../../rustc_span/source_map.ts";
import { Symbol } from "../../../rustc_span/symbol.ts";
import { Limit } from "../../../rustc_structures/limit.ts";
import { PRETTY } from "../../../std/fmt.ts";
import { Str } from "../../../std/str.ts";
import { lit_to_const } from "../constant.ts";
import { Const } from "../../../rustc_type_ir/sty/consts.ts";
import { PatCtxt } from "./mod.ts";

/** A `TyCtxt` over fresh interners (as thir/print.test.ts), for `{:?}` of `Ty`. */
function mk_tcx(): TyCtxt {
  const interners = CtxtInterners.new(undefined);
  let types: CommonTypes | undefined;
  let lifetimes: CommonLifetimes | undefined;
  const gcx = {
    interners,
    get types() {
      return (types ??= CommonTypes.new(interners));
    },
    get lifetimes() {
      return (lifetimes ??= CommonLifetimes.new(interners));
    },
    sess: {
      opts: { trimmed_def_paths: false, unstable_opts: { trim_diagnostic_paths: true } },
      verbose_internals: () => false,
    },
  };
  const tcx = new TyCtxt(gcx as unknown as GlobalCtxt);
  (tcx as unknown as { type_length_limit: () => Limit }).type_length_limit = () => Limit.new(1048576);
  return tcx;
}

/** tests/ui/thir-print/str-patterns.rs */
const SRC = [
  '#![crate_type = "rlib"]',
  "//@ edition: 2024",
  "//@ compile-flags: -Zunpretty=thir-flat",
  "//@ check-pass",
  "",
  "// Snapshot test capturing the THIR pattern structure produced by",
  "// string-literal and string-constant patterns.",
  "",
  "pub fn hello_world(x: &str) {",
  "    match x {",
  '        "hello" => {}',
  "        CONSTANT => {}",
  "        _ => {}",
  "    }",
  "}",
  "",
  'const CONSTANT: &str = "constant";',
  "",
].join("\n");

/** Session globals whose source map holds `SRC` as `$DIR/str-patterns.rs`, plus the `ImplicitCtxt` of a mock tcx;
 *  `f` gets the span of `needle` (first occurrence). */
const sg = (needle: string, f: (tcx: TyCtxt, sp: Span) => void) => () => {
  const sm_inputs = {
    file_loader: new RealFileLoader(),
    path_mapping: FilePathMapping.empty(),
    hash_kind: "Md5" as const,
    checksum_hash_kind: undefined,
  };
  create_session_globals_then(DEFAULT_EDITION, [], sm_inputs, () => {
    const sm = with_session_globals((g) => g.source_map!);
    const file = sm.new_source_file(
      { $: "Real", _0: sm.path_mapping().to_real_filename(sm.working_dir(), "$DIR/str-patterns.rs") },
      Str.from(SRC),
    );
    const at = SRC.indexOf(needle);
    const start = BytePos.to_u32(file.start_pos);
    const sp = Span.with_root_ctxt(BytePos.from_u32(start + at), BytePos.from_u32(start + at + needle.length));
    const tcx = mk_tcx();
    tls.enter_context(new tls.ImplicitCtxt(tcx, undefined, 0), () => f(tcx, sp));
  });
};

/** `text`'s lines after the first indented by `n` spaces (a value nested in the stdout file at that depth). */
const nest = (text: string, n: number): string => text.split("\n").join(`\n${" ".repeat(n)}`);

describe("thir/pattern", () => {
  test(
    'const_to_pat.rs const_to_pat / valtree_to_pat: the `"hello"` arm of tests/ui/thir-print/str-patterns.stdout',
    sg('"hello"', (tcx, sp) => {
      // `PatCtxt::lower_pat_expr`: `lit_to_const` (constant.rs) of `"hello"` at the pattern's type `&str`.
      const pat_ty = Ty.new_imm_ref(tcx, tcx.lifetimes.re_erased, tcx.types.str_);
      const value = lit_to_const(tcx, { lit: { $: "Str", _0: Symbol.intern("hello"), _1: { $: "Cooked" } }, ty: pat_ty, neg: false });
      if (value === undefined) throw new Error("lit_to_const returned None");
      const constant = Const.new_value(tcx, value.valtree, pat_ty);
      // Only `tcx` / `typing_env` are read by `const_to_pat` (via `ConstToPat::new`); `typing_env` only by ADT / `Ref`
      // of non-`str`/slice pointees, which this value has not.
      const pcx = new PatCtxt(undefined as never, tcx, undefined as never, undefined as never, undefined);
      const hir_id = new HirId(new OwnerId(LocalDefId.new(3)), ItemLocalId.from_u32(10));
      const pat = pcx.const_to_pat(constant, pat_ty, hir_id, sp);
      const SPAN = "$DIR/str-patterns.rs:11:9: 11:16 (#0)";
      // str-patterns.stdout lines 9-32 (`pattern: ` at depth 12).
      expect(`            pattern: ${nest(debug_Pat(pat, PRETTY), 12)},`).toBe(
        [
          "            pattern: Pat {",
          "                ty: &'{erased} str,",
          `                span: ${SPAN},`,
          "                extra: None,",
          "                kind: Deref {",
          "                    pin: Not,",
          "                    subpattern: Pat {",
          "                        ty: str,",
          `                        span: ${SPAN},`,
          "                        extra: None,",
          "                        kind: Constant {",
          "                            value: Value {",
          "                                ty: str,",
          "                                valtree: Branch(",
          "                                    [",
          "                                        104_u8,",
          "                                        101_u8,",
          "                                        108_u8,",
          "                                        108_u8,",
          "                                        111_u8,",
          "                                    ],",
          "                                ),",
          "                            },",
          "                        },",
          "                    },",
          "                },",
          "            },",
        ].join("\n"),
      );
    }),
  );

  test(
    "thir.rs ExprKind::Literal Debug (`hir::Lit`): CONSTANT's e0 in tests/ui/thir-print/str-patterns.stdout",
    sg('"constant"', (tcx, sp) => {
      const e0: Expr = {
        kind: { $: "Literal", lit: { node: { $: "Str", _0: Symbol.intern("constant"), _1: { $: "Cooked" } }, span: sp }, neg: false },
        ty: Ty.new_imm_ref(tcx, tcx.lifetimes.re_erased, tcx.types.str_),
        temp_scope_id: ItemLocalId.from_u32(5),
        span: sp,
      };
      const SPAN = "$DIR/str-patterns.rs:17:24: 17:34 (#0)";
      // str-patterns.stdout: the first element of `exprs` (depth 8) of `DefId(0:4 ~ str_patterns[fc71]::CONSTANT)`.
      expect(`        ${nest(debug_Expr(e0, PRETTY), 8)},`).toBe(
        [
          "        Expr {",
          "            kind: Literal {",
          "                lit: Spanned {",
          "                    node: Str(",
          '                        "constant",',
          "                        Cooked,",
          "                    ),",
          `                    span: ${SPAN},`,
          "                },",
          "                neg: false,",
          "            },",
          "            ty: &'{erased} str,",
          "            temp_scope_id: 5,",
          `            span: ${SPAN},`,
          "        },",
        ].join("\n"),
      );
    }),
  );
});
