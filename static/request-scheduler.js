// Only in-flight reads are shared. Completed business responses are never cached.
export function createRequestScheduler({ concurrency = 4, timeoutMs = 20000, fetchImpl = fetch } = {}) {
  let active = 0;
  let epoch = 0;
  const pending = [];
  const reads = new Map();
  const cancelled = () => Object.assign(new Error(""), { name: "AbortError" });
  function pump() {
    while (active < concurrency && pending.length) {
      const job = pending.shift();
      if (job.epoch !== epoch) { job.reject(cancelled()); continue; }
      active += 1;
      const timer = setTimeout(() => { job.timedOut = true; job.controller.abort(); }, timeoutMs);
      Promise.resolve().then(async () => {
        const response = await fetchImpl(job.url, { ...job.options, signal: job.controller.signal });
        // Consume within the slot: a stalled response body must also time out.
        const body = await response.arrayBuffer();
        if (job.epoch !== epoch) throw cancelled();
        return new Response([204, 205, 304].includes(response.status) ? null : body, { status: response.status, statusText: response.statusText, headers: response.headers });
      }).then(job.resolve, (error) => job.reject(job.timedOut ? new Error("读取超时，请稍后刷新重试") : job.controller.signal.aborted ? cancelled() : error))
        .finally(() => { clearTimeout(timer); active -= 1; pump(); });
    }
  }
  return {
    read(url, options = {}, scope = "") {
      const key = JSON.stringify([epoch, scope, url]);
      let job = reads.get(key);
      if (!job) {
        job = { url, options, epoch, controller: new AbortController() };
        job.promise = new Promise((resolve, reject) => { job.resolve = resolve; job.reject = reject; });
        reads.set(key, job);
        pending.push(job);
        job.promise.then(() => { if (reads.get(key) === job) reads.delete(key); }, () => { if (reads.get(key) === job) reads.delete(key); });
        pump();
      }
      return job.promise.then((response) => response.clone());
    },
    invalidate() {
      epoch += 1;
      for (const job of reads.values()) job.controller.abort();
      reads.clear();
      for (const job of pending.splice(0)) job.reject(cancelled());
    },
  };
}
