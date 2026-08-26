#!/usr/bin/env node
/**
 * Import the lab workflows into a running n8n and wire up the references that
 * a plain file import cannot resolve.
 *
 * A tool-workflow node points at another workflow by database id. Those ids do
 * not exist until the referenced workflow has been created, so importing the
 * JSON by hand leaves every tool unresolved. The vendor guide handles this by
 * asking the customer to reopen each tool node and reselect the workflow by
 * name. This does it in one pass instead:
 *
 *   1. create or update every workflow, tools first
 *   2. rewrite each tool reference from its cachedResultName to the real id
 *   3. attach the Radware credentials by name, if they already exist
 *
 * Credentials themselves are never created here. They hold the API keys, and
 * those belong in the encrypted store via the UI, not in a script's argv.
 *
 *   pnpm import:workflows
 *   N8N_URL=https://radware.ztat.me pnpm import:workflows
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { N8nClient, loadEnv } from './lib/n8n-client.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const env = { ...loadEnv(), ...process.env };

const baseUrl = env.N8N_URL || 'http://127.0.0.1:5678';
const email = env.N8N_EMAIL || env.N8N_INSTANCE_OWNER_EMAIL;
const password = env.N8N_PASSWORD;

if (!email || !password) {
	console.error(
		'Set N8N_PASSWORD (and N8N_EMAIL if it differs from N8N_INSTANCE_OWNER_EMAIL in deploy/.env).',
	);
	process.exit(1);
}

/** Credential display name -> credential type, for automatic attachment. */
const CREDENTIAL_TYPES = {
	radwareInPathApi: '@radware/n8n-nodes-radware-agentic-protection.radwareChatModel',
	radwareOutOfPathApi: 'CUSTOM.radwareGuard',
};

const client = await new N8nClient({ baseUrl, email, password }).login();
console.log(`connected to ${baseUrl} as ${email}`);

const existingWorkflows = new Map(
	(await client.listWorkflows()).map((w) => [w.name, w.id]),
);

// Credentials are matched by type, not by name, so whatever the user called
// theirs in the UI still gets picked up. If two exist for one type we do not
// guess: leave it unattached and say so.
const credentialsByType = new Map();
const ambiguous = new Set();
for (const cred of await client.listCredentials()) {
	if (!(cred.type in CREDENTIAL_TYPES)) continue;
	if (credentialsByType.has(cred.type)) ambiguous.add(cred.type);
	credentialsByType.set(cred.type, cred);
}

const files = readdirSync(join(root, 'workflows'))
	.filter((f) => f.endsWith('.json'))
	.sort(); // 00- and 01- and 02- tools precede the 1x- labs that reference them

const nameToId = new Map(existingWorkflows);
const summary = [];

for (const file of files) {
	const wf = JSON.parse(readFileSync(join(root, 'workflows', file), 'utf8'));
	let resolved = 0;
	let unresolved = [];
	let attached = 0;

	for (const node of wf.nodes) {
		// 1. tool-workflow references
		const ref = node.parameters?.workflowId;
		if (ref && typeof ref === 'object' && ref.cachedResultName) {
			const id = nameToId.get(ref.cachedResultName);
			if (id) {
				ref.value = id;
				resolved += 1;
			} else {
				unresolved.push(ref.cachedResultName);
			}
		}

		// 2. credentials, by node type
		for (const [credType, nodeType] of Object.entries(CREDENTIAL_TYPES)) {
			if (node.type !== nodeType) continue;
			if (ambiguous.has(credType)) continue;
			const cred = credentialsByType.get(credType);
			if (!cred) continue;
			node.credentials = { ...(node.credentials ?? {}), [credType]: { id: cred.id, name: cred.name } };
			attached += 1;
		}
	}

	const payload = {
		name: wf.name,
		nodes: wf.nodes,
		connections: wf.connections,
		settings: wf.settings ?? { executionOrder: 'v1' },
	};

	const existingId = existingWorkflows.get(wf.name);
	const saved = existingId
		? await client.updateWorkflow(existingId, payload)
		: await client.createWorkflow(payload);

	const id = (saved.data ?? saved).id;
	nameToId.set(wf.name, id);
	summary.push({ file, name: wf.name, id, resolved, attached, unresolved });
}

console.log('');
for (const s of summary) {
	const bits = [];
	if (s.resolved) bits.push(`${s.resolved} tool ref(s) resolved`);
	if (s.attached) bits.push(`${s.attached} credential(s) attached`);
	if (s.unresolved.length) bits.push(`UNRESOLVED: ${s.unresolved.join(', ')}`);
	console.log(`  ${s.name}\n      id=${s.id}${bits.length ? `  (${bits.join('; ')})` : ''}`);
}

const missingCreds = Object.keys(CREDENTIAL_TYPES).filter((t) => !credentialsByType.has(t));
if (missingCreds.length) {
	console.log(`\nNot yet created in n8n, so nothing was attached for: ${missingCreds.join(', ')}`);
	console.log('Create them in the UI under Credentials, then re-run this to attach them.');
}
for (const t of ambiguous) {
	console.log(`\nMore than one credential of type ${t} exists. Left unattached rather than guessed.`);
}

console.log('\nWorkflows are imported inactive. Activate the chat agent in the UI when ready.');
