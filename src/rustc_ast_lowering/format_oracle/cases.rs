// Cases of src/rustc_ast_lowering/format.test.ts: every `format_args!` here is lowered by the port (with a
// recording LoweringContext) and compared with the pinned rustc's `-Zunpretty=hir` of this file.
#![allow(unused)]

fn literals(x: i32) {
    // Only a literal: `from_str`, const and nonconst.
    println!("hello");
    print!("{{}}");
    format_args!("");
    let _ = format_args!("a{}b", "c");
    // Literal chunks: escapes and multibyte text, adjacent literal pieces after inlining.
    println!("tab\there \"q\" \\ é ü 漢字 🦀");
    println!("{} {} {} {}", "lit", 42, 'c', true);
}

fn placeholders(x: i32, y: f64, s: &str) {
    println!("a {} b {:?} {x:>8.3} {0:#x} {y:+010.2e} {:<w$.p$}", x, y, w = 4, p = 2);
    println!("{0} {1} {0} {1:?} {0:?}", x, y);
    println!("{x} {s} {x:?} {s:?}");
    println!("{:o} {:b} {:X} {:e} {:E} {:p}", x, x, x, y, y, s);
    println!("{:x?} {:X?} {:#?}", x, x, s);
    println!("{:*^20} {:-<5} {:>+5} {:05} {:#010b}", s, x, x, x, x);
    println!("{:.*} {:1$} {:.0} {:0}", 3, y, x, y, x);
    println!("{:width$.prec$}", y, width = 10, prec = 3);
    println!("{x:w$}", w = 3);
    println!("{:\u{1F980}>9}", x);
}

fn inlining(x: i32) {
    // Inlined: Display, default options, Str / unsuffixed and in-range suffixed ints.
    println!("{} {} {}", 1, -2, 2147483647);
    println!("{} {} {}", 127i8, 255u8, 65535u16);
    println!("{} {} {}", 9223372036854775807i64, 18446744073709551615u64, 4294967295u32);
    println!("{} {}", 170141183460469231731687303715884105727i128, 340282366920938463463374607431768211455u128);
    // Not inlined: out of range, non-Display, options, non-literal.
    println!("{} {} {}", 2147483648, 128i8, 256u16);
    println!("{:?} {:5} {:x}", 1, 2, 3);
    println!("{} {} {}", 1.5, b'a', x);
    println!("{} {x} {}", "a", "b");
    println!("{0} {0:?}", "same");
    println!("{} {}", ("paren"), &"ref");
}

fn flattening(x: i32, y: i32) {
    println!("é{}ü", format_args!("in{}", x));
    println!("a {} {} {}.", 1, format_args!("b{}!", 2), 3);
    println!("{:?} {}", format_args!("dbg {}", x), y);
    println!("{} {}", format_args!("{} {}", format_args!("{}", x), y), x);
    println!("{}", &format_args!("ref {}", x));
    println!("{x} {}", format_args!("{x:5}"));
}

fn main() {}
