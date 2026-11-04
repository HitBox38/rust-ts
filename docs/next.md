# Work queue

Top = next. Root keeps this current. Claim items via `docs/claims/<id>.md` (see AGENTS.md).

## M1 — lexer, parser, AST, diagnostics  (gate: `parse` suite = `-Zunpretty=ast-tree` parity on tests/ui)

Infrastructure first (root):
1. **probe-typedefs** — `tools/probes/typedefs`: a Rust probe using `syn` that dumps every
   struct/enum definition of a given upstream crate (fields, variants, derives, generics) as JSON.
2. **codegen-types** — `tools/codegen/types.ts`: from typedefs JSON, emit TS type declarations,
   enum companions and `debug_<Type>` impls following PORTING.md §5. Validate on rustc_lexer
   (generated output must be equivalent to the hand port) before using it on rustc_ast.
3. **codegen-symbols** — `symbols!` (rustc_span/src/symbol.rs) → generated interner prefill.
4. **suite-errors** — add a suite that runs the `ui/parser`, `ui/lexer` tests with their
   compiletest flags (`-Zui-testing` etc.) and compares diagnostics.

Porting lanes (in dependency order; each wave starts after the previous one integrates):
- Wave A: `rustc_data_structures` (subset used by span/ast), `rustc_index`, `rustc_hashes`,
  vendor `rustc_literal_escaper`.
- Wave B: `rustc_span` (BytePos, Span, SourceMap, SourceFile, hygiene stubs, Symbol interner,
  Span Debug = `file:1:1: 1:33 (#0)`), `rustc_ast_ir`, `rustc_ast` (types via codegen),
  `rustc_feature` (tables), `rustc_error_messages`.
- Wave C: `rustc_errors` (DiagCtxt, human emitter, annotate-snippets renderer),
  `rustc_session` (only option parsing + ParseSess needed by the parser).
- Wave D: `rustc_parse::lexer` (StringReader, tokentrees, unicode_chars, diagnostics),
  `rustc_ast_pretty` (needed by parser diagnostics).
- Wave E: `rustc_parse::parser` (mod, item, expr, pat, ty, stmt, path, generics, attr, diagnostics, ...).
- Wave F: driver: `rustc_driver_impl`/`rustc_interface` subset: CLI → parse → `-Zunpretty=ast-tree`.

## Later milestones
See `PLAN.md` §5.

## In flight (wave 1, started 2026-10-11)
| lane | scope | status |
|---|---|---|
| typedefs | syn probe + tools/codegen/types.ts | **merged** |
| escaper | vendor rustc-literal-escaper 0.0.8 + `escape` suite (25,780/25,780) | **merged, protected** |
| span-core | rustc_span lib.rs, span_encoding, analyze_source_file, edition, fatal_error | **merged** |
| span-symbol | symbol.rs (+ symbols! codegen, 2434 symbols oracle-checked), edit_distance | **merged** |
| span-hygiene | hygiene.rs, def_id.rs | **merged** |

Next after integration: wave 2 = span-map (source_map.rs, caching_source_map_view.rs), rustc_ast types via codegen, rustc_errors start; plus reviewer + regression auditor over wave 1.

## Wave 2 (started 2026-10-12)
| lane | scope | status |
|---|---|---|
| span-wire | rustc_span stand-ins → real exports; session globals; float Debug; std char helpers; review-w1 fixes | **merged** (gate-20261012-104747-root-9uvz) |
| ast-types | rustc_ast + rustc_ast_ir types/Debug via codegen (20 .gen.ts, 252 types); newtype_index/bitflags; unknown cfg → ERROR | **merged** (gate-20261012-105724-root-lfad) |
| review-w1 | independent review of wave 1 | **merged** |
| harness-w2 | symdump probe + `symbols` suite; synthetic escape corpus + `escape-synthetic` suite | done, under independent review |

## Wave 3 (2026-10-12) — done
| lane | scope | status |
|---|---|---|
| span-map | source_map.rs, caching_source_map_view.rs, vendor unicode-width 0.2.2 (oracle tables) | **merged** (gate-20261012-154702-root-tr7a) |
| ast-token | rustc_ast token.rs, tokenstream.rs, util/* | **merged** (gate-20261012-185308-root-a805) |
| errors-core | rustc_error_messages (100%), rustc_errors core: DiagCtxt, Diag, codes (518 error codes generated) | **merged** |
| harness-w2 | `symbols` (10) + `escape-synthetic` (11) suites | **merged, protected** (gate-20261012-105941-root-hf6n) |
| audit-1 / gate-provenance | regression audit (CLEAN-WITH-NOTES) → gate records HEAD/dirty, accept refuses partial/dirty/moved runs; oracle cache keyed on rustc_driver build | **merged, reviewed** |

rustc_span is 658/658. Total 1,196 / 25,517 fns.

## Wave 4 (2026-10-12) — done (root host now macOS)
| lane | scope | status |
|---|---|---|
| fluent-syntax | vendor fluent-syntax 0.12.0 | **merged** |
| langid-plural | vendor tinystr, unic-langid(-impl), intl_pluralrules (+ `plurals` probe) | **merged** |
| fluent-bundle | vendor fluent-bundle 0.16, intl-memoizer, type-map, fluent-langneg; rustc_errors formatting wired | **merged** |
| icu-list | vendor icu_list/icu_locale_core/icu_provider/fallback/zerotrie/regex-automata(sparse DFA)/writeable subsets; rustc_baked_icu_data as data (+ `listfmt` probe) | **merged** |
| annotate-a / annotate-b | vendor annotate-snippets 0.12.16 + anstyle 1.0.13 (+ `annotate` probe, 1754/1754 renders) | **merged** |
| ast-core | rustc_ast ast.rs fns, node_id, entry, format, attr/{data_structures,version}, expand/* | **merged** |
| ast-visit | ast_traits.rs, visit.rs, mut_visit.rs | **merged** |
| codegen-derive | generated Walkable/MutWalkable (147x2), clone_<T> (231), Pu128 Debug, Ord discriminants | **merged** |
| harness-fluent | `fluentdump` probe, `fluent-parse`/`fluent-format` suites | **merged, protected** (4210 + 4210), reviewed x2 |
| harness-w4b | difftest batch bisection on failure, vendor markers in coverage.ts, fluentdump line-range guard | **merged**, reviewed |
| review-w23a/b + fix-w23a/b | independent review of waves 2–3 and fixes (Path hash stable ids, desugared_tts u8 wrap, Diag drop bomb, exact assert texts, std path/io/slice) | **merged** |

Compiler fns 1527/25517; vendor 1773/6132 (26 crates). Final gate: gate-20261012-211129-root-ws8a.

## Wave 5 (2026-10-13) — done
| lane | scope | status |
|---|---|---|
| emitter | emitter.rs, annotate_snippet_emitter_writer.rs, timings.rs; vendor anstream/anstyle-parse/utf8parse/colorchoice/anstyle-query/termize | **merged** |
| codegen-diag | `#[derive(Diagnostic/Subdiagnostic)]` codegen (token-checked vs real expansion, 394 impls); rustc_parse diagnostics generated | **merged** |
| lint-defs | rustc_lint_defs lib + generated builtin lints (oracle `-W help`); LintExpectationId interned | **merged** |
| feature | rustc_feature tables generated, oracle-checked | **merged** |
| ast-attr | attr/mod.rs, rustc_ast_ir fns, single LitKind companion | **merged** |
| harness-w5 | `emit` suite (1466 cases, emitdump probe linking upstream rustc_errors), difftest split fixes, gate requires probes, Result::unwrap text | **merged, protected**, reviewed x2 |

## Wave 6a (2026-10-13) — done
| lane | scope | status |
|---|---|---|
| lexer | rustc_parse lexer/mod.rs, diagnostics.rs, tokentrees.rs (oracle token streams via rustc-dev) | **merged** |
| lexer-aux | vendor unicode-normalization 0.1.25 (nfc probe), unicode_chars.rs, unescape_error_reporting.rs | **merged** |
| session-parse | rustc_session parse.rs (ParseSess), diagnostics.rs (generated), utils.rs; Session stand-in | **merged** |
| session-options | `options!` codegen (`-Z/-C help` byte-exact), options.rs parse fns, config.rs subset | **merged** |
| pp / pprust-state / pprust-ei | rustc_ast_pretty complete (pp engine 715/715, State, expr/item; oracle fixtures via rustc-dev) | **merged** |

Compiler fns 2284/25518; vendor 2172/6531. Final gate: gate-20261012-222820-root-ezdj (emit protected 1466).

## Wave 6b (2026-10-13) — done
| lane | scope | status |
|---|---|---|
| parser-core | Parser contract (decls.ts, 560 methods), mod.rs, token_type.rs, attr.rs, attr_wrapper.rs, nonterminal.rs, rustc_parse lib.rs | **merged** |
| driver-session | vendor getopts 0.2.24; config/session subset; rustc_driver_impl + rustc_interface driver path; CLI oracle | **merged** |
| harness-w6 | `tokens` (crate-root lexing, rustc-dev probe) + `tokens-str` suites; gate/cache/probe hardening | **merged, protected**, reviewed x2 |
| review-w456a/b + fix-w456 | independent review of waves 4–6a + fixes (termize fd leak, Visitor Result footgun, AstNodeWrapper write-through, tuple clones) | **merged** |

Compiler fns 2650/25518; vendor 2277/6637. Final gate: gate-20261013-001906-root-2lda (tokens 25780 + tokens-str 39 protected).

## Wave 6c (2026-10-13) — done: the parser
| lane | scope | status |
|---|---|---|
| parser-ptg / pat-stmt / expr / item / fn-asm / diag | all of rustc_parse/parser (path, ty, generics, pat, stmt, expr(+diagnostics), item, function, asm, cfg_select, diagnostics) | **merged** |
| parser-tests | all 54 parser/tests.rs tests (emitter rendering + parser) | **merged** |
| unicode-width-str | string widths (width_in_str); getopts usage; driver --help/--explain | **merged** |

**`parse` suite: 21,522 / 21,526 tests/ui files byte-identical** (`-Zunpretty=ast-tree` + parser diagnostics), protected
(gate-20261013-012502-root-ad5h). Not matching: 3 subject TIMEOUTs (deep nesting; `{:#?}` builders re-pad every level,
O(depth×size)) and 1 oracle timeout (deep try chain). Compiler fns 3213/25518 (rustc_parse 779/791).

## Wave 7 (started 2026-10-13) — finish M1, scope M2
| lane | scope |
|---|---|
| review-parser-a / review-parser-b | independent review of wave 6b/6c porting lanes (parser files, driver-session, unicode-width-str) |
| fmt-perf | std/fmt Debug builders without per-level re-padding (output byte-identical); clears the 3 parse TIMEOUTs |
| harness-w7 | `parse-ui` suite: tests/ui/{parser,lexer} with compiletest flags (`//@ compile-flags`, edition, -Zui-testing) stopping after parsing; per-suite timeouts for deep-nesting cases; harness-w6-2 J1 |
| plan-m2 | M2 (expansion + name resolution) crate map, order, lane split, oracle suites |

## M1 — DONE 2026-10-13 (gate-20261013-074957-root-7dg1)
lex 25,780/25,780; parse 21,523/21,526 (3 ORACLE_TIMEOUT); parse-ui 991/991 (ui/parser, ui/lexer, ui/frontmatter with compiletest flags).

## Wave 7–8 (2026-10-13) — mostly done
reviews parser-a/b + fix-parser (stack re-exec, argfiles, raw argv, json emitter, io errors); fmt-perf (linear {:#?});
harness-w7 (parse-ui, ORACLE_TIMEOUT), harness-w8 (expanded-nocore / unpretty-expanded-nocore / resdump-nocore, unprotected);
target-cfg, attr-ir-gen, hir-def, stable-hash, tyctxt-min, attr-parse-a/-b/-c/-d merged. **Wave 8 done** (rustc_attr_parsing complete; query engine + TyCtxt subset; rustc_target 6 targets; stable hashing).

## Wave 9 (started 2026-10-13) — expansion + builtins (docs/plan-m2.md §3)
expand-base, expand-core, mbe-a, mbe-b, bm-a (incl. cmdline_attrs::inject, the current stop point of every nocore case) now;
then bm-format, bm-derive-a/-b, bm-rest, expand-pm-types. Then wave 10 (resolve, ast-passes, lint-early, driver-m2).
Queued: lane std-unicode (oracle-generated char property tables replacing JS \p{} regexes); lane hashbrown-order (HashMap/HashSet iteration order for the oracle host; unblocks format named-arg Debug, doc(auto_cfg), mbe candidates); harness L1 env filtering; skip the 3 parse ORACLE_TIMEOUT files; error-code explanation texts for json.
**Wave 9 done**: all lanes merged (hashbrown-order, expand-pm-types, bm-rest last). Follow-ups from them:
lane target-asm (rustc_target::asm; asm! stops there); typemap FxHashMap/FxHashSet clone+debug via clone_HashMap/debug_HashSet
(codegen batch); switch remaining plain-Map Fx maps (NamedMatches etc.) to FxHashMap; check env_depinfo Symbol-vs-string
mismatch between rustc_builtin_macros/env.ts and passes.ts.

## Wave 10 (started 2026-10-13) — resolution, passes, lints
lint-early-a, res-graph, res-ident, res-macros, res-imports, ast-passes (against res-lib's contract, docs/handoff/res-lib.md);
then res-late-a/-b, res-diag, res-late-diag-a/-b, lint-early-b, rustdoc. Gate M2a: expanded-nocore + resdump-nocore >=95%.
Merged: res-ident, res-macros, res-graph, res-imports, ast-passes (+ExternAbi/AbiMap), target-asm, fx-maps. rustc_resolve 56%.
Second half running: res-late-a/-b (late.rs split at :2891), res-diag-a/-b (diagnostics/impls.rs split at :1978),
res-late-diag-a/-b (late/diagnostics.rs split at :2267), rustdoc (+pulldown-cmark subset), feed-hash (query re-feed hashing,
DenseBitSet, per-process test scratch dirs). lint-early-b after lint-early-a.
**Wave 10 done (2026-10-13)**: rustc_resolve complete (all files), rustc_lint core + all early passes, rustc_ast_passes,
creader (wave 11 lane pulled forward), rustdoc (+pulldown-cmark), target-asm, fx-maps, feed-hash. Samples (300):
expanded-nocore 89.7% and unpretty-expanded-nocore 89.7% (0 DIFF; every other case stops at CrateLocator::new = extern crate);
resdump-nocore 1% (the port's resdump printer, src/rust_ts/resdump.ts `dump`, is not written).

## Wave 11 — metadata + resdump (toward M2a: expanded-nocore + resdump-nocore >= 95%)
resdump-dump (write src/rust_ts/resdump.ts `dump` to the probe's format); locator (+fs, filesearch); rmeta-types
(rmeta/mod, table, parameterized); serialize (rustc_serialize + Decodable codegen); rmeta-decoder (decoder.rs split);
cstore-impl (rest of cstore_impl.rs + provide); object-read (vendor object 0.39.1 archive/ELF read; DefaultMetadataLoader).
Follow-ups: char::to_titlecase -> src/std (generated table); late_b.test.ts loads .env.local itself; std-unicode
switches; harness L1 env filtering; skip the 3 parse ORACLE_TIMEOUT files.
Wave 11 progress (2026-10-13): gate-20261013-144410 protected expanded-nocore/unpretty-expanded-nocore (19668) and
resdump-nocore (19677). Merged: resdump-dump, locator, serialize, object-read (+wasmparser), span-decode, rmeta-contract,
rmeta-decoder-a/-b, cstore-impl, odht (+odht-wire fixer). decoder.rs 156/156. Remaining extern-crate cases stop at
`Decodable for SimplifiedType` -> lane decode-elems running. Then M2a gate (>=95%) and M2b (`expanded` with std).

## Queued (later)
1. Follow-ups: move shared helpers into src/std (str helpers from ast-token/span-map/errors-core, path, io, Backtrace);
   `LoneSlash` escape coverage (raw-input mode, harness batch); hash std libs into the oracle key once suites compile against std.

## M2a — DONE 2026-10-14 (gate-20261013-203604-root-k75z)
expanded-nocore 21471/21523 (99.76%), unpretty-expanded-nocore 21471, resdump-nocore 21480 (99.80%).

## Wave 12 — M2b (`expanded` with std >= 95%)
Merged: harness-w12 (suites expanded / unpretty-expanded / resdump; review ACCEPT-WITH-NOTES), m2b-stability
(middle/stability.rs), m2b-misc (include!/resolve_path, Path::file_name, DeclaredIdents). Samples ~99.5%.
Known stops: Location::caller (-Ztrack-diagnostics, decision: unported), VariantData decode, find_by_ident_and_kind,
proc-macro quote! (M6). Next: gate protecting the with-std suites (= M2b), then wave 12 ui-expanded harness
(compiletest flags, aux crates by the oracle) toward gate M2, then M3 planning (typeck on mini_core).

## M2b — DONE 2026-10-14 (gate-20261013-223511-root-kxdx): expanded 21460, unpretty-expanded 21460, resdump 21470 / 21523.

## Wave 13 — M3 foundations (merged 2026-10-14, see docs/plan-m3.md)
Merged: plan-m3, vendor-ena, hir-types, hir-visit, lowering-contract, ty-contract, codegen-tyir, probe-tydump (reviewed).
Pending review: harness-w13 (hir-tree suites + sparse tests/auxiliary; must handle the oracle cache for files that
include tests/auxiliary). Follow-ups: rustc_data_structures lib.ts ena re-exports; wire rustc_ast_lowering.provide +
codegen set rustc_ast_lowering; ena oracle probe; probe-tydump review notes L1-L3; bundle the port (startup ~0.44 s
of 0.55 s per case) to speed up the gate (harness batch).
Next: wave 14 = lowering lanes (lower-lib-a/-b, lower-item, lower-expr, lower-pat-path-block, lower-asm-format-contract,
lower-delegation, lower-index-diag, middle-hir, hir-pretty-a/-b) -> gate M3a (hir-tree); + tyir lanes.

## M3a — DONE 2026-10-14 (gate-20261014-053236-root-e5u0): hir-tree-nocore 21335, hir-tree 21306; unpretty-hir 21310 protected (gate-20261014-092810).
## Waves 15–16 merged 2026-10-14: rustc_middle::ty, type IR, next trait solver (425/425), infer contract, collect, HIR ty lowering.
Compiler fns ported: 12816/25518 (50.2%).
Next: tydump-subject (port side of tydump suites), delegation fn_sig_skip_binders repoint; infer fill lanes (infer-core, -relate, -regions,
-canonical-outlives, -opaque-snapshot per infcx-contract split); wave 17 (trait-sel-solve, trait-sel-traits-a/-b, check-wf-a/-b, check-check,
check-compare, check-region-intrinsic, coherence, variance-outlives-implwf, lint-levels-hir).
Follow-ups: scripts tests pollute env when run with src (run separately); coverage can't mark two fns on one line; cache-deps notes N1-N3.


## Wave 17 merged 2026-10-15 (main 4750f7d): trait-sel-traits-a/-b/-c, trait-sel-solve, check-check, check-wf-a/-b, check-compare,
check-region-intrinsic, coherence, small-gaps-17 (+ merge-w17 fixer), thir-cx-print. Review review-w17 (sampled, independent): all lanes
ACCEPT-WITH-NOTES so far; MED: tracked oracle rlib (fixed 6ed33da). Decision: compiletest passes -Znext-solver=coherence, so ui-derived
suites need the old solver -> pulled forward to wave 18.

## Wave 18 (running)
18a: fnctxt-contract (rustc_hir_typeck contract), selcx-contract (old solver contract + obligation_forest + rustc_traits),
codegen-fn-attrs (top tydump stop), small-gaps-18, thir-pattern (pattern lowering, mir_build diagnostics, THIR Debug typemap).
18b (after contracts): typeck fill lanes and old-solver fill lanes per the contracts' split tables -> gate M3b.
Follow-ups from review-w17 (LOW): stale PORT/header comments (wfcheck.ts, coherence/mod.ts, check/mod.ts, lib.ts, refine.ts,
diagnostics.ts:153); traits_a.test.ts solver-default comment + old-solver stop tests; bug!() text in analyse.ts:157;
min_specialization.ts:393 has_infer assert; dropped assert messages (check.ts:762, normalize.ts:228); util.ts:157 index panic;
compare_impl_item oracle should use --out-dir; collect.test.ts min facts 69->70; set-based PENDING tests -> per-case maps.
Wave-18b follow-ups found by lanes (for a `typeck-gaps` lane after the 13 lanes merge):
- checks.rs:3615 `same_type_modulo_vars` + `SameModuloVars` (:3620..3700) are on the success path (check_argument_types) — pull out of typeck-checks-b.
- fn_ctxt/suggestions.rs `is_field_suggestable` reached for valid `Foo { a, .. }` patterns — pull forward.
- rustc_middle ty/cast.rs (`CastTy`, 73 lines, no owner) — every non-coercion `as` cast stops there.
- codegen: `PointerKind::VTable` TypeVisitable/TypeFoldable (map to BoundExistentialPredicates fold fns); `AliasTy` Debug.
- decls.ts BinOp/UnOp -> rustc_middle/mir/syntax.ts; typeck_results.ts DerefPatBorrowMode/FakeReadCause real types.
- rustc_passes upvars.rs (`upvars_mentioned` provider, ~100 lines, no owner): needed by closure analysis / typeck-euv.
- decls.ts `Fns_upvar.truncate_place_to_len_and_update_capture_kind` curr_mode -> MutRef<UpvarCapture>; drop upvar.ts's PORT(decls) overload.
- After typeck-euv merges: replace upvar.ts place stand-ins (Place_new, PlaceWithHirId_new, clone_Place, fold_Place, Debug helpers, as_HirPlace casts).
- typeck-euv follow-ups: point rustc_middle/ty/decls.ts HirPlace/ProjectionKind at hir/place.ts (drop casts and stand-in views in ty/closure.ts, thir/cx/expr.ts, tydump_dump.ts); `pub mod place` in hir/mod.ts; codegen TypeFoldable/TypeVisitable for place types (writeback needs them).
- decls.ts CoerceMany: import the hand class from ./coercion.ts (not coercion.gen.ts), stop codegen emitting it; drop expr.ts casts ret_coercion_of / as_gen_CoerceMany.
- diagnostics.ts `ReturnLikeStatementKind` IntoDiagArg stub (return/become outside fn body).
- QueryKey for `CanonicalMethodAutoderefStepsGoal` (method_autoderef_steps; first stop of every `x.method()` once typeck runs).
- probe.ts: codegen the two probe_op lint diagnostics; move local fold_MethodAutoderefSteps / ParamEnvAnd fold descriptor into codegen; type CandidateStep.self_ty; debug_Canonical var_kinds.
- QueryKeys for canonical old-solver queries (normalize_canonicalized_{projection,free_alias,inherent_projection}, type_op_ascribe_user_type, type_op_normalize_*, type_op_prove_predicate, dropck_outlives); their key label "(LocalExpnId, &TokenStream)" looks like a queries codegen bug.
- traits/mod.ts TypeErrCtxtView.build_overflow_error (drop query/normalize.ts OverflowErrCtxtView).
- fulfill.ts:209 unreachable("old solver coherence") must yield "internal error: entered unreachable code: old solver coherence".
- AutoImplConstituents fold: ArgOutlivesClause unported_type_fold (CoroutineWitness assumptions).
- rustc_lint/context.ts:693 LateContext::data_layout still unported (data_layout is ported).
- probe_op's two fn-local lint diagnostics need the typedefs probe to look inside fn bodies.
- CapturedPlace TypeFoldable (ty/closure.rs derive) still unported in writeback.ts.

## Waves 19–29 (2026-10-15 … 2026-10-29): M3 → M4
Typeck/old-solver fill (18b–20), M3 gate 2026-10-22; M4 per docs/plan-m4.md §5: MIR contracts + build (21–22), borrowck
(23, incl. legacy Polonius on vendored datafrog/polonius-engine in 29), CTFE (23b–24), runtime lowering + level-1/2 MIR
passes, driver `-Zunpretty=mir`/`mir-cfg`, metadata MIR decoding, coverage (24–26); harness: mir/mir-minicore/mir-o0/
thir-tree suites (25), serial re-run of pool subject timeouts (harness-timeout-retry, reviewed).

## M4 — DONE 2026-10-29 (gate-20261029-001428-root-june, main b3c8b27a)
mir 20968/21526 (97.4%), mir-minicore 46/46, borrowck-ui 960/960, rustc_dump subset 118/119, mirdump-ui 1340,
thir-tree 1823; 354,775 protected cases in 33 suites; 22,219/25,518 fns (87.1%).

## Wave 30 (started 2026-10-29) — M4 tail + M5 planning
| lane | scope | status |
|---|---|---|
| gaps-30a | `ty_is_opaque_future` skip_binder (163 mir / 91 borrowck-ui-report), iter_instantiated_copied, Relate for ty::Expr (62), select_inherent_assoc_candidates (30), Binder visit caller (13) | running |
| gaps-30b | query descs layout_of / eval_to_const_value_raw / evaluate_obligation, IntoDiagArg impls (22), asm `const` operand (13), Size > 2^53 (32) | running |
| transmute | port rustc_transmute (2.8k; 71 mir cases) | running |
| mir-tail-30 | mir DIFF 2 / CRASH 3 / persistent TIMEOUT 6 | running |
| gaps-30c | the long tail (58 stops: NumScalableVectors, Const::from_bits, extern diagnostic items, ValidityRequirement QueryKey, probe_op diagnostics, ...) | running |
| plan-m5 | docs/plan-m5.md: check core → alloc → std (oracle commands, suites, D1–D13, waves 31–34) | **merged into integ-w30**; D1–D13 recorded |

## Wave 31 (started early, 2026-10-29; plan-m5 §5) — lanes with no overlap with wave 30
| lane | scope | status |
|---|---|---|
| harness-m5a | split mode + heavy class (D6, D11), suites check-core-bin / mir-core (unprotected) | running (harness batch: needs independent review) |
| driver-m5 | Linker, start_codegen, DummyCodegenBackend + D7 stand-in backend, CrateInfo::new, link_binary metadata path, symbol_export providers | running |
| vendor-twox-hash | twox-hash 2.1.2 XXH3-128 scalar path (D8) + oracle probe | running |
Queued after wave 30 merges: stablehash-gaps (D9), query-keys, perf-core-a/-b (serial: 5–7 GB each on a 24 GB host).
Also queued: harness-m5b (harness-m5a review fixes), crateinfo-symbols (wave 33, after the encoder: linker exported_symbols, linked_symbols, exported_symbols_for_lto, metadata_symbol_name), middle dependency_format types file (before metadata-deps), codegen fn-local #[derive(Diagnostic)], fixer for gaps-30a's 3 new CRASH/DIFF cases (simplify.ts:810 unwrap; false E0433 for `use core::` in edition 2015), Size > 2^53 representation (gaps-30b design; plan-m5 D10).
Left after these: proc-macro `quote!` (30, M6), `Location::caller` (decision: unported). Rule: no lane work while a gate runs.

## Gate on wave 30 (main 5a542fbf): FAILED, 1 loss (gate-20261029-114054-root-6z8e)
Only loss: mir tests/ui/try-trait/deep-try-chain-issue-153583.rs TIMEOUT (68 s user, limit 60 s; oracle 1.65 s; not a
wave-30 regression). Gains otherwise: borrowck-ui-report 1276/1276 (+103), mir 21444 (+477), tydump-ui +13, unpretty-hir +10, ...
| lane | scope | status |
|---|---|---|
| perf-stalled-goals | next-solver fulfillment loop constant factors (stalled-goal checks); target <= 30 s user on that case | running |
Then: re-gate, accept, and wave 31 proper (stablehash-gaps, query-keys, harness-m5b, perf-core-a/-b).

## Waves 30–31 ACCEPTED 2026-10-30 (gate-20261029-224808-root-f2r5, main 61086b63)
403,191 protected in 34 suites (+48,416): mir-core 47,734 (all of core's MIR), mir 21,445, borrowck-ui-report 1,276/1,276,
thir-tree 1,849. check-core-bin completes core's analysis and stops at the metadata encoder. 22,413/25,518 fns (87.8%).

## Wave 32 (started 2026-10-30) — encoder foundations (plan-m5 §5)
| lane | scope | status |
|---|---|---|
| encode-contract ✱ | Encodable codegen (D3), Encoder interface, EncodeContext skeleton, Lazy* writers, contract test | running |
| metadata-deps | dependency_format/native_libs/foreign_modules/fs.rs; middle dependency_format types file | running |
| passes-reachable | reachable.rs, svh, config DepTrackingHash | running |
| perf-core-a | profile core expanded + check-core-bin; constant-factor fixes (D10) | running |
| fixer-30 | remaining mir CRASH/DIFF cases (simplify.ts:810 unwrap, false E0433) | running |
After encode-contract: encode-span-hygiene, encode-middle; probe-rmetadump + harness-m5c (rmeta-* suites, check-core binary
compare, compiler_builtins aux chain); vendor-twox-hash wiring (wave 33); crateinfo-symbols (wave 33).

## Wave 32 ACCEPTED 2026-10-31 (gate-20261030-102229-root-fsro, main 937edef8)
Encoder foundations merged and reviewed (encode-contract, encode-span-hygiene, encode-middle incl. hashbrown-order
FxHashMap encoding, metadata-deps, passes-reachable: D1 core dep_tracking_hash == oracle) + perf-core-a; protected set
unchanged (403,191, encoder not yet reachable); mir-core 145.6 s user / 8.0 GB. Root fix: options codegen POLONIUS_HELP
lazy (config.ts/options.gen.ts cycle safe in either order).

## Wave 33 (started 2026-10-31) — the encoder (plan-m5 §5)
| lane | scope | status |
|---|---|---|
| encoder-a | encoder.rs :1–:650 (contract-owned: [u8], def-path table/hash map, lazy machinery) | running |
| encoder-b | :651–:1480 (encode_crate_root, crate-level lists, should_encode_*) | running |
| encoder-c | :1482–:2040 (encode_def_ids, ADTs, mir_for_ctfe/promoted, stability, native libs) | running |
| encoder-d | :2040–:2909 (impls, items, exported symbols, encode_metadata, header, SVH via XXH3-128, EncodedMetadata switch-over) | running |
| crateinfo-symbols | linker exported_symbols/linked_symbols, lto exported_symbols_for_lto, metadata_symbol_name, global_backend_features | running |
| probe-rmetadump | rmeta dump probe + rmeta-core / small-crate rmeta suites / check-core binary compare (harness batch) | running |
Queued: representation decisions from perf-core-a (numeric interning hash, GenericArg.kind, SpanData columns, GC/closures);
std io::stdout EBADF; harness: instructions-retired for heavy runs; harness-m5c (compiler_builtins aux chain, check-alloc/std).

## Wave 33 ACCEPTED 2026-10-31 (gate-20261030-222147-root-bec4, main 1c555a2e) — M5b on core
The metadata encoder (encoder.rs 95/95) + crateinfo/symbol-export + NativeLib codec + hashbrown-order DefIdMaps + the
rmeta probe. libcore's .rmeta is byte-identical to the oracle's (check-core protected); rmeta-core 82,338,
check-ui/rmeta-ui 730/730. 486,990 protected in 38 suites; 22,589/25,518 fns (88.5%).

## Wave 34 ACCEPTED 2026-10-31 (gate-20261031-111945-root-7u0n, main 05dba243, accept b89066b4) — **M5 done**
| lane | scope | review |
|---|---|---|
| harness-m5c | D2 aux chain (compiler_builtins, std's 13 deps, backtrace submodule), check-/rmeta-/mir-alloc, check-/rmeta-/mir-std, check-chain (harness batch) | APPROVE |
| followups-33 | the small wave-32/33 review follow-ups (ExportedSymbol import, SpanEncoder typing, fx-order type check, rmeta oracle test, typemap, EBADF, ...) | APPROVE |
| size-bigint | Size exact form for values >= 2^53 (decision cb7b9a60): mir-std 5,204/5,204, mir +30 | APPROVE WITH NITS |
| exported-symbols-codec (root) | (ExportedSymbol, SymbolExportInfo) derives generated (rustc_middle set); refine_rpitit now stops at mono items (M7) | REQUEST CHANGES → fixed → APPROVE |
| gate-runner-unit (root, harness batch) | the gate runs the scripts/harness tests in a second unit-test process; deps.test.ts restores RUST_TS_DATA | APPROVE WITH NITS |
core, alloc and std .rmeta byte-identical to the oracle's (check-core/alloc/std, the plan-m5 gate). 529,020 protected in
44 suites (+42,030: rmeta-alloc 14,678, rmeta-std 18,196, mir-alloc 3,734, mir-std 5,204, check-alloc/std 1 each,
escape/lex/tokens +62 each, mir +30); 22,590/25,518 fns (88.5%). Note: a full gate takes ~10 h; run it detached (nohup).

Follow-ups (queued):
- size-bigint review nits: stale "Size < 2^53" comments (memory.ts:739, operator.ts:531, pointer.ts:11-12); upstream's
  `i64::try_from(..).unwrap()` panic missing at 4 memory.ts sites + intrinsics.ts:568; local Size comparators
  (provenance_map.ts, layout/ty.ts, validity.ts) → Size_cmp/Size_eq; compute_size_in_bytes / allocate_bytes_ptr against
  `max_size_of_val()`; stale Size notes in mir.typemap.json / typemap.hir.json.
- The 3 mir cases at `UndefinedBehaviorInfo u64/i64 field beyond 2^53` (consts/const_transmute_type_id2, offset_from_ub,
  offset_ub): DanglingIntPointer / PointerOutOfBounds u64/i64 fields → bigint (typemap + error.ts Display + validity.ts).
- gate-runner-unit nits: probe pre-check covers only src/tools tests (scripts/gate-probes.test.ts needs every suite's
  probe); carry the junit path in the step definition; path-filter overlap of `bun test scripts harness`.
- exported-symbols-codec: unit coverage of the DefId/Ty/GenericArgs variants comes with M7 (oracle).
- Earlier queue: check-chain stderr order (report-only suite); chain-run.test.ts uses /bin/sh; aux dir cleanup; merge
  the duplicate handle_ebadf; perf representation decisions from perf-core-a (numeric interning hash, GenericArg.kind,
  SpanData columns, GC/closures); expected mir TIMEOUTs (supertrait-hint-cycle, 3 TAIT cases).

## Wave 35 (started 2026-10-31) — M6 planning + M5 follow-ups
| lane | scope | status |
|---|---|---|
| plan-m6 | design lane: docs/plan-m6.md (Miri oracle in an isolated toolchain; run-pass; proc macros; D1–D14) | APPROVE WITH AMENDMENTS → accepted with A1–A11 (decision recorded); merged into integ-w35 |
| interp-generic ✱ | D3/A1: generalise the interpreter's Machine types; re-port the OFFSET_IS_ADDR=true branches (15 sites verified) | REQUEST CHANGES (B1 provenance at get_bytes_unchecked_raw*, B2 MayLeak/Display of M::MemoryKind) → fixed in interp-miri-reconcile |
| miri-contract ✱ | D2: src/miri skeleton (60 gen modules, 248 types, 101 stubs), decisions C1–C13 recorded (C4/C5 amended) | APPROVE WITH NITS → lands via interp-miri-reconcile |
| interp-miri-reconcile ✱ | merges both; B1/B2 (+ machine-supplied MemoryKind Eq); miri-contract M1–M5, M7 (mixin); C5 hot fields → number; nits | APPROVE WITH NITS (N1 fixed by root; N2/N3 decisions recorded); merged into integ-w35 |
| pm-bridge | library/proc_macro bridge/* (~2.1k; wire format = upstream's with_api! 31 methods; TS-to-TS tested) | APPROVE WITH NITS; merged into integ-w35 (hooks wired with pm-lib) |
| pm-lib | library/proc_macro lib, diagnostic, escape, to_tokens, quote (~2.9k) | APPROVE WITH NITS; merged into integ-w35 |
| pm-wiring (root) | lib.ts ↔ bridge/client.ts, quote! = BangProcMacro(Client.expand1(quote)), Rustc.default_TokenStream: the 30 quote! cases 330/330 MATCH on 11 suites through the real bridge | APPROVE WITH NITS (F1 init order fixed by root) |
| vendor-rand | D5: rand/rand_core 0.10.1 + chacha20 0.10.0 subset; 254-line StdRng oracle fixture byte-identical | APPROVE WITH NITS; merged into integ-w35 |
| followups-34 | the size-bigint review nits and the 3 UB-field cases above (all 3 MATCH; codegen per-field typemap override, decision recorded) | APPROVE WITH NITS (N1 fixed by root); merged into integ-w35 |
| harness-w35 | oracle-toolchain component check (UPSTREAM.json rust.components), gate-runner-unit nits, check-chain runner (core output only on failure), chain-run without /bin/sh, aux cleanup (harness batch) | APPROVE WITH NITS (nits 1-2 fixed by root); merged into integ-w35 |
| harness-m6a | D1 isolated Miri toolchain (`bun scripts/miri.ts setup`) + guard, Miri oracle runner/cache, miri-hello 1 / run-pass-miri 3,263 (+6 heavy) / run-fail-miri 263 (report), coverage crate `miri` (0/1,514; total 27,032), sparse src/tools/miri/tests | APPROVE WITH NITS; merged into integ-w35 |
Then: wave 36 Miri core (plan-m6 §5, with A2's split lanes). Small queue: proc_macro load order: importing bridge/client.ts first hits a 'Client' TDZ (pre-existing pm-bridge
cycle client.ts → … → server.ts); harness-m6a nits (crash-of-Miri detection via bug! path, unstable.ts pattern-order dependence, reject
-Zmiri-disable-isolation argv or mark unstable; port side switches to src/miri/bin/miri.ts when miri-driver lands;
`needs-*` directives evaluated (250 run-pass / 48 run-fail skipped); README `bun scripts/miri.ts setup`; Windows setup);
register tools/probes/randstream (regenerates stdrng.oracle.txt) and crate-src.ts for yanked crates (harness);
vendor-rand nits (x86 sampler skip reason, bernoulli.ts const order); coverage.ts counts // std: / // std-skip: markers (harness batch); pm-bridge nits (client.ts fn order,
unknown-enum 255 encode, panic-hook branch test; pm-host's first test = a real oracle-built proc macro); harness-w35 nits (aux cleanup for mini_core-*/ui/*; disjointness test also for *_test.ts/*.spec.ts; probe
builds run the toolchain check); `BoundsCheckFailed { len, index }` exact (one typemap
`fields` entry + machine.ts / projection.ts); stale comment eval_context.ts:27.

## Wave 35 ACCEPTED 2026-11-01 (gate-20261101-002620-root-q9z7, main 1bb74ec6, accept b8305c67) — M6 planned, contracts in
plan-m6 accepted with A1–A11; the interpreter generalised over Machine types (OFFSET_IS_ADDR=true branches restored) and
the src/miri skeleton reconciled with it; library/proc_macro bridge + lib ported and `quote!` runs through the real bridge
(+29/+30 on 11 suites); vendor rand/chacha20; the isolated Miri oracle toolchain and the miri report suites (harness-m6a).
529,348 protected in 44 suites (+328, 0 lost); 22,614/27,032 fns (83.7%; denominator now includes miri's 1,514).
Gate note: check-core subject max RSS 12,305 MB, 17 MB over its 12,288 MB budget (report only, plan-m5 D11) → perf watch item.

## Wave 36 (started 2026-11-01) — Miri core (plan-m6 §5, A2 split lanes)
Integration branch `integ-w36` (worktree .data/integ-w36) holds: followups-35, miri-machine, miri-driver, miri-sb,
harness-m6b, miri-alloc, miri-race, pm-host, miri-diff (+ root integration fixes: DedupRangeMap clone/eq call sites,
emit_diagnostic via port_methods, placeholder removal). Miri/runtime/proc_macro/metadata/harness/scripts unit tests green.
| lane | scope | status |
|---|---|---|
| followups-35 | port-side small queue | APPROVE WITH NITS (nits fixed acfd1e04); on integ-w36 |
| miri-machine | machine.rs 87/87 | APPROVE WITH NITS (test fix 555f1abb); on integ-w36; callback! API fix queued before first caller |
| miri-driver | bin/miri.rs 19/21, diagnostics, provenance_gc, data_structures | APPROVE WITH NITS; on integ-w36 |
| miri-sb | stacked_borrows/* + weak_memory (88 fns) | APPROVE WITH NITS; on integ-w36 |
| harness-m6b | proc-macro aux dylibs, pm-ui / pm-expanded (272 cases) | APPROVE WITH NITS; on integ-w36; ANOTHER pin + needs-* before pm-ui accept (harness-w36) |
| miri-alloc | alloc/*, alloc_addresses/*, borrow_tracker/mod.rs | APPROVE WITH NITS (root fixes 7de01997); on integ-w36; re-check running |
| miri-race | data_race, data_race_handler, vector_clock | REQUEST CHANGES → root fixes 8199a512; on integ-w36; re-check running |
| pm-host | host_dylib.rs + bun:ffi edge; A4 ok on macOS (Windows unchecked) | REQUEST CHANGES → root fixes d21986ed/a25814af; on integ-w36; re-check running |
| miri-diff | scripts/miri-diff.ts (harness) | REQUEST CHANGES → root fixes c586df20/ef55bea0; on integ-w36; re-check running |
| miri-threads | concurrency thread/scheduler/sync/init_once/blocking_io (163 fns) | REQUEST CHANGES → fixer miri-threads-fix running (oracle schedule pin, value-keyed maps, sync_objs) |
| miri-eval | eval/helpers/operator/math/clock (139 fns) + src/std time/task | REQUEST CHANGES → fixer miri-eval-fix running (f16 powi, f32/f64 host libm fidelity, host guard) |
| miri-log | tracing INFO + interpret info! + bin/log | REQUEST CHANGES → fixer miri-log-fix running (leak fix, loud stop, driver wiring, honest sample) |
| harness-w36 | ANOTHER pin, needs-*, port side → src/miri/bin/miri.ts, probes, nits (harness) | running |
| integ-w36 re-check | independent re-check of all root fixes + integration commits | running |
Then: miri-wire (swap remaining cross-lane stand-ins, callback! API, adjust_alloc_root_pointer interface, typemap retyping
std::time / Poll), the wave 36 gate, then wave 37 shims (→ M6a).

## Wave 36 ACCEPTED 2026-11-02 (gate-20261102-014140-root-96kb, main 30cd90a3, accept 907905cb) — Miri core + proc macros
All 12 wave-36 lanes reviewed and integrated (three via fixer lanes: miri-threads-fix, miri-eval-fix, miri-log-fix), plus
miri-wire (cross-lane wiring) and harness-w36. Miri 759/1,514 fns (50.1%): machine, eval/helpers/operator/math/clock (host
libm via bun:ffi, bit-identical to the oracle), driver, diagnostics, provenance GC, data structures, alloc + addresses (RNG
pinned by probe), Stacked Borrows, weak memory, threads/scheduler (pinned by probe), data-race detector, MIRI_LOG tracing.
Proc macros: oracle-built dylibs load through bun:ffi; **pm-ui 279/282 (98.9%, the M6 pm-ui >= 95% criterion), pm-expanded
280/282**, both new protected suites. 529,907 protected in 46 suites (+559, 0 lost); 23,354/27,032 fns (86.4%).
A first gate run (gate-20261101-155954-root-xp2f) was clean but failed on a mid-gate `state.ts record` (tree changed);
rule recorded: nothing writes to the tree during a gate. Per-merge rule: full unit step after every lane merge.

## Wave 37 (started 2026-11-02) — Miri shims (plan-m6 §5 → gate M6a: miri-hello)
| lane | scope | status |
|---|---|---|
| miri-shims-a | shims foreign_items, alloc, env, extern_static, global_ctor, mod, panic, unwind, tls, os_str (~2.9k) | running |
| miri-shims-b | shims files, io_error, time, math, backtrace, cpu_affinity (MAX_CPUS), sig (~2.85k) | running |
| miri-shims-c | shims readiness, unix/foreign_items, unix/env, unix/mod, unix/thread, unix/mem (~2.9k) | running |
| miri-shims-d | unix/fd, unix/poll, linux/*, intrinsics/{mod, math, simd}, socket.rs isolation-error paths (A3) (~2.1k+) | running |
| miri-shims-e | unix/sync, linux_like/* (epoll, eventfd, sync, syscall, thread) (~2.1k) | running |
| miri-fs | unix/fs.rs (2,404; isolation errors are on the run-pass path) | running |
| fixers-36 | do_not_const_check.rs divergence (rustc and port panic on different constants); RealTime arm test; pm-host failure-path tests check the oracle's error text | running |
| harness-w37 | miri-diff masks the base and keeps offsets; needs-llvm-zstd / needs-deterministic-layouts from the oracle; register the scheduler and mirimath probes; ctfe-sample.ts into scripts (harness batch) | running |
After the shims: miri-hello first differences via miri-diff → fixer lanes; perf lane (D11: hello world <= 3 s user); then the
M6a gate (miri-hello protected).

## Wave 37 ACCEPTED 2026-11-04 (gate-20261102-174727-root-kxpt, main ef00b86a) — **M6a done**: std hello world runs
All wave 37 lanes reviewed and integrated: miri-shims-a to -e, miri-fs, fixers-36, harness-w37, miri-wire-37, m6a-backend,
miri-thread-exit. Miri 1,199/1,514 fns (79.2%). New protected suites: miri-hello 1/1, run-pass-miri 3408/3470 (98.2%; 60
UNPORTED, 2 TIMEOUT), run-fail-miri 292/294 (99.3%; 1 UNPORTED, 1 TIMEOUT). 533,608 protected in 49 suites (+3,701, 0 lost);
23,795/27,032 fns (88.0%). M6b is not read from this gate: its run-pass figure also needs run-pass-miri-heavy, which did not run (correction, 2026-11-04: an earlier version of this note called it met; plan-m6 A12), and M6b needs miri-pass >= 80% (harness-m6c).
run-pass-miri-heavy was left out of this gate (8 serial cases; the two slowest take 282 s and 451 s on the oracle): perf lane.

## Wave 38 (started 2026-11-04) — run-pass tail, M6b (plan-m6 §5)
Integration branch `integ-w38` (worktree .data/integ-w38). x86 and Tree Borrows run in parallel: the Miri contract declares what the halves share (split per docs/handoff/miri-contract.md).
| lane | scope | status |
|---|---|---|
| harness-m6c | miri-pass, -heavy, -tb, miri-fail, run-pass-aux-miri suites (A8); M6b needs miri-pass + heavy >= 80%; scripts/criteria.ts | REQUEST CHANGES, root's fixes re-checked APPROVE WITH NITS; on integ-w38 |
| harness-w38 | harness-w37 nits, queued probes (randstream, epoll/eventfd), UNPORTED bucket counts in the run summary | APPROVE WITH NITS; on integ-w38 |
| miri-perf | D11: hello <= 3 s user, run-pass p99 <= 10 s; the 3 timeouts and the heavy cases; rmeta-core RSS watch | running |
| miri-x86-a | intrinsics/x86/mod.rs + sse, sse2, sse3, ssse3, sse41, sse42 (~2.7k) | APPROVE WITH NITS; on integ-w38 |
| miri-x86-b | intrinsics/x86/avx, avx2, avx512, aesni, bmi, gfni, sha (~1.4k) | APPROVE WITH NITS; on integ-w38; AES rounds stay unported (D5) |
| miri-tb-a | tree_borrows mod, perms, tree_visitor, unimap, wildcard, foreign_access_skipping, exhaustive (~2.6k) | APPROVE WITH NITS; on integ-w38 |
| miri-tb-b | tree_borrows tree, diagnostics, tree/tests (~2.9k) | APPROVE WITH NITS; on integ-w38; test gaps queued |
| followups-37 | port-side small queue from the wave 37 reviews | APPROVE WITH NITS (M1 fixed); on integ-w38 |
| ice-report | design: docs/plan-ice-report.md; independent review ACCEPT WITH AMENDMENTS (docs/reviews/plan-ice-report.md): D3 replay and D8 RUST_BACKTRACE=0 rejected, D4 and D11 amended, target 92 of 118 cases incl. all 14 mir; lanes queued at low priority, after the M6b gate | reviewed |
| miri-tail-a | configure_llvm / target_config flags (31 cases), each_linked_rlib with -C lto (14), parse_native_lib (2), -Zrandomize-layout (1) | APPROVE WITH NITS; on integ-w38 |
| miri-tail-b | shims/unix/virtual_socket.rs: pipe2, socketpair (10 cases; narrows D2) | running |
| mono-collector, mono-partition, miri-sysroot, harness-m6d | M7 groundwork, plan-m6 §5 | queued |
Left out of the 61 for now: getaddrinfo (1 case, sync-send-in-std.rs; D2 sockets) and RUSTC_LOG info/trace (2 cases, log-backtrace.rs, def-path-hash-ice-157238.rs; need rustc's INFO events converted beyond the current targets).

