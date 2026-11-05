// miri-flags: -Zmiri-disable-isolation
// Isolation off with no socket: `Poll::new` at startup, a zero-timeout poll before every shim and on every scheduler tick, and
// a poll with a timeout when every thread sleeps, all on a poller with nothing registered (shims/env/home.rs and others).
use std::time::Duration;

fn main() {
    std::thread::sleep(Duration::from_millis(5));
    let h = std::thread::spawn(|| {
        std::thread::sleep(Duration::from_millis(1));
        7
    });
    println!("{}", h.join().unwrap());
    println!("{}", std::env::current_dir().is_ok());
    println!("{}", std::env::var("MIRI_NO_SUCH_VARIABLE").is_err());
}
