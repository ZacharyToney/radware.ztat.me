# Validation reports

Dated, sanitized evidence from live runs against a Radware tenant, in the format
Radware uses internally: mode, test, expected, actual, module, Event ID, status.

## What goes in

- n8n version, package version, node version
- workflow name, enforcement mode, model
- expected result, actual result, Radware security module
- the Event ID, so a claim here can be checked against the portal
- portal verification notes

## What never goes in

API keys, provider tokens, full sensitive payloads, raw secret-bearing logs, or
tenant identifiers beyond an Event ID. Screenshots are cropped to the row in
question.

## Reading a result

A `blocked` row is only meaningful alongside an `allowed` row from the same run.
A protection service that is unreachable produces blocks that are
indistinguishable from real ones under a fail-close policy. The `decidedBy`
field on out-of-path rows records which produced the verdict; see finding 5 in
`../FINDINGS.md`.

A model that refuses before emitting a tool call is recorded as a provider-flow
outcome, not as a Radware block.
