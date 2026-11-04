// poll (miri-shims-d review M2): the fast path, POLLNVAL, ignored negative descriptors, a blocking poll that times out, and
// one woken by another thread, on eventfds and the standard streams (pipes and socketpairs are not ported yet, plan-m6 D2).
#![feature(rustc_private)]
extern crate libc;
use std::io::Error;
use std::thread;

fn poll(fds: &mut [libc::pollfd], timeout: i32) {
    let r = unsafe { libc::poll(fds.as_mut_ptr(), fds.len() as libc::nfds_t, timeout) };
    let revents: Vec<i16> = fds.iter().map(|p| p.revents).collect();
    if r < 0 {
        println!("poll {r} errno {} {revents:?}", Error::last_os_error().raw_os_error().unwrap());
    } else {
        println!("poll {r} {revents:?}");
    }
}
fn pfd(fd: i32, events: i16) -> libc::pollfd {
    libc::pollfd { fd, events, revents: -1 }
}

fn eventfd_write(e: i32, n: u64) {
    assert_eq!(unsafe { libc::write(e, n.to_ne_bytes().as_ptr().cast(), 8) }, 8);
}
fn eventfd_read(e: i32) -> u64 {
    let mut b = [0u8; 8];
    assert_eq!(unsafe { libc::read(e, b.as_mut_ptr().cast(), 8) }, 8);
    u64::from_ne_bytes(b)
}

fn main() {
    let e = unsafe { libc::eventfd(0, 0) };
    let g = unsafe { libc::eventfd(0, 0) };
    assert!(e >= 0 && g >= 0);

    // The fast path: not readable yet, writable; both; after a write.
    poll(&mut [pfd(e, libc::POLLIN)], 0);
    poll(&mut [pfd(e, libc::POLLOUT)], 0);
    poll(&mut [pfd(e, libc::POLLIN | libc::POLLOUT)], 0);
    poll(&mut [pfd(e, libc::POLLIN), pfd(g, libc::POLLOUT)], 0);
    eventfd_write(e, 1);
    poll(&mut [pfd(e, libc::POLLIN), pfd(g, libc::POLLIN)], 0);
    // A full counter: not writable.
    eventfd_write(g, u64::MAX - 1);
    poll(&mut [pfd(g, libc::POLLIN | libc::POLLOUT)], 0);
    // No events asked for: nothing but the always-reported ones.
    poll(&mut [pfd(e, 0), pfd(g, 0)], 0);
    println!("{}", eventfd_read(e));
    println!("{}", eventfd_read(g));

    // An invalid descriptor counts as ready with POLLNVAL; a negative one is ignored.
    poll(&mut [pfd(42, libc::POLLIN)], 0);
    poll(&mut [pfd(-1, libc::POLLIN)], 0);
    poll(&mut [pfd(42, libc::POLLIN), pfd(-1, libc::POLLIN), pfd(e, libc::POLLOUT), pfd(43, 0)], 0);
    // No descriptors at all.
    poll(&mut [], 0);
    // std's standard streams.
    poll(&mut [pfd(0, libc::POLLIN), pfd(1, libc::POLLOUT), pfd(2, libc::POLLOUT)], 0);

    // A blocking poll that times out, and one that is woken up by another thread's write.
    poll(&mut [pfd(e, libc::POLLIN)], 10);
    let writer = thread::spawn(move || {
        thread::yield_now();
        eventfd_write(e, 2);
    });
    poll(&mut [pfd(e, libc::POLLIN)], -1);
    writer.join().unwrap();
    println!("{}", eventfd_read(e));
    // A timeout that does not expire because the data arrives first.
    let writer = thread::spawn(move || eventfd_write(e, 3));
    poll(&mut [pfd(e, libc::POLLIN)], 1000);
    writer.join().unwrap();
    println!("{}", eventfd_read(e));

    // Readers blocked on the descriptors still work after all those polls: no interest stayed behind.
    let reader = thread::spawn(move || eventfd_read(e));
    thread::yield_now();
    eventfd_write(e, 4);
    println!("{}", reader.join().unwrap());

    // A closed descriptor is invalid again.
    assert_eq!(unsafe { libc::close(e) }, 0);
    poll(&mut [pfd(e, libc::POLLIN), pfd(g, libc::POLLOUT)], 0);
    assert_eq!(unsafe { libc::close(g) }, 0);
    println!("done");
}
