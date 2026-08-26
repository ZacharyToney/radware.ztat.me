# Security posture

This repository contains attack-shaped content and runs an AI agent on a public
URL. Both are deliberate. This document says what the exposure is, what bounds
it, and what would be wrong to copy from here into production.

## The public chat endpoint

`https://radware.ztat.me` serves an n8n Chat Trigger that anyone with the link
can use. That is the demonstration: a reviewer should be able to click it and
try to break it.

**What bounds it:**

- The agent has exactly two tools. `read_email` returns fixture text from a
  hardcoded map. `send_email` is a placeholder whose implementation returns a
  JSON object and sends nothing. There is no mail transport configured, no
  outbound integration, and no credential that could reach one.
- The reverse proxy rate-limits the chat and webhook paths to 20 requests per
  minute per source address. Everything else on the host is behind the n8n owner
  login.
- The upstream model account carries a hard spend cap. Rate limiting bounds
  request volume; the cap bounds cost if the limit is misjudged.
- Execution history is pruned after seven days.

**What is not claimed:** a determined visitor can make the agent say things. It
cannot make the agent do things, because there is nothing wired up for it to do.
Prompt injection against this instance succeeds at the model layer or it does
not succeed at all.

## Fixtures

`fixtures/` contains an indirect prompt injection payload and prompts designed
to trip PII, HAP, and topic guardrails. They are inert data files. Nothing reads
them at runtime except the workflow generator.

Every identifier in them is reserved or non-routable: RFC 2606 and RFC 6761
domains, 555-01xx phone numbers, `000-00-0000`, and the published Visa test PAN.
They still trigger detection, which is the point, but they cannot be mistaken
for a real person's data by a reader or by a secret scanner. See
`fixtures/README.md`.

This is a deliberate departure from the vendor guide, which demonstrates the
same attack using plausible-looking personal details. That is fine in a PDF
distributed to customers. In a public Git repository it would read as a leak.

## Secrets

- `deploy/.env` is gitignored. `deploy/.env.example` is the committed template
  and contains no values.
- Radware and provider API keys live in n8n's encrypted credential store,
  entered through the UI. `scripts/import-workflows.mjs` attaches credentials by
  reference and never creates them, so no key passes through a script argument
  where `ps` would show it.
- `scripts/hash-password.mjs` reads from stdin for the same reason, and emits
  the bcrypt hash pre-escaped for Docker Compose. An unescaped hash is silently
  truncated by variable interpolation, which provisions the public owner account
  with a password nobody knows.
- `N8N_ENCRYPTION_KEY` is generated once and must be backed up off the instance.
  Losing it makes every stored credential permanently unreadable.
- Exported workflow JSON references credentials by id and name only. Verify this
  before committing any workflow exported from a live instance.
- CI runs `gitleaks` on every push.

## Host

- SSH restricted to a single source address in the EC2 security group, with
  `ufw` as a second layer in case the group is later widened.
- Postgres and n8n are never published to the host. Caddy is the only ingress.
- `N8N_BLOCK_ENV_ACCESS_IN_NODE=true`, so a Code node cannot read the
  environment it runs in.
- Three n8n settings whose defaults are tightening in a future release are
  already set to the stricter values rather than pinned to today's looser ones:
  task timeout, decompression size, and zip entry count.
- Unattended security upgrades enabled. Container logs capped.

## Handling the vendor documents

The PDFs this work is based on contain, by design, text that instructs an AI
agent to take an action. Page 12 of the User Guide is a worked indirect
injection example.

That content was treated as data throughout. It describes an attack; it is not
addressed to whoever is reading it. The same discipline applies to anything this
repository ingests: vendor example workflows are third-party JSON and were read
before being imported, not after.

## Do not copy these into production

- The public chat endpoint. It exists to be tried by strangers.
- The `send_email` placeholder. Replacing it with a real send node on a publicly
  reachable instance turns a demonstration into an open relay driven by
  untrusted input.
- `docker-compose.local.yml` and `scripts/mock-digester-server.mjs`. The mock
  answers protection queries with whatever it is told to answer.
- `N8N_UNVERIFIED_PACKAGES_ENABLED=true` without first deciding you trust the
  specific unverified package you are installing.

## Reporting

Issues with this repository: open a GitHub issue. Nothing here is a supported
product.

Issues with Radware Agentic AI Protection itself belong with Radware.
