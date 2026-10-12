use annotate_snippets::renderer::source_map::{SourceMap, as_substr};
use annotate_snippets::renderer::margin::Margin;
use annotate_snippets::renderer::styled_buffer::StyledBuffer;
use annotate_snippets::renderer::{ElementStyle, Renderer};
use annotate_snippets::{AnnotationKind, Patch, Annotation, Level};
use std::panic::{catch_unwind, AssertUnwindSafe};

fn unhex(s: &str) -> String {
    if s == "-" { return String::new(); }
    let b: Vec<u8> = (0..s.len()).step_by(2).map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap()).collect();
    String::from_utf8(b).unwrap()
}
fn pmsg(e: Box<dyn std::any::Any + Send>) -> String {
    if let Some(s) = e.downcast_ref::<String>() { s.clone() } else if let Some(s) = e.downcast_ref::<&str>() { s.to_string() } else { "?".into() }
}
fn style(n: &str) -> ElementStyle {
    match n { "NoStyle" => ElementStyle::NoStyle, "Quotation" => ElementStyle::Quotation, "LineNumber" => ElementStyle::LineNumber,
      "UnderlinePrimary" => ElementStyle::UnderlinePrimary, "LabelSecondary" => ElementStyle::LabelSecondary, "Addition" => ElementStyle::Addition, _ => panic!("style") }
}

fn main() {
    std::panic::set_hook(Box::new(|i| { if std::env::var("PDBG").is_ok() { eprintln!("{i}"); } }));
    let text = std::fs::read_to_string(std::env::args().nth(1).unwrap()).unwrap();
    let mut source = String::new();
    let mut line_start = 1;
    let mut anns: Vec<Annotation<'static>> = vec![];
    let mut patches: Vec<Patch<'static>> = vec![];
    let mut spans: Vec<(usize, usize)> = vec![];
    let mut sb = StyledBuffer::new();
    for l in text.lines() {
        let f: Vec<&str> = l.split(' ').collect();
        match f[0] {
            "source" => { source = unhex(f[1]); line_start = f[2].parse().unwrap(); anns.clear(); patches.clear(); spans.clear(); }
            "ann" => {
                let kind = match f[1] { "P" => AnnotationKind::Primary, "C" => AnnotationKind::Context, _ => AnnotationKind::Visible };
                let label = if f[4] == "~" { None } else { Some(unhex(f[4])) };
                anns.push(kind.span(f[2].parse().unwrap()..f[3].parse().unwrap()).label(label).highlight_source(f[5] == "1"));
            }
            "patch" => patches.push(Patch::new(f[1].parse().unwrap()..f[2].parse().unwrap(), unhex(f[3]))),
            "span" => spans.push((f[1].parse().unwrap(), f[2].parse().unwrap())),
            "run" => {
                let fold = f[1] == "1";
                let sm = SourceMap::new(&source, line_start);
                println!("sm {:?}", sm);
                for &(a, b) in &spans {
                    let r = catch_unwind(AssertUnwindSafe(|| format!("{:?} {:?} {:?}", sm.span_to_locations(a..b), sm.span_to_snippet(a..b), sm.span_to_lines(a..b))));
                    println!("span {a} {b} {}", r.unwrap_or_else(|e| format!("PANIC {}", pmsg(e))));
                }
                let r = catch_unwind(AssertUnwindSafe(|| format!("{:?}", sm.annotated_lines(anns.clone(), fold))));
                println!("annotated {}", r.unwrap_or_else(|e| format!("PANIC {}", pmsg(e))));
                let r = catch_unwind(AssertUnwindSafe(|| {
                    let sl = sm.splice_lines(patches.clone(), fold);
                    let mut s = format!("{:?}", sl);
                    if let Some((_, tp, _, _)) = &sl {
                        for p in tp { s += &format!(" | {} {} {} {}", p.is_addition(&sm), p.is_deletion(&sm), p.is_replacement(&sm), p.is_destructive_replacement(&sm)); }
                    }
                    s
                }));
                println!("splice {}", r.unwrap_or_else(|e| format!("PANIC {}", pmsg(e))));
                for p in &patches {
                    let p2 = p.clone();
                    let r = catch_unwind(AssertUnwindSafe(|| format!("{:?}", p2.trim_trivial_replacements(&source))));
                    println!("trim {}", r.unwrap_or_else(|e| format!("PANIC {}", pmsg(e))));
                }
            }
            "substr" => println!("substr {:?}", as_substr(&unhex(f[1]), &unhex(f[2]))),
            "margin" => {
                let v: Vec<usize> = f[1..8].iter().map(|x| x.parse().unwrap()).collect();
                let m = Margin::new(v[0], v[1], v[2], v[3], v[4], v[5]);
                println!("margin {:?} {} {} {} {} {}", m, m.was_cut_left(), m.left(v[6]), m.right(v[6]), m.left(0), m.right(1000));
            }
            "sbnew" => sb = StyledBuffer::new(),
            "putc" => sb.putc(f[1].parse().unwrap(), f[2].parse().unwrap(), unhex(f[3]).chars().next().unwrap(), style(f[4])),
            "puts" => sb.puts(f[1].parse().unwrap(), f[2].parse().unwrap(), &unhex(f[3]), style(f[4])),
            "append" => sb.append(f[1].parse().unwrap(), &unhex(f[2]), style(f[3])),
            "prepend" => sb.prepend(f[1].parse().unwrap(), &unhex(f[2]), style(f[3])),
            "replace" => {
                let r = catch_unwind(AssertUnwindSafe(|| sb.replace(f[1].parse().unwrap(), f[2].parse().unwrap(), f[3].parse().unwrap(), &unhex(f[4]))));
                if let Err(e) = r { println!("sbpanic {}", pmsg(e)); }
            }
            "setstyle" => sb.set_style_range(f[1].parse().unwrap(), f[2].parse().unwrap(), f[3].parse().unwrap(), style(f[4]), f[5] == "1"),
            "sbdump" => {
                let mut s = String::new();
                let _ = sb.render(&Level::WARNING, &Renderer::styled().stylesheet, &mut s);
                let mut p = String::new();
                let _ = sb.render(&Level::ERROR, &Renderer::plain().stylesheet, &mut p);
                println!("sb {} {:?} {:?} {:?}", sb.num_lines(), sb, s, p);
            }
            _ => panic!("bad line {l}"),
        }
    }
}
