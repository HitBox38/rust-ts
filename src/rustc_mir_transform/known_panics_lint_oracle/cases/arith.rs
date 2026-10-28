// KnownPanicsLint on integer arithmetic of `Copy` locals (known_panics_lint.oracle.test.ts).

fn shifts(x: u8, y: i64) {
    let _a = x << 8;
    let _b = y >> 64;
    let _c = 1u32 << 31;
    let _d = 1i16 << 16;
    let _e = 1u128 >> 128;
    let _f = x << 7;
}

fn add_sub_mul() {
    let a = 255u8;
    let _b = a + 1;
    let c = -128i8;
    let _d = c - 1;
    let _e = 200u8 * 2;
    let _f = 0usize - 1;
    let _g = 100u8 + 100;
}

fn neg() {
    let x = -128i8;
    let _y = -x;
    let z = -127i8;
    let _w = -z;
}

fn div_rem() {
    let z = 0;
    let _a = 10 / z;
    let _b = 10 % z;
    let m = -128i8;
    let _c = m / -1;
    let _d = m % -1;
    let _e = m / 2;
}

fn branch(b: bool) {
    let x = 255u8;
    if false {
        let _y = x + 1;
    }
    if b {
        let _z = x + 1;
    }
}

#[allow(arithmetic_overflow)]
fn allowed() {
    let _x = 255u8 + 1;
}

fn casts() {
    let x = 300i32;
    let y = x as u8;
    let _z = y + 250;
    let _w = y + 200;
}

fn tuple() {
    let t = (1u8, 255u8);
    let _s = t.1 + t.0;
}

fn reassigned() {
    let mut x = 1u8;
    x = 255;
    let _y = x + 1;
}

fn borrowed() {
    let mut x = 255u8;
    let r = &mut x;
    *r = 0;
    let _y = x + 1;
}

fn closure() {
    let f = || {
        let _x = 255u8 + 1;
    };
    f();
}

fn main() {
    shifts(1, 2);
    add_sub_mul();
    neg();
    div_rem();
    branch(true);
    allowed();
    casts();
    tuple();
    reassigned();
    borrowed();
    closure();
}
