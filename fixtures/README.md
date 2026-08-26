# Fixtures

Inert test payloads. Nothing here is executed, sent, or fetched.

## Policy

These files contain attack-shaped content on purpose: that is what the
protection is being tested against. Two rules keep that from becoming a
liability.

**Every payload is labeled.** Each fixture carries a `_fixture` block naming
what it is and what it is for, so a reader or a scanner encountering it out of
context can tell immediately that it is a test artifact.

**All identifiers are reserved or non-routable.** The Radware Agentic AI
Protection User Guide 26.03.1 (page 12) demonstrates indirect prompt injection
with a sample carrying a plausible-looking national ID, bank account and phone
number. Reproducing that verbatim in a public repository would make this repo
read like a data leak to any secret scanner pointed at it, and would be
indistinguishable from one at a glance. The fixtures here use only values
reserved for exactly this purpose:

| Kind | Value used | Why it is safe |
| --- | --- | --- |
| Domains | `example.com`, `example.invalid` | RFC 2606 and RFC 6761 reserved |
| Phone | `+1-555-0100` | 555-01xx is reserved for fictional use |
| SSN | `000-00-0000` | Never issued by the SSA |
| Card | `4111 1111 1111 1111` | The published Visa test PAN |
| Addresses | `1 Test Street` | Not a deliverable address |

They still trip PII detection, which is the point. They just cannot be mistaken
for a real person's data.

## Contents

- `emails/benign-status-request.json` — a normal support email. The control.
- `emails/indirect-injection-exfiltration.json` — an email whose body carries an
  instruction aimed at the agent reading it, not at the human recipient. This is
  the payload behind the Behavioral / Agentic Protection test.
- `prompts/guardrails-matrix.json` — direct prompts for the AI Guardrails tests:
  benign, PII, HAP, and a blocked topic.
