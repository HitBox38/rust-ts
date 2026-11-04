//@ edition: 2021
// A binary using std: `main`, the `start` lang item, println's fmt machinery, upstream monomorphizations.
fn main() {
    let v: Vec<u32> = (0..3).map(|x| x * 2).collect();
    println!("{:?} {}", v, v.len());
}
