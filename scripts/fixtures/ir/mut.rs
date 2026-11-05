// The real program behind scripts/ir-normal.test.ts: compiled by the oracle, and the text it writes is what gets mutated.
// It reaches what the mutations need: pointer parameters, wrapping arithmetic, signed and equality compares, loads and stores
// of integers, plain and inbounds GEPs, local name collisions, and a string holding the normaliser's own comment text.
static S: &str = "abc  ; preds = %bb1, %bb2";
static L: &str = "first\n; second";
#[inline(never)]
pub fn sum(a: &mut Vec<u64>, b: &[u8], k: i64) -> u64 {
    let mut s = 0u64;
    for x in b {
        s = s.wrapping_add(*x as u64).wrapping_mul(3).wrapping_sub(1);
        if (k as i32) < 7 || (*x as i64) > k {
            a.push(s);
        }
    }
    s
}
#[inline(never)]
pub fn pick(p: &(u64, u8), q: &[u32; 4], i: usize) -> u64 {
    if p.1 == 3 { p.0 } else if q[i & 3] != 9 { q[1] as u64 } else { 0 }
}
/// # Safety
/// `p` is valid, and so is what it points at.
#[inline(never)]
pub unsafe fn raw(p: *const *const u8, n: usize) -> *const u8 {
    unsafe { (*p).add(n).add(0) }
}
struct T(u32, Option<Box<T>>);
impl Drop for T {
    fn drop(&mut self) {
        println!("{}", self.0);
    }
}
fn main() {
    let mut v = vec![];
    let r = sum(&mut v, S.as_bytes(), L.len() as i64);
    let _t = T(1, Some(Box::new(T(2, None))));
    let q = [1, 2, 3, 4];
    let b = S.as_ptr();
    println!("{r} {} {} {:?}", v.len(), pick(&(r, 3), &q, v.len()), unsafe { raw(&b, 1) });
}
