# Radware Agentic AI Protection for n8n: a working lab

A self-hosted n8n instance running Radware Agentic AI Protection in **both**
enforcement modes, with the workflows, the evidence, and a custom node that
fills the gap Radware's own documentation identifies.

**Live:** https://radware.ztat.me
**Built against:** `@radware/n8n-nodes-radware-agentic-protection@0.3.2`, n8n 2.36.7

---

## In sixty seconds

The brief was one line: an API key, and *"Out of path Secure AI agent"*. So
out-of-path is the deliverable here, not a bonus.

That is the harder half of the product. Radware ships an n8n community node, but
it works **in-path**: an AI Agent talks to `Radware Chat Model` instead of to its
provider, so every model call is inspected. Nothing equivalent ships for
out-of-path, and Radware's own docs explain why:

> Out-of-path explicit guard nodes are not part of the public n8n package
> because they cannot provide full one-go AI Agent protection in n8n.

True, and their internal validation report shows they built one anyway before
deciding not to ship it. The reasoning is sound: no n8n community node can
intercept every tool an agent might call.

But it does not have to. **A sensitive tool implemented as a sub-workflow has an
interior the model cannot route around.** Put the check there and you get
deterministic enforcement immediately before the action, for every tool you wire
that way. Coverage becomes a property of how many tools you wire, not a property
the node can promise.

This repo builds that node, runs both modes side by side, and documents where
the pattern stops working.

## The two paths

**In-path**, as Radware specifies it:

```
Chat Trigger ─▶ AI Agent ─▶ Radware Chat Model ─▶ Radware Cloud ─▶ provider
```

Every model call leaves through Radware. Prompt guardrails, response guardrails,
and behavioural protection all see the exchange. No provider model is attached
to the protected agent.

**Out-of-path**, at the tool boundary:

```
AI Agent ──tool──▶ Execute Workflow Trigger
                        │
                        ▼
                   Radware Guard ──── POST /llmp/digester/agentic-api
                        │
              ┌─────────┴─────────┐
              ▼                   ▼
          Allowed              Blocked
              │                   │
              ▼                   ▼
        real action        refusal + Event ID
```

They are not alternatives. A model exchange that looks acceptable can still end
in an action that is not. Running both means neither gap is the only thing
between an injection and an outbound send. Full reasoning in
[`docs/out-of-path.md`](docs/out-of-path.md).

## What is here

```
packages/radware-guard/   the out-of-path guard node, with tests
deploy/                   Caddy + Postgres + n8n, and the EC2 bootstrap
workflows/                six importable n8n workflows, generated from fixtures
fixtures/                 labeled, inert attack payloads
scripts/                  import, verification, and validation tooling
reports/                  dated validation evidence
docs/                     architecture and setup
FINDINGS.md               feedback for Radware
SECURITY.md               threat model and blast radius
```

### The workflows

Numbering reflects priority. `1x` is the deliverable; `9x` is reference material
a reviewer can skip.

| File | What it is |
| --- | --- |
| `00-tool-read-email` | Returns untrusted content. One benign email, one carrying an indirect injection. Nothing is sanitised on the way out; that is the test. |
| `01-tool-send-email-unguarded` | No-op placeholder. Sends nothing, ever. |
| `02-tool-send-email-guarded` | Same placeholder behind `Radware Guard`, fail mode `failClose`. |
| `03-tool-delete-record-unguarded` | Deliberately unguarded. Demonstrates the coverage boundary instead of describing it. |
| **`10-outofpath-guarded-chat-agent`** | **The deliverable.** Live chat agent, provider model direct, Radware called at the tool boundary. |
| `11-outofpath-tool-misuse` | Deterministic validation. Guarded `send_email` beside unguarded `delete_record`, on purpose. |
| `90-reference-inpath-chat-agent` | The vendor's in-path pattern, for comparison. Not the deliverable. |
| `91-reference-inpath-tool-misuse` | In-path behavioural test. Not exercised; see finding 8. |

## Running it

Requires Docker and pnpm.

```bash
cp deploy/.env.example deploy/.env
pnpm hash-password                      # emits the owner hash, Compose-escaped
$EDITOR deploy/.env                     # domain, encryption key, db password, hash

pnpm install
pnpm --filter @ztat/n8n-nodes-radware-guard build

cd deploy
docker compose -f docker-compose.yml -f docker-compose.local.yml up -d
```

n8n comes up on `http://localhost:5678` already provisioned. There is no setup
wizard: the owner account is created from environment variables, and the Radware
package is installed from `N8N_COMMUNITY_PACKAGES` at a pinned version rather
than typed into the UI dialog. That last part is deliberate, and
[finding 1](FINDINGS.md) explains why.

Then create the two Radware credentials in the UI and import:

```bash
N8N_PASSWORD='...' pnpm import:workflows
```

The import resolves every tool-workflow reference and attaches credentials by
node type. Radware's guide asks customers to do that reselect by hand; it is
automatable, and [finding 4](FINDINGS.md) covers it.

For production on EC2, see [`docs/deployment.md`](docs/deployment.md).

## The guard node

`Radware Guard` evaluates one tool call against the out-of-path API and routes
the item to `Allowed` or `Blocked`. Every item carries a `json.radware` block:

```json
{ "toolName": "send_email", "isBlocked": true,
  "eventId": "...", "decidedBy": "radware" }
```

`decidedBy` is `radware` only when the service returned a usable verdict. A
block produced by the fail mode reports `failClose` and a reason. That
distinction is not cosmetic: while building this, every check reported the
expected result while the protection service was completely unreachable,
because a correct fail-close and a dead service produce identical evidence. Only
the allow case tells them apart. [Finding 5](FINDINGS.md) has the full story.

**It is deliberately not exposed as an AI Agent tool.** An agent that can call
its own enforcement point can be steered into calling it with sanitised
arguments, reading the verdict, and acting anyway.

**It is deliberately not published to npm.** The `@radware/` scope is Radware's.
Publishing a `n8n-nodes-radware-*` package from a third-party account would put
it beside the vendor's in the same search results, which is a naming decision
that belongs to Radware and not to me. The node loads from a mounted custom
extensions directory instead, and is compiled into the n8n image at build time,
so it installs and runs identically. If Radware wants it published under a name
they are comfortable with, that is a ten-minute change.

## Verifying the work

Nothing here is asserted without a command that checks it.

```bash
pnpm -r test          # 20 unit tests: both verdicts, every failure shape, redaction
pnpm check:workflows  # committed workflow JSON still matches the fixtures
pnpm verify:guard     # 11 checks driving a real workflow on a real n8n instance
```

`pnpm verify:guard` is the one that matters. Unit tests cannot tell you whether
n8n loads the node, resolves its credential, evaluates expressions, or routes
items to the correct output. It creates a throwaway workflow and credential,
runs them against a mock protection service on the compose network, reads the
execution back, and deletes both.

The guard node's tests also run inside the Docker build, so a failing test
cannot produce a deployable image.

Live validation against a real Radware tenant is in [`reports/`](reports/), in
the same format Radware uses internally: mode, test, expected, actual, module,
Event ID, status.

## Limitations

Stated because a security audience will find them anyway.

- **The out-of-path guard is opt-in per tool.** Wire a new sensitive tool and
  forget the guard, and that tool is unprotected. In-path has no equivalent
  gap, which is the argument for running both.
- **The custom node registers as `CUSTOM.radwareGuard`.** Workflows referencing
  it import cleanly only on an instance that loads it the same way. Publishing
  to npm would fix that, and is not being done for the reason above.
- **Guardrail outcomes depend on the portal policy**, not on this repo. The
  expectations in `fixtures/prompts/guardrails-matrix.json` assume the template
  described in [`docs/portal-setup.md`](docs/portal-setup.md).
- **A model may refuse before emitting a tool call.** That is a provider-flow
  outcome, not a Radware block, and the reports record it as such rather than
  counting it as a pass.
- **`t3.small` is 2 GB.** It runs this comfortably with the configured swap and
  memory limits, and would not run a real workload.
- **Out-of-path decision latency is wildly variable**, measured from 165 ms to
  71 s on one tenant. The guard's timeout default is 60 s as a result, which
  means a guarded tool can stall an agent for a minute. This is the single
  biggest obstacle to using out-of-path enforcement in line, and it is a
  property of the service rather than of this node. See finding 9.

## Feedback for Radware

[`FINDINGS.md`](FINDINGS.md) collects six observations, with severity stated
plainly including where it is low. The most actionable is finding 3: a future
n8n default flip will uninstall the Radware package from customer instances that
have not set `N8N_UNVERIFIED_PACKAGES_ENABLED`.

## License and attribution

MIT. Radware's package, examples, and documentation are MIT and copyright
Radware; this is an independent integration and is not affiliated with or
endorsed by Radware. Radware trademarks and logos are not reproduced here: the
guard node ships its own icon.
