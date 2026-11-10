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
| miri-perf | D11: hello <= 3 s user met; p99 11.1 s (target 10 s); move-3-unique about 70 s to 33 s CPU; rmeta-core RSS watch | REQUEST CHANGES (F1, F2 memo keys), root's fixes on integ-w38; re-checked APPROVE WITH NITS |
| miri-x86-a | intrinsics/x86/mod.rs + sse, sse2, sse3, ssse3, sse41, sse42 (~2.7k) | APPROVE WITH NITS; on integ-w38 |
| miri-x86-b | intrinsics/x86/avx, avx2, avx512, aesni, bmi, gfni, sha (~1.4k) | APPROVE WITH NITS; on integ-w38; AES rounds stay unported (D5) |
| miri-tb-a | tree_borrows mod, perms, tree_visitor, unimap, wildcard, foreign_access_skipping, exhaustive (~2.6k) | APPROVE WITH NITS; on integ-w38 |
| miri-tb-b | tree_borrows tree, diagnostics, tree/tests (~2.9k) | APPROVE WITH NITS; on integ-w38; test gaps queued |
| followups-37 | port-side small queue from the wave 37 reviews | APPROVE WITH NITS (M1 fixed); on integ-w38 |
| ice-report | design: docs/plan-ice-report.md; independent review ACCEPT WITH AMENDMENTS (docs/reviews/plan-ice-report.md): D3 replay and D8 RUST_BACKTRACE=0 rejected, D4 and D11 amended, target 92 of 118 cases incl. all 14 mir; lanes queued at low priority, after the M6b gate | reviewed |
| miri-tail-a | configure_llvm / target_config flags (31 cases), each_linked_rlib with -C lto (14), parse_native_lib (2), -Zrandomize-layout (1) | APPROVE WITH NITS; on integ-w38 |
| miri-tail-b | shims/unix/virtual_socket.rs: pipe2, socketpair (10 cases; narrows D2) | APPROVE WITH NITS; on integ-w38 |
| mono-collector, mono-partition | M7 groundwork, plan-m6 §5 (rustc_monomorphize 90/153; offload has no lane) | APPROVE WITH NITS; on integ-w38 |
| harness-w39 | aux cache poisoning, scope, probes nits, case lock for the fs cases | APPROVE WITH NITS; on integ-w38 |
| fixers-38 | stdout/stderr synchronous writers, --print sysroot stop, send/recv, -C target-cpu, test gaps, cleanups | APPROVE WITH NITS (F1, F2 fixed); on integ-w38 |
| mio-poll | isolation-off cases stop at mio::Poll::new (17 in miri-pass) with no socket I/O in sight: check whether Miri only creates it at startup, and port that with real polling still stopping | queued |
| miri-sysroot, harness-m6d | M7 groundwork, plan-m6 §5 | queued |
Left out of the 61 for now: getaddrinfo (1 case, sync-send-in-std.rs; D2 sockets) and RUSTC_LOG info/trace (2 cases, log-backtrace.rs, def-path-hash-ice-157238.rs; need rustc's INFO events converted beyond the current targets).
Root's own commits on integ-w38: independent re-check APPROVE WITH NITS (docs/reviews/integ-w38-recheck.md).
Queued after the M6b gate: pointer fragments in Miri allocation dumps print `[object Object]` (re-check F1, silent wrong output, mir/pretty.ts:174); Stacked Borrows ICE on a valid program (miri-perf O1); MIR validation at -Copt-level 2 and 3 (mono-lanes O2); type_length wrapping (mono-lanes O1); mio::Poll::new for 17 miri-pass cases; the probe rebuild (harness-w39 A1); the bytecode bundle; the review nits recorded in docs/state/history.jsonl.

## Wave 38 ACCEPTED 2026-11-05 (gate-20261104-143144-root-lpo8, main bc16a254) — **M6 done**
534,012 protected in 52 suites (+404, 0 lost); 24,230/27,053 fns (89.6%); Miri 1,504/1,535. `bun scripts/criteria.ts --run gate-20261104-143144-root-lpo8`: M6b run-pass 3473/3478 = 99.86%, run-fail 294/294 = 100%, miri-pass 337/360 = 93.61%, all met. pm-ui 279/282 = 98.9%. The 30 `quote!` cases: 325 of 325 instances MATCH across the 11 suites that have them. Independent regression audit PASS WITH NOTES, M6 done by the plan's definition (docs/reviews/m6-audit.md).
Report suites, not protected, after the accept at db323c3b: miri-pass-tb 130/132 (2 mio::Poll::new); miri-fail 598/610 (1 DIFF, the pointer fragment; 4 mio::Poll::new; 7 long error descriptions); run-pass-aux-miri 338/356 (16 EiiMapEncodedKeyValue, 1 RUSTC_LOG, 1 CRASH rustc-env.rs: `option_env!("PWD")` is wrong on the port).

## Wave 39 (started 2026-11-05) — M7 planning, fixes
| lane | scope | status |
|---|---|---|
| plan-m7 | docs/plan-m7.md: IR model behind llvm/ffi.rs, pinned opt and llc, IR parity before LLVM's passes plus native behaviour | ACCEPT WITH AMENDMENTS (docs/reviews/plan-m7.md); D4 scope change pending the owner, before wave 40 |
| fixers-39 | pointer-fragment dump, Stacked Borrows crash, MIR validation at -Copt-level 2/3, type_length, mio::Poll::new, a test's global state | APPROVE WITH NITS; on integ-w39 |
| M7 preflight (plan-m7 wave 39, as amended) | abi-aarch64, vtable-alloc, mono-wire, real-crates (O3-O7), harness-m7a (with mir-opt-o4, -Zalways-encode-mir check-rg, check-rg-host); o2-inline deleted, fixers-39 has it; plus mir-alias | all on integ-w39, reviewed; root's commits re-checked (REQUEST CHANGES, fixed) |
Queued:
- Near-limit protected cases, which matched only through the serial retry in the gate (audit): dynamic-drop.rs and issue-8827.rs (newly protected, about 52-57 s of 60 s), move-3-unique.rs, and four mir cases retried in each of the last four gates (deep-try-chain-issue-153583, hkl_forbidden, param_mismatch2, self-referential-4). Next perf lane; the gate must run with nothing else on the host.
- 52 run-pass programs with proc-macro aux crates run in no suite: run-pass-aux-native in harness-m7c.
- (Both done since, in fixers-40: EiiMapEncodedKeyValue decoding, rustc-env.rs CRASH.) Long error descriptions in rustc_errors::codes (7 miri-fail cases).
- Plan items outside the M6 gate, not done: miri-sysroot-* with harness-m6d; D11's p99 (11.1 s against 10 s); D8's cross-thread proc-macro path (expand-expr.rs).
- Reviews of wave 39: abi-vtable F1 (a supertrait vtable pointer's contents are not compared: fix before a native suite relies on upcasting), F2, F3; mono-wire W2, W3, W5; mir-alias F2 (checker gaps), F3, F4; harness-m7a H3, H5 (due in harness-m7b before the first ir-* baseline), H8-H10; integ-w39 L3, N1-N6; integ-w39-b1 F1 (other exits still leak the metadata temp dir, not new, not reaching the gate); the tools batch from mono-wire, with codegen-sets-m7; rustc_lint/builtin.ts:541; short_string_namespace.
- Recorded earlier: ICE report lanes (docs/plan-ice-report.md, as amended); the deliberate probe rebuild (harness-w39 A1); the bytecode bundle; integ-w38 re-check N2, N8, N9; miri-perf N1-N5; the review nits in docs/state/history.jsonl.

## Wave 39 ACCEPTED 2026-11-06 (gate-20261105-081912-root-ygiz, main 1ec6dd8a) — M7 preflight
541,633 protected in 59 suites (+7,621, 0 lost); 24,242/27,053 fns (89.6%). New protected: mir-o2 3474, mono-ui 3475, mir-opt-o4 405, check-ui-encode-mir 146, check-rg, check-rg-encode-mir and check-rg-host 36 each; miri-pass 345, miri-pass-heavy 5. M6b miri-pass now 350/360 = 97.22%.
**Held for the owner:** D4 (port rustc_codegen_llvm; harness/scope.json says changes need the owner's approval) and PLAN.md's D1, D3; wave 40 does not start without an answer. Also reported: root removed scope.json's virtual_socket.rs exclusion without approval.

## Wave 40a ACCEPTED 2026-11-06 (gate-20261106-073703-root-u0z2, main d51089a3) — what does not depend on D4
541,731 protected in 59 suites (+98, 0 lost); 24,245/27,053 fns (89.6%). The gains are 35 distinct tests/ui files across 13 suites. The laptop lost AC power at 19:14 UTC, near the end, with one suite left; the new safeguard noted it and no case was lost. Regression audit PASS WITH NOTES (docs/reviews/w40a-audit.md): all 541,731 protected IDs MATCH in the raw output; 74 of the +98 are real matches from the ICE report's port, 24 match through the masks and were re-run on both sides. Closest protected cases: dynamic-drop.rs 62% of its limit, issue-8827.rs 60%.
| lane | scope | status |
|---|---|---|
| perf-near-limit | the cases gates retry: all 10 protected mir cases at 36% of their limit or less; dynamic-drop.rs and issue-8827.rs stay at 63-66% | APPROVE WITH NITS; on integ-w40 |
| fixers-40 | review queue of wave 39 | APPROVE WITH NITS; on integ-w40 |
| fixers-41 | environment seen by compiled programs: the /bin/sh re-exec (fixers-40 F1), Bun's dotenv (F2), non-Unicode variables (F3) | APPROVE WITH NITS; on integ-w40 |
| ice-report | docs/plan-ice-report.md as amended by its review: 92 of 118 reached, 18 of those needing the mask batch; no replay, no RUST_BACKTRACE change | reviewed and re-checked; on integ-w40 |
| harness-w40 | queued: thread-id mask, stderr only (docs/handoff/ice-report-impl.md section 5.2, and F4 for split suites); coverage.ts support for rustc-call and rustc-const (5.3); long-type digits (fixers-40 N1); the generator for long error descriptions as a tools batch; mono-wire's tools batch; supertrait-hint-cycle.rs to a heavy list (oracle 59-68 s, A12's oracle-cost rule); retry times, and per-case RSS if possible, in gate.json | APPROVE WITH NITS; on integ-w40 |
| harness-w41 | gate.json records power source, suite times, load and swap, and the gate refuses on battery (perf-near-limit review (c)); bun --preload for the re-exec (fixers-41: about 27% on one Miri program) | REQUEST CHANGES, then root's fix f9309c20 and a25cca77 (a hung power reader could hang the gate), re-checked APPROVE WITH NITS; on integ-w40 |
| fixers-42 | fixers-41 F1-F4, N1-N4; perf-near-limit N1 a permanent test of StalledPrefix, N2-N4 | APPROVE WITH NITS; on integ-w40 |
| root-w40-check, root-w40-check2 | independent re-checks of root's commits: 8a79ff32, b7635f61, 11ded631, f9309c20, a25cca77 | APPROVE WITH NITS; on integ-w40. The test-only commit after them (C1, C2) goes to the wave's regression audit |

Queued from these reviews, none blocking wave 40a:
- root-w40-check F2: a process stuck past SIGKILL adds one process and one descriptor per sample; it can matter across about 3 gates without a reboot, and such a gate prints nothing. check2 C3: `AC,?,?,B` says "power lost at T" where T is only when it was seen. C5: the StalledPrefix test's header points to a handoff that does not mention `floats`.
- harness-w41 N1: a read in flight at a failing gate's exit outlives it. N2: one unit test of plain `miri.ts` from a cwd whose `.env` disagrees; due in the next harness batch.
- fixers-42 R1-R3: wrong panic or result on invalid or non-UTF-8 `MIRI_CWD`, `MIRI_BE_RUSTC`, `RUSTC_OVERRIDE_VERSION_STRING`, `RUSTC_CTFE_BACKTRACE` (`miri.ts:148,152,154,561`, `rustc_driver_impl/lib.ts:714`, `rustc_session/session.ts:1119`). R5: `home_dir`'s fallback when the passwd home is not UTF-8. R8: the near-limit test's own spawn with a 900-byte Bun path.
- Seen in fixers-42's review, on base too: a cwd of 1,024 bytes or more stops the port where the oracle compiles (`rustc_session/config.ts:3226`); `HOME` or `XDG_CACHE_HOME` over 1,023 bytes panics Bun at start; `miri.ts` ignores `RUST_TS_IMPL`, so `--impl` cannot validate the harness on Miri suites.
- root-w40-check3 N1: five assertions outside `plain_bug` keep their message only because the panic location is refused (`expr_a.test.ts:141,155`, `matches_b.test.ts:202`, `late_a.test.ts:730`, `late_b.test.ts:790`); they would read `ExplicitBug` if it resolved. N5: `BACKTRACE_STYLE`, the `MiriConfig.default` spy, the `log/setup` mock and `ICE_PATH` stay changed after `miri.test.ts`; no later test reads them today. O1, on base too: `typeck_impl.test.ts` fails with `Cannot access 'InlineAttr' before initialization` when it is the first file in its process.


## Wave 40b (started 2026-11-06) — what does not depend on D4, while D4 waits for the owner
**ACCEPTED 2026-11-07 (gate-20261106-224720-root-i68w, main 045b7318):** 542,086 protected in 60 suites (+355, 0 lost): `run-pass-aux-miri` joins at 355 of 356. 24,269/27,053 fns (89.7%); Miri 1,506/1,535. No power loss. Regression audit PASS WITH NOTES (docs/reviews/w40b-audit.md): all 542,086 MATCH in the raw output; none of the 355 needs a mask or a retry, the slowest at 3.2 s of 60; rebuilt aux rlibs are byte-identical. dynamic-drop.rs 61% of its limit, issue-8827.rs 60%. Queued from it: N3, an aux rebuild that fails stops the whole suite with ERROR: (a failed gate, not a silent loss); N4, the unit step took 1,225.6 s of its 1,800 s limit (68%, up from 66%).
| lane | scope | status |
|---|---|---|
| fixers-43 | environment and driver: fixers-42 R1-R3, R5; a cwd of 1,024 bytes or more; `miri.ts` and `RUST_TS_IMPL`; rustc-env.rs CRASH; check3 N1, O1 | REQUEST CHANGES on F1 (a shim under the Miri home installed an unpinned nightly), root fixed it; on integ-w41 |
| fixers-44 | EiiMapEncodedKeyValue decoding (16 cases); abi-vtable F1-F3; mono-wire W2, W3, W5; mir-alias F1-F4 | APPROVE WITH NITS; on integ-w41 |
| harness-w42 | root-w40-check F2, check2 C3, C5; harness-w41 N1, N2; harness-m7a H3, H5, N2; stale comments | REQUEST CHANGES on F1 (lock wait inside IR limits), root fixed it; on integ-w41 |
| miri-sysroot, harness-m6d | plan-m6 §5, D4 of that plan: the port builds core, alloc and std as Miri's sysroot compiler, as a report suite | APPROVE WITH NITS; all 26 replayable crates byte-identical, in a chain too; on integ-w41 |

Queued from wave 40b's reviews, none blocking:
- fixers-43 F2: from a cwd of 1,024 bytes or more, `realpath` on a relative path resolves against `~/.bun/bin` (`rustc_fs_util/lib.ts:19`, `passes.ts:547`, `miri.ts:218`). F3: `RUST_TARGET_PATH` is read lossily (`rustc_target/spec/mod.ts:2797`); exit 70 today, a silent wrong answer once `from_json` is ported, so due with it. F4: upstream's `?` ported as `unwrap_result` (`std/path.ts:747`, `passes.ts:582`). F6: the cwd refresh on Linux with a U+FFFD twin (`env.ts:332-336`). F7: the location checker cannot see the 79 new `Result` sites or witness Miri locations. (Done in wave 40c: the temp-dir error's path, `POLONIUS_ALGORITHM`'s location.)
- fixers-44 F2: `aarch64.ts:127`'s `is_scalable_vector` guard is not equivalent and has no test. F5: older stops at or above 2^53 bytes (`known_panics_lint.ts:1115`, `rustc_lint/types.ts:914`). F6: `decl.name.span` in the EII test; W5's `coverage.ts --order --require-clean` (docs/handoff/fixers-44.md).
- harness-w42 N1: a SIGKILLed `ir-run` with its compiler alive leaves a lock the next run takes at once; N2: a SIGTERM during the normal form leaves `work.lock`, recovered next run; N4: `process.off("exit")` has no test; N6: three fixed test deadlines; the `criteria.ts` M7 group.
- miri-sysroot F1: `custom_local_sysroot` as the 27th crate (an empty `lib.rs` at its path). F2: overlapping runs of one crate and side share an out dir. F6: the ICE report stops on `miri.ts:417`'s assertion. Chained lanes in docs/handoff/miri-sysroot.md: Mach-O, COFF and XCOFF object writing, bundled native libraries, staticlib and native linking, `elf_e_flags` on other architectures.

- root-w41-check N1, watch: Bun segfaulted once at 622 ms on a `miri-sysroot-core` subject (exit 128, a DIFF; 1 in about 1,500 subjects, reruns match, cause unknown). difftest has no retry for that, so if a gate loses a single case, grep its diff for `Bun has crashed` first. N2: `x86_win64.ts`'s `case 8n`, `16n`, `32n` arms are not pinned by the fixture. N3: two difftests at once on one IR case still wait inside their limits. N4: a hand-run shim with no host tuple and no `.env.local` still calls `rustc +nightly -vV` under the Miri home. N5: Bun's `mkdtempSync` truncates prefixes of 1,018-1,023 bytes. N6: no test of `tempdir_in`'s suffix path.

- `tests/ui/rustc-env/def-path-hash-ice-157238.rs` in `mono-ui`, DIFF and not protected, as in the wave 40a gate: under `RUSTC_LOG`, the port does not print `some trace filter directives would enable traces that are disabled statically`.

- (Done in wave 40d: the deployment-target error and warning at `--emit=metadata`, object-write-macho review N1 and N2, root-w42-check N4's tests, the `host-rlib` report suite.) (Done in wave 40e: root-w42-check N6.)

Queued from wave 40c's reviews, none blocking:
- (Done in wave 40d: fixers-45 review F1, F2, F4, F5; in wave 40e: `scripts/mono-run.ts` starts the logger.)
- `rust-log.rs` (run-pass-aux-miri) and `def-path-hash-ice-157238.rs` (run-pass-miri, mir-o2) are protected and are the only protected cases that set `RUSTC_LOG`: they print whole-run interner counts and, under Miri, about 15k step lines, so a later change anywhere can move them. On a loss, compare `debug_stats`' counts and the step lines first (w40c audit N3). Since they protect the INFO logging path, make `src/rust_ts/info_sites_check.ts` a gate step (audit N2). Audit N4: mir-o2's case prints 121 paths under the oracle's sysroot, which its oracle key does not hash, so a different home or std file set would be a false loss, never a false pass.
- (Done in wave 40d: fixers-46 review F4, the 2^53 `static` and the `gvn.ts` index; in wave 40f: `-Zprint-type-sizes`, through a port of code_stats.rs.)
- (Done in wave 40f: root-w44-check N1, a passing static step's `note:` lines reach the gate log and gate.json.)
- (Decided 2026-11-09, docs/state: they stay in run-pass-miri behind the solo retry; revisit over 45 s alone.) perf-miri review N3: `dynamic-drop.rs` and `issue-8827.rs` (36-37 s alone) can only leave the 12-job pool by moving to `run-pass-miri-heavy`, which runs one case at a time (`harness/suites.ts:1547`); its entry rule is oracle time over 5 s and theirs is 4.1-4.2 s, so it needs a reviewed harness change and a recorded decision. Before any representation change in Miri, measure the GC share and what stays live at the 2.1 GB peak. N2: a bad cached frame index now crashes only multi-threaded programs in data_race.ts.
- harness-w46 review N1: a timer left running by one test file that ends the process during a later file gets the later file named (the step still fails). N2: on Windows the output tail splits on `\n` but notes on `\r?\n`, so a note prints twice (display only). N3: `scripts/rlib-native-run.ts:157` does not register its compiler as a case-lock holder, as `ir-run` does, so a SIGKILLed difftest could leave a false DIFF next run (`host-rlib` has the same gap).
- fixers-49 review N1, N3: `code_stats.ts:157-165` stops `unported` on ties of size and description, but upstream's FxHashSet order is reproducible with `rust_ts/hash_map.ts`'s FxHashSet and `TypeSizeInfo`'s derived Hash (prototype matched the oracle on three files); check that Symbol indices equal upstream's for named fields first. N5: 3 of the 15 `print_type_sizes` oracle outputs differ from upstream's `.stdout` under the lane's flags; a suite for them needs compiletest's flags. O1 (fixers-47) stays: Bun refuses a typed array over 2^32 bytes, so a static above that gives E0080 in the port.
- (Done in wave 40f: perf-tait review N2, N3 and the generic slice length check are pinned by tests.) Still open: N4, `GenericArg::as_*` on a value that is none of the three returns undefined where `kind()` panicked (both ICE).
- (Done in wave 40f: harness-w45 review N1 and N6.) Still open: N2, the miri-sysroot-* report keys moved; N3, removing a namesake marker passes `info sites` as not ported, as asked.
- (Done in wave 40f: the `BoundRegionKind`, `ObligationCause` and `InferOk` cycles, and memmap2 and tempfile markers with their vendor entries.) Still open: fixers-48 review O2, `archive.ts:199` opens the fat-file temp write-only where tempfile opens it read+write.
- (Done in wave 40e: unit-parallel review N2, the `Printer`, `Os` and `MacroKinds` cycles; N3 and N4; in wave 40f: N5, no `.rlib` files beside tests.)
- (Done in wave 40e: fixers-47 review F1, F2; link-rlib-native review N1, N3.) Still open from those reviews: fixers-47 O1 (a 64 GiB static gives E0080 in the port, host-dependent), O2 (`host_canonicalize` decodes the resolved path lossily, Linux only), O3 done in wave 40f, but root-w45-check N1: on a hash-ordered Linux file system the E0464 test's setup can fail loudly (44 of 300 simulated orders) where none of 200 fillers swaps a `libfoo` pair; the `rlib-native` report suite done in wave 40f; harness-w44 review N2-N4.
- (Done in wave 40d: harness-w43 review F6, F7.)
- (Done in wave 40d: perf-heavy's 0d4092c4 re-landed behind the `frozen lists` gate step.) What remains of supertrait-hint-cycle.rs (959 s alone, about 15x the oracle's instructions) is the runtime's constant factor.
- (Done in wave 40d: the src/tools unit step runs on 4 workers, then four heavy files alone, about 447 s against 1,226 s.) Still open: one port process per test file instead of per test would save more (harness-w43 handoff).

Also queued: `tests/ui/closures/supertrait-hint-cycle.rs` under `mir-heavy` (first report run, on AC, 2026-11-06): the oracle takes 60.3 s and 9 GB, and the port timed out at 1,800 s with 12.7 GB, so it is at least 30x slower there; worth a performance look, not protected. near-limit `dynamic-drop.rs` and `issue-8827.rs` (60-62%).

## Wave 40c (started 2026-11-07) — still independent of D4
**ACCEPTED 2026-11-08 (gate-20261107-141645-root-lspa, main 71ef4101):** 542,089 protected in 60 suites (+3, 0 lost): def-path-hash-ice-157238.rs (mir-o2), rust-log.rs (run-pass-aux-miri, now 356 of 356), one run-pass-miri case. 24,279/27,053 fns (89.7%). M7a figures: mir-o2 and mono-ui 99.89%, check-rg 34 of 34; ir-hello not yet in a gate. No power loss. Regression audit PASS WITH NOTES (docs/reviews/w40c-audit.md): all three new cases matched 6 of 6, alone and under load, at most 3.6% of their limits; dynamic-drop.rs 61.8%, issue-8827.rs 59.7%; unit step 1,226.3 s (68.1%).
| lane | scope | status |
|---|---|---|
| fixers-45 | driver and environment: fixers-43 review F2, F3, F4, F6, the temp-dir error's path, `POLONIUS_ALGORITHM`'s location; `RUSTC_LOG` INFO events (rust-log.rs, log-backtrace.rs, def-path-hash-ice-157238.rs and mono-ui's trace filter warning) | APPROVE WITH NITS; on integ-w42 |
| fixers-46 | ABI, lint and Miri stops: fixers-44 review F2, F5; root-w41 N2, N5, N6; miri-sysroot review F1 (`custom_local_sysroot`), F6 | APPROVE WITH NITS; on integ-w42 |
| harness-w43 | harness-w42 review N1, N2, N4, N6; root-w41 N3, N4; fixers-44 W5 (`coverage.ts --order --require-clean` for `rustc_monomorphize`); miri-sysroot review F2; the `criteria.ts` M7 group; the slowest unit tests (unit step 68% of its limit) | APPROVE WITH NITS (root fixed F1-F5; F1's last oracle call, verifyOraclePin, after root-w42-check N1); on integ-w42 |
| object-write-macho | docs/handoff/miri-sysroot.md chained lane 1: Mach-O `Object` (write/macho.rs) and the darwin branches of `create_object_file`, for host rlibs in M7 | APPROVE WITH NITS; on integ-w42 |
| perf-heavy | `supertrait-hint-cycle.rs` under `mir-heavy` (port timed out at 1,800 s where the oracle takes 60 s); then sysroot core's 19x and 10.9 GB if the same cause | APPROVE WITH NITS; 90fad7d0 on integ-w42, 0d4092c4 (unfrozen lists) dropped for now |

## Wave 40d (started 2026-11-08) — still independent of D4
**ACCEPTED 2026-11-08 (gate-20261108-052654-root-cpy7, main 4ed419a1):** 542,092 protected in 60 suites (+3, 0 lost): the three type-alias-impl-trait cases in mir, matching only on the solo retry at 45.7-48.3 s of 60 (decision in docs/state; a performance lane for them is first in the queue). First gate with the parallel unit step and the info sites and frozen lists steps. 24,290/27,053 fns (89.8%). No power loss. Regression audit PASS WITH NOTES (docs/reviews/w40d-audit.md): every test file ran exactly once in the two unit passes (439.5 s in all); frozen lists ran frozen on 48 protected cases; the 4 re-keyed oracles re-ran byte-identical. N1: the three TAIT cases pass only alone (46-47 s, 9 of 9) and time out beside any sample (5 of 5), so nothing may run beside a gate; N2: their margin depends on lists staying unfrozen.
Parallel unit trial (root, quiet machine, AC, 2026-11-08): `bun test ./src ./tools --parallel=4` took 386-402 s on three runs against 1,226 s serial, tree unchanged. With `RUST_TS_DATA` exported, as the gate's children get it, the same 5 files fail on every run, each from a module-order cycle that per-file isolation exposes: `Cannot access 'Os' before initialization` (src/rustc_metadata/rmeta/decoder_a.oracle.test.ts, root.oracle.test.ts, src/rustc_codegen_ssa/back/link.test.ts, rlib_stub.oracle.test.ts) and `'MacroKinds'` (src/rustc_hir_analysis/contract.test.ts). Without `RUST_TS_DATA` exported, workers do not read `.env.local`.

| lane | scope | status |
|---|---|---|
| unit-parallel | fix the two cycles without changing real compile entries' module order; then the gate's src/tools unit step at `--parallel=4`, with the environment its workers need, the skip allowlist and the junit report intact | APPROVE WITH NITS (root added --isolate to the alone pass, N1); on integ-w43 |
| fixers-47 | fixers-45 review F1, F2 (`host_canonicalize` by bytes), F5 (E0464 with a symlinked -L); fixers-46 review F4 (2^53 `static`, `gvn.ts` index); an invalid `MACOSX_DEPLOYMENT_TARGET` and the too-low warning at --emit=metadata; object-write-macho review N1, N2 | APPROVE WITH NITS; on integ-w43 |
| harness-w44 | `info_sites_check.ts` fails loudly and becomes a gate step (fixers-45 F4, w40c audit N2); a gate step with a frozen-lists sample, then perf-heavy's 0d4092c4 re-landed; root-w42-check N4 tests; harness-w43 review F6, F7; w40c audit N4; the proposed `host-rlib` report suite | APPROVE WITH NITS (c8ca9c27 kept; 0d4092c4 re-landed behind the frozen-lists step); on integ-w43 |
| link-rlib-native | docs/handoff/miri-sysroot.md chained lane 2: `add_archive`, `find_native_static_library`, `walk_native_lib_search_dirs`, bundled native libraries | APPROVE WITH NITS (root pinned N2); on integ-w43 |

## Wave 40e (started 2026-11-08) — still independent of D4
**ACCEPTED 2026-11-09 (gate-20261108-194803-root-0xx0, main 39811561):** 542,092 protected (0 gained, 0 lost). The three TAIT cases: 25.2-25.5 s on the solo retry (42% of their limit). No power loss. Regression audit PASS WITH NOTES (docs/reviews/w40e-audit.md): all 542,092 MATCH; only 3 of 372,123 oracle keys moved, all report-only; the TAIT cases 24.5-25.3 s alone and 32-33 s beside a 4-job sample, 9 of 9 each, but they still time out beside 12 jobs, so a plain `--sample` beside a gate would lose them, as it would dynamic-drop.rs and issue-8827.rs.
| lane | scope | status |
|---|---|---|
| perf-tait | the three protected TAIT cases in mir (recursive-drop-elaboration.rs, -2.rs, error-tainting-issue-122904.rs): 46-47 s alone of 60, timing out beside any sample (w40d audit N1); get them under about 30 s, faithfully | APPROVE WITH NITS (root closed N1); on integ-w44: the three cases at about 25 s alone, 32-33 s beside a 4-job sample (w40e audit) |
| fixers-48 | fixers-47 review F1 (`pat.ts` 2^53 rest bindings, E0527), F2; link-rlib-native review N1 (a directory named like the library), N3 (TMPDIR unset or empty); unit-parallel review N2 (the `Printer` cycle and the other first-import failures) | APPROVE WITH NITS; on integ-w44 |
| harness-w45 | w40d audit N2 (frozen-lists.ts's header, and guarding the TAIT cases' margin); unit-parallel review N3 (a file that throws at load named in the report), N4 (each report's slowest test, flagged over about 30 s); harness-w44 review N2-N4; root-w42-check N6; `scripts/mono-run.ts` and the logger | REQUEST CHANGES (F1 a flaky float test, F2 a missing gate.json stopped every gate), root fixed both; on integ-w44 |

## Wave 40f (started 2026-11-09) — still independent of D4
**ACCEPTED 2026-11-09 (gate-20261109-084958-root-eit4, main 0638cdfa):** 542,092 protected in 60 suites (0 gained, 0 lost); every static step clean, frozen lists 48/48 with no notes, AC power throughout. Solo retries: the three TAIT cases in mir at 25.0-25.1 s; in run-pass-miri `dynamic-drop.rs` 35.6 s, `issue-8827.rs` 34.8 s, `move-3-unique.rs` 24.5 s, `repeated-vector-syntax.rs` 18.3 s (all of 60). Regression audit PASS WITH NOTES (docs/reviews/w40f-audit.md): all 542,092 MATCH, baselines unchanged, only the report-only miri-sysroot-* keys moved and rlib-native's 58 cases are new; alone, dynamic-drop.rs 33.2-34.8 s and issue-8827.rs 34.4-34.7 s; coverage 24,293 (N1, now recorded).
| lane | scope | status |
|---|---|---|
| perf-miri | run-pass-miri's `dynamic-drop.rs` (36.3 s alone of 60) and `issue-8827.rs` (35.2 s), retried in every gate: the Miri interpreter's cost there, faithfully | APPROVE WITH NITS: one faithful change (2.1% of dynamic-drop.rs); faithful work cannot fit them in the 12-job pool (about 8-9x the real Miri per step, spread across the interpreter); on integ-w45 |
| fixers-49 | the three module-order cycles (`BoundRegionKind`, `ObligationCause`, `InferOk`); `-Zprint-type-sizes` at 2^53 bytes; perf-tait review N2, N3 tests; vendor markers for memmap2 0.2.3 and tempfile 3.23.0 with their `harness/scope.json` vendor entries (PORTING 5b); fixers-47 O1, O3 | APPROVE WITH NITS (root closed N2); on integ-w45 |
| harness-w46 | root-w44-check N1 (a passing static step's `note:` lines reach the gate log); harness-w45 review N1, N6; unit-parallel N5 (`.rlib` files beside tests); the proposed `rlib-native` report suite | APPROVE WITH NITS; on integ-w45 |

## Wave 40g (started 2026-11-09) — still independent of D4
**ACCEPTED 2026-11-10 (gate-20261110-023454-root-88uo, main 3541f8a5), the first gate in binary mode:** 542,092 protected in 60 suites (0 gained, 0 lost), every static step clean, AC power throughout. The suites took 6.0 h against 10.4 h in source mode (gate-20261109-084958-root-eit4). But long cases are slower in the binary: at lower load, the solo retries used 15-16% more user time (recursive-drop-elaboration.rs 32.8 s user against 28.3, issue-8827.rs 46.6 against 40.5), and 15 cases retried against 7. Alone: the TAIT cases 28.5-29.2 s, dynamic-drop.rs 39.6 s, issue-8827.rs 39.0 s, move-3-unique.rs 27.1 s (all of 60). Regression audit PASS WITH NOTES (docs/reviews/w40g-audit.md): all 542,092 MATCH, oracle keys identical, both build keys recomputed from the tested tree, 600 sampled subjects byte-identical in both modes; alone on an idle machine the binary is about +11% wall, +14% user on long cases (dynamic-drop.rs 35.4 -> 39.5 s, issue-8827.rs 35.3 -> 39.1 s, recursive-drop-elaboration.rs 25.5 -> 28.3 s), and the TAIT cases need about 20% more memory (N2); each build is about 250 MB with its `rts.map` (N3). Before that, gate-20261110-013859-root-j9yr (main a37f0d84) failed in its static steps, with no suite run: the gate passed `RUST_TS_SUBJECT=binary` to the runner unit tests, and 4 harness tests that read a suite's subject command failed. Root's fix (9bd994f1 on integ-w47: `unitStepEnv` sets `RUST_TS_SUBJECT=source`) was checked APPROVE WITH NITS (docs/reviews/root-w47-check.md) and merged; the gate re-runs in binary mode. Queued from that check: N1 `RUST_TS_IMPL` from the gate's environment reaches the unit tests (`stub` fails `eval_queries.oracle.test.ts`, `shim` makes it compare the oracle with itself), N2 `REGEN=1` and the fixture-writing variables too, N3 the comment says default mode where the code says `source`. Disk: the data volume was full (2.6 GiB free); root removed 18 merged, clean integ worktrees and 13 unused subject builds (8.9 GiB free). Queued: root-w46-check N1 (a tsconfig edit in the second before the key is computed), N2 (no test of the post-build config re-check or the config list); subject-bin review N1, N2, N4-N7.
Root measured 2026-11-09: the port takes 0.48 s to start (`--version`), and a `bun build --compile --bytecode` binary of `src/rust_ts/main.ts` takes 0.05 s. Its `-Zunpretty=hir` and `=expanded` output on dynamic-drop.rs is byte-identical, at 0.17 s against 0.67-0.72 s. The 13 suites of about 21.5k cases take 32-56 min each in the gate.

| lane | scope | status |
|---|---|---|
| subject-bin | harness batch: run the gate's and difftest's subject from a compiled bytecode build of the tested tree, cached by content, with a source fallback; prove byte-identical raw output on samples of every protected suite; oracle keys unchanged | done (branch t3/compiled-subject-cache, f28f8d5a): `RUST_TS_SUBJECT=binary`, off by default; all 60 protected suites at --sample 200 byte-identical in both modes except two unprotected ICE backtraces and a stack overflow about 0.9% sooner on deep nesting; subject time -66% on main.ts suites; also touches src/rust_ts/track_caller.ts (repo-relative frames), approved by root after review; REQUEST CHANGES (docs/reviews/subject-bin.md: F1 config files not in the key, F2 an unchecked Bun option), root fixed F1, F2, N3 (344a014d) and moved its tests into a child (2a9930d7: they broke deps.test.ts in the runner step); root-w46-check APPROVE WITH NITS, root-w46-check2 REQUEST CHANGES on the wrapper's zero-test pass, root fixed it (ef609b6f, test-only, to the audit with 60cc3471); merged to main 78314e27 |
| fixers-50 | fixers-49 review N1, N3 (`code_stats.ts` ties in FxHashSet order); perf-tait N4; fixers-48 O2; fixers-44 F2, F5; fixers-43 F2, F4; root-w40-check3 O1 (`InlineAttr` first-import) | done (branch t3/fix-rustc-port-findings-1, fa44dce6): ties ported (60/60 generated tie files match), `as_*` panics, temp read+write, `InferOk` first-import in coercion.ts and _match.ts; items 4-6 were already fixed earlier (fixers-44 F2/F5, fixers-43 F2/F4, check3 O1); APPROVE WITH NITS (docs/reviews/fixers-50.md; root fixed N1, N2); on integ-w46 |

## Wave 40h (started 2026-11-10) — still independent of D4
| lane | scope | status |
|---|---|---|
| perf-subject-bin | the binary's cost on long cases (w40g-audit N1, N2: +11% wall, +14% user, +20% memory) and the `rts.map` (N3): find the cause and remove it without losing byte-identical output or the stack depth | running |
| harness-w48 | root-w47-check N1-N3 (gate variables reaching the unit steps: `RUST_TS_IMPL`, `REGEN`, the fixture writers); harness-w46 review N1-N3; outside `scripts/lib/subject-bin.ts` | done (branch t3/harness-w48-runner-fixes, 3789f879): the gate refuses to start with `RUST_TS_IMPL`, `REGEN`, `RUST_TS_WRITE_ORACLE`, `TY*_WRITE` or `TY*_PROBE` set (two scan tests keep the list complete); rlib-native and host-rlib hold `work.lock` (their report-suite caches miss once); review running |
