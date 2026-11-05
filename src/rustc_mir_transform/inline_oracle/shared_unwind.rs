// `thread::spawn` inlined has two `unwind continue` calls, each mapped to the same cleanup block of `main`, and the
// `Box<dyn FnOnce>` call before it makes `remove_dead_blocks` renumber that block after inlining.
fn main() {
    let b: Box<dyn FnOnce(u8) -> u8> = Box::new(|x| x);
    let _ = b(1);
    let _ = std::thread::spawn(|| 1u8);
}
