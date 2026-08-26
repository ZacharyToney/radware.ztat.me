# Radware portal setup

What to create at https://console.radwarecloud.com before any of this runs.
Follows the *Radware Agentic AI Protection User Guide 26.03.1*, chapter 1.

## Two agents, not one

Integration Options is a radio button: **Out-of-Path Enforcement** *or* **In-Path
Enforcement**. One homegrown agent is one mode. This lab uses both, so it needs
two homegrown agents and two API keys.

This is easy to miss. An in-path key starting `sk-rdwr-` authenticates against
`https://api.agentic.radwarecto.com/v1/<provider>`; it is not a given that the
same key authorises `POST /llmp/digester/agentic-api`. If the out-of-path guard
returns a fail-mode decision with an HTTP 401 reason, this is why.

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
