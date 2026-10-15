// Unit tests of lane thir-cx-print: thir/print.rs on hand-built `Thir`s (THIR building needs typeck, which is not
// ported yet). The expected texts are upstream's own outputs, tests/ui/thir-print/thir-tree.stdout and
// thir-flat.stdout (`pub fn main() {}`, with the test's source file in the source map so that spans print as
// there), with two substitutions: the `HirId` (its `DefId` path needs the definitions, which the mock tcx lacks) is
// printed by the same Debug impl the printer calls, and `thir-flat`'s `body_type: Fn(\n fn(),\n )` is
// `Const(\n (),\n )` here (no fn signature is built), printed by the same derive.
import { describe, expect, test } from "bun:test";
import "../lib.ts";
import { HirId, ItemLocalId, OwnerId, debug_HirId } from "../../rustc_hir_id/lib.ts";
import { Scope, ScopeData } from "../../rustc_middle/middle/region.ts";
import { type BlockId, debug_Thir, type Expr, ExprId, Thir } from "../../rustc_middle/thir.ts";
import { CommonLifetimes, CommonTypes, CtxtInterners, type GlobalCtxt, TyCtxt } from "../../rustc_middle/ty/context.ts";
import * as tls from "../../rustc_middle/ty/context/tls.ts";
import { LocalDefId } from "../../rustc_span/def_id.ts";
import { BytePos, create_session_globals_then, Span, with_session_globals } from "../../rustc_span/lib.ts";
import { DEFAULT_EDITION } from "../../rustc_span/edition.ts";
import { FilePathMapping, RealFileLoader } from "../../rustc_span/source_map.ts";
import { Str } from "../../std/str.ts";
import { Limit } from "../../rustc_structures/limit.ts";
import { PLAIN, PRETTY } from "../../std/fmt.ts";
import { ThirPrinter } from "./print.ts";

/** A `TyCtxt` over fresh interners (as rustc_infer infer_core.test.ts), for `{:?}` of `Ty`. */
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

/** Session globals whose source map holds `src` as file `name`, plus the `ImplicitCtxt` of a mock tcx; `f` gets the
 *  span of `needle` (first occurrence). */
const sg = (name: string, src: string, needle: string, f: (tcx: TyCtxt, sp: Span) => void) => () => {
  const sm_inputs = {
    file_loader: new RealFileLoader(),
    path_mapping: FilePathMapping.empty(),
    hash_kind: "Md5" as const,
    checksum_hash_kind: undefined,
  };
  create_session_globals_then(DEFAULT_EDITION, [], sm_inputs, () => {
    const sm = with_session_globals((g) => g.source_map!);
    const file = sm.new_source_file({ $: "Real", _0: sm.path_mapping().to_real_filename(sm.working_dir(), name) }, Str.from(src));
    const at = src.indexOf(needle);
    const start = BytePos.to_u32(file.start_pos);
    const sp = Span.with_root_ctxt(BytePos.from_u32(start + at), BytePos.from_u32(start + at + needle.length));
    const tcx = mk_tcx();
    tls.enter_context(new tls.ImplicitCtxt(tcx, undefined, 0), () => f(tcx, sp));
  });
};

/** tests/ui/thir-print/thir-tree.rs and thir-flat.rs (the same source). */
const SRC = (flag: string): string => `//@ compile-flags: -Z unpretty=${flag}\n//@ check-pass\n\npub fn main() {}\n`;

/** The THIR of `pub fn main() {}` as thir-flat.stdout lists it (blocks[0], exprs[0..2]); `e1` is the body. */
function main_thir(tcx: TyCtxt, hir_id: HirId, span: Span): Thir {
  const thir = Thir.new({ $: "Const", _0: tcx.types.unit });
  thir.blocks.push({
    targeted_by_break: false,
    region_scope: new Scope(ItemLocalId.from_u32(1), ScopeData.Node),
    span,
    stmts: [],
    expr: undefined,
    safety_mode: { $: "Safe" },
  });
  const e0: Expr = { kind: { $: "Block", block: 0 as BlockId }, ty: tcx.types.unit, temp_scope_id: ItemLocalId.from_u32(2), span };
  const e1: Expr = {
    kind: { $: "Scope", region_scope: new Scope(ItemLocalId.from_u32(2), ScopeData.Node), hir_id, value: ExprId.from_u32(0) },
    ty: tcx.types.unit,
    temp_scope_id: ItemLocalId.from_u32(2),
    span,
  };
  thir.exprs.push(e0, e1);
  return thir;
}

describe("thir/print.rs", () => {
  test(
    "ThirPrinter::print matches tests/ui/thir-print/thir-tree.stdout",
    sg("$DIR/thir-tree.rs", SRC("thir-tree"), "{}", (tcx, sp) => {
      const hir_id = new HirId(new OwnerId(LocalDefId.new(3)), ItemLocalId.from_u32(2));
      const thir = main_thir(tcx, hir_id, sp);
      const printer = ThirPrinter.new(thir);
      printer.print(ExprId.from_u32(1));
      const SPAN = "$DIR/thir-tree.rs:4:15: 4:17 (#0)";
      const HIR_ID = debug_HirId(hir_id, PLAIN);
      expect(printer.into_buffer()).toBe(
        [
          "params: [",
          "]",
          "body:",
          "    Expr {",
          "        ty: ()",
          "        temp_scope_id: 2",
          `        span: ${SPAN}`,
          "        kind: ",
          "            Scope {",
          "                region_scope: Node(2)",
          `                hir_id: ${HIR_ID}`,
          "                value:",
          "                    Expr {",
          "                        ty: ()",
          "                        temp_scope_id: 2",
          `                        span: ${SPAN}`,
          "                        kind: ",
          "                            Block {",
          "                                targeted_by_break: false",
          `                                span: ${SPAN}`,
          "                                region_scope: Node(1)",
          "                                safety_mode: Safe",
          "                                stmts: []",
          "                                expr: []",
          "                            }",
          "                    }",
          "            }",
          "    }",
          "",
        ].join("\n"),
      );
    }),
  );

  test(
    "{:#?} of the Thir (thir_flat's format) matches tests/ui/thir-print/thir-flat.stdout",
    sg("$DIR/thir-flat.rs", SRC("thir-flat"), "{}", (tcx, sp) => {
      const hir_id = new HirId(new OwnerId(LocalDefId.new(3)), ItemLocalId.from_u32(2));
      const thir = main_thir(tcx, hir_id, sp);
      const SPAN = "$DIR/thir-flat.rs:4:15: 4:17 (#0)";
      const HIR_ID = debug_HirId(hir_id, PLAIN);
      // `thir_flat` is `format!("{:#?}", thir.steal())`; it reaches `thir_body` (typeck) first, so print the value.
      expect(debug_Thir(thir, PRETTY)).toBe(
        [
          "Thir {",
          "    body_type: Const(",
          "        (),",
          "    ),",
          "    loop_hint_attrs: {},",
          "    arms: [],",
          "    blocks: [",
          "        Block {",
          "            targeted_by_break: false,",
          "            region_scope: Node(1),",
          `            span: ${SPAN},`,
          "            stmts: [],",
          "            expr: None,",
          "            safety_mode: Safe,",
          "        },",
          "    ],",
          "    exprs: [",
          "        Expr {",
          "            kind: Block {",
          "                block: b0,",
          "            },",
          "            ty: (),",
          "            temp_scope_id: 2,",
          `            span: ${SPAN},`,
          "        },",
          "        Expr {",
          "            kind: Scope {",
          "                region_scope: Node(2),",
          `                hir_id: ${HIR_ID},`,
          "                value: e0,",
          "            },",
          "            ty: (),",
          "            temp_scope_id: 2,",
          `            span: ${SPAN},`,
          "        },",
          "    ],",
          "    stmts: [],",
          "    params: [],",
          "}",
        ].join("\n"),
      );
    }),
  );
});
