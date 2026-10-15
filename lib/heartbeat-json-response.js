// Keeps a long-running JSON request alive through proxies and gateways.
//
// A route that stays silent until it has its full answer looks dead to any
// reverse proxy / load balancer / CDN with an idle or time-to-first-byte limit,
// which then drops the connection. The browser sees that as a network failure
// (fetch rejects with TypeError) even though the route is still working.
//
// If `work` settles within `startAfterMs`, its Response is returned untouched
// (real HTTP status preserved). Otherwise a 200 response starts immediately and
// a single space is written every `intervalMs` until `work` settles, then the
// JSON body follows. Leading whitespace is valid JSON, so `res.json()` /
// `JSON.parse(await res.text())` read it unchanged. Heartbeat chunks are only
// ASCII spaces and the JSON is written in one final chunk, so no partial JSON is
// ever exposed.
//
// Streamed contract: the HTTP status is always 200 once streaming starts, so a
// non-2xx result is reported in the body as
//   { success: false, code, error, status, ...details }
// where `status` is the semantic HTTP status. Clients must decide success from
// the body (`success` / `code`), never from `response.ok`.

const encoder = new TextEncoder();

function fallbackErrorResponse(err) {
  console.error("[HeartbeatResponse] work rejected:", err?.message || err);
  return Response.json(
    { success: false, error: "The request failed unexpectedly. Please try again." },
    { status: 500 }
  );
}

async function bodyForStream(res) {
  const text = await res.text();
  if (res.ok) return text;
  try {
    const data = JSON.parse(text);
    if (data && typeof data === "object" && !Array.isArray(data)) {
      return JSON.stringify({ ...data, success: false, code: data.code ?? "REQUEST_FAILED", status: res.status });
    }
  } catch {}
  return JSON.stringify({ success: false, code: "REQUEST_FAILED", status: res.status, error: "The request failed. Please try again." });
}

export async function respondWithHeartbeat(work, { startAfterMs = 5_000, intervalMs = 10_000 } = {}) {
  const settled = Promise.resolve(work).catch(fallbackErrorResponse);

  let timer;
  const stillRunning = new Promise((resolve) => {
    timer = setTimeout(() => resolve(null), startAfterMs);
  });
  const early = await Promise.race([settled, stillRunning]);
  clearTimeout(timer);
  if (early) return early;

  let interval;
  let closed = false;
  const stream = new ReadableStream({
    start(controller) {
      const write = (chunk) => {
        if (closed) return;
        try { controller.enqueue(encoder.encode(chunk)); } catch { closed = true; }
      };
      write(" ");
      interval = setInterval(() => write(" "), intervalMs);

      settled
        .then(bodyForStream)
        .catch((err) => bodyForStream(fallbackErrorResponse(err)))
        .then((body) => {
          clearInterval(interval);
          write(body);
          if (!closed) {
            closed = true;
            try { controller.close(); } catch {}
          }
        });
    },
    cancel() {
      closed = true;
      clearInterval(interval);
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      // no-transform: keeps Next's gzip (and intermediaries) from buffering the
      // keep-alive bytes. X-Accel-Buffering: tells nginx not to buffer them.
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
