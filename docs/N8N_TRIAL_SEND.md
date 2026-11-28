# n8n Trial Send

Trial Send delivers a **saved** post's real outbound publish request to a separately configured **trial** n8n webhook. Use it to check payload structure, scheduling fields and your workflow's field mapping.

> **A trial is not a dry run.** Content Studio sends exactly what production would send. What happens next depends entirely on the n8n workflow that receives it. An n8n Test URL runs the same workflow nodes as production, including publishing and database writes. Content Studio cannot guarantee that n8n has no downstream side effects.

## What Content Studio guarantees

- The request goes **only** to the trial webhook URL configured in **Settings → n8n Webhooks**. It never goes to the production publish or delete webhook, and it never falls back to production after an error. There is no environment-variable fallback for the trial URL.
- The request body is produced by the same server code as a production send:
  1. The stored canonical payload.
  2. The Brand name and the four server-computed schedule fields (`Scheduled Date`, `scheduled_date_utc`, `brand_timezone`, `brand_local_publish_datetime`).
  3. The LinkedIn legacy PDF adapter.
  4. JSON serialization.
- Trial and production bodies are identical when both use the same saved post and the same public media state. A production send may first upload media and rewrite media URLs; a trial never does.
- Nothing is changed:
  - no database writes
  - no media uploads
  - no stored `jsonPayload` change
  - no status, date or error-log change
  - no LinkedIn retention run
  - no delete webhook call
- Two extra headers are sent: `X-Content-Studio-Mode: trial` and `X-Content-Studio-Trial-Id: <uuid>`. Use them for logging, but do not rely on the header alone to keep a workflow safe.

## A. Standard n8n Test URL

1. Open the workflow in n8n and select its **Webhook** node (HTTP method **POST**).
2. Copy the node's **Test URL**. It contains `/webhook-test/`.
3. Make sure downstream publishing nodes and production database writes **cannot run**. For example, disconnect them or add an IF node on the `X-Content-Studio-Mode` header. If you cannot guarantee this, use option B.
4. In Content Studio, go to **Settings → n8n Webhooks**, paste it as the **Trial Webhook URL**, and save.
5. In n8n, click **Listen for test event**. n8n listens for about **120 seconds**.
6. In Content Studio, open a post → **n8n JSON Payload** → **Trial Send to n8n** → **Run Trial**.
7. Inspect the received body in the n8n editor.

## B. Dedicated diagnostic workflow (recommended)

Create a separate workflow that contains no publishing, scheduling or database nodes:

```
Webhook (POST) → Validate incoming payload → Respond to Webhook
```

Set the Webhook node's **Respond** option to **Using 'Respond to Webhook' Node**. Example response (the exact response depends on your workflow):

```json
{
  "received": true,
  "mode": "trial",
  "post_id": "POST-0023",
  "platform": "LinkedIn",
  "scheduled_date": "25/11/2026 05:00:00",
  "scheduled_date_utc": "2026-11-25T12:00:00.000Z"
}
```

Publish (activate) the workflow and use its **Production URL** as the Content Studio *trial* URL. It does not need to be listening, and it must not be the production publishing workflow.

## C. Header Authentication

1. In n8n, set the Webhook node's **Authentication** to **Header Auth** and create a credential with a header name (e.g. `X-N8N-Trial-Key`) and a long random value.
2. In Content Studio, choose **Header Authentication** and enter the same header name and secret.

Rules:

- Reserved transport headers cannot be used. These include `Host`, `Content-Length`, `Content-Type`, `Transfer-Encoding`, `Connection`, `Cookie`, `Proxy-*`, `Sec-*` and `X-Content-Studio-*`. Names must be valid HTTP tokens, and secrets cannot contain line breaks or control characters.
- The secret is **write-only**. No API returns it, it never appears in trial results, diagnostic downloads or logs, and it is never sent to production webhooks. If n8n echoes it back in a response, it is replaced with `[redacted]`.
- Saving other settings keeps the stored secret. Use **Remove secret** to delete it; this also switches authentication to **None**, because Header Authentication cannot be saved without a secret.
- **Changing the destination host** (or port) while a secret is stored requires re-entering the secret in the same save. The stored secret is never silently forwarded to a different host. The same applies when a URL is set again after it was cleared.
- **Redaction guarantees.** If n8n echoes the secret back, these forms are replaced with `[redacted]` in the response text and content type before they reach the browser or a diagnostic download:
  - the raw value
  - JSON-escaped, URL-encoded (both space forms) and HTML-escaped
  - base64 and base64url
  
  Other transformations cannot be detected: hashing, partial echoes, other encodings, or a secret split across the 64 KB response cut. A downstream system that stores or forwards the secret is outside Content Studio's control.
- **Storage at rest:** the secret is stored in the `Settings` table as **plain text**, like the other Settings values. It is **not encrypted**. Protect the database file and its backups.

Basic Auth and JWT Auth are not supported in this release.

## D. IP allowlist

On the Webhook node, set **IP(s) Allowlist** to the public IP address of the Content Studio server. Requests from other addresses receive HTTP 403. Combine this with Header Authentication.

## E. Destination rules

The trial URL is checked when it is saved **and again before every trial**, because production settings may have changed since it was saved. It must:

- use `https://` and contain no username/password and no `#fragment`;
- differ from the production publish and delete webhook URLs. The comparison is deliberately conservative, so these all count as the same webhook:
  - scheme and host in a different case, a default port, or a trailing dot on the host
  - the path percent-decoded (repeatedly), so `%70`, an encoded `/` (`%2F`) and double encoding are all caught
  - dot segments resolved, repeated or trailing slashes ignored, and backslashes treated as slashes
  - any **query string** ignored
  
  The path's **case** still matters, so n8n's `/webhook-test/…` URL for the same workflow remains allowed;
- use a host name, not an IP address, and that host must be **approved**. Approved hosts are the production n8n webhook host(s), plus any host listed by the server administrator in the environment variable `N8N_TRIAL_WEBHOOK_ALLOWED_HOSTS` (comma-separated). This list cannot be edited in Settings;
- resolve only to public addresses. Loopback, private, link-local and cloud-metadata ranges are rejected, as are CGNAT, multicast, documentation ranges, IPv4-mapped IPv6 and NAT64. The connection is pinned to the validated address, so a second DNS lookup cannot redirect it.

Redirects are **never followed**; a 3xx response is reported as *Redirect blocked*.

**Transport.** Trials use Node's `https` module directly, not `fetch`:
- The resolved, validated address is pinned through the request's `lookup` hook, so there is no second DNS lookup.
- TLS verification stays **on**. The certificate is checked against the system CA store, and its host name is checked against the configured host, which is also sent as SNI and as the `Host` header.
- Every request uses a fresh connection (no connection pooling).
- The automated tests use a real certificate to check that SNI, the certificate host name and self-signed rejection all behave this way.

**Confirmation binding.** The confirmation dialog carries a fingerprint of the exact request body and the trial configuration. If the post (for example its schedule) or the trial destination changes before **Run Trial**, the trial is refused and nothing is sent.

## F. Reading the result

| Result | Meaning |
|---|---|
| HTTP accepted | n8n returned 2xx. This does **not** show that the workflow completed or that anything was published. |
| HTTP rejected | n8n returned 4xx/5xx. A 404 on a Test URL usually means nobody clicked *Listen for test event* (or 120 s passed), but it can also mean a wrong path or an inactive workflow. 401/403: authentication or IP allowlist. 429: rate limited. |
| Redirect blocked | The webhook answered with a redirect; nothing was followed. |
| Request timed out | No response within 30 s. **n8n may still have received and processed the request.** |
| Network failure | DNS or connection failure. It is unknown whether n8n received anything. |
| Response truncated | The response exceeded 64 KB. Reading stopped at the limit; the request itself was delivered. |

With n8n's default *Respond: Immediately*, the response is `"Workflow got started"`, which says nothing about how the workflow finished. Use a *Respond to Webhook* node for meaningful diagnostics.

The result panel shows the exact request body sent, n8n's response as plain text (HTML is never rendered), a correlation ID and the timing. It also offers **Copy Request**, **Copy Response** and **Download Diagnostic JSON**. Results are kept only while the modal is open; nothing is stored in the database.

## G. Payload-only trials

If a post's media has no public URL yet (it was never uploaded to the public media server), n8n cannot fetch it. The confirmation then lists the affected fields and offers a **payload-only trial**:

- The payload is sent unchanged, including those media URLs.
- Nothing is uploaded or rewritten.
- The result is labelled **"Payload-only trial — media not verified."**

A trial is **blocked** (nothing is sent) if the payload contains a value that must not leave the server. That means a private filesystem path, a `file://` URL, a URL with embedded credentials, or a known server credential. The affected fields are listed.

## H. Deployment requirements

- No database migration and no new environment variables are required. Existing installations behave exactly as before until an administrator saves a trial URL.
- The trial host must be the production n8n webhook host, **or** be listed in `N8N_TRIAL_WEBHOOK_ALLOWED_HOSTS` on the server (comma-separated host names, exact match). Changing this variable requires a restart.
- The Content Studio server needs outbound HTTPS (port 443, or the URL's port) to that host. The host must resolve to public addresses only.
- `N8N_TRIAL_WEBHOOK_TEST_POLICY` is for automated tests only. It has no effect when `NODE_ENV=production` (the case for `next start`), and it must not be set in deployed environments.

## I. Security limitations

- Duplicate-trial protection is **per server process**. Two trials for the same post at the same time are refused; it does not coordinate across several app instances.
- An n8n Test URL is not a sandbox; see the warning at the top.
- Trial results are not stored. There is no trial history.

## J. Troubleshooting

- **"Trial webhook is not configured"**: an administrator must set it in Settings → n8n Webhooks.
- **"…same as a production webhook"**: use the `/webhook-test/` URL or a separate diagnostic workflow.
- **"…not an approved n8n host"**: use the production n8n host, or ask the server administrator to add the host to `N8N_TRIAL_WEBHOOK_ALLOWED_HOSTS`.
- **"…resolves to a private, local or reserved network address"**: the host is internal; trials can only reach public addresses.
- **404 on a Test URL**: click *Listen for test event* in n8n and run the trial within about 120 seconds.
- **401/403**: check the header name/secret and the IP allowlist.
- **"…changed since this trial was confirmed"**: the post or the trial settings changed; open the confirmation again.
- **"…Re-enter the header secret"**: the trial host changed; enter the secret again (or remove it) when saving.
