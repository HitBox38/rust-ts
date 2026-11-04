// review miri-x86-a N4: `llvm.x86.sse2.pause` yields the thread. With preemption off, nothing else can switch threads between
// the log entries, so the order of the log shows that yield. The log is written with one `write`, to stay cheap.
use std::arch::x86_64::_mm_pause;
use std::sync::atomic::{AtomicU8, AtomicUsize, Ordering::Relaxed};
use std::thread;

const ROUNDS: u8 = 4;
const ZERO: AtomicU8 = AtomicU8::new(0);
static LOG: [AtomicU8; 36] = [ZERO; 36];
static NEXT: AtomicUsize = AtomicUsize::new(0);

extern "C" {
    fn write(fd: i32, buf: *const u8, count: usize) -> isize;
}

fn log(c: u8) {
    LOG[NEXT.fetch_add(1, Relaxed)].store(c, Relaxed);
}

fn worker(name: u8) {
    for round in 0..ROUNDS {
        log(name);
        log(b'0' + round);
        log(b' ');
        _mm_pause();
    }
}

fn main() {
    let a = thread::spawn(|| worker(b'a'));
    let b = thread::spawn(|| worker(b'b'));
    worker(b'm');
    a.join().unwrap();
    b.join().unwrap();
    let mut out = [0u8; 36];
    for i in 0..36 {
        out[i] = LOG[i].load(Relaxed);
    }
    unsafe { write(1, out.as_ptr(), 36) };
}
