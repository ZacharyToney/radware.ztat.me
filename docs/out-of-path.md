# Out-of-path enforcement in n8n

## The problem, stated honestly

Radware's documentation is right about the constraint:

> n8n community nodes cannot globally intercept every AI Agent tool, built-in
> node, or workflow action before execution. An out-of-path guard node would
> protect only workflow branches that a customer manually routes through that
> node.

There is no node you can drop onto a canvas that makes an AI Agent's every tool
call pass through Radware first. n8n does not expose that seam.

## What is achievable

The seam that does exist is the tool boundary. When an AI Agent calls a tool
backed by a sub-workflow, the agent controls *whether* the tool runs; it does
not control *what happens inside it*. That interior is deterministic workflow,
and the model cannot route around it.

```
AI Agent ──tool──▶ Call n8n Workflow Tool
                        │
                        ▼
                   Execute Workflow Trigger
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

So the honest claim is not "full coverage". It is: **for every tool you wire
this way, the check happens on a path the model cannot influence.** Coverage is
a property of how many tools you wire, not of the node.

That is weaker than a transparent interceptor and stronger than nothing. It
also has a property in-path enforcement does not: it evaluates the *action*,
with its concrete arguments, at the moment before it happens.

## Why not both

They are not alternatives. This repo runs both because they fail differently.

| | In-path | Out-of-path guard |
| --- | --- | --- |
| Sees | the whole model exchange | one tool call and its arguments |
| Enforces at | the model endpoint | immediately before the action |
| Coverage | every model call on the protected path, automatically | only tools deliberately wired through it |
| Fails when | the model call is fine but the action is not | a tool is added and nobody wires the guard |

A model exchange that looks acceptable can still end in an action that is not,
and a tool can be invoked through a path the model endpoint never sees. Running
both means neither gap is the only thing standing between an injection and an
outbound send.

## The node

`Radware Guard` takes one tool call and returns a verdict.

**Inputs** map to the documented out-of-path body: `ToolName`, `ArgsInput`,
`UserPrompt`, `UserIdentifier`, `UserContext`, `ToolsInput`, `ModelToUse`. The
API key comes from the credential and is never a node parameter.

**Outputs** are two: `Allowed` and `Blocked`. Branching is structural rather
than a boolean somebody has to remember to test.

**Every item carries `json.radware`:**

```json
{
  "toolName": "send_email",
  "isBlocked": true,
  "eventId": "Sean-Out-of-Path-Connector-Test-1780314379-icrw9m",
  "decidedBy": "radware"
}
```

`decidedBy` is the field that matters for evidence. It is `radware` only when
the service returned a usable verdict. A block produced by the fail mode reports
`failClose` and carries a `reason`. Validation evidence therefore cannot credit
an unreachable protection service as a protection decision. See finding 5 in
`FINDINGS.md` for why that is not hypothetical.

## Getting the inputs right

Two mistakes make the guard look like it does not work.

**Omitting `UserContext`.** The retrieved content that motivated the tool call
has to be passed through. Asking Radware to judge an outbound send without
showing it the email that asked for the send is asking a different question, and
the answer will usually be "allow".

**Sending only the guarded tool in `ToolsInput`.** Radware's own validation
guide is explicit: behavioural detection needs the full advertised tool set. A
send in isolation is ordinary. A send that follows a read, in a session where
both were available, is the shape of exfiltration.

## Fail mode, and why it carries more weight than it should

Set per node, not per credential, because it is a per-tool decision.

- `failClose` (default): no verdict means no action. Correct for anything
  outbound, destructive, or irreversible.
- `failOpen`: no verdict means proceed. Defensible for a read whose blast
  radius is a stale answer.

Choosing this per tool is the whole reason it is a node parameter rather than a
credential setting: it is visible on the canvas, where a reviewer can see it.

**The latency measurements make this setting more load-bearing than it looks.**
The same call to the protection service has been observed taking 165 ms and
71 seconds on this tenant, minutes apart, with near-identical payloads. Full
numbers in finding 9.

There is no timeout that is both responsive and safe against that spread, so the
timeout stops being a tuning knob and becomes a coin flip whose outcome the fail
mode decides. Practical consequences:

- The default timeout is 60 seconds. That is not "we measured p99 and added
  headroom", it is "we could not find a defensible smaller number".
- A guarded tool can stall an agent for a minute. On a chat-facing agent that is
  a visible hang, and n8n's own task runner timeout default is moving to 60
  seconds, so a long check can outlive the task running it.
- `failClose` on a slow service silently converts availability problems into
  blocks. Always read `decidedBy` before treating a block as protection.

If you are wiring this in front of a high-traffic or latency-sensitive tool,
measure against your own tenant first, and consider whether `failOpen` plus
alerting is more honest than a fail-close that fires on timeouts more often than
on threats. That is a real trade-off and it should be made deliberately.

## What this node deliberately does not do

**It is not exposed as an AI Agent tool.** `usableAsTool` is omitted on purpose.
An agent that can call its own enforcement point can be steered into calling it
with sanitised arguments, reading the verdict, and acting anyway. The guard
belongs on the deterministic path, where the model cannot reach it.

**It does not sanitise tool output.** Stripping injection markers on the way
through would make the fixtures pass and prove nothing. The point is that
untrusted content reaches the model intact and that Radware is what stops the
unsafe action.

**It is not published to npm.** See `README.md` for the reasoning.
