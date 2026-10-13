// Stand-in for compiler/rustc_expand/src/mbe/macro_rules.rs in the mbe-a oracle probe (see main.rs).
// `Tracker`, `NoopTracker`, `WhichMatcher` and `parser_from_cx` are copied verbatim from the pinned
// upstream file; the rest is the probe driver.
//
// cases.txt: blocks `### <name> [edition=2015|2018|2021|2024] [features=f1,f2,..]`, then `ops: op op ..`,
// then the source until the next `###`. The source is lexed as `t.rs` (`source_str_to_stream`) into a
// list of top-level token trees ("tree I" below). Each case runs in its own `rustc_interface::run_compiler`
// (`Options::default()` with the case's edition; the emitter is swapped for a -Zui-testing
// `AnnotateSnippetEmitter` writing to a buffer). `features` are enabled on a `Features::default()` with
// `set_enabled_lang_feature` (`attr_sp: DUMMY_SP`, `stable_since: None`). Node id = `CRATE_NODE_ID`.
//
// ops (events are `<op> => <result>`):
//   lhs:I      `parse_one_tt(tree I, RulePart::Pattern, ..)` -> `{:?}` (kept as the LHS)
//   rhs:I      `parse_one_tt(tree I, RulePart::Body, ..)` -> `{:?}` (kept as the RHS)
//   check      `check_meta_variables(psess, CRATE_NODE_ID, None, &lhs, &rhs)` -> `{:?}`
//   checkd     the same with `DUMMY_NODE_ID` (lints are not buffered)
//   locs       `compute_locs(&lhs_delimited.tts)`: one event `loc i => {:?} | {}` per entry
//   count      `count_metavar_decls(&lhs_delimited.tts)`
//   match:I    `TtParser::new().parse_tt(&mut Cow::Borrowed(&parser), &locs, &mut rec)` where `parser` is
//              `parser_from_cx(psess, <inner stream of tree I>, Recovery::Forbidden)` (matchr: Allowed).
//              Events: `trace` (the recording tracker's calls: `b<loc index>` + `!` when
//              `has_no_remaining_items_for_step()`, `m<loc index>`, `failure <token>`, `ambiguity <token>`),
//              the result (`Success` + ` $name=<NamedMatch:?>` per metavar decl in loc order, `Failure`,
//              `Ambiguity`, `ErrorReported(..)`), and `tok` (`{:?}` of the parser token after, and whether
//              the `Cow` was cloned).
//   mve:I      `MetaVarExpr::parse(<inner stream of tree I>, <tree I entire span>, psess)` -> `Ok({:?})`,
//              or the error is emitted and the event is `Err`
//   lints      every buffered early lint as `buffered <LINT> <span:?>`, then rendered into stderr (the
//              `DecorateDiagCompat` closure with `Level::Warning(None)`, `Diag::span(lint span)`, emit)
use std::borrow::Cow;
use std::io::Write;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};

use rustc_ast::node_id::{CRATE_NODE_ID, DUMMY_NODE_ID};
use rustc_ast::tokenstream::{TokenStream, TokenTree as TT};
use rustc_errors::AutoStream;
use rustc_errors::annotate_snippet_emitter_writer::AnnotateSnippetEmitter;
use rustc_feature::{EnabledLangFeature, Features};
use rustc_parse::parser::{Parser, Recovery};
use rustc_session::config::{Input, Options};
use rustc_session::parse::ParseSess;
use rustc_span::edition::Edition;
use rustc_span::{DUMMY_SP, FileName, MacroRulesNormalizedIdent, Symbol};

use super::macro_check::check_meta_variables;
use super::macro_parser::{
    Ambiguity, ErrorReported, Failure, MatcherLoc, NamedParseResult, Success, TtParser, compute_locs,
    count_metavar_decls,
};
use super::metavar_expr::MetaVarExpr;
use super::quoted::{RulePart, parse_one_tt};
use crate::mbe;

// ---- verbatim from compiler/rustc_expand/src/mbe/macro_rules.rs ---------------------------------

/// The arms within a rule come in a fixed order and this type is consistent with that ordering.
#[derive(Copy, Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) enum WhichMatcher {
    /// The arguments of an attr macro ([`MacroRule::Attr::args`]).
    Args,

    /// The body of an attr macro ([`MacroRule::Attr::body`]), **or** the only arm of the rule.
    ///
    /// This is also used to express the only arm in a [`MacroRule::Func`] or [`MacroRule::Derive`].
    Body,
}

impl WhichMatcher {
    /// The [`WhichMatcher`] for [`MacroRule::Func`].
    pub(crate) const FOR_FUNC: Self = Self::Body;

    /// The [`WhichMatcher`] for [`MacroRule::Derive`].
    pub(crate) const FOR_DERIVE: Self = Self::Body;
}

pub(super) trait Tracker<'matcher> {
    /// Provide context on the arm that's about to be matched.
    fn prepare(&mut self, which_matcher: WhichMatcher, matcher: &'matcher [MatcherLoc]);

    /// This is called before trying to match next MatcherLoc on the current token.
    fn before_match_loc(&mut self, parser: &TtParser, matcher: &'matcher MatcherLoc);

    /// A [`MatcherLoc`] successfully consumed input from the parser.
    fn matched_one(&mut self, parser: &Parser<'_>, loc_index: usize);

    /// This is called after an arm has been parsed, either successfully or unsuccessfully.
    fn after_arm(&mut self, result: &NamedParseResult);

    /// The arm could not be matched successfully.
    fn failure(&mut self, parser: &Parser<'_>);

    /// An ambiguity error occurred.
    fn ambiguity(&mut self, parser: &Parser<'_>);

    /// For tracing.
    fn description() -> &'static str;

    fn recovery() -> Recovery;
}

/// A noop tracker that is used in the hot path of the expansion, has zero overhead thanks to
/// monomorphization.
pub(super) struct NoopTracker;

impl<'matcher> Tracker<'matcher> for NoopTracker {
    fn prepare(&mut self, _which_matcher: WhichMatcher, _matcher: &'matcher [MatcherLoc]) {}

    fn before_match_loc(&mut self, _parser: &TtParser, _matcher: &'matcher MatcherLoc) {}

    fn matched_one(&mut self, _parser: &Parser<'_>, _loc_index: usize) {}

    fn ambiguity(&mut self, _parser: &Parser<'_>) {}

    fn after_arm(&mut self, _result: &NamedParseResult) {}

    fn failure(&mut self, _parser: &Parser<'_>) {}

    fn description() -> &'static str {
        "none"
    }

    fn recovery() -> Recovery {
        Recovery::Forbidden
    }
}

pub(super) fn parser_from_cx(
    psess: &ParseSess,
    mut tts: TokenStream,
    recovery: Recovery,
) -> Parser<'_> {
    tts.desugar_doc_comments();
    Parser::new(psess, tts, rustc_parse::MACRO_ARGUMENTS).recovery(recovery)
}

// ---- probe driver ---------------------------------------------------------------------------------

struct Rec {
    base: *const MatcherLoc,
    ev: Vec<String>,
}

impl<'matcher> Tracker<'matcher> for Rec {
    fn prepare(&mut self, _which_matcher: WhichMatcher, _matcher: &'matcher [MatcherLoc]) {}

    fn before_match_loc(&mut self, parser: &TtParser, matcher: &'matcher MatcherLoc) {
        let idx = (matcher as *const MatcherLoc as usize - self.base as usize)
            / std::mem::size_of::<MatcherLoc>();
        let bang = if parser.has_no_remaining_items_for_step() { "!" } else { "" };
        self.ev.push(format!("b{idx}{bang}"));
    }

    fn matched_one(&mut self, _parser: &Parser<'_>, loc_index: usize) {
        self.ev.push(format!("m{loc_index}"));
    }

    fn after_arm(&mut self, _result: &NamedParseResult) {}

    fn failure(&mut self, parser: &Parser<'_>) {
        self.ev.push(format!("failure {:?}", parser.token));
    }

    fn ambiguity(&mut self, parser: &Parser<'_>) {
        self.ev.push(format!("ambiguity {:?}", parser.token));
    }

    fn description() -> &'static str {
        "rec"
    }

    fn recovery() -> Recovery {
        Recovery::Forbidden
    }
}

struct Shared(Arc<Mutex<Vec<u8>>>);
impl Write for Shared {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        self.0.lock().unwrap().write(buf)
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

fn esc(s: &str) -> String {
    let mut o = String::from("\"");
    for c in s.chars() {
        match c {
            '"' => o.push_str("\\\""),
            '\\' => o.push_str("\\\\"),
            '\n' => o.push_str("\\n"),
            '\r' => o.push_str("\\r"),
            '\t' => o.push_str("\\t"),
            c if (c as u32) < 0x20 => o.push_str(&format!("\\u{:04x}", c as u32)),
            c => o.push(c),
        }
    }
    o.push('"');
    o
}

static USING_INTERNAL_FEATURES: AtomicBool = AtomicBool::new(false);

fn inner_stream(t: &TT) -> &TokenStream {
    match t {
        TT::Delimited(_, _, _, ts) => ts,
        _ => panic!("tree is not delimited"),
    }
}

fn lhs_tts(lhs: &Option<mbe::TokenTree>) -> &[mbe::TokenTree] {
    match lhs {
        Some(mbe::TokenTree::Delimited(.., d)) => &d.tts,
        _ => panic!("no delimited lhs"),
    }
}

fn result_str(res: &NamedParseResult, locs: &[MatcherLoc]) -> String {
    match res {
        Success(m) => {
            let mut s = String::from("Success");
            for loc in locs {
                if let MatcherLoc::MetaVarDecl { bind, .. } = loc {
                    let nm = m.get(&MacroRulesNormalizedIdent::new(*bind)).unwrap();
                    s.push_str(&format!(" ${}={:?}", bind, nm));
                }
            }
            s
        }
        Failure => "Failure".to_string(),
        Ambiguity => "Ambiguity".to_string(),
        ErrorReported(g) => format!("ErrorReported({g:?})"),
    }
}

pub(crate) fn probe_main() {
    let args: Vec<String> = std::env::args().collect();
    let text = std::fs::read_to_string(&args[1]).unwrap();
    let mut first = true;
    println!("[");
    for block in text.split("### ").skip(1) {
        let (head, rest) = block.split_once('\n').unwrap();
        let (ops_line, src) = rest.split_once('\n').unwrap();
        let ops: Vec<&str> = ops_line.strip_prefix("ops:").unwrap().split_whitespace().collect();
        let src = src.strip_suffix('\n').unwrap_or(src).to_string();
        let mut words = head.split_whitespace();
        let name = words.next().unwrap().to_string();
        let mut edition = Edition::Edition2024;
        let mut feats: Vec<String> = vec![];
        for w in words {
            if let Some(e) = w.strip_prefix("edition=") {
                edition = e.parse().unwrap();
            } else if let Some(f) = w.strip_prefix("features=") {
                feats = f.split(',').map(|s| s.to_string()).collect();
            } else {
                panic!("head word {w}");
            }
        }
        let out = Arc::new(Mutex::new(Vec::new()));
        let mut ev: Vec<String> = Vec::new();
        let mut fatal = false;
        let mut opts = Options::default();
        opts.edition = edition;
        let config = rustc_interface::Config {
            opts,
            crate_cfg: vec![],
            crate_check_cfg: vec![],
            input: Input::Str { name: FileName::Custom("unused".into()), input: String::new() },
            output_dir: None,
            output_file: None,
            ice_file: None,
            file_loader: None,
            lint_caps: Default::default(),
            psess_created: None,
            track_state: None,
            register_lints: None,
            override_queries: None,
            extra_symbols: vec![],
            make_codegen_backend: None,
            using_internal_features: &USING_INTERNAL_FEATURES,
        };
        rustc_interface::run_compiler(config, |compiler| {
            let sess = &compiler.sess;
            let sm = sess.psess.clone_source_map();
            let shared: Box<dyn Write + Send> = Box::new(Shared(out.clone()));
            sess.dcx().set_emitter(Box::new(
                AnnotateSnippetEmitter::new(AutoStream::never(shared))
                    .sm(Some(Arc::clone(&sm)))
                    .ui_testing(true),
            ));
            let fname = FileName::Real(
                sm.path_mapping().to_real_filename(sm.working_dir(), std::path::Path::new("t.rs")),
            );
            let mut features = Features::default();
            for f in &feats {
                features.set_enabled_lang_feature(EnabledLangFeature {
                    gate_name: Symbol::intern(f),
                    attr_sp: DUMMY_SP,
                    stable_since: None,
                });
            }
            let res = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                let stream = match rustc_parse::source_str_to_stream(&sess.psess, fname, src.clone(), None)
                {
                    Ok(s) => s,
                    Err(errs) => {
                        for e in errs {
                            e.emit();
                        }
                        ev.push("lex => Err".to_string());
                        return;
                    }
                };
                let trees: Vec<TT> = stream.iter().cloned().collect();
                let mut lhs: Option<mbe::TokenTree> = None;
                let mut rhs: Option<mbe::TokenTree> = None;
                for op in &ops {
                    let (name, arg) = op.split_once(':').unwrap_or((op, ""));
                    let idx = || arg.parse::<usize>().unwrap();
                    match name {
                        "lhs" | "rhs" => {
                            let part = if name == "lhs" { RulePart::Pattern } else { RulePart::Body };
                            let tt = parse_one_tt(
                                trees[idx()].clone(),
                                part,
                                sess,
                                CRATE_NODE_ID,
                                &features,
                                edition,
                            );
                            ev.push(format!("{op} => {tt:?}"));
                            if name == "lhs" {
                                lhs = Some(tt);
                            } else {
                                rhs = Some(tt);
                            }
                        }
                        "check" | "checkd" => {
                            let node_id = if name == "check" { CRATE_NODE_ID } else { DUMMY_NODE_ID };
                            let r = check_meta_variables(
                                &sess.psess,
                                node_id,
                                None,
                                lhs.as_ref().unwrap(),
                                rhs.as_ref().unwrap(),
                            );
                            ev.push(format!("{op} => {r:?}"));
                        }
                        "locs" => {
                            let locs = compute_locs(lhs_tts(&lhs));
                            for (i, l) in locs.iter().enumerate() {
                                ev.push(format!("loc {i} => {l:?} | {l}"));
                            }
                        }
                        "count" => {
                            ev.push(format!("{op} => {}", count_metavar_decls(lhs_tts(&lhs))));
                        }
                        "match" | "matchr" => {
                            let recovery =
                                if name == "match" { Recovery::Forbidden } else { Recovery::Allowed };
                            let locs = compute_locs(lhs_tts(&lhs));
                            let parser =
                                parser_from_cx(&sess.psess, inner_stream(&trees[idx()]).clone(), recovery);
                            let mut rec = Rec { base: locs.as_ptr(), ev: vec![] };
                            let mut tt_parser = TtParser::new();
                            let mut cow = Cow::Borrowed(&parser);
                            let res = tt_parser.parse_tt(&mut cow, &locs, &mut rec);
                            ev.push(format!("{op} trace => {}", rec.ev.join(" ")));
                            ev.push(format!("{op} => {}", result_str(&res, &locs)));
                            let owned = matches!(cow, Cow::Owned(_));
                            ev.push(format!("{op} tok => {:?} owned={owned}", cow.token));
                        }
                        "mve" => {
                            let t = &trees[idx()];
                            let TT::Delimited(dspan, _, _, ts) = t else { panic!("mve tree") };
                            match MetaVarExpr::parse(ts, dspan.entire(), &sess.psess) {
                                Ok(m) => ev.push(format!("{op} => Ok({m:?})")),
                                Err(e) => {
                                    e.emit();
                                    ev.push(format!("{op} => Err"));
                                }
                            }
                        }
                        "lints" => {
                            for l in sess.psess.buffered_lints.lock().iter() {
                                ev.push(format!("buffered {} {:?}", l.lint_id.lint.name, l.span));
                            }
                            let lints = std::mem::take(&mut *sess.psess.buffered_lints.lock());
                            for l in lints {
                                let mut diag = (l.diagnostic.0)(
                                    sess.dcx(),
                                    rustc_errors::Level::Warning(None),
                                    sess,
                                );
                                if let Some(sp) = l.span {
                                    diag.span(sp);
                                }
                                diag.emit();
                            }
                        }
                        o => panic!("op {o}"),
                    }
                }
            }));
            fatal = res.is_err();
            sess.dcx().reset_err_count();
        });
        let stderr = String::from_utf8(out.lock().unwrap().clone()).unwrap();
        if !first {
            println!(",");
        }
        first = false;
        let evs: Vec<String> = ev.iter().map(|e| esc(e)).collect();
        print!(
            "{{\"name\":{},\"head\":{},\"ops\":{},\"src\":{},\"events\":[{}],\"fatal\":{},\"stderr\":{}}}",
            esc(&name),
            esc(head.trim()),
            esc(ops_line.strip_prefix("ops:").unwrap().trim()),
            esc(&src),
            evs.join(","),
            fatal,
            esc(&stderr)
        );
    }
    println!("\n]");
}
