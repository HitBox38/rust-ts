// Port of compiler/rustc_attr_parsing/src/attributes/cfg_select.rs.
import type { NodeId } from "../../rustc_ast/lib.ts";
import { CfgEntry, clone_CfgEntry } from "../../rustc_ast/attr/data_structures.ts";
import { clone_Token, type Token } from "../../rustc_ast/token.ts";
import type { TokenStream } from "../../rustc_ast/tokenstream.ts";
import { AttrPath } from "../../rustc_attr_ir/lib.ts";
import { Target } from "../../rustc_attr_ir/target.ts";
import type { ErrorGuaranteed } from "../../rustc_errors/lib.ts";
import type { Features } from "../../rustc_feature/lib.ts";
import { UNREACHABLE_CFG_SELECT_PREDICATES } from "../../rustc_lint_defs/builtin.ts";
import { parser as rustc_parse_parser } from "../../rustc_parse/lib.ts";
import type { Session } from "../../rustc_session/lib.ts";
import { Span } from "../../rustc_span/lib.ts";
import { sym, type Symbol } from "../../rustc_span/symbol.ts";
import { Err, Ok, type Result } from "../../std/result.ts";
import type { ShouldEmit } from "../context.ts";
import { UnreachableCfgSelectPredicate_into_diag, UnreachableCfgSelectPredicateWildcard_into_diag } from "../diagnostics.ts";
import { AttributeParser } from "../interface.ts";
import { AllowExprMetavar, MetaItemOrLitParser } from "../parser.ts";
import { AttributeTemplate } from "../template.ts";
import { type EvalConfigResult, parse_cfg_entry } from "./cfg.ts";
import { AttributeSafety } from "./mod.ts";

type Parser = rustc_parse_parser.Parser;
const { exp } = { exp: rustc_parse_parser.token_type.exp };
// `rustc_span::Symbol` shadows the JS global `Symbol` in this module.
const Symbol_iterator: typeof globalThis.Symbol.iterator = globalThis.Symbol.iterator;

/** `#[derive(Clone)] pub enum CfgSelectPredicate` */
export type CfgSelectPredicate = { readonly $: "Cfg"; _0: CfgEntry } | { readonly $: "Wildcard"; _0: Token };

export const CfgSelectPredicate = {
  // rustc: compiler/rustc_attr_parsing/src/attributes/cfg_select.rs:29 span
  span(self: CfgSelectPredicate): Span {
    switch (self.$) {
      case "Cfg":
        return CfgEntry.span(self._0);
      case "Wildcard":
        return self._0.span;
    }
  },
};

/** `#[derive(Clone)]` */
export function clone_CfgSelectPredicate(v: CfgSelectPredicate): CfgSelectPredicate {
  switch (v.$) {
    case "Cfg":
      return { $: "Cfg", _0: clone_CfgEntry(v._0) };
    case "Wildcard":
      return { $: "Wildcard", _0: clone_Token(v._0) };
  }
}

/** `#[derive(Default)] pub struct CfgSelectBranches` */
export class CfgSelectBranches {
  constructor(
    /// All the conditional branches.
    public reachable: [CfgEntry, TokenStream, Span][],
    /// The first wildcard `_ => { ... }` branch.
    public wildcard: [Token, TokenStream, Span] | undefined,
    /// All branches after the first wildcard, including further wildcards.
    /// These branches are kept for formatting.
    public unreachable: [CfgSelectPredicate, TokenStream, Span][],
  ) {}

  /** `#[derive(Default)]` */
  static default(): CfgSelectBranches {
    return new CfgSelectBranches([], undefined, []);
  }

  /// Removes the top-most branch for which `predicate` returns `true`,
  /// or the wildcard if none of the reachable branches satisfied the predicate.
  // rustc: compiler/rustc_attr_parsing/src/attributes/cfg_select.rs:51 pop_first_match
  pop_first_match(predicate: (cfg: CfgEntry) => EvalConfigResult): [CfgEntry, TokenStream, Span] | undefined {
    for (let index = 0; index < this.reachable.length; index++) {
      const entry = this.reachable[index]!;
      const r = predicate(entry[0]);
      switch (r.$) {
        case "True":
          return this.reachable.splice(index, 1)[0]!;
        case "False":
          entry[0] = r.reason;
          break;
      }
    }

    const wildcard = this.wildcard;
    this.wildcard = undefined;
    if (wildcard === undefined) return undefined;
    const [, tts, span] = wildcard;
    return [{ $: "Bool", _0: true, _1: span }, tts, span];
  }

  /// Consume this value and iterate over all the `TokenStream`s that it stores.
  // rustc: compiler/rustc_attr_parsing/src/attributes/cfg_select.rs:70 into_iter_tts
  *into_iter_tts(): Generator<[CfgEntry, TokenStream, Span]> {
    const it1 = this.reachable;
    const it2: [CfgEntry, TokenStream, Span][] =
      this.wildcard === undefined ? [] : [[{ $: "Bool", _0: true, _1: this.wildcard[2] }, this.wildcard[1], this.wildcard[2]]];
    const it3 = this.unreachable.map(([, tts, span]): [CfgEntry, TokenStream, Span] => [{ $: "Bool", _0: false, _1: span }, tts, span]);

    yield* it1;
    yield* it2;
    yield* it3;
  }
}

// rustc: compiler/rustc_attr_parsing/src/attributes/cfg_select.rs:83 parse_cfg_select
export function parse_cfg_select(
  p: Parser,
  sess: Session,
  features: Features | undefined,
  lint_node_id: NodeId,
): Result<CfgSelectBranches, ErrorGuaranteed> {
  const branches = CfgSelectBranches.default();

  while (p.token.kind.$ !== "Eof") {
    const r0 = p.recover_from_outer_attributes("`cfg_select` branches");
    if (r0.$ === "Err") return Err(r0._0.emit_err());

    if (p.eat_keyword(exp.Underscore)) {
      const underscore = clone_Token(p.prev_token);
      const r1 = p.expect(exp.FatArrow);
      if (r1.$ === "Err") return Err(r1._0.emit_err());

      const tts_r = p.parse_cfg_select_branch_rhs();
      if (tts_r.$ === "Err") return Err(tts_r._0.emit_err());
      const tts = tts_r._0;
      const span = Span.to(underscore.span, p.token.span);

      if (branches.wildcard === undefined) {
        branches.wildcard = [underscore, tts, span];
      } else {
        branches.unreachable.push([{ $: "Wildcard", _0: underscore }, tts, span]);
      }
    } else {
      const meta_r = MetaItemOrLitParser.parse_single(p, { $: "ErrorsAndLints", recovery: "Allowed" }, AllowExprMetavar.Yes);
      if (meta_r.$ === "Err") return Err(meta_r._0.emit_err());
      const meta = meta_r._0;
      const cfg_span = MetaItemOrLitParser.span(meta);
      const cfg_r = AttributeParser.parse_single_args(
        sess,
        cfg_span,
        cfg_span,
        "Inner",
        new AttrPath([sym.cfg_select], cfg_span),
        undefined,
        AttributeSafety.Normal,
        "Macro",
        cfg_span,
        lint_node_id,
        // Doesn't matter what the target actually is here.
        Target.Crate,
        features,
        { $: "ErrorsAndLints", recovery: "Allowed" } satisfies ShouldEmit,
        meta,
        parse_cfg_entry,
        // PORT: `AttributeTemplate::default()` (derived: no forms, no docs).
        new AttributeTemplate(false, undefined, [], undefined, undefined),
      );
      if (cfg_r.$ === "Err") return cfg_r;
      const cfg = cfg_r._0;

      const r1 = p.expect(exp.FatArrow);
      if (r1.$ === "Err") return Err(r1._0.emit_err());

      const tts_r = p.parse_cfg_select_branch_rhs();
      if (tts_r.$ === "Err") return Err(tts_r._0.emit_err());
      const tts = tts_r._0;
      const span = Span.to(cfg_span, p.token.span);

      if (branches.wildcard === undefined) {
        branches.reachable.push([cfg, tts, span]);
      } else {
        branches.unreachable.push([{ $: "Cfg", _0: cfg }, tts, span]);
      }
    }
  }

  const it: CfgSelectPredicate[] = [
    ...branches.reachable.map(([entry]): CfgSelectPredicate => ({ $: "Cfg", _0: clone_CfgEntry(entry) })),
    ...(branches.wildcard === undefined ? [] : [{ $: "Wildcard", _0: clone_Token(branches.wildcard[0]) } as CfgSelectPredicate]),
    ...branches.unreachable.map(([entry]) => clone_CfgSelectPredicate(entry)),
  ];

  lint_unreachable(p, it, lint_node_id);

  return Ok(branches);
}

// rustc: compiler/rustc_attr_parsing/src/attributes/cfg_select.rs:159 lint_unreachable
function lint_unreachable(p: Parser, predicates: Iterable<CfgSelectPredicate>, lint_node_id: NodeId): void {
  // Symbols that have a known value.
  const known = new Map<Symbol, boolean>();
  let wildcard_span: Span | undefined = undefined;
  const it = predicates[Symbol_iterator]();

  const branch_is_unreachable = (predicate: CfgSelectPredicate, wildcard_span: Span | undefined) => {
    const span = CfgSelectPredicate.span(predicate);
    p.psess.dyn_buffer_lint(UNREACHABLE_CFG_SELECT_PREDICATES, span, lint_node_id, (dcx, level) => {
      if (wildcard_span !== undefined) {
        return UnreachableCfgSelectPredicateWildcard_into_diag({ span, wildcard_span }, dcx, level);
      } else {
        return UnreachableCfgSelectPredicate_into_diag({ span }, dcx, level);
      }
    });
  };

  // `known.insert(name, v)`: returns the previous value.
  const insert = (name: Symbol, v: boolean): boolean | undefined => {
    const current = known.get(name);
    known.set(name, v);
    return current;
  };

  outer: for (let n = it.next(); !n.done; n = it.next()) {
    const predicate = n.value;
    if (predicate.$ !== "Cfg") {
      wildcard_span = CfgSelectPredicate.span(predicate);
      break;
    }
    const cfg_entry = predicate._0;

    switch (cfg_entry.$) {
      case "Bool":
        if (cfg_entry._0) {
          wildcard_span = CfgSelectPredicate.span(predicate);
          break outer;
        } else {
          continue;
        }
      case "NameValue": {
        const { name, value } = cfg_entry;
        if (value === undefined) {
          // `name` will be false in all subsequent branches.
          const current = insert(name, false);

          switch (current) {
            case undefined:
              continue;
            case false:
              branch_is_unreachable(predicate, undefined);
              break outer;
            case true:
              // this branch will be taken, so all subsequent branches are unreachable.
              break outer;
          }
        } else {
          // FIXME(https://github.com/rust-lang/rust/pull/149960#issuecomment-3780301699): expand capabilities.
        }
        break;
      }
      case "Not": {
        const inner = cfg_entry._0;
        if (inner.$ === "NameValue" && inner.value === undefined) {
          const name = inner.name;
          // `name` will be true in all subsequent branches.
          const current = insert(name, true);

          switch (current) {
            case undefined:
              continue;
            case true:
              branch_is_unreachable(predicate, undefined);
              break outer;
            case false:
              // this branch will be taken, so all subsequent branches are unreachable.
              break outer;
          }
        } else {
          // FIXME(https://github.com/rust-lang/rust/pull/149960#issuecomment-3780301699): expand capabilities.
        }
        break;
      }
      case "All":
      case "Any":
        /* for now we don't bother solving these */
        break;
      case "Version":
        /* don't bother solving these */
        break;
    }
  }

  for (let n = it.next(); !n.done; n = it.next()) {
    branch_is_unreachable(n.value, wildcard_span);
  }
}
