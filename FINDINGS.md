# Findings

Observations from building against Radware Agentic AI Protection, offered as
feedback. Everything here is verifiable from public sources; nothing depends on
tenant data. Severity is stated plainly, including where it is low.

Sources: *Radware Agentic AI Protection User Guide 26.03.1*, *n8n Radware
Agentic AI Protection Integration Guide v0.3.1*, the public npm registry, and
`github.com/Radware/n8n-nodes-radware-agentic-protection`. Checked 2026-08-26.

---

## 1. The install screenshot shows a deprecated package name

**Severity: low. Documentation defect.**

The Integration Guide's install section names the scoped package in prose:

> `@radware/n8n-nodes-radware-agentic-protection`

Figure 5, directly beneath it, shows the Community Nodes dialog with the
**unscoped** name typed into the field: `n8n-nodes-radware-agentic-protection`.

These are two different packages.

| | scoped | unscoped |
| --- | --- | --- |
| Latest | 0.3.2 (2026-08-04) | 0.2.3 (2026-07-02) |
| Publisher | the Radware npm org account | a personal npm account |
| Repository | `github.com/Radware/...` | a personal fork namespace |
| Status | current | every version deprecated |

**This is not a supply-chain exposure, and it would be wrong to describe it as
one.** Radware's npm hygiene here is correct: all seven unscoped versions carry
a deprecation notice reading *"This package has moved to
@radware/n8n-nodes-radware-agentic-protection. Install the official Radware
package instead."* The name is held, not abandoned.

The residual problem is narrower. A customer who follows the picture rather than
the sentence installs 0.2.3 instead of 0.3.2, two minor versions behind, and
whether they notice depends on how prominently n8n's install dialog surfaces an
npm deprecation notice. They then validate against an older node and report
results the vendor cannot reproduce.

**Suggested fix:** retake Figure 5 with the scoped name in the field.

## 2. The guide pins a version that is no longer current

**Severity: low.**

The Integration Guide header says *"Package:
@radware/n8n-nodes-radware-agentic-protection@0.3.1"* and the body says
*"currently validated at version 0.3.1"*. npm latest is 0.3.2, published
2026-08-04.

Separately, 0.3.0 is deprecated on npm with *"does not pass the n8n package
scanner metadata check"*, so the usable range is 0.3.1 and up. A customer
installing "latest" from the UI gets 0.3.2 while reading documentation validated
against 0.3.1.

**Suggested fix:** state a minimum supported version rather than an exact one,
or refresh the pin with each release.

## 3. A future n8n default will silently uninstall the package

**Severity: medium. Worth acting on before it lands.**

n8n 2.36.7 emits this on startup:

> `N8N_UNVERIFIED_PACKAGES_ENABLED` -> The default for this variable will change
> to `false` in a future version. Set it to `true` explicitly to keep installing
> unverified community packages.

`@radware/n8n-nodes-radware-agentic-protection` is not in n8n's verified
registry today. When that default flips, a customer who upgrades n8n on a
routine cadence, and who has not set the variable, loses the Radware node. In an
in-path deployment the protected agent has no model endpoint at that point, so
the failure is loud rather than silent, which is the good case. The bad case is
a customer who reacts by reattaching a direct provider model to get the workflow
running again, which removes the protection while restoring the function.

Radware's own internal validation report already lists n8n Creator Portal
submission as pending. This is the reason to prioritise it.

**Suggested fix:** pursue verification, and in the interim document
`N8N_UNVERIFIED_PACKAGES_ENABLED=true` in the installation section. This repo
sets it explicitly in `deploy/docker-compose.yml`.

## 4. The tool-workflow reselect step can be automated away

**Severity: informational.**

The Integration Guide's import steps say:

> If n8n marks the referenced workflow as unresolved, reselect the imported tool
> workflow by name.

This is unavoidable for a file import: a tool-workflow node references its
target by database id, and those ids do not exist until the target has been
created. It is avoidable through the API. Importing in dependency order and
rewriting each reference from its `cachedResultName` to the freshly created id
removes the manual step entirely.

`scripts/import-workflows.mjs` in this repo does that, and also attaches the
Radware credentials by node type. Radware is welcome to it under MIT.

## 5. Validating fail-close needs an allow-path control

**Severity: informational. Methodology.**

Radware's validation report records `fail_close_unavailable_simulation` and
`fail_open_unavailable_simulation` as connector failure-mode checks. Building
the equivalent here surfaced a trap worth writing down.

While developing the out-of-path guard, every check reported the expected
result: fail-close blocked, fail-open allowed. All of it was wrong. This
machine's firewall drops container-to-host traffic, so n8n could not reach the
mock protection service at all. Every request timed out. A guard that is
correctly failing closed and a guard whose protection service is entirely
unreachable produce identical evidence.

The only check that distinguished them was the allow case, which failed: a
verdict of "allowed" cannot be produced by a fail-close default. The block
results looked green throughout.

**Suggested addition to the validation guidance:** a fail-mode result is only
meaningful when the same run also demonstrates a positive allow decision
attributed to the service. This repo's guard records `decidedBy` as `radware`,
`failOpen`, or `failClose` for exactly this reason, so evidence cannot credit a
fail-close as a protection decision.

## 6. The out-of-path node exists but is not shipped

**Severity: informational. Observation, not a defect.**

`docs/validation.md` states:

> Out-of-path explicit guard nodes are not part of the public n8n package
> because they cannot provide full one-go AI Agent protection in n8n.

The reasoning is sound: an n8n community node cannot intercept every tool an AI
Agent might call. But `reports/2026-06-01-validation-report.md` records a full
out-of-path matrix at v0.1.0 "using the explicit Radware agentic API payload
used by the n8n guard node", so the capability was built and validated before
being withheld.

The gap between "cannot cover everything" and "ships nothing" is where this
repo's contribution sits. See `docs/out-of-path.md` for the pattern and its
honest limits.

## 7. An unrecognised API key is reported as HTTP 500

**Severity: medium. Every client in the path misreports it.**

Sending a key the service does not recognise returns:

```
HTTP/1.1 500 Internal Server Error
{"message":"radware key not found: sk-rdwr-..."}
```

This is an authentication failure. The correct status is `401 Unauthorized`,
and `500` is reserved for the server having failed at something that is not the
caller's doing. Reproduced on `/v1/openai/models`,
`/v1/openai/chat/completions`, and `/llmp/digester/agentic-api`; all three
behave the same way.

The consequence is not cosmetic. n8n's credential test surfaces the status, so a
customer with a mistyped or stale key sees:

> Couldn't connect with these settings
> **Internal Server Error**

That sentence points at Radware having an outage. It sends the customer to check
their network, their proxy, and their egress rules, when the actual problem is a
key they can fix in thirty seconds. We lost time to exactly this before testing
the endpoint directly with a deliberately invalid key and seeing the real message
underneath.

Two further notes:

- The response **echoes the submitted key back in the error body**. That key then
  lands in whatever logs sit between the client and the service. Even an invalid
  key is a credential-shaped secret, and a mistyped one is usually one character
  away from a valid one. Returning it is not necessary to explain the failure.
- `GET /v1/<provider>/models` returns the same 500 for an unrecognised key. Since
  the n8n credential test targets `/models`, that endpoint's behaviour determines
  whether a correct credential can be confirmed in the UI at all.

**Suggested fix:** return `401` with a body that names the problem and does not
echo the key, for example `{"message":"API key not recognised"}`.

`scripts/check-radware-key.mjs` in this repo tests a key against all three
endpoints and translates the 500 back into a plain answer. It reads the key from
stdin or the environment rather than argv, and redacts it from output.

## 8. An in-path agent with no provider key fails as if it were the customer's fault

**Severity: medium. Sends the customer to the wrong system entirely.**

An in-path homegrown agent proxies to an upstream provider using a provider API
key supplied in the portal. When that field is empty, the agent still
authenticates the Radware key correctly, then calls the provider with an empty
credential. What the customer sees is the provider's error relayed verbatim:

```
GET /v1/openai/models
HTTP 401
{"error":{"message":"Incorrect API key provided: ''. You can find your API key
 at https://platform.openai.com/account/api-keys.", ...}}
```

Note the empty string. Radware knows the provider key is blank at the moment it
builds that request, and could say so.

Instead the message names OpenAI, links to OpenAI's dashboard, and describes an
"Incorrect API key". A customer reading that goes to check their OpenAI account,
which is not where the problem is and may not be a system they have. The
misdirection is complete: correct Radware key, correct base URL, correct
provider segment, correct network, and an error that mentions none of them.

Compounding it, the two failure modes are hard to tell apart from the n8n UI,
because n8n renders both as a red box:

| Cause | Actual response |
| --- | --- |
| Radware key wrong | `500` `{"message":"radware key not found: ..."}` |
| Provider key missing in the portal | `401` provider error naming OpenAI |

Finding 7 covers why the first is a 500. Together they mean a customer whose
in-path credential test fails cannot tell from n8n whether the problem is their
Radware key, their portal configuration, or a Radware outage. Those have three
different owners.

**Suggested fix:** when the configured provider key is absent, fail before
calling the provider and return something attributable, for example
`400 {"message":"No upstream provider API key is configured for this homegrown
agent. Set Custom Provider and API Key in the Agentic AI Protection portal."}`.

**Suggested addition to the Integration Guide:** the in-path section should
state plainly that in-path requires the customer's own provider API key entered
in the portal, and that out-of-path does not. That difference is currently
visible only in a screenshot of the creation form.

## 9. Out-of-path decision latency spans three orders of magnitude

**Severity: high for anyone deploying it in line. This is the finding that most
affects how the product can be used.**

Measured against `POST /llmp/digester/agentic-api` on one tenant, from one host,
over roughly thirty minutes:

| Call | Observed |
| --- | --- |
| Prompt only, no tools advertised | 165 ms, 330 ms |
| Tool call, no retrieved context | 1.6 s, 2.3 s, 3.0 s, 7.1 s |
| Tool call, retrieved context | 3.6 s, 4.8 s, 9.2 s, 13.9 s, 20.4 s |
| Guardrail prompts | 18.7 s, 20.6 s, 23.7 s, 25.3 s, 35.6 s |
| Benign send, single tool advertised | **71.5 s** |

Same endpoint, same key, same tenant. The 71.5-second call and the 2.3-second
call carried near-identical payloads.

This is not a complaint about speed. Content inspection is expected to cost
more than a rule lookup. The problem is the **spread**, because an out-of-path
guard is synchronous and must choose a timeout:

- Pick a responsive timeout and the guard fails closed on healthy traffic. At
  5 s, our first live run produced six blocks and zero Radware decisions. Under
  a fail-close policy those are indistinguishable from real blocks, which is
  exactly the trap in finding 5.
- Pick a safe timeout and every guarded tool call may stall the agent for over a
  minute, and n8n's own task runner default is being reduced to 60 s.

There is no value that is both. We settled on 60 s and treat the fail mode as
the real control, but that is a compromise, not a solution.

**Suggested fixes, in order of usefulness:**

1. **Publish a latency SLO** for the endpoint, even a loose one. Integrators
   cannot choose a timeout without it, and are currently choosing by guessing.
2. **Return a decision id immediately and allow polling**, so a slow inspection
   does not have to be an open socket.
3. **Document the p50 and p99** in the User Guide's out-of-path section next to
   the failopen/failclose choice, since those two settings are the only lever a
   customer has and their consequences depend entirely on this distribution.

## 10. A benign action is blocked whenever tools are advertised

**Severity: medium, and I would like to be told I am wrong about this.**

Reproduced on this tenant. Identical benign tool call throughout: reply to the
sender of an innocuous support email, confirming a ticket was closed. No
sensitive data, no external recipient, no injected content anywhere in the
payload. The only variable is `ToolsInput`.

| `ToolsInput` | Result | n |
| --- | --- | --- |
| `[]` | **allowed** | 3 of 3 |
| `[send_email]` | blocked | 1 of 1 |
| `[read_email, send_email]` | blocked | 2 of 2 |

Event IDs for the blocks: `ZACH-Agent-1787767167-0af00y`,
`ZACH-Agent-1787767185-csfn9a`, `ZACH-Agent-1787767261-fbicde`.

The tension is with Radware's own guidance. `docs/validation.md` says:

> Do not validate Behavioral with only the outbound action tool in the `tools`
> array; the full tool context is needed to reproduce the intended agent
> behavior.

That is sound advice, and following it appears to be what flips this benign
action from allow to block. An integrator who omits `ToolsInput` gets clean
allows and weakened detection; one who includes it, as instructed, gets blocks
on ordinary traffic.

**Caveats, stated because they matter:** this is one tenant, with Behavior Data
Leakage Prevention set to Block and Report and no custom guardrail template
attached. Small sample. It is entirely possible this is the configured policy
behaving exactly as designed, and that a tuned template resolves it.

**What would settle it:** confirmation of whether advertised-tool presence is
intended to weigh toward blocking independently of the action's content, and if
so, a note in the validation guidance so integrators expect it. If it is not
intended, the three Event IDs above should be enough to trace.
