// Port of compiler/rustc_parse/src/parser/token_type.rs
// `TokenType`, `ExpTokenPair`, `ExpKeywordPair` are generated into token_type.gen.ts.
//
// PORT: init order (see parser/decls.ts): this module has no `impl Parser`; it must never import
// `./mod.ts` (or another parser extension module) at runtime, because `mod.ts` imports it.
import { TokenKind } from "../../rustc_ast/token.ts";
import { kw, sym, Symbol } from "../../rustc_span/symbol.ts";
import { panic } from "../../std/panic.ts";
import * as gen from "./token_type.gen.ts";
import { type ExpKeywordPair, type ExpTokenPair, TokenType_discriminant } from "./token_type.gen.ts";

export * from "./token_type.gen.ts";

/// Used in "expected"/"expected one of" error messages. Tokens are added here
/// as necessary. Tokens with values (e.g. literals, identifiers) are
/// represented by a single variant (e.g. `Literal`, `Ident`).
///
/// It's an awkward representation, but it's important for performance. It's a
/// C-style parameterless enum so that `TokenTypeSet` can be a bitset. This is
/// important because `Parser::expected_token_types` is very hot. `TokenType`
/// used to have variants with parameters (e.g. all the keywords were in a
/// single `Keyword` variant with a `Symbol` parameter) and
/// `Parser::expected_token_types` was a `Vec<TokenType>` which was much slower
/// to manipulate.
///
/// We really want to keep the number of variants to 128 or fewer, so that
/// `TokenTypeSet` can be implemented with a `u128`.
export type TokenType = gen.TokenType;

// Macro to avoid repetitive boilerplate code.
// PORT: `macro_rules! from_u32_match` expands to one guarded arm per listed variant, in list order:
// `t if t == TokenType::$tok as u32 => TokenType::$tok`, then `_ => panic!(..)`. The list is kept
// verbatim (it omits `SymBikeshed` and `SymPin`, like upstream).
const FROM_U32_LIST: readonly TokenType[] = [
  "Eq",
  "Lt",
  "Le",
  "EqEq",
  "Gt",
  "AndAnd",
  "OrOr",
  "Bang",
  "Tilde",

  "Plus",
  "Minus",
  "Star",
  "And",
  "Or",

  "At",
  "Dot",
  "DotDot",
  "DotDotDot",
  "DotDotEq",
  "Comma",
  "Semi",
  "Colon",
  "PathSep",
  "RArrow",
  "FatArrow",
  "Pound",
  "Question",
  "OpenParen",
  "CloseParen",
  "OpenBrace",
  "CloseBrace",
  "OpenBracket",
  "CloseBracket",
  "Eof",

  "Operator",
  "Ident",
  "Lifetime",
  "Path",
  "Type",
  "Const",

  "KwAs",
  "KwAsync",
  "KwAuto",
  "KwAwait",
  "KwBecome",
  "KwBox",
  "KwBreak",
  "KwCatch",
  "KwConst",
  "KwContinue",
  "KwContractEnsures",
  "KwContractRequires",
  "KwCrate",
  "KwDefault",
  "KwDyn",
  "KwElse",
  "KwEnum",
  "KwExtern",
  "KwFn",
  "KwFor",
  "KwFinal",
  "KwGen",
  "KwIf",
  "KwImpl",
  "KwIn",
  "KwLet",
  "KwLoop",
  "KwMacro",
  "KwMacroRules",
  "KwMatch",
  "KwMod",
  "KwMove",
  "KwMut",
  "KwPin",
  "KwPub",
  "KwRaw",
  "KwRef",
  "KwReturn",
  "KwReuse",
  "KwSafe",
  "KwSelfUpper",
  "KwStatic",
  "KwStruct",
  "KwSuper",
  "KwTrait",
  "KwTry",
  "KwType",
  "KwUnderscore",
  "KwUnsafe",
  "KwUse",
  "KwWhere",
  "KwWhile",
  "KwYield",

  "SymAttSyntax",
  "SymClobberAbi",
  "SymInlateout",
  "SymInout",
  "SymIs",
  "SymLabel",
  "SymLateout",
  "SymMayUnwind",
  "SymNomem",
  "SymNoreturn",
  "SymNostack",
  "SymNull",
  "SymOptions",
  "SymOut",
  "SymPreservesFlags",
  "SymPure",
  "SymReadonly",
  "SymSym",
];

export const TokenType = {
  ...gen.TokenType,

  // rustc: compiler/rustc_parse/src/parser/token_type.rs:172 from_u32
  from_u32(val: number): TokenType {
    // PORT: `from_u32_match! { val; .. }` (see FROM_U32_LIST).
    let token_type: TokenType | undefined;
    for (const t of FROM_U32_LIST) {
      if (val === TokenType_discriminant[t]) {
        token_type = t;
        break;
      }
    }
    if (token_type === undefined) panic(`unhandled value: ${val}`);
    return token_type;
  },

  // rustc: compiler/rustc_parse/src/parser/token_type.rs:294 is_keyword
  is_keyword(self: TokenType): Symbol | undefined {
    switch (self) {
      case "KwAs":
        return kw.As;
      case "KwAsync":
        return kw.Async;
      case "KwAuto":
        return kw.Auto;
      case "KwAwait":
        return kw.Await;
      case "KwBecome":
        return kw.Become;
      case "KwBox":
        return kw.Box;
      case "KwBreak":
        return kw.Break;
      case "KwCatch":
        return kw.Catch;
      case "KwConst":
        return kw.Const;
      case "KwContinue":
        return kw.Continue;
      case "KwContractEnsures":
        return kw.ContractEnsures;
      case "KwContractRequires":
        return kw.ContractRequires;
      case "KwCrate":
        return kw.Crate;
      case "KwDefault":
        return kw.Default;
      case "KwDyn":
        return kw.Dyn;
      case "KwElse":
        return kw.Else;
      case "KwEnum":
        return kw.Enum;
      case "KwExtern":
        return kw.Extern;
      case "KwFn":
        return kw.Fn;
      case "KwFor":
        return kw.For;
      case "KwFinal":
        return kw.Final;
      case "KwGen":
        return kw.Gen;
      case "KwIf":
        return kw.If;
      case "KwImpl":
        return kw.Impl;
      case "KwIn":
        return kw.In;
      case "KwLet":
        return kw.Let;
      case "KwLoop":
        return kw.Loop;
      case "KwMacroRules":
        return kw.MacroRules;
      case "KwMacro":
        return kw.Macro;
      case "KwMatch":
        return kw.Match;
      case "KwMod":
        return kw.Mod;
      case "KwMove":
        return kw.Move;
      case "KwMut":
        return kw.Mut;
      case "KwPin":
        return kw.Pin;
      case "KwPub":
        return kw.Pub;
      case "KwRaw":
        return kw.Raw;
      case "KwRef":
        return kw.Ref;
      case "KwReturn":
        return kw.Return;
      case "KwReuse":
        return kw.Reuse;
      case "KwSafe":
        return kw.Safe;
      case "KwSelfUpper":
        return kw.SelfUpper;
      case "KwStatic":
        return kw.Static;
      case "KwStruct":
        return kw.Struct;
      case "KwSuper":
        return kw.Super;
      case "KwTrait":
        return kw.Trait;
      case "KwTry":
        return kw.Try;
      case "KwType":
        return kw.Type;
      case "KwUnderscore":
        return kw.Underscore;
      case "KwUnsafe":
        return kw.Unsafe;
      case "KwUse":
        return kw.Use;
      case "KwWhere":
        return kw.Where;
      case "KwWhile":
        return kw.While;
      case "KwYield":
        return kw.Yield;

      case "SymAttSyntax":
        return sym.att_syntax;
      case "SymClobberAbi":
        return sym.clobber_abi;
      case "SymInlateout":
        return sym.inlateout;
      case "SymInout":
        return sym.inout;
      case "SymIs":
        return sym.is;
      case "SymLabel":
        return sym.label;
      case "SymLateout":
        return sym.lateout;
      case "SymMayUnwind":
        return sym.may_unwind;
      case "SymNomem":
        return sym.nomem;
      case "SymNoreturn":
        return sym.noreturn;
      case "SymNostack":
        return sym.nostack;
      case "SymNull":
        return sym.null;
      case "SymOptions":
        return sym.options;
      case "SymOut":
        return sym.out;
      case "SymPreservesFlags":
        return sym.preserves_flags;
      case "SymPure":
        return sym.pure;
      case "SymReadonly":
        return sym.readonly;
      case "SymSym":
        return sym.sym;
      default:
        return undefined;
    }
  },

  // The output should be the same as that produced by
  // `rustc_ast_pretty::pprust::token_to_string`.
  // rustc: compiler/rustc_parse/src/parser/token_type.rs:374 to_string
  to_string(self: TokenType): string {
    switch (self) {
      case "Eq":
        return "`=`";
      case "Lt":
        return "`<`";
      case "Le":
        return "`<=`";
      case "EqEq":
        return "`==`";
      case "Gt":
        return "`>`";
      case "AndAnd":
        return "`&&`";
      case "OrOr":
        return "`||`";
      case "Bang":
        return "`!`";
      case "Tilde":
        return "`~`";

      case "Plus":
        return "`+`";
      case "Minus":
        return "`-`";
      case "Star":
        return "`*`";
      case "And":
        return "`&`";
      case "Or":
        return "`|`";

      case "At":
        return "`@`";
      case "Dot":
        return "`.`";
      case "DotDot":
        return "`..`";
      case "DotDotDot":
        return "`...`";
      case "DotDotEq":
        return "`..=`";
      case "Comma":
        return "`,`";
      case "Semi":
        return "`;`";
      case "Colon":
        return "`:`";
      case "PathSep":
        return "`::`";
      case "RArrow":
        return "`->`";
      case "FatArrow":
        return "`=>`";
      case "Pound":
        return "`#`";
      case "Question":
        return "`?`";
      case "OpenParen":
        return "`(`";
      case "CloseParen":
        return "`)`";
      case "OpenBrace":
        return "`{`";
      case "CloseBrace":
        return "`}`";
      case "OpenBracket":
        return "`[`";
      case "CloseBracket":
        return "`]`";
      case "Eof":
        return "<eof>";

      case "Operator":
        return "an operator";
      case "Ident":
        return "identifier";
      case "Lifetime":
        return "lifetime";
      case "Path":
        return "path";
      case "Type":
        return "type";
      case "Const":
        return "a const expression";

      default: {
        const k = TokenType.is_keyword(self);
        if (k === undefined) panic("called `Option::unwrap()` on a `None` value");
        // PORT: `Display for Symbol` is `as_str()`.
        return `\`${Symbol.as_str(k)}\``;
      }
    }
  },
};

// Gets a statically-known `ExpTokenPair` pair (for non-keywords) or
// `ExpKeywordPair` (for keywords), as used with various `check`/`expect`
// methods in `Parser`.
//
// The name is short because it's used a lot.
// PORT: `macro_rules! exp` -> a table of frozen pairs: `exp!(Comma)` is `exp.Comma`. Where the macro
// has two arms for one input, the first arm wins (macro_rules order): `exp!(Pin)` is
// `@kw, Pin, KwMut`; the later `(Pin) => exp!(@sym, pin, SymPin)` arm is unreachable upstream.
const tok = (t: keyof typeof gen.TokenType & keyof typeof TokenKind): ExpTokenPair =>
  Object.freeze({ tok: TokenKind[t] as TokenKind, token_type: gen.TokenType[t] });
const kwp = (k: Symbol, token_type: TokenType): ExpKeywordPair => Object.freeze({ kw: k, token_type });
export const exp = {
  Eq: tok("Eq"),
  Lt: tok("Lt"),
  Le: tok("Le"),
  EqEq: tok("EqEq"),
  Gt: tok("Gt"),
  AndAnd: tok("AndAnd"),
  OrOr: tok("OrOr"),
  Bang: tok("Bang"),
  Tilde: tok("Tilde"),
  Plus: tok("Plus"),
  Minus: tok("Minus"),
  Star: tok("Star"),
  And: tok("And"),
  Or: tok("Or"),
  At: tok("At"),
  Dot: tok("Dot"),
  DotDot: tok("DotDot"),
  DotDotDot: tok("DotDotDot"),
  DotDotEq: tok("DotDotEq"),
  Comma: tok("Comma"),
  Semi: tok("Semi"),
  Colon: tok("Colon"),
  PathSep: tok("PathSep"),
  RArrow: tok("RArrow"),
  FatArrow: tok("FatArrow"),
  Pound: tok("Pound"),
  Question: tok("Question"),
  Eof: tok("Eof"),

  OpenParen: tok("OpenParen"),
  OpenBrace: tok("OpenBrace"),
  OpenBracket: tok("OpenBracket"),
  CloseParen: tok("CloseParen"),
  CloseBrace: tok("CloseBrace"),
  CloseBracket: tok("CloseBracket"),

  As: kwp(kw.As, "KwAs"),
  Async: kwp(kw.Async, "KwAsync"),
  Auto: kwp(kw.Auto, "KwAuto"),
  Await: kwp(kw.Await, "KwAwait"),
  Become: kwp(kw.Become, "KwBecome"),
  Box: kwp(kw.Box, "KwBox"),
  Break: kwp(kw.Break, "KwBreak"),
  Catch: kwp(kw.Catch, "KwCatch"),
  Const: kwp(kw.Const, "KwConst"),
  Continue: kwp(kw.Continue, "KwContinue"),
  ContractEnsures: kwp(kw.ContractEnsures, "KwContractEnsures"),
  ContractRequires: kwp(kw.ContractRequires, "KwContractRequires"),
  Crate: kwp(kw.Crate, "KwCrate"),
  Default: kwp(kw.Default, "KwDefault"),
  Dyn: kwp(kw.Dyn, "KwDyn"),
  Else: kwp(kw.Else, "KwElse"),
  Enum: kwp(kw.Enum, "KwEnum"),
  Extern: kwp(kw.Extern, "KwExtern"),
  Fn: kwp(kw.Fn, "KwFn"),
  For: kwp(kw.For, "KwFor"),
  Final: kwp(kw.Final, "KwFinal"),
  Gen: kwp(kw.Gen, "KwGen"),
  If: kwp(kw.If, "KwIf"),
  Impl: kwp(kw.Impl, "KwImpl"),
  In: kwp(kw.In, "KwIn"),
  Let: kwp(kw.Let, "KwLet"),
  Loop: kwp(kw.Loop, "KwLoop"),
  Macro: kwp(kw.Macro, "KwMacro"),
  MacroRules: kwp(kw.MacroRules, "KwMacroRules"),
  Match: kwp(kw.Match, "KwMatch"),
  Mod: kwp(kw.Mod, "KwMod"),
  Move: kwp(kw.Move, "KwMove"),
  Mut: kwp(kw.Mut, "KwMut"),
  Pin: kwp(kw.Pin, "KwMut"),
  Pub: kwp(kw.Pub, "KwPub"),
  Raw: kwp(kw.Raw, "KwRaw"),
  Ref: kwp(kw.Ref, "KwRef"),
  Return: kwp(kw.Return, "KwReturn"),
  Reuse: kwp(kw.Reuse, "KwReuse"),
  Safe: kwp(kw.Safe, "KwSafe"),
  SelfUpper: kwp(kw.SelfUpper, "KwSelfUpper"),
  Static: kwp(kw.Static, "KwStatic"),
  Struct: kwp(kw.Struct, "KwStruct"),
  Super: kwp(kw.Super, "KwSuper"),
  Trait: kwp(kw.Trait, "KwTrait"),
  Try: kwp(kw.Try, "KwTry"),
  Type: kwp(kw.Type, "KwType"),
  Underscore: kwp(kw.Underscore, "KwUnderscore"),
  Unsafe: kwp(kw.Unsafe, "KwUnsafe"),
  Use: kwp(kw.Use, "KwUse"),
  Where: kwp(kw.Where, "KwWhere"),
  While: kwp(kw.While, "KwWhile"),
  Yield: kwp(kw.Yield, "KwYield"),

  AttSyntax: kwp(sym.att_syntax, "SymAttSyntax"),
  Bikeshed: kwp(sym.bikeshed, "SymBikeshed"),
  ClobberAbi: kwp(sym.clobber_abi, "SymClobberAbi"),
  Inlateout: kwp(sym.inlateout, "SymInlateout"),
  Inout: kwp(sym.inout, "SymInout"),
  Is: kwp(sym.is, "SymIs"),
  Label: kwp(sym.label, "SymLabel"),
  Lateout: kwp(sym.lateout, "SymLateout"),
  MayUnwind: kwp(sym.may_unwind, "SymMayUnwind"),
  Nomem: kwp(sym.nomem, "SymNomem"),
  Noreturn: kwp(sym.noreturn, "SymNoreturn"),
  Nostack: kwp(sym.nostack, "SymNostack"),
  Null: kwp(sym.null, "SymNull"),
  Options: kwp(sym.options, "SymOptions"),
  Out: kwp(sym.out, "SymOut"),
  PreservesFlags: kwp(sym.preserves_flags, "SymPreservesFlags"),
  Pure: kwp(sym.pure, "SymPure"),
  Readonly: kwp(sym.readonly, "SymReadonly"),
  Sym: kwp(sym.sym, "SymSym"),
} as const;

/// A bitset type designed specifically for `Parser::expected_token_types`,
/// which is very hot. `u128` is the smallest integer that will fit every
/// `TokenType` value.
// PORT: `TokenTypeSet(u128)` (`Copy`) -> four u32 words (`w0` = bits 0..31, ..., `w3` = bits 96..127)
// instead of a `bigint`, because this is the parser's hottest path (PORTING §7). Same bit layout and
// iteration order (lowest set bit first). It is mutated in place by `insert`/`clear`, so every Rust
// copy is a `clone()` here (`Parser` clones, `iter`).
export class TokenTypeSet {
  constructor(
    public w0: number,
    public w1: number,
    public w2: number,
    public w3: number,
  ) {}

  // rustc: compiler/rustc_parse/src/parser/token_type.rs:596 new
  static new(): TokenTypeSet {
    return new TokenTypeSet(0, 0, 0, 0);
  }

  // rustc: compiler/rustc_parse/src/parser/token_type.rs:600 is_empty
  is_empty(): boolean {
    return (this.w0 | this.w1 | this.w2 | this.w3) === 0;
  }

  // rustc: compiler/rustc_parse/src/parser/token_type.rs:604 insert
  insert(token_type: TokenType): void {
    const b = TokenType_discriminant[token_type];
    const m = (1 << (b & 31)) >>> 0;
    switch (b >>> 5) {
      case 0:
        this.w0 = (this.w0 | m) >>> 0;
        break;
      case 1:
        this.w1 = (this.w1 | m) >>> 0;
        break;
      case 2:
        this.w2 = (this.w2 | m) >>> 0;
        break;
      default:
        this.w3 = (this.w3 | m) >>> 0;
        break;
    }
  }

  // rustc: compiler/rustc_parse/src/parser/token_type.rs:608 clear
  clear(): void {
    this.w0 = 0;
    this.w1 = 0;
    this.w2 = 0;
    this.w3 = 0;
  }

  // rustc: compiler/rustc_parse/src/parser/token_type.rs:612 contains
  contains(token_type: TokenType): boolean {
    const b = TokenType_discriminant[token_type];
    const m = (1 << (b & 31)) >>> 0;
    const w = b >>> 5 === 0 ? this.w0 : b >>> 5 === 1 ? this.w1 : b >>> 5 === 2 ? this.w2 : this.w3;
    return (w & m) !== 0;
  }

  // rustc: compiler/rustc_parse/src/parser/token_type.rs:616 iter
  iter(): TokenTypeSetIter {
    return new TokenTypeSetIter(this.clone());
  }

  /** `#[derive(Clone, Copy)]` */
  clone(): TokenTypeSet {
    return new TokenTypeSet(this.w0, this.w1, this.w2, this.w3);
  }
}

/** `#[derive(Clone)]` */
export function clone_TokenTypeSet(v: TokenTypeSet): TokenTypeSet {
  return v.clone();
}

/** `u128::trailing_zeros` over the four words. */
function trailing_zeros(s: TokenTypeSet): number {
  if (s.w0 !== 0) return 31 - Math.clz32(s.w0 & -s.w0);
  if (s.w1 !== 0) return 32 + 31 - Math.clz32(s.w1 & -s.w1);
  if (s.w2 !== 0) return 64 + 31 - Math.clz32(s.w2 & -s.w2);
  if (s.w3 !== 0) return 96 + 31 - Math.clz32(s.w3 & -s.w3);
  return 128;
}

// The `TokenTypeSet` is a copy of the set being iterated. It initially holds
// the entire set. Each bit is cleared as it is returned. We have finished once
// it is all zeroes.
export class TokenTypeSetIter implements Iterable<TokenType> {
  constructor(public _0: TokenTypeSet) {}

  // rustc: compiler/rustc_parse/src/parser/token_type.rs:629 next
  next(): TokenType | undefined {
    // PORT: `size_of_val(&self.0.0) * 8` of a `u128`.
    const num_bits: number = 128;
    // assert_eq!(num_bits, 128): always true here.
    const z = trailing_zeros(this._0);
    if (z === num_bits) {
      return undefined;
    } else {
      // clear the trailing 1 bit
      const m = ~((1 << (z & 31)) >>> 0) >>> 0;
      switch (z >>> 5) {
        case 0:
          this._0.w0 = (this._0.w0 & m) >>> 0;
          break;
        case 1:
          this._0.w1 = (this._0.w1 & m) >>> 0;
          break;
        case 2:
          this._0.w2 = (this._0.w2 & m) >>> 0;
          break;
        default:
          this._0.w3 = (this._0.w3 & m) >>> 0;
          break;
      }
      return TokenType.from_u32(z);
    }
  }

  /** `impl Iterator` -> JS iteration protocol. */
  *[globalThis.Symbol.iterator](): Iterator<TokenType> {
    let t: TokenType | undefined;
    while ((t = this.next()) !== undefined) yield t;
  }
}
