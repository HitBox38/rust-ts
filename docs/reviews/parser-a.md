# Wave 6b/6c review A: parser-core, parser-ptg, parser-pat-stmt, parser-fn-asm (independent reviewer, lane review-parser-a)

Work in progress. Reviewed at main `5659298`, against upstream at the pin `6f5da406b56c`.

## Method (so far)
- `coverage.ts --check`: markers ok (3642). `--missing`: mod 90/90, token_type 10/10, attr 12/12, attr_wrapper 9/9,
  nonterminal 4/4, lib 13/13, path 19/19, ty 50/50, generics 17/17, pat 52/52, stmt 27/27, function 11/11,
  asm 11/11, cfg_select 1/1.
- `RUST_TS_REQUIRE_PROBES=1 bun test src tools`: 1999 pass, 1 skip (pre-existing linux-only), 0 fail.
- Marker order: one descent (mod.ts:215 `SeqSep::trailing_allowed` after `Parser::new`), acceptable under PORTING §8.
- Review probe (rustc-dev, pinned nightly) for paths `-Zunpretty=ast-tree` cannot reach: 5760 `nonterminal_may_begin_with`
  checks, 258 `parse_nonterminal` cases, 96 `collect_tokens` cases with `capture_cfg` on and off: all match.
