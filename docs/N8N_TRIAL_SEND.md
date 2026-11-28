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
- A plain Trial Send of a saved post changes nothing:
  - no database writes
  - no media uploads
  - no stored `jsonPayload` change
  - no status, date, delivery-mode or error-log change
  - no LinkedIn retention run
  - no delete webhook call

  The only exception is the explicitly confirmed **Upload Media & Run Trial** (section K): it uploads missing media and stores the resulting public URLs.
- A trial never promotes a post to Production, never marks it Published and never updates a production delivery timestamp.
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

- V1.3.56 adds one database migration, `20261128090000_add_published_post_delivery_mode`. It adds two nullable `PublishedPost` columns, `deliveryMode` and `productionDeliveryAttemptedAt`, and one new table, `PublishedPostSubmission` (duplicate-submission receipts). There is no backfill: existing rows stay NULL and keep their existing behaviour. Run `npx prisma migrate deploy` **before** starting V1.3.56. See section L before any rollback.
- No new environment variables are required. Without a trial URL, Trial mode is disabled and Production and Save Only work normally.
- The trial host must be the production n8n webhook host, **or** be listed in `N8N_TRIAL_WEBHOOK_ALLOWED_HOSTS` on the server (comma-separated host names, exact match). Changing this variable requires a restart.
- The Content Studio server needs outbound HTTPS (port 443, or the URL's port) to that host. The host must resolve to public addresses only.
- `N8N_TRIAL_WEBHOOK_TEST_POLICY` is for automated tests only. It has no effect when `NODE_ENV=production` (the case for `next start`), and it must not be set in deployed environments.

## I. Security limitations

- Duplicate-trial protection is **per server process**. Two trials for the same post at the same time are refused; it does not coordinate across several app instances.
- An n8n Test URL is not a sandbox; see the warning at the top.
- Trial results are not stored. There is no trial history.

## K. Publishing mode per post (V1.3.56)

The Instagram and LinkedIn upload forms and both adaptation directions have a **Publishing Mode** selector, between Scheduled Date and Notes. It applies to that one post only, and every new form starts at **Production**.

| Mode | Button | What happens |
|---|---|---|
| Production | Upload Post / Save & Send to n8n | Unchanged behaviour: save, upload media to the public media server, send to the **production** webhook. |
| Trial | Upload & Run Trial / Save & Run Trial | Confirm first, then: save, upload media, send **only** to the trial webhook. Nothing ever goes to production, and there is no fallback. |
| Save Only | Save Post | Save only. No media upload, no webhook. The media stays local until an explicit Send to n8n or Upload Media & Run Trial. |

- **When Trial is unavailable:** if no trial webhook is configured, Trial is disabled and points to Settings → n8n Webhooks. The server refuses Trial requests too; a Trial selection is never silently switched to Production.
- **Confirmation:** the Trial confirmation is bound to the current trial configuration, including the header secret, and to the exact form being submitted, including each file's **content** (SHA-256 computed in the browser and again on the server). Any later change refuses the request (nothing saved), including swapping in a different file with the same name and size. Computing the digest needs a secure connection (HTTPS or localhost); without one, Trial refuses to start and nothing is saved. The configuration is checked again before saving and before the trial is sent. If it changed in between, the response is *"Post saved. Trial not sent because the trial configuration changed."*
- **After a Trial upload:** the saved post's detail opens with the actual trial result: request JSON, n8n response, schedule and correlation ID. If the trial failed after saving, the post is kept; retry with **Trial Send to n8n** on that post. A retry never creates a second post.
- **Delivery mode is stored on the post** (`deliveryMode`) and shown as a small badge on cards, detail modals and Today. It is separate from Status: a Trial post can be a Draft, and an accepted trial is never shown as Published. Older posts show no badge.
- **Edits never auto-send Trial or Save Only posts.** No edit of such a post reaches the production webhook: caption, schedule, notes, status, cover, collaborators, or a no-op save. The edit reports *"Production delivery skipped because this post is in Trial or Save Only mode."* Older posts (no mode) and Production posts behave exactly as before.
- **Promotion:** the explicit **Send to n8n** button asks for confirmation first ("…Sending it to production will enable automatic production delivery on future edits."). Only an HTTP 2xx from n8n switches the post to Production.
  - A failed send leaves the mode unchanged.
  - A timeout or network failure is reported as **uncertain**: n8n may still have received the post. It is never resent automatically.
  - There is no demotion back to Trial or Save Only.
- **Upload Media & Run Trial:** for Trial or Save Only posts whose media is not public yet, the saved-post Trial Send offers this alongside the payload-only trial.
  - It **publishes the files to the existing public media server** (the social post itself is not published) and stores their public URLs.
  - A later production send reuses those URLs instead of uploading again.
  - If the upload fails, no trial is sent.
- **LinkedIn retention** is unchanged and runs before any upload or webhook, in every mode. If it removes the new post, nothing is uploaded or sent.
- **Production delivery attempts:** a production publish request is recorded on the post (`productionDeliveryAttemptedAt`) **immediately before** it is sent, by create, edit, adaptation, manual Send and promotion alike.
  - The record is not proof of delivery: a failed or timed-out request keeps it.
  - If it cannot be recorded, nothing is sent and the response says so.
  - Trials, Save Only, media recovery, previews, cover and collaborator updates never set it.
- **Deleting a post:**
  - Legacy and Production posts: unchanged. Instagram and LinkedIn posts call the production delete webhook before deleting locally.
  - Trial / Save Only posts with **no recorded production attempt** cannot exist in the production workflow, so they are deleted locally (same file cleanup) without the delete webhook.
  - Trial / Save Only posts **with** a recorded attempt keep the normal delete webhook, because a failed or timed-out send may still have reached n8n.
  - LinkedIn retention and the Instagram 21-post cleanup never call the delete webhook, as before.
- **Duplicate submissions (durable):** each opened upload or adaptation form generates one submission ID. A network error never generates a new one; a new post needs a new form.
  - **Scope:** the server scopes the ID to the signed-in user, the owning Brand, the operation and (for adaptation) the source post. It binds it to a SHA-256 digest of every submitted field and file's content.
  - **Receipt:** it records a receipt in the database (`PublishedPostSubmission`, unique key). The receipt holds no caption, payload, credentials or media, only the digest, state, resulting post ID and a small outcome summary. This works across restarts and several app instances.
  - **Same ID, same request:** never a second post and never a second webhook. The answer depends on the receipt:
    - completed → the saved post
    - saved but unfinished → the saved post plus "did not finish, nothing resent"
    - a production attempt recorded but no result → "n8n may have received it, nothing resent"
    - the post was later removed by retention → "no longer kept"; it is never recreated
    - still running → 409 `SUBMISSION_IN_PROGRESS`
  - **Same ID, different request:** 409 `SUBMISSION_ID_REUSED`. A request refused before anything was saved (for example a caption-rule error) can be corrected and resent with the same ID.
  - **Crash safety:**
    - The post and its receipt's *saved* state commit in one short database transaction. Media upload and webhooks run outside it.
    - A reservation abandoned before any post was saved (server crash) is taken over by the same request after 15 minutes.
    - Nothing is ever resent automatically. Content Studio does not claim exactly-once delivery to n8n.
  - **Expiry:** receipts are kept for 30 days and then pruned automatically. An ID older than that would be treated as new; forms always generate fresh IDs.
  - **Older clients:** requests without an ID behave exactly as before.
- **Today:** Trial and Save Only posts keep their schedule and appear on Today with their badge. They never count as production **Overdue** (legacy and Production posts keep the existing rule). Once their scheduled time has passed they show:
  - *"Scheduled time passed — not sent to production"* when no production send was ever attempted
  - *"Scheduled time passed — production send attempted, not confirmed"* when an attempt failed or timed out (n8n may have it)

## L. Rollback warning (V1.3.56)

The `deliveryMode` column is additive: V1.3.55 code runs against the migrated database and ignores the column. That is **schema** compatibility only, **not behavioural safety**. V1.3.55 sends **every** edited post to the production webhook, so after a rollback, editing a Trial or Save Only post would publish it.

V1.3.55 also ignores `productionDeliveryAttemptedAt` and the submission receipts (it has no duplicate protection). It calls the delete webhook for every Instagram and LinkedIn delete, and it never records attempts, so V1.3.56 can no longer trust the column for posts touched by the older code.

Prefer a **controlled forward fix** over a rollback. If an emergency rollback is unavoidable:
1. Disable production webhook transmission first: clear the production publish webhook URL in Settings and in `N8N_PUBLISHED_POST_WEBHOOK_URL`. Edits then fail to send instead of publishing.
2. Identify the affected posts (`deliveryMode IN ('trial','save_only')`) and tell editors not to touch them.
3. Restore transmission only after V1.3.56 or later is back.

Do not delete posts just to make a rollback possible.

## J. Troubleshooting

- **"Trial webhook is not configured"**: an administrator must set it in Settings → n8n Webhooks.
- **"…same as a production webhook"**: use the `/webhook-test/` URL or a separate diagnostic workflow.
- **"…not an approved n8n host"**: use the production n8n host, or ask the server administrator to add the host to `N8N_TRIAL_WEBHOOK_ALLOWED_HOSTS`.
- **"…resolves to a private, local or reserved network address"**: the host is internal; trials can only reach public addresses.
- **404 on a Test URL**: click *Listen for test event* in n8n and run the trial within about 120 seconds.
- **401/403**: check the header name/secret and the IP allowlist.
- **"…changed since this trial was confirmed"**: the post or the trial settings changed; open the confirmation again.
- **"…Re-enter the header secret"**: the trial host changed; enter the secret again (or remove it) when saving.
