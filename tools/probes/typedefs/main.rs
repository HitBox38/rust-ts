//! Probe: type definitions in upstream Rust source files, as JSON (input for tools/codegen/types.ts).
//!
//!   typedefs [--out <file.json>] <file.rs>...
//!
//! For every file: structs, enums, unions and type aliases (generics, fields, variants,
//! explicit discriminants, attributes, doc comments, source lines), `use` imports (flattened),
//! inline/out-of-line `mod`s, every `impl` block (trait path, self type, fn names), and item
//! macros (`macro_rules!` definitions and invocations, with the type names they appear to
//! define, since their expansion is invisible to syn).
//!
//! Types are emitted both as token text (`text`) and structured (`kind` + paths + generic args).
//! Object keys are sorted (serde_json's default map), so output is deterministic.
use std::io::Write;

use proc_macro2::{Span, TokenStream, TokenTree};
use quote::ToTokens;
use serde_json::{Map, Value, json};
use syn::parse::{ParseStream, Parser};
use syn::punctuated::Punctuated;
use syn::{
    Attribute, Expr, Fields, GenericArgument, GenericParam, Generics, ImplItem, Item, Lit, Meta, Path, PathArguments,
    Token, Type, TypeParamBound, UseTree, Visibility,
};

fn line(span: Span) -> usize {
    span.start().line
}

fn text<T: ToTokens>(t: &T) -> String {
    t.to_token_stream().to_string()
}

fn path_str(p: &Path) -> String {
    let s: Vec<String> = p.segments.iter().map(|s| s.ident.to_string()).collect();
    let s = s.join("::");
    if p.leading_colon.is_some() { format!("::{s}") } else { s }
}

fn vis_str(v: &Visibility) -> String {
    match v {
        Visibility::Public(_) => "pub".into(),
        Visibility::Restricted(r) => format!("pub({})", text(&r.path)),
        Visibility::Inherited => "".into(),
    }
}

// ---- attributes ------------------------------------------------------------------------

fn cfg_json(meta: &Meta) -> Value {
    match meta {
        Meta::Path(p) => json!({ "name": path_str(p) }),
        Meta::NameValue(nv) => json!({ "name": path_str(&nv.path), "value": lit_value(&nv.value) }),
        Meta::List(l) => {
            let name = path_str(&l.path);
            if matches!(name.as_str(), "all" | "any" | "not") {
                match l.parse_args_with(Punctuated::<Meta, Token![,]>::parse_terminated) {
                    Ok(args) => json!({ "op": name, "args": args.iter().map(cfg_json).collect::<Vec<_>>() }),
                    Err(_) => json!({ "name": name, "text": text(meta) }),
                }
            } else {
                json!({ "name": name, "text": text(meta) })
            }
        }
    }
}

/// String literal value, or token text for anything else.
fn lit_value(e: &Expr) -> Value {
    if let Expr::Lit(l) = e {
        if let Lit::Str(s) = &l.lit {
            return Value::String(s.value());
        }
    }
    Value::String(text(e))
}

fn meta_json(meta: &Meta) -> Value {
    let path = path_str(meta.path());
    let mut o = Map::new();
    o.insert("path".into(), Value::String(path.clone()));
    o.insert("text".into(), Value::String(text(meta)));
    match (path.as_str(), meta) {
        ("derive", Meta::List(l)) => {
            if let Ok(ps) = l.parse_args_with(Punctuated::<Path, Token![,]>::parse_terminated) {
                o.insert("derives".into(), json!(ps.iter().map(path_str).collect::<Vec<_>>()));
            }
        }
        ("cfg", Meta::List(l)) => {
            let v = l.parse_args::<Meta>().map(|m| cfg_json(&m)).unwrap_or_else(|_| json!({ "text": l.tokens.to_string() }));
            o.insert("cfg".into(), v);
        }
        ("cfg_attr", Meta::List(l)) => {
            let r = l.parse_args_with(|input: ParseStream| {
                let pred: Meta = input.parse()?;
                input.parse::<Token![,]>()?;
                let rest = Punctuated::<Meta, Token![,]>::parse_terminated(input)?;
                Ok((pred, rest))
            });
            if let Ok((pred, rest)) = r {
                o.insert("cfg".into(), cfg_json(&pred));
                o.insert("attrs".into(), json!(rest.iter().map(meta_json).collect::<Vec<_>>()));
            }
        }
        ("repr", Meta::List(l)) => {
            if let Ok(ps) = l.parse_args_with(Punctuated::<Meta, Token![,]>::parse_terminated) {
                o.insert("repr".into(), json!(ps.iter().map(text).collect::<Vec<_>>()));
            }
        }
        (_, Meta::NameValue(nv)) => {
            o.insert("value".into(), lit_value(&nv.value));
        }
        _ => {}
    }
    Value::Object(o)
}

/// (non-doc attributes, doc comment lines)
fn attrs_json(attrs: &[Attribute]) -> (Value, Value) {
    let mut out = vec![];
    let mut docs = vec![];
    for a in attrs {
        if a.path().is_ident("doc") {
            if let Meta::NameValue(nv) = &a.meta {
                docs.push(lit_value(&nv.value));
                continue;
            }
        }
        let mut m = meta_json(&a.meta);
        if let syn::AttrStyle::Inner(_) = a.style {
            m["inner"] = Value::Bool(true);
        }
        out.push(m);
    }
    (Value::Array(out), Value::Array(docs))
}

// ---- types -----------------------------------------------------------------------------

fn bounds_json<'a>(bounds: impl Iterator<Item = &'a TypeParamBound>) -> Value {
    Value::Array(
        bounds
            .map(|b| match b {
                TypeParamBound::Trait(t) => json!({ "kind": "trait", "path": path_json(&t.path), "text": text(t) }),
                TypeParamBound::Lifetime(l) => json!({ "kind": "lifetime", "name": l.ident.to_string() }),
                other => json!({ "kind": "other", "text": text(other) }),
            })
            .collect(),
    )
}

fn path_json(p: &Path) -> Value {
    let segs: Vec<Value> = p
        .segments
        .iter()
        .map(|s| {
            let args: Vec<Value> = match &s.arguments {
                PathArguments::None => vec![],
                PathArguments::AngleBracketed(a) => a
                    .args
                    .iter()
                    .map(|g| match g {
                        GenericArgument::Lifetime(l) => json!({ "kind": "lifetime", "name": l.ident.to_string() }),
                        GenericArgument::Type(t) => json!({ "kind": "type", "ty": ty_json(t) }),
                        GenericArgument::Const(e) => json!({ "kind": "const", "text": text(e) }),
                        GenericArgument::AssocType(a) => {
                            json!({ "kind": "assoc", "name": a.ident.to_string(), "ty": ty_json(&a.ty) })
                        }
                        GenericArgument::AssocConst(a) => {
                            json!({ "kind": "assoc_const", "name": a.ident.to_string(), "text": text(&a.value) })
                        }
                        GenericArgument::Constraint(c) => {
                            json!({ "kind": "constraint", "name": c.ident.to_string(), "bounds": bounds_json(c.bounds.iter()) })
                        }
                        other => json!({ "kind": "other", "text": text(other) }),
                    })
                    .collect(),
                PathArguments::Parenthesized(p) => vec![json!({
                    "kind": "fn_sugar",
                    "inputs": p.inputs.iter().map(ty_json).collect::<Vec<_>>(),
                    "output": match &p.output { syn::ReturnType::Default => Value::Null, syn::ReturnType::Type(_, t) => ty_json(t) },
                })],
            };
            json!({ "name": s.ident.to_string(), "args": args })
        })
        .collect();
    json!({ "global": p.leading_colon.is_some(), "segments": segs })
}

fn ty_json(t: &Type) -> Value {
    let mut v = match t {
        Type::Path(p) => {
            let mut v = json!({ "kind": "path", "path": path_json(&p.path) });
            if let Some(q) = &p.qself {
                v["qself"] = ty_json(&q.ty);
                v["qself_position"] = json!(q.position);
            }
            v
        }
        Type::Reference(r) => json!({
            "kind": "ref",
            "mut": r.mutability.is_some(),
            "lifetime": r.lifetime.as_ref().map(|l| l.ident.to_string()),
            "elem": ty_json(&r.elem),
        }),
        Type::Ptr(p) => json!({ "kind": "ptr", "mut": p.mutability.is_some(), "elem": ty_json(&p.elem) }),
        Type::Slice(s) => json!({ "kind": "slice", "elem": ty_json(&s.elem) }),
        Type::Array(a) => json!({ "kind": "array", "elem": ty_json(&a.elem), "len": text(&a.len) }),
        Type::Tuple(t) => json!({ "kind": "tuple", "elems": t.elems.iter().map(ty_json).collect::<Vec<_>>() }),
        Type::Paren(p) => return ty_json(&p.elem),
        Type::Group(g) => return ty_json(&g.elem),
        Type::Never(_) => json!({ "kind": "never" }),
        Type::TraitObject(o) => json!({ "kind": "dyn", "bounds": bounds_json(o.bounds.iter()) }),
        Type::ImplTrait(i) => json!({ "kind": "impl", "bounds": bounds_json(i.bounds.iter()) }),
        Type::BareFn(_) => json!({ "kind": "fn" }),
        Type::Macro(m) => json!({ "kind": "macro", "name": path_str(&m.mac.path) }),
        Type::Infer(_) => json!({ "kind": "infer" }),
        _ => json!({ "kind": "other" }),
    };
    v["text"] = Value::String(text(t));
    v
}

fn generics_json(g: &Generics) -> Value {
    let params: Vec<Value> = g
        .params
        .iter()
        .map(|p| match p {
            GenericParam::Lifetime(l) => json!({
                "kind": "lifetime",
                "name": l.lifetime.ident.to_string(),
                "bounds": l.bounds.iter().map(|b| b.ident.to_string()).collect::<Vec<_>>(),
            }),
            GenericParam::Type(t) => json!({
                "kind": "type",
                "name": t.ident.to_string(),
                "bounds": bounds_json(t.bounds.iter()),
                "default": t.default.as_ref().map(ty_json),
            }),
            GenericParam::Const(c) => json!({
                "kind": "const",
                "name": c.ident.to_string(),
                "ty": ty_json(&c.ty),
                "default": c.default.as_ref().map(text),
            }),
        })
        .collect();
    let wc: Vec<String> = g.where_clause.iter().flat_map(|w| w.predicates.iter().map(text)).collect();
    json!({ "params": params, "where": wc })
}

fn fields_json(f: &Fields) -> Value {
    let style = match f {
        Fields::Named(_) => "named",
        Fields::Unnamed(_) => "unnamed",
        Fields::Unit => "unit",
    };
    let fields: Vec<Value> = f
        .iter()
        .enumerate()
        .map(|(i, fl)| {
            let (attrs, docs) = attrs_json(&fl.attrs);
            json!({
                "name": fl.ident.as_ref().map(|i| i.to_string()),
                "index": i,
                "vis": vis_str(&fl.vis),
                "ty": ty_json(&fl.ty),
                "attrs": attrs,
                "docs": docs,
                "line": line(match &fl.ident {
                    Some(i) => i.span(),
                    None => fl.ty.to_token_stream().into_iter().next().map(|t| t.span()).unwrap_or_else(Span::call_site),
                }),
            })
        })
        .collect();
    json!({ "style": style, "fields": fields })
}

// ---- items -----------------------------------------------------------------------------

struct Out {
    items: Vec<Value>,
    uses: Vec<Value>,
    impls: Vec<Value>,
    macros: Vec<Value>,
    mods: Vec<Value>,
}

fn flatten_use(tree: &UseTree, prefix: &mut Vec<String>, vis: &str, ln: usize, module: &[String], out: &mut Vec<Value>) {
    let mut push = |alias: Option<String>, path: Vec<String>, glob: bool| {
        out.push(json!({ "alias": alias, "path": path, "glob": glob, "vis": vis, "line": ln, "module": module }));
    };
    match tree {
        UseTree::Path(p) => {
            prefix.push(p.ident.to_string());
            flatten_use(&p.tree, prefix, vis, ln, module, out);
            prefix.pop();
        }
        UseTree::Name(n) => {
            if n.ident == "self" {
                push(prefix.last().cloned(), prefix.clone(), false);
            } else {
                let mut p = prefix.clone();
                p.push(n.ident.to_string());
                push(Some(n.ident.to_string()), p, false);
            }
        }
        UseTree::Rename(r) => {
            let mut p = prefix.clone();
            if r.ident != "self" {
                p.push(r.ident.to_string());
            }
            push(Some(r.rename.to_string()), p, false);
        }
        UseTree::Glob(_) => push(None, prefix.clone(), true),
        UseTree::Group(g) => {
            for t in &g.items {
                flatten_use(t, prefix, vis, ln, module, out);
            }
        }
    }
}

/// Type names that a macro invocation appears to define (or implement): `struct X` / `enum X` /
/// `union X` / `type X` / `impl X` token pairs anywhere in its body, plus `debug_format = "..."`
/// literals.
fn scan_macro(ts: TokenStream, names: &mut Vec<String>, formats: &mut Vec<String>) {
    let toks: Vec<TokenTree> = ts.into_iter().collect();
    for (i, t) in toks.iter().enumerate() {
        match t {
            TokenTree::Group(g) => scan_macro(g.stream(), names, formats),
            TokenTree::Ident(id) => {
                let s = id.to_string();
                if matches!(s.as_str(), "struct" | "enum" | "union" | "type" | "impl") {
                    if let Some(TokenTree::Ident(n)) = toks.get(i + 1) {
                        names.push(n.to_string());
                    }
                }
                if s == "debug_format" {
                    if let (Some(TokenTree::Punct(p)), Some(TokenTree::Literal(l))) = (toks.get(i + 1), toks.get(i + 2)) {
                        if p.as_char() == '=' {
                            formats.push(l.to_string());
                        }
                    }
                }
            }
            _ => {}
        }
    }
}

fn walk(items: &[Item], module: &[String], out: &mut Out) {
    for item in items {
        match item {
            Item::Struct(s) => {
                let (attrs, docs) = attrs_json(&s.attrs);
                out.items.push(json!({
                    "kind": "struct",
                    "name": s.ident.to_string(),
                    "line": line(s.ident.span()),
                    "vis": vis_str(&s.vis),
                    "module": module,
                    "attrs": attrs,
                    "docs": docs,
                    "generics": generics_json(&s.generics),
                    "fields": fields_json(&s.fields),
                }));
            }
            Item::Union(u) => {
                let (attrs, docs) = attrs_json(&u.attrs);
                out.items.push(json!({
                    "kind": "union",
                    "name": u.ident.to_string(),
                    "line": line(u.ident.span()),
                    "vis": vis_str(&u.vis),
                    "module": module,
                    "attrs": attrs,
                    "docs": docs,
                    "generics": generics_json(&u.generics),
                    "fields": fields_json(&Fields::Named(u.fields.clone())),
                }));
            }
            Item::Enum(e) => {
                let (attrs, docs) = attrs_json(&e.attrs);
                let variants: Vec<Value> = e
                    .variants
                    .iter()
                    .map(|v| {
                        let (vattrs, vdocs) = attrs_json(&v.attrs);
                        json!({
                            "name": v.ident.to_string(),
                            "line": line(v.ident.span()),
                            "attrs": vattrs,
                            "docs": vdocs,
                            "fields": fields_json(&v.fields),
                            "discriminant": v.discriminant.as_ref().map(|(_, e)| text(e)),
                        })
                    })
                    .collect();
                out.items.push(json!({
                    "kind": "enum",
                    "name": e.ident.to_string(),
                    "line": line(e.ident.span()),
                    "vis": vis_str(&e.vis),
                    "module": module,
                    "attrs": attrs,
                    "docs": docs,
                    "generics": generics_json(&e.generics),
                    "variants": variants,
                }));
            }
            Item::Type(t) => {
                let (attrs, docs) = attrs_json(&t.attrs);
                out.items.push(json!({
                    "kind": "type",
                    "name": t.ident.to_string(),
                    "line": line(t.ident.span()),
                    "vis": vis_str(&t.vis),
                    "module": module,
                    "attrs": attrs,
                    "docs": docs,
                    "generics": generics_json(&t.generics),
                    "ty": ty_json(&t.ty),
                }));
            }
            Item::Trait(t) => {
                let (attrs, _) = attrs_json(&t.attrs);
                out.items.push(json!({
                    "kind": "trait",
                    "name": t.ident.to_string(),
                    "line": line(t.ident.span()),
                    "vis": vis_str(&t.vis),
                    "module": module,
                    "attrs": attrs,
                    "generics": generics_json(&t.generics),
                }));
            }
            Item::Impl(i) => {
                let (attrs, _) = attrs_json(&i.attrs);
                let self_name = match &*i.self_ty {
                    Type::Path(p) => p.path.segments.last().map(|s| s.ident.to_string()),
                    _ => None,
                };
                let fns: Vec<Value> = i
                    .items
                    .iter()
                    .filter_map(|it| match it {
                        ImplItem::Fn(f) => Some(json!({ "name": f.sig.ident.to_string(), "line": line(f.sig.fn_token.span) })),
                        _ => None,
                    })
                    .collect();
                let consts: Vec<String> = i
                    .items
                    .iter()
                    .filter_map(|it| match it {
                        ImplItem::Const(c) => Some(c.ident.to_string()),
                        _ => None,
                    })
                    .collect();
                out.impls.push(json!({
                    "line": line(i.impl_token.span),
                    "module": module,
                    "attrs": attrs,
                    "generics": generics_json(&i.generics),
                    "trait": i.trait_.as_ref().map(|(_, p, _)| path_str(p)),
                    "negative": i.trait_.as_ref().is_some_and(|(n, _, _)| n.is_some()),
                    "self_ty": ty_json(&i.self_ty),
                    "self_name": self_name,
                    "fns": fns,
                    "consts": consts,
                }));
            }
            Item::Use(u) => {
                let mut prefix = if u.leading_colon.is_some() { vec!["".to_string()] } else { vec![] };
                flatten_use(&u.tree, &mut prefix, &vis_str(&u.vis), line(u.use_token.span), module, &mut out.uses);
            }
            Item::Mod(m) => {
                let (attrs, _) = attrs_json(&m.attrs);
                let mut path = module.to_vec();
                path.push(m.ident.to_string());
                out.mods.push(json!({
                    "name": m.ident.to_string(),
                    "line": line(m.ident.span()),
                    "vis": vis_str(&m.vis),
                    "module": module,
                    "inline": m.content.is_some(),
                    "attrs": attrs,
                }));
                if let Some((_, items)) = &m.content {
                    walk(items, &path, out);
                }
            }
            Item::Macro(m) => {
                let (attrs, _) = attrs_json(&m.attrs);
                let mut names = vec![];
                let mut formats = vec![];
                scan_macro(m.mac.tokens.clone(), &mut names, &mut formats);
                out.macros.push(json!({
                    "kind": if m.ident.is_some() { "macro_rules" } else { "call" },
                    "name": m.ident.as_ref().map(|i| i.to_string()),
                    "macro": path_str(&m.mac.path),
                    "line": line(m.mac.path.segments.first().map(|s| s.ident.span()).unwrap_or_else(Span::call_site)),
                    "module": module,
                    "attrs": attrs,
                    "types": names,
                    "debug_formats": formats,
                }));
            }
            _ => {}
        }
    }
}

fn main() {
    let mut args: Vec<String> = std::env::args().skip(1).collect();
    let mut out_path = None;
    if args.first().map(String::as_str) == Some("--out") {
        out_path = Some(args[1].clone());
        args.drain(0..2);
    }
    let mut files = vec![];
    let mut failed = false;
    for path in &args {
        let src = match std::fs::read_to_string(path) {
            Ok(s) => s,
            Err(e) => {
                failed = true;
                files.push(json!({ "path": path, "error": e.to_string() }));
                continue;
            }
        };
        let file = match syn::parse_file(&src) {
            Ok(f) => f,
            Err(e) => {
                failed = true;
                files.push(json!({ "path": path, "error": format!("{}:{}: {e}", e.span().start().line, e.span().start().column) }));
                continue;
            }
        };
        let mut out = Out { items: vec![], uses: vec![], impls: vec![], macros: vec![], mods: vec![] };
        walk(&file.items, &[], &mut out);
        let (attrs, docs) = attrs_json(&file.attrs);
        files.push(json!({
            "path": path,
            "attrs": attrs,
            "docs": docs,
            "items": out.items,
            "uses": out.uses,
            "impls": out.impls,
            "macros": out.macros,
            "mods": out.mods,
        }));
    }
    let doc = json!({ "probe": "typedefs", "syn": "2.0.117", "files": files });
    let s = serde_json::to_string(&doc).unwrap();
    match out_path {
        Some(p) => std::fs::write(p, s).unwrap(),
        None => {
            let stdout = std::io::stdout();
            let mut w = stdout.lock();
            w.write_all(s.as_bytes()).unwrap();
            w.write_all(b"\n").unwrap();
        }
    }
    if failed {
        eprintln!("ERROR: typedefs: some files failed to parse (see \"error\" entries)");
        std::process::exit(1);
    }
}
