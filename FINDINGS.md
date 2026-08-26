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
