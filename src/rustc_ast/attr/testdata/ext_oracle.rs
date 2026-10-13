// Oracle program for testdata/ext.oracle.txt (lane fix-w456; from review w456a ast-attr finding 3).
// Prints every `AttributeExt` / `Attribute` / `MetaItem` / `MetaItemInner` query on the attributes
// of testdata/ext.rs as parsed by the pinned nightly (commit 6f5da406b56c2db6607202b63daee73aa8c61297):
//   rustc +nightly-2026-10-11 --edition 2024 ext_oracle.rs -o ext_oracle
//   DYLD_LIBRARY_PATH=$(rustc +nightly-2026-10-11 --print sysroot)/lib ./ext_oracle --edition 2024 ext.rs > ext.oracle.txt
// (`--edition 2024` on the run matters: `c"x"` is a C string literal only from edition 2021.)
// testdata/ext.ast-tree.txt is `rustc +nightly-2026-10-11 --edition 2024 -Zunpretty=ast-tree ext.rs`.
#![feature(rustc_private)]
extern crate rustc_ast;
extern crate rustc_driver;
extern crate rustc_interface;
extern crate rustc_span;
use rustc_ast::attr::AttributeExt;
use rustc_ast::{ast, MetaItemInner};
use rustc_driver::{Callbacks, Compilation};
use rustc_span::{Span, Symbol};

fn os(s: Option<Symbol>) -> String { match s { Some(s) => format!("Some({})", s.as_str()), None => "None".into() } }
fn osp(s: Option<Span>) -> String { format!("{:?}", s) }

fn inner(prefix: &str, it: &MetaItemInner) {
    println!("{prefix} span={:?} ident={:?} name={} word={} lit={:?} bool={:?} mib={} is_mi={} nvls={} vstr={} sll={} vas={} mil={:?}",
        it.span(), it.ident(), os(it.name()), it.is_word(), it.lit(), it.boolean_literal(),
        it.meta_item_or_bool().is_some(), it.is_meta_item(), osp(it.name_value_literal_span()), os(it.value_str()),
        match it.singleton_lit_list() { Some((s, l)) => format!("Some({}, {:?})", s.as_str(), l), None => "None".into() },
        os(it.lit().and_then(|l| l.value_as_str())),
        it.meta_item_list().map(|l| l.len()));
    if let Some(mi) = it.meta_item() {
        println!("{prefix}  mi ident={:?} name={} word={} nvl={:?} nvls={} vstr={} mil_len={:?}",
            mi.ident(), os(mi.name()), mi.is_word(), mi.name_value_literal(), osp(mi.name_value_literal_span()), os(mi.value_str()), mi.meta_item_list().map(|l| l.len()));
        if let Some(l) = mi.meta_item_list() {
            for (k, x) in l.iter().enumerate() { inner(&format!("{prefix}.{k}"), x); }
        }
    }
}

fn dump(i: usize, a: &ast::Attribute) {
    let sp = |v: Option<Vec<Symbol>>| v.map(|v| v.iter().map(|s| s.as_str().to_string()).collect::<Vec<_>>().join("::"));
    println!("[{i}] name={} path={} symbol_path={:?} path_span={} is_word={} is_doc_comment={} idc={} value_str={} value_span={}",
        os(a.name()), sp(Some(a.path().to_vec())).unwrap(), sp(a.symbol_path().map(|v| v.to_vec())), osp(AttributeExt::path_span(a)),
        a.is_word(), a.is_doc_comment(), osp(AttributeExt::is_doc_comment(a)), os(a.value_str()), osp(a.value_span()));
    println!("[{i}] doc_str={} dsfk={} drs={:?} hidden={} kw={} procm={} auto={} prim={} dep={} mhdl={} style={:?} has_any={} pm={}",
        os(a.doc_str()),
        match a.doc_str_and_fragment_kind() { Some((s, k)) => format!("Some({}, {:?})", s.as_str(), k), None => "None".into() },
        a.doc_resolution_scope(), a.is_doc_hidden(), a.is_doc_keyword_or_attribute(), a.is_proc_macro_attr(),
        a.is_automatically_derived_attr(), a.is_rustc_doc_primitive(),
        match a.deprecation_note() { Some(id) => format!("Some({}, {:?})", id.name.as_str(), id.span), None => "None".into() },
        a.may_have_doc_links(), a.style(),
        a.has_any_name(&[rustc_span::sym::doc, rustc_span::sym::deprecated]),
        a.path_matches(&[Symbol::intern("a"), Symbol::intern("b"), Symbol::intern("c")]));
    println!("[{i}] meta={:?}", a.meta());
    println!("[{i}] meta_kind={:?}", a.meta_kind());
    println!("[{i}] tt={:?}", a.token_trees());
    match a.meta_item_list() {
        None => println!("[{i}] mil=None"),
        Some(l) => {
            println!("[{i}] mil=Some({})", l.len());
            for (j, it) in l.iter().enumerate() { inner(&format!("[{i}].{j}"), it); }
        }
    }
}

struct Cb;
impl Callbacks for Cb {
    fn after_crate_root_parsing(&mut self, _c: &rustc_interface::interface::Compiler, krate: &mut ast::Crate) -> Compilation {
        let mut i = 0;
        for a in &krate.attrs { dump(i, a); i += 1; }
        for item in &krate.items { for a in &item.attrs { dump(i, a); i += 1; } }
        let marked_first = rustc_ast::attr::first_attr_value_str_by_name(&krate.items[0].attrs, rustc_span::sym::doc);
        println!("first_doc={} contains_a={} filter_dep={}", os(marked_first),
            rustc_ast::attr::contains_name(&krate.items[0].attrs, Symbol::intern("a")),
            rustc_ast::attr::filter_by_name(&krate.items[0].attrs, rustc_span::sym::deprecated).count());
        Compilation::Stop
    }
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    rustc_driver::compiler_entrypoint(&args, &mut Cb);
}
