use anstyle::*;
use annotate_snippets::renderer::*;
use annotate_snippets::{Level, Group, AnnotationKind, Snippet, Patch, Origin, Padding};

fn main() {
    let styles = [
        ("error", DEFAULT_ERROR_STYLE), ("warning", DEFAULT_WARNING_STYLE), ("info", DEFAULT_INFO_STYLE),
        ("note", DEFAULT_NOTE_STYLE), ("help", DEFAULT_HELP_STYLE), ("line_num", DEFAULT_LINE_NUM_STYLE),
        ("emphasis", DEFAULT_EMPHASIS_STYLE), ("none", DEFAULT_NONE_STYLE), ("context", DEFAULT_CONTEXT_STYLE),
        ("addition", DEFAULT_ADDITION_STYLE), ("removal", DEFAULT_REMOVAL_STYLE),
    ];
    for (n, s) in styles { println!("{n}\t{:?}\t{:?}\t{:?}\t{:?}\t{:#?}", format!("{s}"), format!("{s:#}"), s.render().to_string(), s, s); }
    let extra = [
        Style::new(),
        Style::new().bold().italic().underline().fg_color(Some(Color::Ansi256(Ansi256Color(7)))).bg_color(Some(Color::Rgb(RgbColor(255, 0, 9)))).underline_color(Some(AnsiColor::Red.into())),
        Style::new().effects(Effects::DOUBLE_UNDERLINE | Effects::CURLY_UNDERLINE | Effects::DOTTED_UNDERLINE | Effects::DASHED_UNDERLINE | Effects::BLINK | Effects::INVERT | Effects::HIDDEN | Effects::STRIKETHROUGH | Effects::DIMMED),
        Ansi256Color(123).on(RgbColor(1, 22, 100)),
        AnsiColor::BrightMagenta.on(AnsiColor::Black) - Effects::BOLD,
        Style::new().bold().underline() - Effects::BOLD,
        Style::new() | Effects::HIDDEN,
        Color::Ansi(AnsiColor::Cyan).on_default().underline_color(Some(Color::Ansi(AnsiColor::BrightWhite))),
    ];
    for s in extra { println!("extra\t{:?}\t{:?}\t{:?}\t{}", format!("{s}"), format!("{s:#}"), s, s.is_plain()); }
    for c in [AnsiColor::Black, AnsiColor::White, AnsiColor::BrightBlack, AnsiColor::BrightWhite] {
        println!("ansi\t{:?}\t{:?}\t{:?}\t{:?}\t{:?}\t{}", c.render_fg().to_string(), c.render_bg().to_string(), Color::from(c).render_bg().to_string(), c.bright(true), c.bright(false), c.is_bright());
    }
    for i in [0u8, 9, 10, 99, 100, 255] {
        let c = Ansi256Color(i);
        println!("a256\t{:?}\t{:?}\t{:?}\t{:?}", c.render_fg().to_string(), c.render_bg().to_string(), c.into_ansi(), Color::from(i));
    }
    println!("rgb\t{:?}\t{:?}", RgbColor(0, 10, 255).render_fg().to_string(), Color::from((1u8, 2u8, 3u8)));
    let e = Effects::BOLD | Effects::UNDERLINE;
    println!("eff\t{:?}\t{:?}\t{:?}\t{:?}", e, Effects::new(), e.iter().collect::<Vec<_>>(), e.render().to_string());
    println!("reset\t{:?}\t{:?}", Reset.render().to_string(), Reset);
    let mut w: Vec<u8> = vec![];
    Ansi256Color(5).on(RgbColor(1,2,3)).bold().underline_color(Some(AnsiColor::Red.into())).write_to(&mut w).unwrap();
    Style::new().bold().write_reset_to(&mut w).unwrap();
    Style::new().write_reset_to(&mut w).unwrap();
    println!("write\t{:?}", String::from_utf8(w).unwrap());
    // public API Debug
    println!("level\t{:?}\t{:?}\t{:?}", Level::ERROR, Level::NOTE.no_name(), Level::ERROR.with_name("error: internal compiler error"));
    let t = Level::ERROR.primary_title("mismatched types").id("E0308").id_url("http://x");
    let g = t.element(Snippet::source("fn main() {}\n").path("a.rs").line_start(3).annotation(AnnotationKind::Primary.span(3..7).label("lbl"))).element(Level::NOTE.message("m")).element(Origin::path("p.rs").line(2).char_column(5)).element(Padding).element(Snippet::source("abc").patch(Patch::new(0..1, "x")));
    println!("group\t{:?}", g);
    println!("groupp\t{:#?}", Group::with_level(Level::HELP));
    println!("renderer\t{:?}", Renderer::plain().term_width(80).decor_style(DecorStyle::Unicode).short_message(true).anonymized_line_numbers(true));
    println!("renderer2\t{:?}", Renderer::styled().error(Style::new()));
    println!("norm\t{:?}", annotate_snippets::normalize_untrusted_str("a\tb\u{200d}c\u{0}\u{202e}"));
}
