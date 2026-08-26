# Radware portal setup

What to create at https://console.radwarecloud.com before any of this runs.
Follows the *Radware Agentic AI Protection User Guide 26.03.1*, chapter 1.

## One key may cover both modes

Integration Options is a radio button: **Out-of-Path Enforcement** *or* **In-Path
Enforcement**. That choice governs how the agent is configured. It does not
necessarily scope the API key.

Measured on this tenant, with one key: the same key was accepted by
`POST /llmp/digester/agentic-api` **and** recognised by the in-path proxy at
`/v1/openai/*`. So do not assume you need a second homegrown agent before
testing. Check first:

```bash
RADWARE_API_KEY='sk-rdwr-...' pnpm check:key
```

That is one key on one tenant, not a documented guarantee. If the out-of-path
endpoint rejects your key with `radware key not found`, create a second
homegrown agent in Out-of-Path mode and use its key.

## In-path also needs a provider key, and the error will not say so

An in-path homegrown agent proxies to an upstream provider **using a provider
API key you supply in the portal**. Radware does not bring its own. If that
field is empty, the agent still authenticates your Radware key correctly and
then calls the provider with nothing, and what comes back is the provider's own
error relayed through Radware:

```
HTTP 401  {"error":{"message":"Incorrect API key provided: ''", ...
           "You can find your API key at https://platform.openai.com/..."}}
```

That message names OpenAI and points at your OpenAI account, so it reads as a
problem with a key you may not even have. The actual fix is in the Radware
portal: open the homegrown agent, set **Custom Provider**, and paste a provider
API key. See finding 8 in `FINDINGS.md`.

Out-of-path needs no provider key, because it returns a decision rather than
proxying a model call. That makes it the faster of the two to get working.

## Agent 1: in-path

1. Agentic AI Protection → **+** → Add Homegrown Agent.
2. Integration Options: **In-Path Enforcement**.
3. Name it for the environment, for example `n8n-inpath-lab`.
4. Save. Copy the API key. **You can copy it once.**
5. Custom Provider: OpenAI. Provider API Key: your own provider key. Radware
   proxies to the provider using this, which is why n8n never needs one.
6. Behavior Data Leakage Prevention: **Block and Report**.
7. AI Guardrails: attach the template below.
8. Create.

Goes into the n8n credential **Radware In-Path API**, provider `openai`. Leave
Resolved Base URL empty; it defaults to
`https://api.agentic.radwarecto.com/v1/openai`.

## Agent 2: out-of-path

Same flow, but Integration Options: **Out-of-Path Enforcement**, named
`n8n-outofpath-lab`. Copy that key into **Radware Out-of-Path API**.

Out-of-path has no Custom Provider field: Radware evaluates the request and
returns a decision rather than proxying a model call.

## Guardrail template

Create under AI Guardrails → **+** → AI Agent. The expectations in
`fixtures/prompts/guardrails-matrix.json` assume this configuration.

| Category | Setting | Drives |
| --- | --- | --- |
| Input & Prompt Security | Prompt Injection: **Report Only** | Leaves injection detection visible without pre-empting the behavioural test |
| Data Security & Privacy | PII Detected: **Block and Report**, with Credit Card Number and SSN | `guardrails_credit_card_pii` |
| Content Safety | HAPBlocker: **Block and Report** | `guardrails_hapblocker` |
| Content Safety | Blocked topics, except-for: medical advice | `guardrails_blocked_topic` |
| System Usage | Token Limit: **Report Only** | Cost visibility on a public endpoint |

Prompt Injection is Report Only on purpose. Set to block, it stops the injected
email at the guardrail layer and the behavioural test never gets the chance to
demonstrate that Radware blocks the *tool call*, which is the more interesting
result. Switch it to Block and Report afterwards; both outcomes are worth
recording.

Assign the template to both homegrown agents.

## Enable logs

Logs → toggle **Enable Logs**. Off by default, and without it there is no record
to cross-reference an Event ID against.

## Collecting evidence

After each validation run, Security Events → filter to the agent → open Details
on each block. Record the Event ID, security module, and OWASP category into
`reports/`. Crop screenshots to the row.

Do not export raw request bodies: they contain the fixture payloads and, on a
real tenant, would contain real prompts.
