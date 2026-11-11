// rust-ts stand-in for the parts of library/std/src/thread and library/std/src/sync/mpsc that must run as native
// code on a second OS thread (see src/std/thread.ts and src/std/sync/mpsc.ts). Not an upstream mirror: std's own
// implementation (sys/thread/unix.rs over pthreads, sync/mpmc/array.rs) is lock-free Rust; this is the same
// contract over a pthread mutex and condition variable.
//
// Compiled at load time by bun:ffi's embedded TinyCC (`cc`). No system headers: TinyCC inside Bun has no SDK
// include path, so the pthread / libc functions below are declared by hand and resolved from the running process.
// The pthread object types are opaque here; they live in 128-byte, 16-aligned blocks, larger than
// `pthread_mutex_t` (64 bytes on macOS, 40 on Linux), `pthread_cond_t` (48 / 48) and `pthread_attr_t` (64 / 56).

typedef unsigned long rts_size_t;
typedef unsigned long rts_u64;

void *malloc(rts_size_t size);
void *calloc(rts_size_t n, rts_size_t size);
void free(void *p);
void abort(void);
int getpagesize(void);
int pthread_create(void *thread, const void *attr, void *(*start)(void *), void *arg);
int pthread_join(void *thread, void **value);
int pthread_attr_init(void *attr);
int pthread_attr_destroy(void *attr);
int pthread_attr_setstacksize(void *attr, rts_size_t size);
int pthread_mutex_init(void *mutex, const void *attr);
int pthread_mutex_destroy(void *mutex);
int pthread_mutex_lock(void *mutex);
int pthread_mutex_unlock(void *mutex);
int pthread_cond_init(void *cond, const void *attr);
int pthread_cond_destroy(void *cond);
int pthread_cond_wait(void *cond, void *mutex);
int pthread_cond_broadcast(void *cond);
#ifdef __linux__
void *dlsym(void *handle, const char *symbol);
#endif

#define RTS_EINVAL 22
// `libc::PTHREAD_STACK_MIN` (libc 0.2.189, the version in library/Cargo.lock). PORT: one value, which holds only on
// aarch64-apple-darwin (src/unix/bsd/apple/mod.rs:2543, the root host, where it is checked) and on glibc for arm, x86,
// x86_64, s390x and riscv (src/unix/linux_like/linux/gnu/mod.rs:973; there it is only the fallback when
// `__pthread_get_minstack` is missing). Elsewhere libc has another value: 8192 on x86_64 apple (apple/mod.rs:2545),
// 0x6000 on glibc sparc and 131072 on glibc aarch64 and the remaining arches (gnu/mod.rs:975,977), and 2048 on musl
// (src/unix/linux_like/linux/musl/mod.rs:576, where std does not look up `__pthread_get_minstack` at all, unlike the
// `#ifdef __linux__` below). It matters only when `RUST_MIN_STACK` is below the floor.
#define RTS_PTHREAD_STACK_MIN 16384

// `rts_thread_spawn`'s `*err` values other than 0 and a positive `pthread_create` error (src/std/thread.ts reads
// them): each is a point where std's `Thread::new` returns an error or fails an assertion, either of which becomes a
// panic, so thread.ts stops `unported` instead of the process aborting here.
#define RTS_SPAWN_INVALID_STACK_SIZE (-1) // Err(io::const_error!(InvalidInput, "invalid stack size"))
#define RTS_SPAWN_ATTR_INIT_FAILED (-2)   // assert_eq!(libc::pthread_attr_init(..), 0)
#define RTS_SPAWN_SETSTACKSIZE_FAILED (-3) // assert_eq!(n, libc::EINVAL)
#define RTS_SPAWN_ATTR_DESTROY_FAILED (-4) // the DropGuard's assert_eq!(libc::pthread_attr_destroy(..), 0)
// -3 and then the DropGuard's assertion failing too, while unwinding from the first panic: a panic in a destructor
// during unwinding, which aborts the process upstream.
#define RTS_SPAWN_SETSTACKSIZE_THEN_DESTROY_FAILED (-5)

typedef struct {
  _Alignas(16) unsigned char bytes[128];
} rts_opaque;

// ---- std::thread (library/std/src/sys/thread/unix.rs `Thread::new`, `Thread::join`) ----

typedef struct {
  rts_opaque native; // pthread_t
} rts_thread;

// sys/thread/unix.rs `min_stack_size`
static rts_size_t rts_min_stack_size(void *attr) {
#ifdef __linux__
  // glibc: `__pthread_get_minstack(attr)` when the symbol exists (accounts for the TLS size).
  rts_size_t (*get_minstack)(void *) = (rts_size_t(*)(void *))dlsym((void *)0, "__pthread_get_minstack");
  if (get_minstack != 0) return get_minstack(attr);
#endif
  (void)attr;
  return RTS_PTHREAD_STACK_MIN;
}

/// `Thread::new(stack, ..)`: a joinable thread running `start(arg)` with a stack of at least `stack` bytes.
/// Returns the thread with `*err` = 0, or null with `*err` = the `pthread_create` error (> 0) or one of the
/// `RTS_SPAWN_*` codes (< 0). `RTS_SPAWN_ATTR_DESTROY_FAILED` can also come after the thread was created: then the
/// thread is returned (it runs, as upstream's does when its guard's assertion panics) and the caller stops.
void *rts_thread_spawn(void *(*start)(void *), void *arg, rts_size_t stack, int *err) {
  rts_opaque attr;
  rts_size_t stack_size;
  int r;
  int ret;
  rts_thread *t = (rts_thread *)calloc(1, sizeof(rts_thread));
  if (t == 0) abort(); // handle_alloc_error
  if (pthread_attr_init(&attr) != 0) {
    free(t);
    *err = RTS_SPAWN_ATTR_INIT_FAILED;
    return 0;
  }
  stack_size = stack > rts_min_stack_size(&attr) ? stack : rts_min_stack_size(&attr);
  r = pthread_attr_setstacksize(&attr, stack_size);
  if (r != 0) {
    rts_size_t page_size;
    if (r != RTS_EINVAL) {
      // The assertion panics while the DropGuard is live, so the guard still destroys `attr` while unwinding; if its
      // own assertion fails there, that second panic aborts (docs/reviews/fixers-51.md N2). Neither failure happens
      // on a host the port supports (setstacksize fails only with EINVAL, destroy does not fail).
      free(t);
      *err = pthread_attr_destroy(&attr) != 0 ? RTS_SPAWN_SETSTACKSIZE_THEN_DESTROY_FAILED : RTS_SPAWN_SETSTACKSIZE_FAILED;
      return 0;
    }
    // EINVAL means |stack_size| is either too small or not a multiple of the system page size. Because it's
    // definitely >= PTHREAD_STACK_MIN, it must be an alignment issue. Round up to the nearest page and try again.
    page_size = (rts_size_t)getpagesize();
    stack_size = (stack_size + page_size - 1) & (-(long)(page_size - 1) - 1);
    // Some libc implementations, e.g. musl, place an upper bound on the stack size, in which case we can only
    // gracefully return an error here.
    if (pthread_attr_setstacksize(&attr, stack_size) != 0) {
      free(t);
      *err = pthread_attr_destroy(&attr) != 0 ? RTS_SPAWN_ATTR_DESTROY_FAILED : RTS_SPAWN_INVALID_STACK_SIZE;
      return 0;
    }
  }
  ret = pthread_create(&t->native, &attr, start, arg);
  // The DropGuard runs when `new` returns, after `pthread_create` either way.
  if (pthread_attr_destroy(&attr) != 0) {
    if (ret != 0) {
      free(t);
      t = 0;
    }
    *err = RTS_SPAWN_ATTR_DESTROY_FAILED;
    return t;
  }
  if (ret != 0) {
    free(t);
    *err = ret;
    return 0;
  }
  *err = 0;
  return t;
}

/// `Thread::join`: waits for the thread and frees the handle. Returns the `pthread_join` result.
int rts_thread_join(rts_thread *t) {
  void *value;
  int r = pthread_join(*(void **)&t->native, &value);
  free(t);
  return r;
}

// ---- std::sync::mpsc::sync_channel (library/std/src/sync/mpmc/array.rs) ----
//
// A bounded channel of `cap` slots, each `words` machine words (a `#[repr(C)]` value moved by copy). One sender,
// one receiver (`SyncSender::clone` is not ported). The channel is freed when both ends are dropped.

typedef struct {
  rts_opaque mutex;
  rts_opaque cond;
  rts_size_t words;
  rts_size_t cap;
  rts_size_t head;
  rts_size_t len;
  int senders;
  int receivers;
  rts_u64 *slots;
} rts_chan;

rts_chan *rts_chan_new(rts_size_t cap, rts_size_t words) {
  rts_chan *c = (rts_chan *)calloc(1, sizeof(rts_chan));
  if (c == 0) abort();
  c->slots = (rts_u64 *)calloc(cap * words, sizeof(rts_u64));
  if (c->slots == 0) abort();
  if (pthread_mutex_init(&c->mutex, 0) != 0) abort();
  if (pthread_cond_init(&c->cond, 0) != 0) abort();
  c->words = words;
  c->cap = cap;
  c->senders = 1;
  c->receivers = 1;
  return c;
}

/// `SyncSender::send`: blocks while the channel is full. 0 = `Ok(())`; 1 = `Err(SendError(msg))` (the receiver
/// is gone; `msg` is not consumed).
int rts_chan_send(rts_chan *c, const rts_u64 *msg) {
  rts_size_t i;
  rts_u64 *slot;
  pthread_mutex_lock(&c->mutex);
  while (c->len == c->cap && c->receivers != 0) pthread_cond_wait(&c->cond, &c->mutex);
  if (c->receivers == 0) {
    pthread_mutex_unlock(&c->mutex);
    return 1;
  }
  slot = c->slots + ((c->head + c->len) % c->cap) * c->words;
  for (i = 0; i < c->words; i++) slot[i] = msg[i];
  c->len++;
  pthread_cond_broadcast(&c->cond);
  pthread_mutex_unlock(&c->mutex);
  return 0;
}

/// `Receiver::recv`: blocks while the channel is empty and a sender is alive. 0 = `Ok(msg)` (written to `out`);
/// 1 = `Err(RecvError)` (empty and every sender is gone).
int rts_chan_recv(rts_chan *c, rts_u64 *out) {
  rts_size_t i;
  rts_u64 *slot;
  pthread_mutex_lock(&c->mutex);
  while (c->len == 0 && c->senders != 0) pthread_cond_wait(&c->cond, &c->mutex);
  if (c->len == 0) {
    pthread_mutex_unlock(&c->mutex);
    return 1;
  }
  slot = c->slots + c->head * c->words;
  for (i = 0; i < c->words; i++) out[i] = slot[i];
  c->head = (c->head + 1) % c->cap;
  c->len--;
  pthread_cond_broadcast(&c->cond);
  pthread_mutex_unlock(&c->mutex);
  return 0;
}

/// The number of messages in the channel (for tests and for the receiver's drop, which must find none).
rts_size_t rts_chan_len(rts_chan *c) {
  rts_size_t n;
  pthread_mutex_lock(&c->mutex);
  n = c->len;
  pthread_mutex_unlock(&c->mutex);
  return n;
}

static void rts_chan_release(rts_chan *c) {
  // Called with the mutex held.
  if (c->senders == 0 && c->receivers == 0) {
    pthread_mutex_unlock(&c->mutex);
    pthread_cond_destroy(&c->cond);
    pthread_mutex_destroy(&c->mutex);
    free(c->slots);
    free(c);
    return;
  }
  pthread_cond_broadcast(&c->cond);
  pthread_mutex_unlock(&c->mutex);
}

/// `drop(SyncSender)`: disconnects the senders (a blocked `recv` on an empty channel returns `Err`).
void rts_chan_drop_sender(rts_chan *c) {
  pthread_mutex_lock(&c->mutex);
  c->senders--;
  rts_chan_release(c);
}

/// `drop(Receiver)`: disconnects the receivers (a blocked `send` returns `Err`). Messages still in the channel are
/// forgotten: the TS side checks there are none (see mpsc.ts).
void rts_chan_drop_receiver(rts_chan *c) {
  pthread_mutex_lock(&c->mutex);
  c->receivers--;
  rts_chan_release(c);
}

/// The channel functions as C function pointers, for native code in another TinyCC unit that moves an endpoint
/// to a second thread (proc_macro_host.c): send, recv, drop_sender, drop_receiver.
void rts_chan_fns(void **out) {
  out[0] = (void *)rts_chan_send;
  out[1] = (void *)rts_chan_recv;
  out[2] = (void *)rts_chan_drop_sender;
  out[3] = (void *)rts_chan_drop_receiver;
}
