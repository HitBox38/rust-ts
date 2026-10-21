// Oracle for src/vendor/rustc_apfloat/apfloat.oracle.test.ts (not a port): runs operations of the
// rustc_apfloat crate the pinned rustc links (rustc-dev, `#![feature(rustc_private)]`) and prints
// one result line per input line.
//
// Input: `<fmt> <op> <args...>` (single spaces). Floats are hex bit patterns; `<fmt>` / `T` is one of
// h s d q b x e5 e4 dd (Half Single Double Quad BFloat X87DoubleExtended Float8E5M2 Float8E4M3FN DoubleDouble;
// `cvt` only between the IEEE formats: `DoubleDouble` implements no `FloatConvert`);
// `R` a rounding mode E P N Z A; strings are hex of their UTF-8 bytes (`_` = empty).
#![feature(rustc_private)]
extern crate rustc_driver;
extern crate rustc_apfloat;

use rustc_apfloat::ieee::{BFloat, Double, Float8E4M3FN, Float8E5M2, Half, Quad, Single, X87DoubleExtended};
use rustc_apfloat::ppc::DoubleDouble;
use rustc_apfloat::{Float, FloatConvert, Round, Status, StatusAnd};
use std::fmt::Write as _;
use std::io::{BufRead, Write};

fn rnd(s: &str) -> Round {
    match s {
        "E" => Round::NearestTiesToEven,
        "P" => Round::TowardPositive,
        "N" => Round::TowardNegative,
        "Z" => Round::TowardZero,
        "A" => Round::NearestTiesToAway,
        _ => panic!("round {s}"),
    }
}
fn hx(s: &str) -> u128 {
    u128::from_str_radix(s, 16).unwrap()
}
fn unhex(s: &str) -> Vec<u8> {
    if s == "_" {
        return vec![];
    }
    (0..s.len() / 2).map(|i| u8::from_str_radix(&s[2 * i..2 * i + 2], 16).unwrap()).collect()
}
fn sa<F: Float>(r: StatusAnd<F>) -> String {
    format!("{} {:x}", r.status.bits(), r.value.to_bits())
}
fn ord(o: Option<std::cmp::Ordering>) -> &'static str {
    match o {
        None => "u",
        Some(std::cmp::Ordering::Less) => "l",
        Some(std::cmp::Ordering::Equal) => "e",
        Some(std::cmp::Ordering::Greater) => "g",
    }
}
fn b(x: bool) -> char {
    if x { '1' } else { '0' }
}

fn cvt<F: Float + FloatConvert<T>, T: Float>(a: F, r: Round) -> String {
    let mut loses = false;
    let x: StatusAnd<T> = a.convert_r(r, &mut loses);
    format!("{} {}", sa(x), b(loses))
}

/// `cvt` (IEEE formats), else `run`.
fn run_ieee<F>(op: &str, a: &[&str]) -> String
where
    F: Float
        + FloatConvert<Half>
        + FloatConvert<Single>
        + FloatConvert<Double>
        + FloatConvert<Quad>
        + FloatConvert<BFloat>
        + FloatConvert<X87DoubleExtended>
        + FloatConvert<Float8E5M2>
        + FloatConvert<Float8E4M3FN>
        + std::fmt::Debug,
{
    let f = |i: usize| F::from_bits(hx(a[i]));
    match op {
        "cvt" => {
            let (x, r) = (f(2), rnd(a[1]));
            match a[0] {
                "h" => cvt::<F, Half>(x, r),
                "s" => cvt::<F, Single>(x, r),
                "d" => cvt::<F, Double>(x, r),
                "q" => cvt::<F, Quad>(x, r),
                "b" => cvt::<F, BFloat>(x, r),
                "x" => cvt::<F, X87DoubleExtended>(x, r),
                "e5" => cvt::<F, Float8E5M2>(x, r),
                "e4" => cvt::<F, Float8E4M3FN>(x, r),
                t => panic!("fmt {t}"),
            }
        }
        _ => run::<F>(op, a),
    }
}

fn run<F: Float + std::fmt::Debug>(op: &str, a: &[&str]) -> String {
    let f = |i: usize| F::from_bits(hx(a[i]));
    match op {
        "add" => sa(f(1).add_r(f(2), rnd(a[0]))),
        "sub" => sa(f(1).sub_r(f(2), rnd(a[0]))),
        "mul" => sa(f(1).mul_r(f(2), rnd(a[0]))),
        "div" => sa(f(1).div_r(f(2), rnd(a[0]))),
        "fma" => sa(f(1).mul_add_r(f(2), f(3), rnd(a[0]))),
        "rem" => sa(f(0).ieee_rem(f(1))),
        "mod" => sa(f(0).c_fmod(f(1))),
        "rti" => sa(f(1).round_to_integral(rnd(a[0]))),
        "nu" => sa(f(0).next_up()),
        "nd" => sa(f(0).next_down()),
        "toi" => {
            let mut exact = false;
            let r = f(2).to_i128_r(a[0].parse().unwrap(), rnd(a[1]), &mut exact);
            format!("{} {} {}", r.status.bits(), r.value, b(exact))
        }
        "tou" => {
            let mut exact = false;
            let r = f(2).to_u128_r(a[0].parse().unwrap(), rnd(a[1]), &mut exact);
            format!("{} {} {}", r.status.bits(), r.value, b(exact))
        }
        "fu" => sa(F::from_u128_r(hx(a[1]), rnd(a[0]))),
        "fi" => sa(F::from_i128_r(a[1].parse().unwrap(), rnd(a[0]))),
        "fs" => {
            let s = String::from_utf8(unhex(a[1])).unwrap();
            match F::from_str_r(&s, rnd(a[0])) {
                Ok(r) => format!("ok {}", sa(r)),
                Err(e) => format!("err {}", e.0),
            }
        }
        "disp" => {
            let x = f(3);
            let alt = a[2] == "1";
            let mut s = String::new();
            match (a[0], a[1]) {
                ("-", "-") if alt => write!(s, "{:#}", x),
                ("-", "-") => write!(s, "{}", x),
                ("-", p) if alt => write!(s, "{:#.p$}", x, p = p.parse::<usize>().unwrap()),
                ("-", p) => write!(s, "{:.p$}", x, p = p.parse::<usize>().unwrap()),
                (w, "-") if alt => write!(s, "{:#w$}", x, w = w.parse::<usize>().unwrap()),
                (w, "-") => write!(s, "{:w$}", x, w = w.parse::<usize>().unwrap()),
                (w, p) if alt => write!(s, "{:#w$.p$}", x, w = w.parse::<usize>().unwrap(), p = p.parse::<usize>().unwrap()),
                (w, p) => write!(s, "{:w$.p$}", x, w = w.parse::<usize>().unwrap(), p = p.parse::<usize>().unwrap()),
            }
            .unwrap();
            s
        }
        "dbg" => format!("{:?}", f(0)),
        "scal" => format!("{:x}", f(2).scalbn_r(a[1].parse().unwrap(), rnd(a[0])).to_bits()),
        "frexp" => {
            let mut e = 0;
            let r = f(1).frexp_r(&mut e, rnd(a[0]));
            format!("{} {:x}", e, r.to_bits())
        }
        "ilogb" => format!("{}", f(0).ilogb()),
        "nan" => {
            let p = if a[1] == "-" { None } else { Some(hx(a[1])) };
            let x = if a[0] == "s" { F::snan(p) } else { F::qnan(p) };
            format!("{:x}", x.to_bits())
        }
        "misc" => {
            let (x, y) = (f(0), f(1));
            let inv = match x.get_exact_inverse() {
                Some(v) => format!("{:x}", v.to_bits()),
                None => "-".to_string(),
            };
            format!(
                "{} {} {} {:x} {:x} {:x} {:x} {:x} {:x} {}{}{}{}{}{}{}{}{}{}{}{}{}{}{}{}{}{}{} {:?} {}",
                ord(x.partial_cmp(&y)),
                b(x == y),
                b(x.bitwise_eq(y)),
                x.min(y).to_bits(),
                x.max(y).to_bits(),
                x.minimum(y).to_bits(),
                x.maximum(y).to_bits(),
                x.abs().to_bits(),
                x.copy_sign(y).to_bits(),
                b(x.is_negative()),
                b(x.is_normal()),
                b(x.is_finite()),
                b(x.is_zero()),
                b(x.is_denormal()),
                b(x.is_infinite()),
                b(x.is_nan()),
                b(x.is_signaling()),
                b(x.is_non_zero()),
                b(x.is_finite_non_zero()),
                b(x.is_pos_zero()),
                b(x.is_neg_zero()),
                b(x.is_pos_infinity()),
                b(x.is_neg_infinity()),
                b(x.is_smallest()),
                b(x.is_smallest_normalized()),
                b(x.is_largest()),
                b(x.is_integer()),
                b((-x).to_bits() == x.to_bits()),
                x.category(),
                inv
            )
        }
        "consts" => format!(
            "{} {} {} {} {:x} {:x} {:x} {:x} {:x} {:x}",
            F::BITS,
            F::PRECISION,
            F::MAX_EXP,
            F::MIN_EXP,
            F::ZERO.to_bits(),
            F::INFINITY.to_bits(),
            F::NAN.to_bits(),
            F::largest().to_bits(),
            F::SMALLEST.to_bits(),
            F::smallest_normalized().to_bits()
        ),
        "status" => format!("{:?} {:?}", Status::from_bits_retain(hx(a[0]) as u8), StatusAnd { status: Status::OK, value: 1u8 }),
        _ => panic!("op {op}"),
    }
}

fn main() {
    let stdin = std::io::stdin();
    let mut out = std::io::BufWriter::new(std::io::stdout().lock());
    // Some inputs panic inside the crate (e.g. Display with precision 0 can empty its digit buffer):
    // those lines print `PANIC` (the port must panic too).
    std::panic::set_hook(Box::new(|_| {}));
    for line in stdin.lock().lines() {
        let line = line.unwrap();
        let t: Vec<&str> = line.split(' ').collect();
        let (fmt, op, args) = (t[0], t[1], &t[2..]);
        let r = std::panic::catch_unwind(|| match fmt {
            "h" => run_ieee::<Half>(op, args),
            "s" => run_ieee::<Single>(op, args),
            "d" => run_ieee::<Double>(op, args),
            "q" => run_ieee::<Quad>(op, args),
            "b" => run_ieee::<BFloat>(op, args),
            "x" => run_ieee::<X87DoubleExtended>(op, args),
            "e5" => run_ieee::<Float8E5M2>(op, args),
            "e4" => run_ieee::<Float8E4M3FN>(op, args),
            "dd" => run::<DoubleDouble>(op, args),
            _ => panic!("fmt {fmt}"),
        })
        .unwrap_or_else(|_| "PANIC".to_string());
        writeln!(out, "{r}").unwrap();
    }
}
