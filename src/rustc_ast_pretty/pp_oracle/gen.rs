// Oracle generator for `src/rustc_ast_pretty/pp.test.ts` (not part of the build).
//
// Drives the real `rustc_ast_pretty::pp::Printer` of the pinned toolchain (rustc-dev component)
// with deterministic pseudo-random op sequences and prints them, with the printer's output,
// as JSON. Regenerate with:
//
//   rustc +nightly-2026-10-11 --edition 2024 -O gen.rs -o $RUST_TS_DATA/tmp/pp/gen
//   DYLD_LIBRARY_PATH=$(rustc +nightly-2026-10-11 --print sysroot)/lib \
//     $RUST_TS_DATA/tmp/pp/gen > cases.json
//
// (`LD_LIBRARY_PATH` / `PATH` instead of `DYLD_LIBRARY_PATH` on Linux / Windows.)
//
// Op encoding (each op is a JSON array):
//   ["i",n] ibox(n)   ["c",n] cbox(n)   ["r",n,"C"|"I"] rbox(n, breaks)   ["v"] visual_align()
//   ["e"] end(<innermost open marker>)
//   ["w",s] word(s)   ["ws",s] word_space(s)   ["wn",s] word_nbsp(s)   ["n"] nbsp()
//   ["s"] space()   ["z"] zerobreak()   ["h"] hardbreak()   ["b",n,off] break_offset(n, off)
//   ["po"] popen()   ["pc"] pclose()   ["hb"] hardbreak_if_not_bol()   ["sb"] space_if_not_bol()
//   ["tc"] trailing_comma()   ["tcs"] trailing_comma_or_space()   ["sc",s] synth_comment(s)
//   ["bol"] is_beginning_of_line(), result appended to `bol` as '1' / '0'
// followed by an implicit eof(). A case records `out` (the eof() result) or `panic` (the panic
// message, if any op or eof() panicked), plus `bol`.
#![feature(rustc_private)]
extern crate rustc_ast_pretty;
extern crate rustc_driver;

use std::mem::ManuallyDrop;
use std::panic::{AssertUnwindSafe, catch_unwind};

use rustc_ast_pretty::pp::{BoxMarker, Breaks, Printer};

#[derive(Clone)]
enum Op {
    Ibox(isize),
    Cbox(isize),
    Rbox(isize, bool),
    Visual,
    End,
    Word(String),
    WordSpace(String),
    WordNbsp(String),
    Nbsp,
    Space,
    Zero,
    Hard,
    Brk(usize, isize),
    Popen,
    Pclose,
    HardIfNotBol,
    SpaceIfNotBol,
    TrailingComma,
    TrailingCommaOrSpace,
    Synth(String),
    Bol,
}

struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        // splitmix64
        self.0 = self.0.wrapping_add(0x9e3779b97f4a7c15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xbf58476d1ce4e5b9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94d049bb133111eb);
        z ^ (z >> 31)
    }
    fn below(&mut self, n: u64) -> u64 {
        self.next() % n
    }
    fn chance(&mut self, pct: u64) -> bool {
        self.below(100) < pct
    }
    fn pick<'a, T>(&mut self, xs: &'a [T]) -> &'a T {
        &xs[self.below(xs.len() as u64) as usize]
    }
}

const PUNCT: &[&str] = &["(", ")", ",", ";", "{", "}", "->", "::", "=", "&", "<", ">", ":", "", "."];
const MULTI: &[&str] = &["é", "ñandú", "日本語", "🦀", "λx", "ß", "naïve", "∀∃", "Ωmega", "ü"];

fn ident(r: &mut Rng, min: u64, max: u64) -> String {
    let len = min + r.below(max - min + 1);
    (0..len).map(|_| (b'a' + r.below(26) as u8) as char).collect()
}

fn word(r: &mut Rng) -> String {
    match r.below(20) {
        0..=9 => ident(r, 1, 10),
        10..=12 => r.pick(PUNCT).to_string(),
        13..=14 => r.pick(MULTI).to_string(),
        15 => ident(r, 15, 40),
        16 => ident(r, 50, 120),
        17 => format!("{}{}", ident(r, 1, 6), r.pick(MULTI)),
        18 => " ".repeat(r.below(4) as usize),
        _ => format!("\"{}\"", ident(r, 0, 20)),
    }
}

struct Gen {
    r: Rng,
    ops: Vec<Op>,
    neg: bool,
    max_ops: usize,
}

impl Gen {
    fn indent(&mut self) -> isize {
        if self.neg && self.r.chance(15) {
            -(*self.r.pick(&[1isize, 2, 4, 8]))
        } else {
            *self.r.pick(&[0isize, 0, 1, 2, 4, 4, 8, 12])
        }
    }

    fn seq(&mut self, depth: u32) {
        let n = 1 + self.r.below(if depth == 0 { 40 } else { 14 });
        for _ in 0..n {
            if self.ops.len() >= self.max_ops {
                return;
            }
            let k = self.r.below(100);
            let op = match k {
                0..=29 => Op::Word(word(&mut self.r)),
                30..=41 => Op::Space,
                42..=45 => Op::Zero,
                46..=48 => Op::Hard,
                49..=53 => {
                    let n = *self.r.pick(&[0usize, 1, 1, 2, 3, 10, 70, 0xffff]);
                    let off = self.indent();
                    Op::Brk(n, off)
                }
                54..=55 => Op::Nbsp,
                56..=59 => Op::WordSpace(word(&mut self.r)),
                60..=61 => Op::WordNbsp(word(&mut self.r)),
                62 => Op::Popen,
                63 => Op::Pclose,
                64..=65 => Op::TrailingComma,
                66..=67 => Op::TrailingCommaOrSpace,
                68..=69 => Op::HardIfNotBol,
                70..=71 => Op::SpaceIfNotBol,
                72 => Op::Synth(ident(&mut self.r, 0, 30)),
                73..=76 => Op::Bol,
                _ => {
                    if depth < 7 {
                        self.boxed(depth);
                    } else {
                        self.ops.push(Op::Word(word(&mut self.r)));
                    }
                    continue;
                }
            };
            self.ops.push(op);
        }
    }

    fn open(&mut self) {
        let ind = self.indent();
        let op = match self.r.below(10) {
            0..=3 => Op::Ibox(ind),
            4..=6 => Op::Cbox(ind),
            7..=8 => Op::Rbox(ind, self.r.chance(50)),
            _ => Op::Visual,
        };
        self.ops.push(op);
    }

    fn boxed(&mut self, depth: u32) {
        self.open();
        self.seq(depth + 1);
        self.ops.push(Op::End);
    }

    // Shapes pprust actually emits: a call/argument list, a block, a fn head.
    fn list(&mut self, depth: u32) {
        let w = ident(&mut self.r, 1, 12);
        self.ops.push(Op::Word(w));
        self.ops.push(Op::Popen);
        self.ops.push(Op::Cbox(*self.r.pick(&[0isize, 4])));
        self.ops.push(Op::Zero);
        let n = self.r.below(9);
        for i in 0..n {
            if depth < 3 && self.r.chance(20) {
                self.list(depth + 1);
            } else {
                self.ops.push(Op::Ibox(0));
                let w = ident(&mut self.r, 1, 18);
                self.ops.push(Op::Word(w));
                self.ops.push(Op::End);
            }
            if i + 1 < n {
                self.ops.push(Op::Word(",".to_string()));
                self.ops.push(Op::Space);
            } else if self.r.chance(50) {
                self.ops.push(Op::TrailingComma);
            } else {
                self.ops.push(Op::Zero);
            }
        }
        self.ops.push(Op::Brk(0, -(*self.r.pick(&[0isize, 4]))));
        self.ops.push(Op::End);
        self.ops.push(Op::Pclose);
    }

    fn block(&mut self, depth: u32) {
        self.ops.push(Op::Cbox(4));
        self.ops.push(Op::Ibox(0));
        self.ops.push(Op::WordNbsp("fn".to_string()));
        let w = ident(&mut self.r, 1, 20);
        self.ops.push(Op::Word(w));
        self.list(1);
        self.ops.push(Op::End);
        self.ops.push(Op::Word(" {".to_string()));
        let n = self.r.below(6);
        for _ in 0..n {
            self.ops.push(Op::HardIfNotBol);
            if depth < 2 && self.r.chance(25) {
                self.block(depth + 1);
            } else {
                self.ops.push(Op::Ibox(4));
                self.ops.push(Op::WordSpace("let".to_string()));
                let w = ident(&mut self.r, 1, 8);
                self.ops.push(Op::WordSpace(w));
                self.ops.push(Op::WordSpace("=".to_string()));
                self.list(1);
                self.ops.push(Op::Word(";".to_string()));
                self.ops.push(Op::End);
            }
        }
        self.ops.push(Op::Brk(1, -4));
        self.ops.push(Op::Word("}".to_string()));
        self.ops.push(Op::End);
        if self.r.chance(30) {
            self.ops.push(Op::Bol);
        }
        self.ops.push(Op::HardIfNotBol);
    }
}

fn run(ops: &[Op], bol: &mut String) -> String {
    let mut p = Printer::new();
    let mut stack: Vec<ManuallyDrop<BoxMarker>> = Vec::new();
    for op in ops {
        match op {
            Op::Ibox(n) => stack.push(ManuallyDrop::new(p.ibox(*n))),
            Op::Cbox(n) => stack.push(ManuallyDrop::new(p.cbox(*n))),
            Op::Rbox(n, c) => stack.push(ManuallyDrop::new(
                p.rbox(*n, if *c { Breaks::Consistent } else { Breaks::Inconsistent }),
            )),
            Op::Visual => stack.push(ManuallyDrop::new(p.visual_align())),
            Op::End => p.end(ManuallyDrop::into_inner(stack.pop().unwrap())),
            Op::Word(s) => p.word(s.clone()),
            Op::WordSpace(s) => p.word_space(s.clone()),
            Op::WordNbsp(s) => p.word_nbsp(s.clone()),
            Op::Nbsp => p.nbsp(),
            Op::Space => p.space(),
            Op::Zero => p.zerobreak(),
            Op::Hard => p.hardbreak(),
            Op::Brk(n, off) => p.break_offset(*n, *off),
            Op::Popen => p.popen(),
            Op::Pclose => p.pclose(),
            Op::HardIfNotBol => p.hardbreak_if_not_bol(),
            Op::SpaceIfNotBol => p.space_if_not_bol(),
            Op::TrailingComma => p.trailing_comma(),
            Op::TrailingCommaOrSpace => p.trailing_comma_or_space(),
            Op::Synth(s) => p.synth_comment(s.clone()),
            Op::Bol => bol.push(if p.is_beginning_of_line() { '1' } else { '0' }),
        }
    }
    assert!(stack.is_empty());
    p.eof()
}

fn js(s: &str) -> String {
    let mut o = String::from("\"");
    for c in s.chars() {
        match c {
            '"' => o.push_str("\\\""),
            '\\' => o.push_str("\\\\"),
            '\n' => o.push_str("\\n"),
            c if (c as u32) < 0x20 => o.push_str(&format!("\\u{:04x}", c as u32)),
            c => o.push(c),
        }
    }
    o.push('"');
    o
}

fn op_json(op: &Op) -> String {
    match op {
        Op::Ibox(n) => format!("[\"i\",{n}]"),
        Op::Cbox(n) => format!("[\"c\",{n}]"),
        Op::Rbox(n, c) => format!("[\"r\",{n},\"{}\"]", if *c { "C" } else { "I" }),
        Op::Visual => "[\"v\"]".into(),
        Op::End => "[\"e\"]".into(),
        Op::Word(s) => format!("[\"w\",{}]", js(s)),
        Op::WordSpace(s) => format!("[\"ws\",{}]", js(s)),
        Op::WordNbsp(s) => format!("[\"wn\",{}]", js(s)),
        Op::Nbsp => "[\"n\"]".into(),
        Op::Space => "[\"s\"]".into(),
        Op::Zero => "[\"z\"]".into(),
        Op::Hard => "[\"h\"]".into(),
        Op::Brk(n, off) => format!("[\"b\",{n},{off}]"),
        Op::Popen => "[\"po\"]".into(),
        Op::Pclose => "[\"pc\"]".into(),
        Op::HardIfNotBol => "[\"hb\"]".into(),
        Op::SpaceIfNotBol => "[\"sb\"]".into(),
        Op::TrailingComma => "[\"tc\"]".into(),
        Op::TrailingCommaOrSpace => "[\"tcs\"]".into(),
        Op::Synth(s) => format!("[\"sc\",{}]", js(s)),
        Op::Bol => "[\"bol\"]".into(),
    }
}

fn main() {
    std::panic::set_hook(Box::new(|_| {}));
    let mut cases: Vec<Vec<Op>> = Vec::new();

    // Hand-written edge cases.
    let w = |s: &str| Op::Word(s.to_string());
    cases.push(vec![]);
    cases.push(vec![w("hello")]);
    cases.push(vec![Op::Bol, w("a"), Op::Bol, Op::Hard, Op::Bol, Op::HardIfNotBol, w("b")]);
    cases.push(vec![Op::Ibox(4), w("hello"), Op::Space, w("world"), Op::End]);
    cases.push(vec![Op::End]); // unbalanced end: print_stack.pop().unwrap() panics
    cases.push(vec![Op::Ibox(0), w(&"x".repeat(100)), Op::Space, w("y"), Op::End]);
    cases.push(vec![Op::Ibox(-4), w(&"x".repeat(80)), Op::Space, w("y"), Op::End]);
    cases.push(vec![Op::Cbox(0), w("a"), Op::Brk(70, -8), w("b"), Op::End]);
    cases.push(vec![Op::Cbox(0), w("a"), Op::Brk(70, -8), Op::Visual, w("b"), Op::Space, w(&"c".repeat(80)), Op::End, Op::End]);
    cases.push(vec![Op::Cbox(2), w("a"), Op::Brk(70, -1), Op::Ibox(-1), w("b"), Op::Hard, w("c"), Op::End, Op::End]);
    cases.push(vec![Op::Ibox(0), w(&"é".repeat(39)), Op::Space, w(&"é".repeat(10)), Op::End]);
    cases.push(vec![Op::Ibox(0), w(&"日".repeat(26)), Op::Space, w("z"), Op::End]);
    cases.push(vec![Op::Cbox(4), w("a"), Op::TrailingComma, w("b"), Op::TrailingCommaOrSpace, w(&"c".repeat(90)), Op::End]);
    cases.push(vec![Op::Synth("synthesized".to_string()), Op::Bol]);
    let mut nest = Vec::new();
    for i in 0..30 {
        nest.push(Op::Ibox(4));
        nest.push(Op::Word(format!("level{i}")));
        nest.push(Op::Space);
    }
    nest.push(w("leaf"));
    for _ in 0..30 {
        nest.push(Op::End);
    }
    cases.push(nest);

    // Pseudo-random cases.
    for i in 0..700u64 {
        let mut g = Gen { r: Rng(i * 7919 + 17), ops: Vec::new(), neg: i % 6 == 0, max_ops: 120 };
        match i % 4 {
            0 | 1 => g.seq(0),
            2 => {
                let mut k = 0;
                while k < 3 || (g.ops.len() < 40 && k < 10) {
                    g.boxed(0);
                    k += 1;
                }
            }
            _ => {
                let n = 1 + g.r.below(3);
                for _ in 0..n {
                    if g.r.chance(50) {
                        g.block(0);
                    } else {
                        g.ops.push(Op::Ibox(4));
                        g.list(0);
                        g.ops.push(Op::End);
                    }
                }
            }
        }
        cases.push(g.ops);
    }

    let mut out = String::from("[\n");
    for (k, ops) in cases.iter().enumerate() {
        let mut bol = String::new();
        let res = catch_unwind(AssertUnwindSafe(|| run(ops, &mut bol)));
        let ops_s: Vec<String> = ops.iter().map(op_json).collect();
        let res_s = match res {
            Ok(s) => format!("\"out\":{}", js(&s)),
            Err(e) => {
                let msg = if let Some(s) = e.downcast_ref::<&str>() {
                    s.to_string()
                } else if let Some(s) = e.downcast_ref::<String>() {
                    s.clone()
                } else {
                    "<non-string panic>".to_string()
                };
                format!("\"panic\":{}", js(&msg))
            }
        };
        out.push_str(&format!(
            "{{\"ops\":[{}],{},\"bol\":{}}}{}\n",
            ops_s.join(","),
            res_s,
            js(&bol),
            if k + 1 < cases.len() { "," } else { "" }
        ));
    }
    out.push_str("]\n");
    print!("{out}");
}
