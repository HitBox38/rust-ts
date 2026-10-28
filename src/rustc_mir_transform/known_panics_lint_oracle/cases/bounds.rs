// KnownPanicsLint's bounds check on an array of `Copy` scalars (known_panics_lint.oracle.test.ts).

fn bounds() {
    let arr = [1u8, 2, 3];
    let i = 5;
    let _x = arr[i];
    let j = 2;
    let _y = arr[j];
}

fn main() {
    bounds();
}
