//! Scratch rustc-dev probe for the stable-hash lane (rust-ts). Links the pinned nightly's own
//! rustc_data_structures / rustc_span / rustc_driver (`#![feature(rustc_private)]`).
//!
//!   hashprobe battery            JSON: StableHasher outputs for a battery of typed values
//!   hashprobe crate-ids          JSON: StableCrateId::new for names / crate types / -C metadata / versions
//!   hashprobe compile <args..>   runs rustc (compiler_entrypoint) with <args>; after expansion prints
//!                                JSON: stable crate id, source files, every local expansion
//!                                (ExpnData fields + ExpnHash) and every SyntaxContext's marks.
//!                                `--custom-name=<n>` (first arg) replaces the input by
//!                                `Input::Str { name: FileName::Custom(n), input: <file text> }`.
#![feature(rustc_private)]
extern crate rustc_data_structures;
extern crate rustc_driver;
extern crate rustc_hashes;
extern crate rustc_interface;
extern crate rustc_middle;
extern crate rustc_session;
extern crate rustc_span;

use std::cmp::Ordering;
use std::collections::BTreeMap;
use std::fmt::Write as _;

use rustc_data_structures::fingerprint::Fingerprint;
use rustc_data_structures::stable_hash::{
    RawDefId, RawSpan, StableHash, StableHashControls, StableHashCtxt, StableHasher,
};
use rustc_hashes::{Hash64, Hash128};
use rustc_span::def_id::{CRATE_DEF_ID, DefId, LOCAL_CRATE, StableCrateId};
use rustc_span::hygiene::{ExpnId, LocalExpnId, SyntaxContext};
use rustc_span::{FileName, Symbol};

struct NoCtx;
impl StableHashCtxt for NoCtx {
    fn stable_hash_span(&mut self, _: RawSpan, _: &mut StableHasher) {
        panic!("span")
    }
    fn def_path_hash(&self, _: RawDefId) -> Fingerprint {
        panic!("def_path_hash")
    }
    fn stable_hash_controls(&self) -> StableHashControls {
        panic!("controls")
    }
    fn assert_default_stable_hash_controls(&self, _: &str) {
        panic!("assert")
    }
}

fn js(s: &str) -> String {
    let mut o = String::from("\"");
    for c in s.chars() {
        match c {
            '"' => o.push_str("\\\""),
            '\\' => o.push_str("\\\\"),
            c if (c as u32) < 0x20 => write!(o, "\\u{:04x}", c as u32).unwrap(),
            c => o.push(c),
        }
    }
    o.push('"');
    o
}

/// Type name + JSON value of a battery value (read back by the TS replay test).
trait Describe {
    fn ty() -> String;
    fn val(&self) -> String;
}
macro_rules! int_describe {
    ($($t:ty),*) => {$(
        impl Describe for $t {
            fn ty() -> String { stringify!($t).to_string() }
            fn val(&self) -> String { format!("\"{}\"", self) }
        }
    )*};
}
int_describe!(u8, u16, u32, u64, u128, usize, i8, i16, i32, i64, i128, isize);
impl Describe for bool {
    fn ty() -> String { "bool".into() }
    fn val(&self) -> String { format!("{}", self) }
}
impl Describe for char {
    fn ty() -> String { "char".into() }
    fn val(&self) -> String { format!("{}", *self as u32) }
}
impl Describe for () {
    fn ty() -> String { "()".into() }
    fn val(&self) -> String { "null".into() }
}
impl Describe for String {
    fn ty() -> String { "String".into() }
    fn val(&self) -> String { js(self) }
}
impl Describe for &str {
    fn ty() -> String { "str".into() }
    fn val(&self) -> String { js(self) }
}
impl Describe for &[u8] {
    fn ty() -> String { "[u8]".into() }
    fn val(&self) -> String { format!("[{}]", self.iter().map(|b| b.to_string()).collect::<Vec<_>>().join(",")) }
}
impl Describe for f32 {
    fn ty() -> String { "f32".into() }
    fn val(&self) -> String { format!("\"{}\"", self.to_bits()) }
}
impl Describe for f64 {
    fn ty() -> String { "f64".into() }
    fn val(&self) -> String { format!("\"{}\"", self.to_bits()) }
}
impl Describe for Ordering {
    fn ty() -> String { "Ordering".into() }
    fn val(&self) -> String { format!("{}", *self as i8) }
}
impl Describe for Hash64 {
    fn ty() -> String { "Hash64".into() }
    fn val(&self) -> String { format!("\"{}\"", self.as_u64()) }
}
impl Describe for Hash128 {
    fn ty() -> String { "Hash128".into() }
    fn val(&self) -> String { format!("\"{}\"", self.as_u128()) }
}
impl Describe for Fingerprint {
    fn ty() -> String { "Fingerprint".into() }
    fn val(&self) -> String {
        let (a, b) = self.split();
        format!("[\"{}\",\"{}\"]", a.as_u64(), b.as_u64())
    }
}
impl<T: Describe> Describe for Vec<T> {
    fn ty() -> String { format!("Vec<{}>", T::ty()) }
    fn val(&self) -> String { format!("[{}]", self.iter().map(|x| x.val()).collect::<Vec<_>>().join(",")) }
}
impl<T: Describe> Describe for Option<T> {
    fn ty() -> String { format!("Option<{}>", T::ty()) }
    fn val(&self) -> String {
        match self {
            Some(x) => format!("{{\"Some\":{}}}", x.val()),
            None => "null".into(),
        }
    }
}
impl<T: Describe, E: Describe> Describe for Result<T, E> {
    fn ty() -> String { format!("Result<{}, {}>", T::ty(), E::ty()) }
    fn val(&self) -> String {
        match self {
            Ok(x) => format!("{{\"Ok\":{}}}", x.val()),
            Err(x) => format!("{{\"Err\":{}}}", x.val()),
        }
    }
}
impl<K: Describe, V: Describe> Describe for BTreeMap<K, V> {
    fn ty() -> String { format!("BTreeMap<{}, {}>", K::ty(), V::ty()) }
    // entries in reverse order: the reader must sort them
    fn val(&self) -> String {
        format!("[{}]", self.iter().rev().map(|(k, v)| format!("[{},{}]", k.val(), v.val())).collect::<Vec<_>>().join(","))
    }
}
macro_rules! tuple_describe {
    ($($n:ident $i:tt),+) => {
        impl<$($n: Describe),+> Describe for ($($n,)+) {
            fn ty() -> String { let v: Vec<String> = vec![$($n::ty()),+]; format!("({}{})", v.join(", "), if v.len() == 1 { "," } else { "" }) }
            fn val(&self) -> String { let v: Vec<String> = vec![$(self.$i.val()),+]; format!("[{}]", v.join(",")) }
        }
    };
}
tuple_describe!(A 0);
tuple_describe!(A 0, B 1);
tuple_describe!(A 0, B 1, C 2);
tuple_describe!(A 0, B 1, C 2, D 3);

struct Out {
    first: bool,
}
impl Out {
    fn case<T: StableHash + Describe>(&mut self, name: &str, v: T) {
        let mut h = StableHasher::new();
        v.stable_hash(&mut NoCtx, &mut h);
        let u64_finish = h.finish_u64_trait();
        let h64: Hash64 = h.clone().finish();
        let fp: Fingerprint = h.clone().finish();
        let h128: Hash128 = h.finish();
        let (f0, f1) = fp.split();
        println!(
            "{}{{\"name\":{},\"ty\":{},\"value\":{},\"hash128\":\"{}\",\"hash64\":\"{}\",\"fingerprint\":[\"{}\",\"{}\"],\"finish_u64\":\"{}\"}}",
            if self.first { "" } else { "," },
            js(name),
            js(&T::ty()),
            v.val(),
            h128.as_u128(),
            h64.as_u64(),
            f0.as_u64(),
            f1.as_u64(),
            u64_finish
        );
        self.first = false;
    }
}
trait FinishU64 {
    fn finish_u64_trait(&self) -> u64;
}
impl FinishU64 for StableHasher {
    fn finish_u64_trait(&self) -> u64 {
        std::hash::Hasher::finish(self)
    }
}

/// xorshift64* with edge-value bias.
struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x >> 12;
        x ^= x << 25;
        x ^= x >> 27;
        self.0 = x;
        x.wrapping_mul(0x2545F4914F6CDD1D)
    }
    fn below(&mut self, n: u64) -> u64 {
        self.next() % n
    }
    fn u64e(&mut self) -> u64 {
        const EDGE: [u64; 12] = [0, 1, 0xfe, 0xff, 0x100, 0xffff, 0x1_0000, 0xffff_ffff, 0x1_0000_0000, u64::MAX, u64::MAX - 1, 1 << 63];
        match self.below(4) {
            0 => EDGE[self.below(EDGE.len() as u64) as usize],
            1 => self.below(0x100),
            _ => self.next() >> self.below(64),
        }
    }
    fn u128e(&mut self) -> u128 {
        ((self.u64e() as u128) << 64) | self.u64e() as u128
    }
    fn string(&mut self) -> String {
        const CH: [char; 10] = ['a', 'Z', '0', ' ', 'é', 'ß', '€', '漢', '😀', '\u{ff}'];
        let n = match self.below(4) {
            0 => 0,
            1 => self.below(8),
            2 => self.below(80),
            _ => self.below(300),
        };
        (0..n).map(|_| CH[self.below(CH.len() as u64) as usize]).collect()
    }
}

fn battery() {
    let mut o = Out { first: true };
    println!("[");
    // primitives of every width, with boundary values
    for v in [0u8, 1, 0x7f, 0xfe, 0xff] { o.case("u8", v); }
    for v in [0u16, 0xff, 0x100, 0xffee, 0xffff] { o.case("u16", v); }
    for v in [0u32, 0xff, 0x445577aa, u32::MAX] { o.case("u32", v); }
    for v in [0u64, 0xff, 0x01234567_13243546, u64::MAX] { o.case("u64", v); }
    for v in [0u128, 1, 0x22114433_66557788_99aaccbb_eeddff77, u128::MAX] { o.case("u128", v); }
    for v in [0usize, 0xfe, 0xff, 0xd0c0b0a0, usize::MAX] { o.case("usize", v); }
    for v in [0i8, -1, -100, i8::MIN, i8::MAX] { o.case("i8", v); }
    for v in [0i16, -200, i16::MIN, i16::MAX] { o.case("i16", v); }
    for v in [0i32, -300, i32::MIN, i32::MAX] { o.case("i32", v); }
    for v in [0i64, -400, i64::MIN, i64::MAX] { o.case("i64", v); }
    for v in [0i128, -500, i128::MIN, i128::MAX] { o.case("i128", v); }
    for v in [0isize, 1, 0xfe, 0xff, 0x100, -1, -7, -600, isize::MIN, isize::MAX, 1 << 53, -(1 << 53)] { o.case("isize", v); }
    for v in [false, true] { o.case("bool", v); }
    for v in ['a', '\0', 'é', '漢', '😀', char::MAX] { o.case("char", v); }
    o.case("unit", ());
    for v in [0.0f32, -0.0, 1.5, f32::NAN, f32::INFINITY, f32::MIN_POSITIVE] { o.case("f32", v); }
    for v in [0.0f64, -0.0, 1.5, f64::NAN, f64::NEG_INFINITY, 1e300] { o.case("f64", v); }
    for v in [Ordering::Less, Ordering::Equal, Ordering::Greater] { o.case("Ordering", v); }
    o.case("Hash64", Hash64::new(0xdead_beef_0123_4567));
    o.case("Hash128", Hash128::new(0x0123_4567_89ab_cdef_fedc_ba98_7654_3210));
    o.case("Fingerprint", Fingerprint::new(Hash64::new(5), Hash64::new(u64::MAX)));
    // strings and slices
    for v in ["", "a", "hello", "aabb", "é漢😀", "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789"] {
        o.case("str", v);
        o.case("String", v.to_string());
    }
    o.case("[u8]", &b""[..]);
    o.case("[u8]", &b"\x00\x01\xff bytes"[..]);
    o.case("[u8] 100", &[7u8; 100][..]);
    o.case("Vec<u8>", vec![1u8, 2, 3]);
    o.case("Vec<u32>", vec![1u32, 0xffff_ffff, 0]);
    o.case("Vec<i64> empty", Vec::<i64>::new());
    o.case("Vec<String>", vec!["aa".to_string(), "bb".to_string()]);
    o.case("Vec<String> concat", vec!["aabb".to_string(), String::new()]);
    o.case("Vec<Vec<u16>>", vec![vec![1u16], vec![], vec![2, 3]]);
    // nested tuples, options, results
    o.case("(u8,)", (5u8,));
    o.case("(u8, u16)", (5u8, 6u16));
    o.case("(u8, u16, u32)", (5u8, 6u16, 7u32));
    o.case("(u8, u16, u32, u64)", (5u8, 6u16, 7u32, 8u64));
    o.case("(isize, isize)", (0xffisize, 0xffffisize));
    o.case("((u8, (bool, char)), Vec<(i32, String)>)", ((1u8, (true, 'x')), vec![(-1i32, "x".to_string()), (2, String::new())]));
    o.case("Option<u32> None", None::<u32>);
    o.case("Option<u32> Some", Some(0u32));
    o.case("Option<Option<u8>>", Some(None::<u8>));
    o.case("Option<Option<u8>> 2", Some(Some(3u8)));
    o.case("Result Ok", Ok::<u8, String>(1));
    o.case("Result Err", Err::<u8, String>("e".into()));
    o.case("(Option<&str>, Result<(), i8>)", (Some("x"), Err::<(), i8>(-2)));
    let mut m = BTreeMap::new();
    for (k, v) in [("zeta", 1u32), ("alpha", 2), ("é", 3), ("Z", 4), ("", 5)] { m.insert(k.to_string(), v); }
    o.case("BTreeMap<String, u32>", m);
    // a mixed sequence: every width in one hasher (stable_hasher/tests.rs test_hash_integers)
    o.case(
        "mixed",
        (
            (0xABu8, 0xFFEEu16, 0x445577AAu32, 0x01234567_13243546u64),
            (0x22114433_66557788_99AACCBB_EEDDFF77u128, 0xD0C0B0A0usize, -100i8, -200i16),
            (-300i32, -400i64, -500i128, -600isize),
        ),
    );
    // random sequences across buffer boundaries
    let mut r = Rng(0x9E3779B97F4A7C15);
    for i in 0..120 {
        let n = r.below(12) as usize;
        let v: Vec<((u8, u16, u32), (u64, usize, i8))> = (0..n)
            .map(|_| ((r.u64e() as u8, r.u64e() as u16, r.u64e() as u32), (r.u64e(), (r.u64e() >> 12) as usize, r.u64e() as i8)))
            .collect();
        let w: Vec<((i16, i32, i64), (isize, u128, i128))> = (0..r.below(6) as usize)
            .map(|_| ((r.u64e() as i16, r.u64e() as i32, r.u64e() as i64), ((r.u64e() as i64 >> r.below(12)) as isize, r.u128e(), r.u128e() as i128)))
            .collect();
        let s: Vec<(String, Option<bool>, char)> = (0..r.below(4) as usize)
            .map(|_| {
                let s = r.string();
                let b = match r.below(3) { 0 => None, 1 => Some(false), _ => Some(true) };
                let c = char::from_u32(r.below(0x11_0000) as u32).unwrap_or('x');
                (s, b, c)
            })
            .collect();
        o.case(&format!("random {i}"), (v, w, s));
    }
    println!("]");
}

fn crate_ids() {
    rustc_span::create_default_session_globals_then(|| {
        let names = ["main", "foo", "rust_out", "a", "my_crate", "std", "core", "x2"];
        let metas: [&[&str]; 8] = [&[], &["abc"], &["ab", "c"], &["a", "bc"], &["x", "x", "y"], &["b", "a"], &["", "z"], &["é", "long-metadata-value-0123456789"]];
        let versions = ["1.101.0-nightly (6f5da406b 2026-10-10)", "unknown version", ""];
        let mut first = true;
        println!("[");
        for name in names {
            for (mi, meta) in metas.iter().enumerate() {
                for is_exe in [false, true] {
                    for version in versions {
                        if (mi + version.len()) % 2 == 1 && name != "main" && name != "foo" {
                            continue;
                        }
                        let metadata: Vec<String> = meta.iter().map(|s| s.to_string()).collect();
                        let id = StableCrateId::new(Symbol::intern(name), is_exe, metadata.clone(), version);
                        println!(
                            "{}{{\"name\":{},\"is_exe\":{},\"metadata\":[{}],\"cfg_version\":{},\"id\":\"{}\"}}",
                            if first { "" } else { "," },
                            js(name),
                            is_exe,
                            metadata.iter().map(|s| js(s)).collect::<Vec<_>>().join(","),
                            js(version),
                            id.as_u64()
                        );
                        first = false;
                    }
                }
            }
        }
        println!("]");
    });
}

struct Cb {
    custom_name: Option<String>,
}

fn marks_json(c: SyntaxContext) -> String {
    format!(
        "[{}]",
        c.marks()
            .iter()
            .map(|(e, t): &(ExpnId, _)| format!("[{},{},{}]", e.krate.as_u32(), e.local_id.as_u32(), js(&format!("{:?}", t))))
            .collect::<Vec<_>>()
            .join(",")
    )
}

fn span_json(sp: rustc_span::Span) -> String {
    let d = sp.data_untracked();
    format!(
        "{{\"lo\":{},\"hi\":{},\"ctxt\":{},\"marks\":{},\"parent\":{}}}",
        d.lo.0,
        d.hi.0,
        js(&format!("{:?}", d.ctxt)),
        marks_json(d.ctxt),
        d.parent.map(|p| p.local_def_index.as_u32().to_string()).unwrap_or("null".into())
    )
}

fn def_json(tcx: rustc_middle::ty::TyCtxt<'_>, d: DefId) -> String {
    let h = tcx.def_path_hash(d);
    format!(
        "{{\"krate\":{},\"index\":{},\"stable_crate_id\":\"{}\",\"local_hash\":\"{}\"}}",
        d.krate.as_u32(),
        d.index.as_u32(),
        h.stable_crate_id().as_u64(),
        h.local_hash().as_u64()
    )
}

fn field<'a>(dbg: &'a str, name: &str) -> &'a str {
    let key = format!(" {name}: ");
    let i = dbg.find(&key).unwrap_or_else(|| panic!("no field {name} in {dbg}")) + key.len();
    let rest = &dbg[i..];
    let j = rest.find(|c: char| c == ',' || c == ' ' || c == '}').unwrap();
    &rest[..j]
}

impl rustc_driver::Callbacks for Cb {
    fn config(&mut self, config: &mut rustc_interface::Config) {
        if let Some(name) = &self.custom_name {
            if let rustc_session::config::Input::File(p) = &config.input {
                let src = std::fs::read_to_string(p).unwrap();
                config.input = rustc_session::config::Input::Str { name: FileName::Custom(name.clone()), input: src };
            }
        }
    }
    fn after_expansion<'tcx>(
        &mut self,
        _compiler: &rustc_interface::interface::Compiler,
        tcx: rustc_middle::ty::TyCtxt<'tcx>,
    ) -> rustc_driver::Compilation {
        let _ = std::panic::take_hook();
        std::panic::set_hook(Box::new(|_| {}));
        let mut out = String::new();
        let sm = tcx.sess.source_map();
        write!(out, "{{\"stable_crate_id\":\"{}\",", tcx.stable_crate_id(LOCAL_CRATE).as_u64()).unwrap();
        write!(out, "\"crate_name\":{},", js(tcx.crate_name(LOCAL_CRATE).as_str())).unwrap();
        write!(out, "\"crate_root\":{},", def_json(tcx, CRATE_DEF_ID.to_def_id())).unwrap();
        write!(out, "\"cfg_version\":{},", js(tcx.sess.cfg_version)).unwrap();
        out.push_str("\"files\":[");
        for (i, f) in sm.files().iter().enumerate() {
            write!(
                out,
                "{}{{\"name\":{},\"start_pos\":{},\"len\":{},\"stable_id\":{}}}",
                if i == 0 { "" } else { "," },
                js(&format!("{:?}", f.name)),
                f.start_pos.0,
                f.end_position().0 - f.start_pos.0,
                js(&format!("{:?}", f.stable_id))
            )
            .unwrap();
        }
        out.push_str("],\"expns\":[");
        let mut i = 0u32;
        loop {
            let id = LocalExpnId::from_u32(i);
            let Ok(hash) = std::panic::catch_unwind(|| id.to_expn_id().expn_hash()) else { break };
            let (f0, f1) = (hash.stable_crate_id().as_u64(), hash.local_hash().as_u64());
            write!(out, "{}{{\"id\":{},\"hash\":[\"{}\",\"{}\"]", if i == 0 { "" } else { "," }, i, f0, f1).unwrap();
            match std::panic::catch_unwind(|| id.expn_data()) {
                Err(_) => out.push_str(",\"data\":null}"),
                Ok(d) => {
                    let dbg = format!("{:?}", d);
                    write!(
                        out,
                        ",\"data\":{{\"kind\":{},\"parent\":[{},{}],\"call_site\":{},\"disambiguator\":{},\"def_site\":{},\"allow_internal_unstable\":{},\"edition\":{},\"macro_def_id\":{},\"parent_module\":{},\"allow_internal_unsafe\":{},\"local_inner_macros\":{},\"collapse_debuginfo\":{},\"diagnostic_opaque\":{}}}}}",
                        js(&format!("{:?}", d.kind)),
                        d.parent.krate.as_u32(),
                        d.parent.local_id.as_u32(),
                        span_json(d.call_site),
                        field(&dbg, "disambiguator"),
                        span_json(d.def_site),
                        match &d.allow_internal_unstable {
                            None => "null".to_string(),
                            Some(v) => format!("[{}]", v.iter().map(|s| js(s.as_str())).collect::<Vec<_>>().join(",")),
                        },
                        js(&format!("{:?}", d.edition)),
                        d.macro_def_id.map(|x| def_json(tcx, x)).unwrap_or("null".into()),
                        d.parent_module.map(|x| def_json(tcx, x.to_def_id())).unwrap_or("null".into()),
                        field(&dbg, "allow_internal_unsafe"),
                        d.local_inner_macros,
                        field(&dbg, "collapse_debuginfo"),
                        d.diagnostic_opaque
                    )
                    .unwrap();
                }
            }
            i += 1;
        }
        out.push_str("]}");
        let _ = std::panic::take_hook();
        println!("{out}");
        rustc_driver::Compilation::Stop
    }
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    match args.get(1).map(|s| s.as_str()) {
        Some("battery") => battery(),
        Some("crate-ids") => crate_ids(),
        Some("compile") => {
            let mut rest: Vec<String> = args[2..].to_vec();
            let mut cb = Cb { custom_name: None };
            if let Some(n) = rest.first().and_then(|a| a.strip_prefix("--custom-name=")) {
                cb.custom_name = Some(n.to_string());
                rest.remove(0);
            }
            let mut at_args = vec!["rustc".to_string()];
            at_args.extend(rest);
            rustc_driver::compiler_entrypoint(&at_args, &mut cb);
        }
        _ => {
            eprintln!("usage: hashprobe battery | crate-ids | compile [--custom-name=N] <rustc args>");
            std::process::exit(2);
        }
    }
}
