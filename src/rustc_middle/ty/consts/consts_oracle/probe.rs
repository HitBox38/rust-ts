//! tyconsts: throwaway oracle probe for lane ty-results (rustc_middle ty/consts/{int,valtree}.rs, ty/consts.rs). Not a
//! tools/probes probe (lanes may not edit tools/); its outputs are stored in ./expected.json, whose subject side is ./run.ts.
//!
//! Build (rustc-dev of the pinned nightly):
//!   rustc +nightly --edition 2024 -O probe.rs -o tyconsts -C link-arg=-Wl,-rpath,$(rustc +nightly --print sysroot)/lib
//! Run: `tyconsts <rustc args>`. In `after_expansion` it prints the sections below to stdout and stops.
//!   == scalar_int    `<name> {:?} {:x} {:#x} {:X} {}` of `ScalarInt`s
//!   == scalar_ops    constructors / conversions of `ScalarInt` (`{:?}` of their results)
//!   == const_int     `{:?} {:#?}` of `ConstInt`s
//!   == valtree       `{:?}` of interned leaf / zst `ValTree`s, `is_zst`, interning identity
//!   == value         `{:?}` of `ty::Value`s, `try_to_*` of `Const`s
//!   == display       `{}` of `Const`s whose printing needs no `Ty` predicate (bool, char, unit)
//!   == display_int   `{}` of integer `Const`s (the subject needs `Ty::is_ptr_sized_integral`, lane ty-sty; only the
//!                    unit test consts.test.ts reads these lines)
//!   == value_preds   `Value::try_to_bool` (the subject needs `Ty::is_bool`, lane ty-sty)
//!   == valtree_consts `{:?}` of branch `ValTree`s (their `Const`s print as integers: same reason as display_int)
#![feature(rustc_private)]
extern crate rustc_abi;
extern crate rustc_driver;
extern crate rustc_interface;
extern crate rustc_middle;
extern crate rustc_session;

use std::fmt::Write as _;
use std::io::Write as _;
use std::process::ExitCode;

use rustc_abi::Size;
use rustc_driver::{Callbacks, Compilation};
use rustc_interface::interface;
use rustc_middle::ty::consts::ConstExt;
use rustc_middle::ty::{self, ConstInt, ScalarInt, TyCtxt, ValTree};
use rustc_session::EarlyDiagCtxt;
use rustc_session::config::ErrorOutputType;

struct TyConsts;

impl Callbacks for TyConsts {
    fn after_expansion<'tcx>(&mut self, _compiler: &interface::Compiler, tcx: TyCtxt<'tcx>) -> Compilation {
        let mut stdout = std::io::stdout();
        let mut out = String::new();

        writeln!(out, "== scalar_int").unwrap();
        let sis: [(&str, ScalarInt); 9] = [
            ("u8_42", ScalarInt::from(42u8)),
            ("u16_7", ScalarInt::from(7u16)),
            ("i32_m1", ScalarInt::from(-1i32)),
            ("i16_m300", ScalarInt::from(-300i16)),
            ("u64_big", ScalarInt::from(0x1234_5678_9abc_def0u64)),
            ("u128_max", ScalarInt::from(u128::MAX)),
            ("bool_t", ScalarInt::from(true)),
            ("char_a", ScalarInt::from('a')),
            ("null8", ScalarInt::null(Size::from_bytes(8))),
        ];
        for (n, s) in sis {
            writeln!(out, "{n} {s:?} {s:x} {s:#x} {s:X} {s}").unwrap();
        }

        writeln!(out, "== scalar_ops").unwrap();
        let s1 = Size::from_bytes(1);
        let s4 = Size::from_bytes(4);
        writeln!(out, "try_from_uint(300, 1) {:?}", ScalarInt::try_from_uint(300u32, s1)).unwrap();
        writeln!(out, "try_from_uint(255, 1) {:?}", ScalarInt::try_from_uint(255u32, s1)).unwrap();
        writeln!(out, "truncate_from_uint(0x1ff, 1) {:?}", ScalarInt::truncate_from_uint(0x1ffu32, s1)).unwrap();
        writeln!(out, "try_from_int(-128, 1) {:?}", ScalarInt::try_from_int(-128i32, s1)).unwrap();
        writeln!(out, "try_from_int(-129, 1) {:?}", ScalarInt::try_from_int(-129i32, s1)).unwrap();
        writeln!(out, "truncate_from_int(-129, 1) {:?}", ScalarInt::truncate_from_int(-129i32, s1)).unwrap();
        writeln!(out, "truncate_from_int(200, 1) {:?}", ScalarInt::truncate_from_int(200i32, s1)).unwrap();
        let m1 = ScalarInt::from(-1i32);
        writeln!(out, "to_int(-1i32, 4) {} to_uint {} to_i32 {} to_u32 {}", m1.to_int(s4), m1.to_uint(s4), m1.to_i32(), m1.to_u32()).unwrap();
        writeln!(out, "to_i8(0x80u8) {} to_u8 {}", ScalarInt::from(0x80u8).to_i8(), ScalarInt::from(0x80u8).to_u8()).unwrap();
        writeln!(out, "i128::MIN to_i128 {} to_u128 {}", ScalarInt::from(i128::MIN).to_i128(), ScalarInt::from(i128::MIN).to_u128()).unwrap();
        writeln!(out, "try_to_bool 0 {:?} 1 {:?} 2 {:?}", ScalarInt::from(0u8).try_to_bool(), ScalarInt::from(1u8).try_to_bool(), ScalarInt::from(2u8).try_to_bool()).unwrap();
        writeln!(out, "char 0x61 {:?} 0xd800 {:?} 0x110000 {:?}", char::try_from(ScalarInt::from(0x61u32)), char::try_from(ScalarInt::from(0xd800u32)), char::try_from(ScalarInt::from(0x110000u32))).unwrap();
        writeln!(out, "is_null {} {} size {:?}", ScalarInt::null(s4).is_null(), ScalarInt::from(1u8).is_null(), ScalarInt::from(5u16).size()).unwrap();
        writeln!(out, "ordering {:?} {:?}", ScalarInt::from(std::cmp::Ordering::Less), ScalarInt::from(std::cmp::Ordering::Greater)).unwrap();
        writeln!(out, "atomic {:?} simd {:?}", ScalarInt::from(4u32).to_atomic_ordering(), ScalarInt::from(2u32).to_simd_alignment()).unwrap();
        writeln!(out, "eq {} {}", ScalarInt::from(1u8) == ScalarInt::TRUE, ScalarInt::from(1u16) == ScalarInt::TRUE).unwrap();

        writeln!(out, "== const_int").unwrap();
        let cis: [(ScalarInt, bool, bool); 14] = [
            (ScalarInt::from(i8::MIN), true, false),
            (ScalarInt::from(i8::MAX), true, false),
            (ScalarInt::from(-5i32), true, false),
            (ScalarInt::from(7i16), true, false),
            (ScalarInt::from(i64::MIN), true, true),
            (ScalarInt::from(i64::MAX), true, true),
            (ScalarInt::from(-3i64), true, true),
            (ScalarInt::from(i128::MIN), true, false),
            (ScalarInt::from(u8::MAX), false, false),
            (ScalarInt::from(7u16), false, false),
            (ScalarInt::from(u32::MAX), false, false),
            (ScalarInt::from(3u64), false, true),
            (ScalarInt::from(u64::MAX), false, true),
            (ScalarInt::from(12345678901234567890123u128), false, false),
        ];
        for (int, signed, ptr) in cis {
            let ci = ConstInt::new(int, signed, ptr);
            writeln!(out, "{ci:?} {ci:#?}").unwrap();
        }

        writeln!(out, "== valtree").unwrap();
        let vt42 = ValTree::from_scalar_int(tcx, 42u8.into());
        let c1 = ty::Const::new_value(tcx, ValTree::from_scalar_int(tcx, 1u8.into()), tcx.types.u8);
        let c2 = ty::Const::new_value(tcx, ValTree::from_scalar_int(tcx, 2u8.into()), tcx.types.u8);
        let br = ValTree::from_branches(tcx, [c1, c2]);
        let zst = ValTree::zst(tcx);
        writeln!(out, "{vt42:?} {} {}", vt42.is_zst(), vt42 == ValTree::from_scalar_int(tcx, 42u8.into())).unwrap();
        writeln!(out, "{} {}", br.is_zst(), br == ValTree::from_branches(tcx, [c1, c2])).unwrap();
        writeln!(out, "{zst:?} {} {}", zst.is_zst(), zst == ValTree::from_branches(tcx, [])).unwrap();
        let raw = ValTree::from_raw_bytes(tcx, b"hi");

        writeln!(out, "== value").unwrap();
        let c42 = ty::Const::new_value(tcx, vt42, tcx.types.u8);
        writeln!(out, "{:?}", c42.to_value()).unwrap();
        writeln!(out, "{:?}", tcx.consts.unit.to_value()).unwrap();
        writeln!(out, "{:?} {:?} {:?}", c42.try_to_leaf(), c42.try_to_branch().map(|b| b.len()), c42.to_leaf()).unwrap();
        let cbr = ty::Const::new_value(tcx, br, tcx.types.u8);
        writeln!(out, "{:?} {}", cbr.try_to_leaf(), cbr.to_branch().len()).unwrap();
        writeln!(out, "{} {}", tcx.consts.true_ == ty::Const::new_value(tcx, ValTree::from_scalar_int(tcx, true.into()), tcx.types.bool), ty::Const::zero_sized(tcx, tcx.types.unit) == tcx.consts.unit).unwrap();

        writeln!(out, "== display").unwrap();
        let ca = ty::Const::new_value(tcx, ValTree::from_scalar_int(tcx, 'a'.into()), tcx.types.char);
        let cq = ty::Const::new_value(tcx, ValTree::from_scalar_int(tcx, '\''.into()), tcx.types.char);
        let cn = ty::Const::new_value(tcx, ValTree::from_scalar_int(tcx, '\n'.into()), tcx.types.char);
        writeln!(out, "{} {} {} {} {} {}", tcx.consts.true_, tcx.consts.false_, tcx.consts.unit, ca, cq, cn).unwrap();
        writeln!(out, "{} {}", tcx.consts.true_.to_value(), ca.to_value()).unwrap();

        writeln!(out, "== display_int").unwrap();
        let ints: [(ScalarInt, ty::Ty<'tcx>); 8] = [
            (42u8.into(), tcx.types.u8),
            ((-5i32).into(), tcx.types.i32),
            (i8::MIN.into(), tcx.types.i8),
            (u64::MAX.into(), tcx.types.u64),
            (3u64.into(), tcx.types.usize),
            ((-1i64).into(), tcx.types.isize),
            (i64::MAX.into(), tcx.types.isize),
            (u128::MAX.into(), tcx.types.u128),
        ];
        for (int, t) in ints {
            let c = ty::Const::new_value(tcx, ValTree::from_scalar_int(tcx, int), t);
            writeln!(out, "{c} {}", c.to_value()).unwrap();
        }

        writeln!(out, "== value_preds").unwrap();
        writeln!(out, "{:?} {:?}", tcx.consts.true_.to_value().try_to_bool(), c42.to_value().try_to_bool()).unwrap();

        writeln!(out, "== valtree_consts").unwrap();
        writeln!(out, "{br:?} {raw:?}").unwrap();

        stdout.write_all(out.as_bytes()).unwrap();
        stdout.flush().unwrap();
        Compilation::Stop
    }
}

fn main() -> ExitCode {
    let early_dcx = EarlyDiagCtxt::new(ErrorOutputType::default());
    rustc_driver::install_ice_hook(rustc_driver::DEFAULT_BUG_REPORT_URL, |_| ());
    let mut callbacks = TyConsts;
    rustc_driver::catch_with_exit_code(|| rustc_driver::compiler_entrypoint(&rustc_driver::args::raw_args(&early_dcx), &mut callbacks))
}
