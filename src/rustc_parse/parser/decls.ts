// The parser contract: one declaration of every method of `impl Parser` (all parser files).
//
// rustc splits `impl<'a> Parser<'a>` over ~15 files. Every method is declared here, once, grouped by
// upstream file in upstream order (`// <file>:<line>` = line of the `fn` keyword at the pin), so that
// all parser files type-check against one surface while they are ported in parallel. The method
// bodies are assigned onto `Parser.prototype` by the file that ports them (PORTING §5).
//
// Signature rules (PORTING §5):
// - `&self` / `&mut self` -> `this`; `self`-by-value builders return `Parser`.
// - `PResult<'a, T>` -> `PResult<T>` (= `Result<T, Diag>`); `()` -> `undefined` (`PResult<undefined>`).
// - `Box<T>`, `P<T>`, `&T`, `&mut T` -> `T`; `Vec`/`ThinVec`/`[T]` -> `T[]` (`&[T]` -> `readonly T[]`).
// - `&mut` of a value that the callee replaces as a whole (`*x = ..`, `mem::replace`) -> `MutRef<T>`.
// - `Option<T>` -> `T | undefined`; `Option<Option<T>>` -> `{ $: "Some"; _0: T | undefined } | undefined`.
//   Generic `Option<T>` returns (`eat_metavar_seq`, `tree_look_ahead`) assume `T` is never `undefined`.
// - Closures `impl FnMut(&mut Parser) -> R` -> `(this_: Parser) => R`.
// - Trait bounds become impl tables as trailing parameters (ast-visit convention):
//   `R: HasTokens` -> `R_HasTokens: HasTokens<R>, R_HasAttrs: HasAttrs<R>` (supertrait);
//   `T: RecoverQPath` -> `T_RecoverQPath: RecoverQPath<T>` (trait table in ./diagnostics.ts).
// - Parameter names that are JS reserved words get a trailing `_` (`case_`, `default_`).
// - Associated fns without `self` are not here: `Parser.new` is a static in mod.ts; the others are
//   module-level functions of their file (nonterminal_may_begin_with, mk_token_lit_char,
//   mk_meta_item_lit_char, make_all_value_bindings_mutable, field_def_extras).
//
// Ownership: lane parser-core wrote this file; afterwards root owns it. A lane that finds a missing
// or wrong declaration asks root (handoff file) instead of editing it.
import type { HasAttrs, HasTokens } from "../../rustc_ast/ast_traits.ts";
import type { AngleBracketedArg, AnonConst, Arm, AssignOp, AssocItem, AssocItemConstraintKind, AttrArgs, AttrItem, AttrVec, Attribute, BinOp, BindingMode, Block, BlockCheckMode, BorrowKind, BoundConstness, ByRef, CaptureBy, Const, ConstBlockItem, CoroutineMarker, Crate, Defaultness, DelimArgs, Expr, ExprField, ExprKind, Extern, FieldDef, FieldDefExtras, FnContract, FnDecl, FnHeader, FnRetTy, FnSig, ForeignItem, GenericArg, GenericArgs, GenericBound, GenericBounds, GenericParam, Generics, Guard, ImplPolarity, ImplRestriction, Item, ItemKind, Label, Lifetime, Local, MacCall, MatchKind, MetaItem, MetaItemInner, MetaItemKind, MetaItemLit, ModSpans, MutRestriction, Mutability, Param, Parens, Pat, PatField, PatFieldsRest, PatKind, Path, PathSegment, Pinnedness, QSelf, RangeEnd, RangeLimits, Recovered, RestrictionKind, Safety, Stmt, StmtKind, StrLit, StructRest, TestBinderBody, TestBinderBoundTypeConstraint, TestBinderConstraint, TestBinderConstraints, TestBinderExists, TestBinderForall, TraitBoundModifiers, Ty, TyKind, UnOp, UnsafeBinderCastKind, UseTree, UseTreeAndId, UseTreeKind, Variant, Visibility, WhereBoundPredicate, WhereClause, WherePredicate } from "../../rustc_ast/lib.ts";
import type { IdentKind, Lit, MetaVarKind, NonterminalKind, Token, TokenKind } from "../../rustc_ast/token.ts";
import type { Spacing, TokenStream, TokenTree, WithTokens } from "../../rustc_ast/tokenstream.ts";
import type { Case } from "../../rustc_ast/util/case.ts";
import type { AssocOp, ExprPrecedence } from "../../rustc_ast/util/parser.ts";
import type { Diag, DiagCtxtHandle, PResult } from "../../rustc_errors/lib.ts";
import type { ParseSess } from "../../rustc_session/parse.ts";
import type { MutRef } from "../../rustc_span/hygiene.ts";
import type { ErrorGuaranteed, Span, SpanSnippetError, Spanned } from "../../rustc_span/lib.ts";
import type { Ident, Symbol } from "../../rustc_span/symbol.ts";
import type { Fmt } from "../../std/fmt.ts";
import type { Result } from "../../std/result.ts";
import type { ComparisonOperatorsCannotBeChained, InvalidVariableDeclarationSub } from "../diagnostics.ts";
import type { AttrWrapper, CollectPos, UsePreAttrPos } from "./attr_wrapper.ts";
import type { InnerAttrPolicy, OuterAttributeType } from "./attr.ts";
import type { AttemptLocalParseRecovery, ConsumeClosingDelim, RecoverQPath as RecoverQPathImpl, SnapshotParser } from "./diagnostics.ts";
import type { Bound, DestructuredFloat, LetChainsPolicy } from "./expr.ts";
import type { IncOrDec, UnaryFixity } from "./expr/diagnostics.ts";
import type { FnContext, FnParseMode, FrontMatterParsingMode } from "./function.ts";
import type { PredicateKindOrStructBody } from "./generics.ts";
import type { IsMacroRulesItem, ReuseKind, UsePathList } from "./item.ts";
import type { CommaRecoveryMode, EatOrResult, Expected, PatternLocation, RecoverColon, RecoverComma } from "./pat.ts";
import type { PathStyle } from "./path.ts";
import type { ExpKeywordPair, ExpTokenPair, TokenType } from "./token_type.ts";
import type { AllowCVariadic, AllowPlus, RecoverQPath, RecoverQuestionMark, RecoverReturnSign } from "./ty.ts";
import type { AllowConstBlockItems, BlockMode, ClosureSpans, FollowedByType, ForceCollect, ParseNtResult, ParsingRestrictionKind, Recovery, Restrictions, SemiColonMode, SeqSep, Trailing } from "./mod.ts";

declare module "./mod.ts" {
  interface Parser {
    // ---- compiler/rustc_parse/src/parser/mod.rs ----
    // mod.rs:376
    recovery(recovery: Recovery): Parser;
    // mod.rs:382
    with_recovery<T>(recovery: Recovery, f: (this_: Parser) => T): T;
    // mod.rs:397
    may_recover(): boolean;
    // mod.rs:403
    unexpected_any<T>(): PResult<T>;
    // mod.rs:412
    unexpected(): PResult<undefined>;
    // mod.rs:417
    expect(exp: ExpTokenPair): PResult<Recovered>;
    // mod.rs:433
    expect_one_of(edible: readonly ExpTokenPair[], inedible: readonly ExpTokenPair[]): PResult<Recovered>;
    // mod.rs:455
    parse_ident(): PResult<Ident>;
    // mod.rs:459
    parse_ident_common(recover: boolean): PResult<Ident>;
    // mod.rs:476
    ident_or_err(recover: boolean): PResult<[Ident, IdentKind]>;
    // mod.rs:488
    check(exp: ExpTokenPair): boolean;
    // mod.rs:498
    check_noexpect(tok: TokenKind): boolean;
    // mod.rs:508
    check_noexpect_past_close_delim(tok: TokenKind): boolean;
    // mod.rs:521
    eat_noexpect(tok: TokenKind): boolean;
    // mod.rs:532
    eat(exp: ExpTokenPair): boolean;
    // mod.rs:544
    check_keyword(exp: ExpKeywordPair): boolean;
    // mod.rs:554
    check_keyword_case(exp: ExpKeywordPair, case_: Case): boolean;
    // mod.rs:573
    eat_keyword(exp: ExpKeywordPair): boolean;
    // mod.rs:586
    eat_keyword_case(exp: ExpKeywordPair, case_: Case): boolean;
    // mod.rs:620
    eat_keyword_noexpect(kw: Symbol): boolean;
    // mod.rs:631
    expect_keyword(exp: ExpKeywordPair): PResult<undefined>;
    // mod.rs:636
    eat_metavar_seq<T>(mv_kind: MetaVarKind, f: (this_: Parser) => PResult<T>): T | undefined;
    // mod.rs:647
    eat_metavar_seq_with_matcher<T>(match_mv_kind: (a0: MetaVarKind) => boolean, f: (this_: Parser) => PResult<T>): T | undefined;
    // mod.rs:690
    is_kw_followed_by_ident(kw: Symbol): boolean;
    // mod.rs:695
    check_or_expected(ok: boolean, token_type: TokenType): boolean;
    // mod.rs:702
    check_ident(): boolean;
    // mod.rs:706
    check_path(): boolean;
    // mod.rs:710
    check_type(): boolean;
    // mod.rs:714
    check_const_arg(): boolean;
    // mod.rs:721
    check_const_closure(): boolean;
    // mod.rs:737
    check_inline_const(dist: number): boolean;
    // mod.rs:749
    check_plus(): boolean;
    // mod.rs:756
    break_and_eat(exp: ExpTokenPair): boolean;
    // mod.rs:786
    eat_plus(): boolean;
    // mod.rs:792
    expect_and(): PResult<undefined>;
    // mod.rs:798
    expect_or(): PResult<undefined>;
    // mod.rs:803
    eat_lt(): boolean;
    // mod.rs:815
    expect_lt(): PResult<undefined>;
    // mod.rs:821
    expect_gt(): PResult<undefined>;
    // mod.rs:835
    expect_any_with_type(closes_expected: readonly ExpTokenPair[], closes_not_expected: readonly TokenKind[]): boolean;
    // mod.rs:847
    parse_seq_to_before_tokens<T>(closes_expected: readonly ExpTokenPair[], closes_not_expected: readonly TokenKind[], sep: SeqSep, f: (this_: Parser) => PResult<T>): PResult<[T[], Trailing, Recovered]>;
    // mod.rs:992
    recover_missing_braces_around_closure_body(closure_spans: ClosureSpans, expect_err: Diag): PResult<undefined>;
    // mod.rs:1052
    parse_seq_to_before_end<T>(close: ExpTokenPair, sep: SeqSep, f: (this_: Parser) => PResult<T>): PResult<[T[], Trailing, Recovered]>;
    // mod.rs:1064
    parse_seq_to_end<T>(close: ExpTokenPair, sep: SeqSep, f: (this_: Parser) => PResult<T>): PResult<[T[], Trailing]>;
    // mod.rs:1083
    parse_unspanned_seq<T>(open: ExpTokenPair, close: ExpTokenPair, sep: SeqSep, f: (this_: Parser) => PResult<T>): PResult<[T[], Trailing]>;
    // mod.rs:1097
    parse_delim_comma_seq<T>(open: ExpTokenPair, close: ExpTokenPair, f: (this_: Parser) => PResult<T>): PResult<[T[], Trailing]>;
    // mod.rs:1109
    parse_paren_comma_seq<T>(f: (this_: Parser) => PResult<T>): PResult<[T[], Trailing]>;
    // mod.rs:1117
    bump_with(next: [Token, Spacing]): void;
    // mod.rs:1123
    inlined_bump_with(next: [Token, Spacing]): void;
    // mod.rs:1133
    bump(): void;
    // mod.rs:1156
    look_ahead<R>(dist: number, looker: (a0: Token) => R): R;
    // mod.rs:1210
    tree_look_ahead<R>(dist: number, looker: (a0: TokenTree) => R): R | undefined;
    // mod.rs:1219
    is_keyword_ahead(dist: number, kws: readonly Symbol[]): boolean;
    // mod.rs:1224
    parse_coroutine_marker(case_: Case): CoroutineMarker | undefined;
    // mod.rs:1248
    parse_safety(case_: Case): Safety;
    // mod.rs:1259
    parse_constness(case_: Case): Const;
    // mod.rs:1264
    parse_closure_constness(): Const;
    // mod.rs:1272
    parse_constness_(case_: Case, is_closure: boolean): Const;
    // mod.rs:1285
    parse_const_block(span: Span, pat: boolean): PResult<Expr>;
    // mod.rs:1309
    parse_mutability(): Mutability;
    // mod.rs:1318
    parse_byref(): ByRef;
    // mod.rs:1332
    parse_mut_or_const(): Mutability | undefined;
    // mod.rs:1347
    parse_field_name(): PResult<Ident>;
    // mod.rs:1363
    parse_delim_args(): PResult<DelimArgs>;
    // mod.rs:1371
    parse_attr_args(): PResult<AttrArgs>;
    // mod.rs:1383
    parse_delim_args_inner(): DelimArgs | undefined;
    // mod.rs:1397
    parse_token_tree(): TokenTree;
    // mod.rs:1442
    parse_tokens(): TokenStream;
    // mod.rs:1457
    with_res<T>(res: Restrictions, f: (this_: Parser) => T): T;
    // mod.rs:1471
    parse_visibility(fbt: FollowedByType): PResult<Visibility>;
    // mod.rs:1531
    recover_incorrect_vis_restriction(): PResult<undefined>;
    // mod.rs:1545
    parse_impl_restriction(): PResult<ImplRestriction>;
    // mod.rs:1559
    parse_mut_restriction(): PResult<MutRestriction>;
    // mod.rs:1575
    parse_restriction(restriction_kind: ParsingRestrictionKind): PResult<[RestrictionKind, Span, Span]>;
    // mod.rs:1628
    parse_extern(case_: Case): Extern;
    // mod.rs:1642
    parse_abi(): StrLit | undefined;
    // mod.rs:1656
    collect_tokens_no_attrs<R>(f: (this_: Parser) => PResult<R>, R_HasTokens: HasTokens<R>, R_HasAttrs: HasAttrs<R>): PResult<R>;
    // mod.rs:1668
    check_path_sep_and_look_ahead(looker: (a0: Token) => boolean): boolean;
    // mod.rs:1682
    is_import_coupler(): boolean;
    // mod.rs:1689
    debug_lookahead(lookahead: number): (f: Fmt) => string;
    // mod.rs:1721
    clear_expected_token_types(): void;
    // mod.rs:1725
    approx_token_stream_pos(): number;
    // mod.rs:1735
    token_uninterpolated_span(): Span;
    // mod.rs:1744
    prev_token_uninterpolated_span(): Span;
    // mod.rs:1752
    missing_semi_from_binop(kind_desc: string, expr: Expr, decl_lo: Span | undefined): [Span, ErrorGuaranteed] | undefined;

    // ---- compiler/rustc_parse/src/parser/attr.rs ----
    // attr.rs:40
    parse_outer_attributes(): PResult<AttrWrapper>;
    // attr.rs:116
    parse_attribute(inner_parse_policy: InnerAttrPolicy): PResult<Attribute>;
    // attr.rs:181
    annotate_following_item_if_applicable(err: Diag, span: Span, attr_type: OuterAttributeType, suggest_to_outer: boolean): Span | undefined;
    // attr.rs:256
    error_on_forbidden_inner_attr(attr_sp: Span, policy: InnerAttrPolicy, suggest_to_outer: boolean): void;
    // attr.rs:323
    parse_attr_item(force_collect: ForceCollect): PResult<WithTokens<AttrItem>>;
    // attr.rs:365
    parse_inner_attributes(): PResult<AttrVec>;
    // attr.rs:406
    parse_unsuffixed_meta_item_lit(): PResult<MetaItemLit>;
    // attr.rs:418
    parse_meta_seq_top(): PResult<MetaItemInner[]>;
    // attr.rs:436
    parse_meta_item(): PResult<MetaItem>;
    // attr.rs:459
    parse_meta_item_kind(): PResult<MetaItemKind>;
    // attr.rs:475
    parse_meta_item_inner(): PResult<MetaItemInner>;
    // attr.rs:512
    recover_from_outer_attributes(target: string): PResult<undefined>;

    // ---- compiler/rustc_parse/src/parser/attr_wrapper.rs ----
    // attr_wrapper.rs:95
    collect_pos(): CollectPos;
    // attr_wrapper.rs:156
    collect_tokens<R>(pre_attr_pos: CollectPos | undefined, attrs: AttrWrapper, force_collect: ForceCollect, f: (this_: Parser, a1: AttrVec) => PResult<[R, Trailing, UsePreAttrPos]>, R_HasTokens: HasTokens<R>, R_HasAttrs: HasAttrs<R>): PResult<R>;

    // ---- compiler/rustc_parse/src/parser/nonterminal.rs ----
    // nonterminal.rs:121
    parse_nonterminal(kind: NonterminalKind): PResult<ParseNtResult>;

    // ---- compiler/rustc_parse/src/parser/diagnostics.rs ----
    // diagnostics.rs:178
    dcx(): DiagCtxtHandle;
    // diagnostics.rs:183
    restore_snapshot(snapshot: SnapshotParser): void;
    // diagnostics.rs:188
    create_snapshot_for_diagnostic(): SnapshotParser;
    // diagnostics.rs:193
    span_to_snippet(span: Span): Result<string, SpanSnippetError>;
    // diagnostics.rs:200
    expected_ident_found(recover: boolean): PResult<[Ident, IdentKind]>;
    // diagnostics.rs:321
    expected_ident_found_err(): Diag;
    // diagnostics.rs:330
    is_lit_bad_ident(): [number, Symbol] | undefined;
    // diagnostics.rs:347
    expected_one_of_not_found(edible: readonly ExpTokenPair[], inedible: readonly ExpTokenPair[]): PResult<ErrorGuaranteed>;
    // diagnostics.rs:652
    is_expected_raw_ref_mut(): boolean;
    // diagnostics.rs:663
    label_expected_raw_ref(err: Diag): void;
    // diagnostics.rs:676
    check_for_misspelled_kw(err: Diag, expected: readonly TokenType[]): void;
    // diagnostics.rs:720
    attr_on_non_tail_expr(expr: Expr): ErrorGuaranteed;
    // diagnostics.rs:825
    check_too_many_raw_str_terminators(err: Diag): boolean;
    // diagnostics.rs:867
    maybe_suggest_struct_literal(lo: Span, s: BlockCheckMode, maybe_struct_name: Token): PResult<Block> | undefined;
    // diagnostics.rs:925
    recover_closure_body(err: Diag, before: Token, prev: Token, token: Token, lo: Span, decl_hi: Span): PResult<Expr>;
    // diagnostics.rs:983
    eat_to_tokens(closes: readonly ExpTokenPair[]): void;
    // diagnostics.rs:1001
    check_trailing_angle_brackets(segment: PathSegment, end: readonly ExpTokenPair[]): ErrorGuaranteed | undefined;
    // diagnostics.rs:1102
    check_turbofish_missing_angle_brackets(segment: PathSegment): void;
    // diagnostics.rs:1148
    check_mistyped_turbofish_with_multiple_type_params(e: Diag, expr: MutRef<Expr>): PResult<ErrorGuaranteed>;
    // diagnostics.rs:1202
    suggest_add_missing_let_for_stmt(err: Diag): void;
    // diagnostics.rs:1225
    attempt_chained_comparison_suggestion(err: ComparisonOperatorsCannotBeChained, inner_op: Expr, outer_op: Spanned<AssocOp>): boolean;
    // diagnostics.rs:1332
    check_no_chained_comparison(inner_op: Expr, outer_op: Spanned<AssocOp>): PResult<Expr | undefined>;
    // diagnostics.rs:1460
    consume_fn_args(): Result<undefined, undefined>;
    // diagnostics.rs:1478
    maybe_report_ambiguous_plus(impl_dyn_multi: boolean, ty: Ty): void;
    // diagnostics.rs:1488
    maybe_recover_from_question_mark(ty: Ty): Ty;
    // diagnostics.rs:1509
    maybe_recover_from_ternary_operator(cond: Span | undefined): PResult<undefined>;
    // diagnostics.rs:1556
    maybe_recover_from_bad_type_plus(ty: Ty): PResult<undefined>;
    // diagnostics.rs:1584
    maybe_recover_from_bad_qpath<T>(base: T, T_RecoverQPath: RecoverQPathImpl<T>): PResult<T>;
    // diagnostics.rs:1596
    recover_from_bad_qpath<T>(base: T, T_RecoverQPath: RecoverQPathImpl<T>): PResult<T>;
    // diagnostics.rs:1605
    maybe_recover_from_bad_qpath_stage_2<T>(ty_span: Span, ty: Ty, T_RecoverQPath: RecoverQPathImpl<T>): PResult<T>;
    // diagnostics.rs:1627
    maybe_consume_incorrect_semicolon(previous_item: Item | undefined): boolean;
    // diagnostics.rs:1653
    unexpected_err(t: TokenKind): Diag;
    // diagnostics.rs:1691
    expect_semi(): PResult<undefined>;
    // diagnostics.rs:1698
    recover_colon_as_semi(): boolean;
    // diagnostics.rs:1721
    recover_incorrect_await_syntax(await_sp: Span): PResult<Expr>;
    // diagnostics.rs:1736
    recover_await_macro(): PResult<[Span, Span, boolean]>;
    // diagnostics.rs:1753
    recover_await_prefix(await_sp: Span): PResult<[Span, Span, boolean]>;
    // diagnostics.rs:1770
    error_on_incorrect_await(lo: Span, hi: Span, expr_span: Span, is_question: boolean): [Span, ErrorGuaranteed];
    // diagnostics.rs:1790
    recover_from_await_method_call(): void;
    // diagnostics.rs:1803
    recover_from_use(): void;
    // diagnostics.rs:1815
    try_macro_suggestion(): PResult<Expr>;
    // diagnostics.rs:1862
    expect_gt_or_maybe_suggest_closing_generics(params: readonly GenericParam[]): PResult<undefined>;
    // diagnostics.rs:1889
    recover_seq_parse_error(open: ExpTokenPair, close: ExpTokenPair, lo: Span, err: Diag): Expr;
    // diagnostics.rs:1906
    recover_stmt(): void;
    // diagnostics.rs:1917
    recover_stmt_(break_on_semi: SemiColonMode, break_on_block: BlockMode): void;
    // diagnostics.rs:1986
    check_for_for_in_in_typo(in_span: Span): void;
    // diagnostics.rs:1996
    parameter_without_type(err: Diag, pat: Pat, require_name: boolean, first_param: boolean, fn_parse_mode: FnParseMode): Ident | undefined;
    // diagnostics.rs:2148
    recover_arg_parse(context: FnContext): PResult<[Pat, Ty]>;
    // diagnostics.rs:2187
    recover_bad_self_param(param: Param): PResult<Param>;
    // diagnostics.rs:2194
    consume_block(open: ExpTokenPair, close: ExpTokenPair, consume_close: ConsumeClosingDelim): void;
    // diagnostics.rs:2226
    expected_expression_found(): Diag;
    // diagnostics.rs:2246
    consume_tts(acc: number, modifier: readonly [TokenKind, number][]): void;
    // diagnostics.rs:2271
    deduplicate_recovered_params_names(fn_inputs: Param[]): void;
    // diagnostics.rs:2298
    handle_lifetime_arg_preceding_type(span: Span): PResult<undefined>;
    // diagnostics.rs:2331
    handle_ambiguous_unbraced_const_arg(args: AngleBracketedArg[]): PResult<boolean>;
    // diagnostics.rs:2365
    recover_const_param_decl(ty_generics: Generics | undefined): GenericArg | undefined;
    // diagnostics.rs:2403
    recover_const_param_declaration(ty_generics: Generics | undefined): PResult<GenericArg | undefined>;
    // diagnostics.rs:2433
    recover_const_arg(start: Span, err: Diag): PResult<GenericArg>;
    // diagnostics.rs:2518
    recover_unbraced_const_arg_that_can_begin_ty(snapshot: SnapshotParser): Expr | undefined;
    // diagnostics.rs:2538
    dummy_const_arg_needs_braces(err: Diag, span: Span): GenericArg;
    // diagnostics.rs:2553
    recover_colon_colon_in_pat_typo(first_pat: Pat, expected: Expected | undefined): Pat;
    // diagnostics.rs:2688
    maybe_recover_unexpected_block_label(loop_header: Span | undefined): boolean;
    // diagnostics.rs:2729
    maybe_recover_unexpected_comma(lo: Span, rt: CommaRecoveryMode): PResult<undefined>;
    // diagnostics.rs:2741
    recover_unexpected_comma(lo: Span, rt: CommaRecoveryMode): PResult<undefined>;
    // diagnostics.rs:2777
    maybe_recover_bounds_doubled_colon(ty: Ty): PResult<undefined>;
    // diagnostics.rs:2799
    maybe_err_dotdotlt_syntax(maybe_lt: Token, err: Diag): Diag;
    // diagnostics.rs:2821
    is_vcs_conflict_marker(long_kind: TokenKind, short_kind: TokenKind): boolean;
    // diagnostics.rs:2836
    conflict_marker(long_kind: TokenKind, short_kind: TokenKind, expected: number | undefined): [Span, number] | undefined;
    // diagnostics.rs:2867
    recover_vcs_conflict_marker(): void;
    // diagnostics.rs:2953
    skip_pat_list(): PResult<undefined>;
    // diagnostics.rs:2962
    maybe_type_in_generic_parameter(origin_error: Diag): Diag;

    // ---- compiler/rustc_parse/src/parser/expr.rs ----
    // expr.rs:56
    parse_expr(): PResult<Expr>;
    // expr.rs:61
    parse_expr_in_let(): PResult<Expr>;
    // expr.rs:66
    parse_expr_force_collect(): PResult<Expr>;
    // expr.rs:89
    parse_expr_anon_const(): PResult<AnonConst>;
    // expr.rs:94
    parse_expr_paren_seq(): PResult<Expr[]>;
    // expr.rs:100
    parse_expr_res(r: Restrictions): PResult<Expr>;
    // expr.rs:109
    parse_expr_res_after_attrs(r: Restrictions, attrs: AttrWrapper): PResult<[Expr, boolean]>;
    // expr.rs:118
    parse_expr_assoc(min_prec: Bound<ExprPrecedence>): PResult<Expr>;
    // expr.rs:129
    parse_expr_assoc_after_attrs(min_prec: Bound<ExprPrecedence>, attrs: AttrWrapper): PResult<[Expr, boolean]>;
    // expr.rs:145
    parse_expr_assoc_rest(min_prec: Bound<ExprPrecedence>, starts_stmt: boolean, lhs: Expr): PResult<[Expr, boolean]>;
    // expr.rs:231
    check_assoc_op(): Spanned<AssocOp> | undefined;
    // expr.rs:263
    expr_is_complete(e: Expr): boolean;
    // expr.rs:269
    parse_expr_range(min_prec: Bound<ExprPrecedence>, lhs: Expr, limits: RangeLimits, cur_op_span: Span): PResult<Expr>;
    // expr.rs:291
    is_at_start_of_range_notation_rhs(): boolean;
    // expr.rs:304
    parse_expr_prefix_range(attrs: AttrWrapper): PResult<Expr>;
    // expr.rs:341
    parse_expr_prefix(attrs: AttrWrapper): PResult<Expr>;
    // expr.rs:426
    parse_expr_prefix_common(lo: Span): PResult<[Span, Expr]>;
    // expr.rs:437
    parse_expr_unary(lo: Span, op: UnOp): PResult<[Span, ExprKind]>;
    // expr.rs:444
    recover_tilde_expr(lo: Span): PResult<[Span, ExprKind]>;
    // expr.rs:450
    parse_expr_move(move_kw: Span): PResult<[Span, ExprKind]>;
    // expr.rs:460
    is_mistaken_not_ident_negation(): boolean;
    // expr.rs:472
    recover_not_expr(lo: Span): PResult<[Span, ExprKind]>;
    // expr.rs:497
    interpolated_or_expr_span(expr: Expr): Span;
    // expr.rs:511
    parse_assoc_op_cast(lhs: Expr, lhs_span: Span, op_span: Span): PResult<Expr>;
    // expr.rs:637
    parse_expr_borrow(lo: Span): PResult<[Span, ExprKind]>;
    // expr.rs:661
    error_remove_borrow_lifetime(span: Span, lt_span: Span): void;
    // expr.rs:669
    parse_borrow_modifiers(): [BorrowKind, Mutability];
    // expr.rs:689
    parse_expr_dot_or_call(attrs: AttrWrapper): PResult<Expr>;
    // expr.rs:697
    parse_expr_dot_or_call_with(attrs: AttrVec, e: Expr, lo: Span): PResult<Expr>;
    // expr.rs:755
    parse_dot_suffix_expr(lo: Span, base: Expr): PResult<Expr>;
    // expr.rs:819
    error_unexpected_after_dot(): void;
    // expr.rs:860
    break_up_float(float: Symbol, span: Span): DestructuredFloat;
    // expr.rs:942
    parse_floating_field_access(): PResult<Ident[]>;
    // expr.rs:1046
    mk_expr_tuple_field_access(lo: Span, ident_span: Span, base: Expr, field: Symbol, suffix: Symbol | undefined): Expr;
    // expr.rs:1064
    parse_expr_fn_call(lo: Span, fun: Expr): Expr;
    // expr.rs:1092
    recover_raw_ref_call_args(guar: ErrorGuaranteed): Expr[];
    // expr.rs:1111
    maybe_recover_struct_lit_bad_delims(lo: Span, open_paren: Span, seq: PResult<Expr>, snapshot: [SnapshotParser, ExprKind] | undefined): PResult<Expr>;
    // expr.rs:1173
    parse_expr_index(lo: Span, base: Expr): PResult<Expr>;
    // expr.rs:1197
    parse_dot_suffix(self_arg: Expr, lo: Span): PResult<Expr>;
    // expr.rs:1262
    parse_expr_bottom(): PResult<Expr>;
    // expr.rs:1428
    parse_expr_lit(): PResult<Expr>;
    // expr.rs:1439
    parse_expr_tuple_parens(restrictions: Restrictions): PResult<Expr>;
    // expr.rs:1468
    parse_expr_array_or_repeat(close: ExpTokenPair): PResult<Expr>;
    // expr.rs:1499
    parse_expr_path_start(): PResult<Expr>;
    // expr.rs:1549
    parse_expr_labeled(label_: Label, consume_colon: boolean): PResult<Expr>;
    // expr.rs:1657
    recover_unclosed_char<L>(ident: Ident, mk_lit_char: (a0: Symbol, a1: Span) => L, err: (a0: Parser) => Diag): L;
    // expr.rs:1688
    recover_do_catch(): PResult<Expr>;
    // expr.rs:1701
    parse_expr_opt(): PResult<Expr | undefined>;
    // expr.rs:1706
    parse_expr_return(): PResult<Expr>;
    // expr.rs:1714
    parse_expr_yeet(): PResult<Expr>;
    // expr.rs:1729
    parse_expr_become(): PResult<Expr>;
    // expr.rs:1746
    parse_expr_break(): PResult<Expr>;
    // expr.rs:1814
    parse_expr_continue(lo: Span): PResult<Expr>;
    // expr.rs:1831
    parse_expr_yield(): PResult<Expr>;
    // expr.rs:1841
    parse_expr_builtin(): PResult<Expr>;
    // expr.rs:1857
    parse_builtin<T>(parse: (this_: Parser, a1: Span, a2: Ident) => PResult<T | undefined>): PResult<T>;
    // expr.rs:1891
    parse_expr_offset_of(lo: Span): PResult<Expr>;
    // expr.rs:1919
    parse_expr_type_ascribe(lo: Span): PResult<Expr>;
    // expr.rs:1927
    parse_expr_unsafe_binder_cast(lo: Span, kind: UnsafeBinderCastKind): PResult<Expr>;
    // expr.rs:1941
    parse_str_lit(): Result<StrLit, MetaItemLit | undefined>;
    // expr.rs:1970
    handle_missing_lit<L>(mk_lit_char: (a0: Symbol, a1: Span) => L): PResult<L>;
    // expr.rs:1991
    parse_token_lit(): PResult<[Lit, Span]>;
    // expr.rs:1997
    parse_meta_item_lit(): PResult<MetaItemLit>;
    // expr.rs:2003
    recover_after_dot(): void;
    // expr.rs:2040
    eat_token_lit(): Lit | undefined;
    // expr.rs:2083
    parse_opt_token_lit(): [Lit, Span] | undefined;
    // expr.rs:2091
    parse_opt_meta_item_lit(): MetaItemLit | undefined;
    // expr.rs:2113
    parse_literal_maybe_minus(): PResult<Expr>;
    // expr.rs:2149
    suggest_missing_semicolon_before_array(prev_span: Span, open_delim_span: Span): PResult<undefined>;
    // expr.rs:2192
    parse_expr_block(opt_label: Label | undefined, lo: Span, blk_mode: BlockCheckMode): PResult<Expr>;
    // expr.rs:2214
    parse_simple_block(): PResult<Expr>;
    // expr.rs:2220
    parse_expr_closure(): PResult<Expr>;
    // expr.rs:2325
    parse_closure_block_body(ret_span: Span): PResult<Expr>;
    // expr.rs:2368
    parse_capture_clause(): PResult<CaptureBy>;
    // expr.rs:2398
    parse_fn_block_decl(): PResult<[FnDecl, Span]>;
    // expr.rs:2424
    parse_fn_block_param(): PResult<Param>;
    // expr.rs:2451
    parse_expr_if(): PResult<Expr>;
    // expr.rs:2460
    parse_if_after_cond(lo: Span, cond: Expr): PResult<Expr>;
    // expr.rs:2584
    parse_expr_cond(let_chains_policy: LetChainsPolicy): PResult<Expr>;
    // expr.rs:2601
    parse_expr_let(restrictions: Restrictions): PResult<Expr>;
    // expr.rs:2641
    parse_expr_else(): PResult<Expr>;
    // expr.rs:2716
    error_on_if_block_attrs(ctx_span: Span, is_ctx_else: boolean, branch_span: Span, attrs: AttrWrapper): void;
    // expr.rs:2739
    error_on_extra_if(cond: Expr): PResult<undefined>;
    // expr.rs:2753
    parse_for_head(): PResult<[Pat, Expr]>;
    // expr.rs:2817
    parse_expr_for(opt_label: Label | undefined, lo: Span): PResult<Expr>;
    // expr.rs:2871
    recover_loop_else(loop_kind: string, loop_kw: Span): PResult<undefined>;
    // expr.rs:2885
    error_missing_in_for_loop(): void;
    // expr.rs:2907
    for_loop_head_has_in(): boolean;
    // expr.rs:2924
    parse_expr_while(opt_label: Label | undefined, lo: Span): PResult<Expr>;
    // expr.rs:2952
    parse_expr_loop(opt_label: Label | undefined, lo: Span): PResult<Expr>;
    // expr.rs:2967
    eat_label(): Label | undefined;
    // expr.rs:2982
    parse_expr_match(): PResult<Expr>;
    // expr.rs:2991
    parse_match_block(lo: Span, match_span: Span, scrutinee: Expr, match_kind: MatchKind): PResult<Expr>;
    // expr.rs:3052
    parse_arm_body_missing_braces(first_expr: Expr, arrow_span: Span): [Span, ErrorGuaranteed] | undefined;
    // expr.rs:3129
    parse_arm(): PResult<Arm>;
    // expr.rs:3325
    eat_metavar_guard(): Guard | undefined;
    // expr.rs:3331
    parse_match_arm_guard(): PResult<Guard | undefined>;
    // expr.rs:3343
    expect_match_arm_guard(force_collect: ForceCollect): PResult<Guard>;
    // expr.rs:3355
    expect_match_arm_guard_cond(force_collect: ForceCollect): PResult<Guard>;
    // expr.rs:3370
    parse_match_arm_pat_and_guard(): PResult<[Pat, Guard | undefined]>;
    // expr.rs:3416
    parse_match_guard_condition(force_collect: ForceCollect): PResult<Expr>;
    // expr.rs:3460
    is_builtin(): boolean;
    // expr.rs:3465
    parse_try_block(span_lo: Span): PResult<Expr>;
    // expr.rs:3483
    is_do_catch_block(): boolean;
    // expr.rs:3490
    is_do_yeet(): boolean;
    // expr.rs:3494
    is_try_block(): boolean;
    // expr.rs:3503
    parse_gen_block(): PResult<Expr>;
    // expr.rs:3521
    is_gen_block(kw: Symbol, lookahead: number): boolean;
    // expr.rs:3535
    is_async_gen_block(): boolean;
    // expr.rs:3539
    is_likely_struct_lit(): boolean;
    // expr.rs:3545
    maybe_parse_struct_expr(qself: QSelf | undefined, path: Path): PResult<Expr> | undefined;
    // expr.rs:3597
    maybe_recover_bad_struct_literal_path(is_underscore_entry_point: boolean): PResult<Expr | undefined>;
    // expr.rs:3634
    parse_struct_fields(pth: Path, recover: boolean, close: ExpTokenPair): PResult<[ExprField[], StructRest, ErrorGuaranteed | undefined]>;
    // expr.rs:3836
    parse_expr_struct(qself: QSelf | undefined, pth: Path, recover: boolean): PResult<Expr>;
    // expr.rs:3855
    recover_struct_comma_after_dotdot(span: Span): void;
    // expr.rs:3866
    recover_struct_field_dots(close: TokenKind): boolean;
    // expr.rs:3878
    recover_ident_into_label(ident: Ident): Label;
    // expr.rs:3893
    parse_expr_field(): PResult<ExprField>;
    // expr.rs:3947
    error_on_eq_field_init(field_name: Ident): void;
    // expr.rs:3958
    mk_assign_op(assign_op: AssignOp, lhs: Expr, rhs: Expr): ExprKind;
    // expr.rs:3962
    mk_range(start: Expr | undefined, end: Expr | undefined, limits: RangeLimits): ExprKind;
    // expr.rs:3976
    mk_unary(unop: UnOp, expr: Expr): ExprKind;
    // expr.rs:3980
    mk_binary(binop: BinOp, lhs: Expr, rhs: Expr): ExprKind;
    // expr.rs:3984
    mk_index(expr: Expr, idx: Expr, brackets_span: Span): ExprKind;
    // expr.rs:3988
    mk_call(f: Expr, args: Expr[]): ExprKind;
    // expr.rs:3992
    mk_await_expr(self_arg: Expr, lo: Span): Expr;
    // expr.rs:3999
    mk_use_expr(self_arg: Expr, lo: Span): Expr;
    // expr.rs:4006
    mk_expr_with_attrs(span: Span, kind: ExprKind, attrs: AttrVec): Expr;
    // expr.rs:4015
    mk_expr(span: Span, kind: ExprKind): Expr;
    // expr.rs:4019
    mk_expr_err(span: Span, guar: ErrorGuaranteed): Expr;
    // expr.rs:4023
    mk_unit_expr(span: Span): Expr;
    // expr.rs:4027
    mk_closure_expr(span: Span, body: Expr): Expr;
    // expr.rs:4049
    mk_expr_sp(lhs: Expr, lhs_span: Span, op_span: Span, rhs_span: Span): Span;
    // expr.rs:4058
    collect_tokens_for_expr(attrs: AttrWrapper, f: (this_: Parser, a1: AttrVec) => PResult<Expr>): PResult<Expr>;

    // ---- compiler/rustc_parse/src/parser/expr/diagnostics.rs ----
    // expr/diagnostics.rs:12
    recover_from_bin_op_after_complete_stmt_expr(lhs: Expr): boolean;
    // expr/diagnostics.rs:57
    recover_from_alpha_logic_op(): Spanned<AssocOp> | undefined;
    // expr/diagnostics.rs:80
    reject_dotdotdot_expr_op(): void;
    // expr/diagnostics.rs:87
    reject_larrow_expr_op(): void;
    // expr/diagnostics.rs:94
    recover_from_strict_eq_op(op: Spanned<AssocOp>): void;
    // expr/diagnostics.rs:116
    recover_from_diamond_ne_op(): void;
    // expr/diagnostics.rs:135
    recover_from_spaceship_cmp_op(): void;
    // expr/diagnostics.rs:150
    recover_from_postfix_inc_op(lhs: Expr, starts_stmt: boolean): PResult<undefined>;
    // expr/diagnostics.rs:167
    recover_from_postfix_dec_op(lhs: Expr, starts_stmt: boolean): PResult<undefined>;
    // expr/diagnostics.rs:185
    report_inc_dec_op(base: Expr, starts_stmt: boolean, op: IncOrDec, fixity: UnaryFixity, op_span: Span): Diag;
    // expr/diagnostics.rs:267
    recover_from_c_array(lo: Span): Expr | undefined;

    // ---- compiler/rustc_parse/src/parser/pat.rs ----
    // pat.rs:103
    parse_pat_allow_top_guard(expected: Expected | undefined, rc: RecoverComma, ra: RecoverColon, rt: CommaRecoveryMode): PResult<Pat>;
    // pat.rs:136
    parse_pat_no_top_alt(expected: Expected | undefined, syntax_loc: PatternLocation | undefined): PResult<Pat>;
    // pat.rs:153
    parse_pat_no_top_guard(expected: Expected | undefined, rc: RecoverComma, ra: RecoverColon, rt: CommaRecoveryMode): PResult<Pat>;
    // pat.rs:165
    parse_pat_no_top_guard_inner(expected: Expected | undefined, rc: RecoverComma, ra: RecoverColon, rt: CommaRecoveryMode, syntax_loc: PatternLocation | undefined): PResult<[Pat, boolean]>;
    // pat.rs:257
    parse_pat_before_ty(expected: Expected | undefined, rc: RecoverComma, syntax_loc: PatternLocation): PResult<[Pat, boolean]>;
    // pat.rs:310
    parse_fn_param_pat_colon(): PResult<[Pat, boolean]>;
    // pat.rs:329
    eat_or_separator(lo: Span | undefined): EatOrResult;
    // pat.rs:351
    recover_trailing_vert(lo: Span | undefined): boolean;
    // pat.rs:399
    maybe_recover_trailing_expr(pat_span: Span, is_end_bound: boolean): [ErrorGuaranteed, Span] | undefined;
    // pat.rs:511
    maybe_augment_stashed_expr_in_pats_with_suggestions(stmt: Stmt): void;
    // pat.rs:698
    eat_metavar_pat(): Pat | undefined;
    // pat.rs:721
    parse_pat_with_range_pat(allow_range_pat: boolean, expected: Expected | undefined, syntax_loc: PatternLocation | undefined): PResult<Pat>;
    // pat.rs:904
    recover_dotdotdot_rest_pat(lo: Span, expected: Expected | undefined): PatKind;
    // pat.rs:940
    recover_intersection_pat(lhs: Pat): PResult<Pat>;
    // pat.rs:972
    ban_pat_range_if_ambiguous(pat: Pat): void;
    // pat.rs:992
    parse_pat_deref(expected: Expected | undefined): PResult<PatKind>;
    // pat.rs:1010
    parse_pat_tuple_or_parens(syntax_loc: PatternLocation | undefined): PResult<PatKind>;
    // pat.rs:1120
    recover_tuple_pat_type_ascription(open_paren: Span, fields: readonly Pat[], tys: readonly [number, Span, Ty][], trailing_comma: Trailing, syntax_loc: PatternLocation | undefined): void;
    // pat.rs:1177
    suggest_tuple_pat_type(err: Diag, open_paren: Span, close_paren: Span, fields: readonly Pat[], tys: readonly [number, Span, Ty][], paren_pattern: boolean): void;
    // pat.rs:1233
    parse_pat_ident_mut(): PResult<PatKind>;
    // pat.rs:1291
    ban_mut_general_pat(lo: Span, pat: Pat, changed_any_binding: boolean): void;
    // pat.rs:1303
    recover_additional_muts(): void;
    // pat.rs:1316
    parse_pat_mac_invoc(path: Path): PResult<PatKind>;
    // pat.rs:1323
    fatal_unexpected_non_pat(err: Diag, expected: Expected | undefined): PResult<Pat>;
    // pat.rs:1345
    parse_range_end(): Spanned<RangeEnd> | undefined;
    // pat.rs:1360
    parse_pat_range_begin_with(begin: Expr, re: Spanned<RangeEnd>): PResult<PatKind>;
    // pat.rs:1379
    inclusive_range_with_incorrect_end(): ErrorGuaranteed;
    // pat.rs:1411
    parse_pat_range_to(re: Spanned<RangeEnd>): PResult<PatKind>;
    // pat.rs:1421
    is_pat_range_end_start(dist: number): boolean;
    // pat.rs:1438
    parse_pat_range_end(): PResult<Expr>;
    // pat.rs:1483
    is_start_of_pat_with_path(): boolean;
    // pat.rs:1490
    can_be_ident_pat(): boolean;
    // pat.rs:1507
    parse_pat_ident(binding_annotation: BindingMode, syntax_loc: PatternLocation | undefined): PResult<PatKind>;
    // pat.rs:1556
    parse_pat_struct(qself: QSelf | undefined, path: Path): PResult<PatKind>;
    // pat.rs:1574
    parse_pat_tuple_struct(qself: QSelf | undefined, path: Path): PResult<PatKind>;
    // pat.rs:1597
    isnt_pattern_start(): boolean;
    // pat.rs:1611
    parse_pat_builtin(): PResult<PatKind>;
    // pat.rs:1630
    parse_pat_box(): PResult<PatKind>;
    // pat.rs:1669
    parse_pat_fields(): PResult<[PatField[], PatFieldsRest]>;
    // pat.rs:1841
    report_misplaced_at_in_struct_pat(prev_field: Ident): Diag;
    // pat.rs:1859
    recover_misplaced_pattern_modifiers(fields: PatField[], err: Diag): void;
    // pat.rs:1886
    recover_bad_dot_dot(): void;
    // pat.rs:1900
    parse_pat_field(lo: Span, attrs: AttrVec): PResult<PatField>;
    // pat.rs:1967
    mk_pat_ident(span: Span, ann: BindingMode, ident: Ident): Pat;
    // pat.rs:1971
    mk_pat(span: Span, kind: PatKind): Pat;

    // ---- compiler/rustc_parse/src/parser/path.rs ----
    // path.rs:76
    parse_qpath(style: PathStyle): PResult<[QSelf, Path]>;
    // path.rs:122
    recover_colon_before_qpath_proj(): boolean;
    // path.rs:147
    parse_path(style: PathStyle): PResult<Path>;
    // path.rs:161
    parse_path_inner(style: PathStyle, ty_generics: Generics | undefined): PResult<Path>;
    // path.rs:220
    parse_path_segments(segments: PathSegment[], style: PathStyle, ty_generics: Generics | undefined): PResult<undefined>;
    // path.rs:281
    eat_path_sep(): boolean;
    // path.rs:291
    parse_path_segment(style: PathStyle, ty_generics: Generics | undefined): PResult<PathSegment>;
    // path.rs:458
    parse_path_segment_ident(): PResult<Ident>;
    // path.rs:481
    recover_fn_call_leading_path_sep(style: PathStyle, prev_token_before_parsing: Token, error: Diag): void;
    // path.rs:538
    parse_angle_args_with_leading_angle_bracket_recovery(style: PathStyle, lo: Span, ty_generics: Generics | undefined): PResult<AngleBracketedArg[]>;
    // path.rs:683
    parse_angle_args(ty_generics: Generics | undefined): PResult<AngleBracketedArg[]>;
    // path.rs:726
    parse_angle_arg(ty_generics: Generics | undefined): PResult<AngleBracketedArg | undefined>;
    // path.rs:785
    parse_assoc_equality_term(ident: Ident, gen_args: GenericArgs | undefined): PResult<AssocItemConstraintKind>;
    // path.rs:849
    expr_is_valid_const_arg(expr: Expr): boolean;
    // path.rs:875
    parse_const_arg(): PResult<AnonConst>;
    // path.rs:892
    parse_unambiguous_unbraced_const_arg(): PResult<Expr>;
    // path.rs:916
    parse_generic_arg(ty_generics: Generics | undefined): PResult<GenericArg | undefined>;
    // path.rs:981
    get_ident_from_generic_arg(gen_arg: GenericArg): Result<[boolean, Ident, GenericArgs | undefined], undefined>;

    // ---- compiler/rustc_parse/src/parser/ty.rs ----
    // ty.rs:107
    parse_ty(): PResult<Ty>;
    // ty.rs:127
    parse_ty_with_generics_recovery(ty_params: Generics): PResult<Ty>;
    // ty.rs:144
    parse_ty_for_param(): PResult<Ty>;
    // ty.rs:184
    parse_ty_no_plus(): PResult<Ty>;
    // ty.rs:197
    parse_as_cast_ty(): PResult<Ty>;
    // ty.rs:208
    parse_ty_no_question_mark_recover(): PResult<Ty>;
    // ty.rs:221
    parse_ty_for_where_clause(): PResult<Ty>;
    // ty.rs:233
    parse_ret_ty(allow_plus: AllowPlus, recover_qpath: RecoverQPath, recover_return_sign: RecoverReturnSign): PResult<FnRetTy>;
    // ty.rs:273
    parse_ty_common(allow_plus: AllowPlus, allow_c_variadic: AllowCVariadic, recover_qpath: RecoverQPath, recover_return_sign: RecoverReturnSign, ty_generics: Generics | undefined, recover_question_mark: RecoverQuestionMark): PResult<Ty>;
    // ty.rs:445
    parse_unsafe_binder_ty(): PResult<TyKind>;
    // ty.rs:465
    parse_paren_start_ty(lo: Span, allow_plus: AllowPlus): PResult<TyKind>;
    // ty.rs:518
    parse_bare_trait_object_ty(lo: Span, allow_plus: AllowPlus): PResult<TyKind>;
    // ty.rs:549
    parse_ref_ty_no_leading_ampersand(): [Mutability, Ty | undefined];
    // ty.rs:560
    maybe_recover_ref_ty_no_leading_ampersand(lt: Lifetime, lo: Span, err: Diag): Result<TyKind, Diag>;
    // ty.rs:588
    finish_parsing_bare_trait_object_ty(generic_params: GenericParam[], path: Path, lo: Span, parse_plus: boolean, parens: Parens): PResult<TyKind>;
    // ty.rs:611
    parse_ty_c_style_pointer(): PResult<TyKind>;
    // ty.rs:646
    parse_ty_ptr(): PResult<TyKind>;
    // ty.rs:661
    parse_array_or_slice_ty(): PResult<TyKind>;
    // ty.rs:688
    maybe_recover_array_ty_without_semi(elt_ty: Ty): PResult<TyKind>;
    // ty.rs:734
    parse_borrowed_pointee(): PResult<TyKind>;
    // ty.rs:784
    parse_pin_and_mut(): [Pinnedness, Mutability];
    // ty.rs:797
    parse_typeof_ty(lo: Span): PResult<TyKind>;
    // ty.rs:811
    parse_builtin_ty(): PResult<TyKind>;
    // ty.rs:820
    parse_ty_field_of(_lo: Span): PResult<TyKind>;
    // ty.rs:866
    parse_ty_fn_ptr(lo: Span, params: GenericParam[], param_insertion_point: Span | undefined, recover_return_sign: RecoverReturnSign): PResult<TyKind>;
    // ty.rs:904
    recover_fn_ptr_with_generics(lo: Span, params: GenericParam[], param_insertion_point: Span | undefined): PResult<undefined>;
    // ty.rs:946
    parse_impl_ty(impl_dyn_multi: MutRef<boolean>): PResult<TyKind>;
    // ty.rs:972
    parse_use_bound(lo: Span, parens: Parens): PResult<GenericBound>;
    // ty.rs:1008
    can_begin_dyn_ty(): boolean;
    // ty.rs:1015
    parse_dyn_ty(impl_dyn_multi: MutRef<boolean>): PResult<TyKind>;
    // ty.rs:1031
    parse_path_start_ty(lo: Span, allow_plus: AllowPlus, ty_generics: Generics | undefined): PResult<TyKind>;
    // ty.rs:1057
    parse_generic_bounds(): PResult<GenericBounds>;
    // ty.rs:1065
    parse_generic_bounds_common(allow_plus: AllowPlus): PResult<GenericBounds>;
    // ty.rs:1096
    can_begin_bound(): boolean;
    // ty.rs:1114
    can_begin_maybe_const_bound(): boolean;
    // ty.rs:1125
    parse_generic_bound(): PResult<GenericBound>;
    // ty.rs:1150
    parse_lifetime_bound(lo: Span, parens: Parens): PResult<GenericBound>;
    // ty.rs:1161
    report_parenthesized_bound(lo: Span, hi: Span, kind: string): ErrorGuaranteed;
    // ty.rs:1173
    error_lt_bound_with_modifiers(modifiers: TraitBoundModifiers, binder_span: Span | undefined): ErrorGuaranteed;
    // ty.rs:1229
    parse_trait_bound_modifiers(): PResult<TraitBoundModifiers>;
    // ty.rs:1293
    parse_bound_constness(): PResult<BoundConstness>;
    // ty.rs:1326
    parse_trait_bound(lo: Span, parens: Parens, leading_token: Token): PResult<GenericBound>;
    // ty.rs:1448
    recover_path_from_fn(): Path | undefined;
    // ty.rs:1487
    parse_higher_ranked_binder(): PResult<[GenericParam[], Span | undefined]>;
    // ty.rs:1506
    recover_fn_trait_with_lifetime_params(fn_path: Path, lifetime_defs: GenericParam[]): PResult<undefined>;
    // ty.rs:1635
    check_lifetime(): boolean;
    // ty.rs:1641
    expect_lifetime(): Lifetime;
    // ty.rs:1654
    mk_ty(span: Span, kind: TyKind): Ty;

    // ---- compiler/rustc_parse/src/parser/generics.rs ----
    // generics.rs:28
    parse_lt_param_bounds(): GenericBounds;
    // generics.rs:41
    parse_ty_param(preceding_attrs: AttrVec): PResult<GenericParam>;
    // generics.rs:104
    parse_const_param(preceding_attrs: AttrVec): PResult<GenericParam>;
    // generics.rs:158
    recover_const_param_with_mistyped_const(preceding_attrs: AttrVec, mistyped_const_ident: Ident): PResult<GenericParam>;
    // generics.rs:204
    parse_generic_params(): PResult<GenericParam[]>;
    // generics.rs:319
    parse_generics(): PResult<Generics>;
    // generics.rs:348
    parse_contract(): PResult<FnContract | undefined>;
    // generics.rs:359
    parse_contract_requires(): PResult<[Stmt[], Expr | undefined]>;
    // generics.rs:383
    parse_contract_ensures(): PResult<Expr | undefined>;
    // generics.rs:398
    parse_where_clause(): PResult<WhereClause>;
    // generics.rs:402
    parse_struct_where_clause(struct_name: Ident, body_insertion_point: Span): PResult<[WhereClause, FieldDef[] | undefined]>;
    // generics.rs:410
    parse_where_clause_common(struct_: [Ident, Span] | undefined): PResult<[WhereClause, FieldDef[] | undefined]>;
    // generics.rs:458
    parse_where_clause_predicates(struct_: [Ident, Span] | undefined, where_lo: Span): PResult<[WherePredicate[], FieldDef[] | undefined]>;
    // generics.rs:539
    parse_ty_where_predicate_kind_or_recover_tuple_struct_body(struct_: [Ident, Span] | undefined, pred_lo: Span, where_sp: Span): PResult<PredicateKindOrStructBody>;
    // generics.rs:605
    parse_ty_where_predicate_kind(): PResult<WhereBoundPredicate>;
    // generics.rs:660
    choose_generics_over_qpath(start: number): boolean;

    // ---- compiler/rustc_parse/src/parser/stmt.rs ----
    // stmt.rs:37
    parse_stmt_nonterminal(force_collect: ForceCollect): Stmt | undefined;
    // stmt.rs:51
    parse_stmt_without_recovery(capture_semi: boolean, force_collect: ForceCollect, force_full_expr: boolean): PResult<Stmt>;
    // stmt.rs:203
    parse_stmt_path_start(lo: Span, attrs: AttrWrapper): PResult<Stmt>;
    // stmt.rs:248
    parse_stmt_mac(lo: Span, attrs: AttrVec, path: Path): PResult<Stmt>;
    // stmt.rs:281
    error_outer_attrs(attrs: AttrWrapper): PResult<undefined>;
    // stmt.rs:298
    recover_stmt_local_after_let(lo: Span, attrs: AttrWrapper, subdiagnostic: (a0: Span) => InvalidVariableDeclarationSub, force_collect: ForceCollect): PResult<Stmt>;
    // stmt.rs:320
    parse_local(super_: Span | undefined, attrs: AttrVec): PResult<Local>;
    // stmt.rs:451
    check_let_else_init_bool_expr(init: Expr): void;
    // stmt.rs:466
    check_let_else_init_trailing_brace(init: Expr): void;
    // stmt.rs:492
    parse_initializer(eq_optional: boolean): PResult<Expr | undefined>;
    // stmt.rs:523
    parse_block(): PResult<Block>;
    // stmt.rs:541
    error_block_no_opening_brace_msg(msg: string): Diag;
    // stmt.rs:604
    suggest_fixes_misparsed_for_loop_head(e: Diag, between: Span, stmt_span: Span, stmt_kind: StmtKind): void;
    // stmt.rs:697
    error_block_no_opening_brace<T>(): PResult<T>;
    // stmt.rs:707
    parse_inner_attrs_and_block(loop_header: Span | undefined): PResult<[AttrVec, Block]>;
    // stmt.rs:718
    parse_block_common(lo: Span, blk_mode: BlockCheckMode, loop_header: Span | undefined): PResult<[AttrVec, Block]>;
    // stmt.rs:744
    parse_block_tail(lo: Span, s: BlockCheckMode, recover: AttemptLocalParseRecovery): PResult<Block>;
    // stmt.rs:810
    recover_missing_let_else(err: Diag, pat: Pat, stmt_span: Span): void;
    // stmt.rs:904
    recover_missing_dot(err: Diag): void;
    // stmt.rs:949
    try_recover_let_missing_semi(local: Local): ErrorGuaranteed | undefined;
    // stmt.rs:965
    parse_full_stmt(recover: AttemptLocalParseRecovery): PResult<Stmt>;
    // stmt.rs:1169
    mk_block(stmts: Stmt[], rules: BlockCheckMode, span: Span): Block;
    // stmt.rs:1178
    mk_stmt(span: Span, kind: StmtKind): Stmt;
    // stmt.rs:1182
    mk_stmt_err(span: Span, guar: ErrorGuaranteed): Stmt;
    // stmt.rs:1186
    mk_block_err(span: Span, guar: ErrorGuaranteed): Block;

    // ---- compiler/rustc_parse/src/parser/item.rs ----
    // item.rs:31
    parse_crate_mod(): PResult<Crate>;
    // item.rs:37
    parse_item_mod(attrs: AttrVec): PResult<ItemKind>;
    // item.rs:56
    parse_mod(term: ExpTokenPair): PResult<[AttrVec, Item[], ModSpans]>;
    // item.rs:124
    parse_item(force_collect: ForceCollect, allow_const_block_items: AllowConstBlockItems): PResult<Item | undefined>;
    // item.rs:135
    parse_item_(fn_parse_mode: FnParseMode, force_collect: ForceCollect, const_block_items_allowed: AllowConstBlockItems): PResult<Item | undefined>;
    // item.rs:154
    parse_item_common(attrs: AttrWrapper, mac_allowed: boolean, attrs_allowed: boolean, fn_parse_mode: FnParseMode, force_collect: ForceCollect, allow_const_block_items: AllowConstBlockItems): PResult<Item | undefined>;
    // item.rs:229
    error_on_unconsumed_default(def: Defaultness, kind: ItemKind): void;
    // item.rs:250
    parse_item_kind(attrs: AttrVec, macros_allowed: boolean, allow_const_block_items: AllowConstBlockItems, lo: Span, vis: Visibility, def: MutRef<Defaultness>, fn_parse_mode: FnParseMode, case_: Case): PResult<ItemKind | undefined>;
    // item.rs:406
    recover_import_as_use(): PResult<ItemKind | undefined>;
    // item.rs:424
    recover_field_in_trait(): PResult<ItemKind | undefined>;
    // item.rs:453
    parse_use_item(): PResult<ItemKind>;
    // item.rs:472
    is_path_start_item(): boolean;
    // item.rs:480
    is_reuse_item(): ReuseKind | undefined;
    // item.rs:496
    isnt_macro_invocation(): boolean;
    // item.rs:502
    recover_missing_kw_before_item(): PResult<undefined>;
    // item.rs:598
    parse_item_builtin(): PResult<ItemKind | undefined>;
    // item.rs:604
    parse_item_macro(vis: Visibility): PResult<MacCall>;
    // item.rs:634
    recover_attrs_no_item(attrs: readonly Attribute[]): PResult<undefined>;
    // item.rs:663
    is_async_fn(): boolean;
    // item.rs:667
    parse_polarity(): ImplPolarity;
    // item.rs:692
    parse_item_impl(attrs: AttrVec, defaultness: Defaultness, is_reuse: boolean): PResult<ItemKind>;
    // item.rs:851
    parse_item_delegation(attrs: AttrVec, defaultness: Defaultness, kind: ReuseKind): PResult<ItemKind>;
    // item.rs:870
    parse_delegation_body(): PResult<Block | undefined>;
    // item.rs:879
    parse_impl_delegation(span: Span, attrs: AttrVec, defaultness: Defaultness): PResult<ItemKind>;
    // item.rs:916
    parse_path_like_delegation(): PResult<ItemKind>;
    // item.rs:960
    parse_item_list<T>(attrs: AttrVec, parse_item: (this_: Parser) => PResult<{ $: "Some"; _0: T | undefined } | undefined>): PResult<T[]>;
    // item.rs:1063
    recover_doc_comment_before_brace(): boolean;
    // item.rs:1087
    parse_defaultness(): Defaultness;
    // item.rs:1106
    check_trait_front_matter(): boolean;
    // item.rs:1166
    parse_item_trait(attrs: AttrVec, lo: Span): PResult<ItemKind>;
    // item.rs:1234
    parse_impl_item(force_collect: ForceCollect): PResult<{ $: "Some"; _0: AssocItem | undefined } | undefined>;
    // item.rs:1243
    parse_trait_item(force_collect: ForceCollect): PResult<{ $: "Some"; _0: AssocItem | undefined } | undefined>;
    // item.rs:1256
    parse_assoc_item(fn_parse_mode: FnParseMode, force_collect: ForceCollect): PResult<{ $: "Some"; _0: AssocItem | undefined } | undefined>;
    // item.rs:1303
    parse_type_alias(defaultness: Defaultness): PResult<ItemKind>;
    // item.rs:1337
    parse_use_tree(use_token_span: Span, use_path: UsePathList | undefined): PResult<UseTree>;
    // item.rs:1383
    parse_use_tree_glob_or_nested(use_token_span: Span, use_path: UsePathList | undefined): PResult<UseTreeKind>;
    // item.rs:1404
    parse_use_tree_list(use_token_span: Span, prefix: UsePathList | undefined): PResult<UseTreeAndId[]>;
    // item.rs:1431
    emit_error_attr_in_use_tree(use_token_span: Span, prefix: UsePathList | undefined, use_tree_span: Span, attr_span: Span): void;
    // item.rs:1483
    parse_rename(): PResult<Ident | undefined>;
    // item.rs:1491
    parse_ident_or_underscore(): PResult<Ident>;
    // item.rs:1508
    parse_item_extern_crate(): PResult<ItemKind>;
    // item.rs:1520
    parse_crate_name_with_dashes(): PResult<Ident>;
    // item.rs:1564
    parse_item_foreign_mod(attrs: AttrVec, safety: Safety): PResult<ItemKind>;
    // item.rs:1589
    parse_foreign_item(force_collect: ForceCollect): PResult<{ $: "Some"; _0: ForeignItem | undefined } | undefined>;
    // item.rs:1632
    error_bad_item_kind<T>(span: Span, kind: ItemKind, ctx: string): T | undefined;
    // item.rs:1647
    is_use_closure(): boolean;
    // item.rs:1662
    is_unsafe_foreign_mod(): boolean;
    // item.rs:1683
    parse_global_static_front_matter(case_: Case): Safety | undefined;
    // item.rs:1709
    recover_const_mut(const_span: Span): void;
    // item.rs:1721
    parse_const_block_item(): PResult<ConstBlockItem>;
    // item.rs:1735
    parse_static_item(safety: Safety, mutability: Mutability): PResult<ItemKind>;
    // item.rs:1773
    parse_const_item(const_span: Span): PResult<[Ident, Generics, Ty, Expr | undefined]>;
    // item.rs:1868
    recover_missing_global_item_type(colon_present: boolean, m: Mutability | undefined): Ty;
    // item.rs:1896
    parse_item_enum(): PResult<ItemKind>;
    // item.rs:1953
    parse_enum_variant(span: Span): PResult<Variant | undefined>;
    // item.rs:2046
    parse_item_struct(): PResult<ItemKind>;
    // item.rs:2113
    parse_item_union(): PResult<ItemKind>;
    // item.rs:2148
    parse_record_struct_body(adt_ty: string, ident_span: Span, parsed_where: boolean): PResult<[FieldDef[], Recovered]>;
    // item.rs:2188
    parse_unsafe_field(): Safety;
    // item.rs:2200
    parse_tuple_struct_body(): PResult<FieldDef[]>;
    // item.rs:2308
    parse_field_def(adt_ty: string, ident_span: Span): PResult<FieldDef>;
    // item.rs:2331
    parse_single_struct_field(adt_ty: string, lo: Span, vis: Visibility, mut_restriction: MutRestriction, safety: Safety, attrs: AttrVec, ident_span: Span): PResult<FieldDef>;
    // item.rs:2423
    expect_field_ty_separator(): PResult<undefined>;
    // item.rs:2455
    parse_name_and_ty(adt_ty: string, lo: Span, vis: Visibility, mut_restriction: MutRestriction, safety: Safety, attrs: AttrVec): PResult<FieldDef>;
    // item.rs:2508
    parse_field_ident(adt_ty: string, lo: Span): PResult<Ident>;
    // item.rs:2605
    parse_item_decl_macro(lo: Span): PResult<ItemKind>;
    // item.rs:2634
    is_macro_rules_item(): IsMacroRulesItem;
    // item.rs:2655
    parse_item_macro_rules(vis: Visibility, has_bang: boolean): PResult<ItemKind>;
    // item.rs:2685
    complain_if_pub_macro(vis: Visibility, macro_rules: boolean): void;
    // item.rs:2700
    eat_semi_for_macro_if_needed(args: DelimArgs, path: Path | undefined): void;
    // item.rs:2707
    parse_test_binder_constraints(): PResult<TestBinderConstraints>;
    // item.rs:2715
    parse_test_binder_body(): PResult<TestBinderBody>;
    // item.rs:2741
    parse_test_binder_forall(): PResult<TestBinderForall>;
    // item.rs:2767
    parse_test_binder_exists(): PResult<TestBinderExists>;
    // item.rs:2775
    parse_test_binder_constraint(): PResult<TestBinderConstraint>;
    // item.rs:2826
    parse_test_binder_bound_type_constraint(): PResult<TestBinderBoundTypeConstraint>;
    // item.rs:2868
    report_invalid_macro_expansion_item(args: DelimArgs, path: Path | undefined): void;
    // item.rs:2910
    recover_nested_adt_item(keyword: Symbol): PResult<boolean>;
    // item.rs:2938
    check_impl_frontmatter(look_ahead: number): boolean;
    // item.rs:2973
    try_recover_const_missing_semi(rhs: Expr | undefined, const_span: Span): Expr | undefined;

    // ---- compiler/rustc_parse/src/parser/function.rs ----
    // function.rs:116
    parse_fn(attrs: AttrVec, fn_parse_mode: FnParseMode, sig_lo: Span, vis: Visibility, case_: Case): PResult<[Ident, FnSig, Generics, FnContract | undefined, Block | undefined]>;
    // function.rs:163
    error_fn_body_not_found(ident_span: Span, req_body: boolean, fn_params_end: Span | undefined): PResult<ErrorGuaranteed>;
    // function.rs:243
    parse_fn_body(attrs: AttrVec, ident: Ident, sig_hi: MutRef<Span>, req_body: boolean, fn_params_end: Span | undefined): PResult<Block | undefined>;
    // function.rs:305
    check_fn_front_matter(check_pub: boolean, case_: Case): boolean;
    // function.rs:407
    parse_fn_front_matter(orig_vis: Visibility, case_: Case, parsing_mode: FrontMatterParsingMode): PResult<FnHeader>;
    // function.rs:669
    parse_fn_decl(fn_parse_mode: FnParseMode, ret_allow_plus: AllowPlus, recover_return_sign: RecoverReturnSign): PResult<FnDecl>;
    // function.rs:682
    parse_fn_params(fn_parse_mode: FnParseMode): PResult<Param[]>;
    // function.rs:731
    parse_param_general(fn_parse_mode: FnParseMode, first_param: boolean): PResult<Param>;
    // function.rs:852
    parse_self_param(): PResult<Param | undefined>;
    // function.rs:995
    is_named_param(): boolean;
    // function.rs:1012
    recover_self_param(): boolean;

    // ---- compiler/rustc_parse/src/parser/cfg_select.rs ----
    // cfg_select.rs:19
    parse_cfg_select_branch_rhs(): PResult<TokenStream>;
  }
}
