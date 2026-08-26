#!/usr/bin/env node
/**
 * Check what a Radware API key is actually accepted for, before wiring it into
 * n8n credentials.
 *
 * Worth having because the API reports an unrecognised key as HTTP 500 with a
 * body of {"message":"radware key not found: <key>"}, not as 401. Every client
 * in that path, n8n's credential test included, surfaces that as "Internal
 * Server Error", which reads like an outage rather than a rejected key and
 * sends you debugging the wrong layer.
 *
 * The key is read from stdin or the environment, never from argv, and is
 * redacted from all output. Nothing here is logged or sent anywhere except to
 * Radware.
 *
 *   RADWARE_API_KEY=sk-rdwr-... node scripts/check-radware-key.mjs
 *   pbpaste | node scripts/check-radware-key.mjs
 */
import { createInterface } from 'node:readline/promises';

const BASE = process.env.RADWARE_BASE_URL || 'https://api.agentic.radwarecto.com';
const PROVIDER = process.env.RADWARE_PROVIDER || 'openai';
const MODEL = process.env.RADWARE_MODEL || 'gpt-4o';

let key = process.env.RADWARE_API_KEY;
if (!key) {
	if (process.stdin.isTTY) {
		const rl = createInterface({ input: process.stdin, output: process.stderr });
		key = await rl.question('Radware API key: ');
		rl.close();
	} else {
		key = (await new Promise((r) => {
			let d = '';
			process.stdin.on('data', (c) => (d += c));
			process.stdin.on('end', () => r(d));
		})).trim();
	}
}
key = (key ?? '').trim();

if (!key) {
	console.error('No key provided.');
	process.exit(1);
}

const redact = (t) => (key.length >= 8 ? t.split(key).join('<key>') : t);
const shown = `${key.slice(0, 11)}...${key.slice(-4)} (${key.length} chars)`;

console.log(`Testing ${shown}`);
console.log(`against ${BASE}, provider segment "${PROVIDER}"\n`);

// A key pasted from a portal often arrives with a stray space or newline. The
// API will reject it and the reason will not be obvious from the error.
if (/\s/.test(key)) console.log('NOTE: the key contains whitespace. That alone will make it fail.\n');
if (!key.startsWith('sk-')) console.log(`NOTE: the key starts with "${key.slice(0, 4)}", not "sk-".\n`);

async function probe(label, url, init) {
	let status;
	let body = '';
	try {
		const res = await fetch(url, { ...init, signal: AbortSignal.timeout(30000) });
		status = res.status;
		body = (await res.text()).slice(0, 300);
	} catch (error) {
		console.log(`  ${label.padEnd(26)} NETWORK ERROR: ${redact(error.message)}`);
		return null;
	}

	const ok = status >= 200 && status < 300;
	const notFound = /key not found/i.test(body);
	// A 401 mentioning an OpenAI-style key is the upstream provider talking, not
	// Radware. It means Radware accepted our key and then called the provider
	// with a credential it does not have.
	const upstreamAuth =
		status === 401 && /Incorrect API key provided|didn't provide an API key|platform\.openai\.com/i.test(body);
	const verdict = ok
		? 'ACCEPTED'
		: notFound
			? 'KEY NOT RECOGNISED'
			: upstreamAuth
				? 'RELAYED, UPSTREAM PROVIDER REJECTED'
				: `HTTP ${status}`;
	console.log(`  ${label.padEnd(26)} ${verdict}`);
	if (!ok) console.log(`      ${redact(body.replace(/\s+/g, ' ')).slice(0, 200)}`);
	return { status, body, ok, notFound, upstreamAuth };
}

console.log('In-path (bearer token in the Authorization header):');
const models = await probe('GET /models', `${BASE}/v1/${PROVIDER}/models`, {
	headers: { Authorization: `Bearer ${key}` },
});
const chat = await probe('POST /chat/completions', `${BASE}/v1/${PROVIDER}/chat/completions`, {
	method: 'POST',
	headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
	body: JSON.stringify({ model: MODEL, messages: [{ role: 'user', content: 'ping' }], max_tokens: 5 }),
});

console.log('\nOut-of-path (key in the JSON body):');
const digester = await probe('POST digester/agentic-api', `${BASE}/llmp/digester/agentic-api`, {
	method: 'POST',
	headers: { 'Content-Type': 'application/json' },
	body: JSON.stringify({
		UserPrompt: 'connectivity check',
		UserIdentifier: 'key-check',
		UserContext: '',
		ToolName: '',
		ApiKey: key,
		ArgsInput: {},
		ToolsInput: [],
		ModelToUse: MODEL,
	}),
});

console.log('\n---');
const anyNotFound = [models, chat, digester].some((r) => r?.notFound);
const anyOk = [models, chat, digester].some((r) => r?.ok);
const upstreamRejected = [models, chat].some((r) => r?.upstreamAuth);

if (digester?.ok) {
	try {
		const decision = JSON.parse(digester.body);
		const keys = Object.keys(decision).join(', ');
		console.log(`Out-of-path returned a decision: ${keys || '(empty object)'}`);
	} catch {
		console.log('Out-of-path returned 2xx but the body did not parse as JSON.');
	}
}

if (upstreamRejected) {
	console.log('');
	console.log('Radware ACCEPTED this key. The 401 above came from the upstream provider,');
	console.log('relayed back through Radware, and it reports an empty API key.');
	console.log('');
	console.log('That means the homegrown agent behind this key has no Custom Provider API');
	console.log('Key set in the Radware portal, so Radware is calling the provider with');
	console.log('nothing. This is a portal configuration gap, not a problem with your key,');
	console.log('your network, or n8n.');
	console.log('');
	console.log('Fix: open the homegrown agent in https://console.radwarecloud.com, set');
	console.log('Custom Provider and paste a provider API key (an OpenAI key for the');
	console.log('"openai" segment). Radware calls the provider on your behalf using it.');
	if (digester?.ok) {
		console.log('');
		console.log('Out-of-path already works with this key and needs no provider key, since');
		console.log('it returns a decision rather than proxying a model call.');
	}
} else if (anyNotFound && !anyOk) {
	console.log('Radware does not recognise this key on any endpoint.');
	console.log('Likely causes, in order: the key was copied incompletely (the portal shows');
	console.log('it once), the homegrown agent was deleted or recreated, the case or');
	console.log('whitespace is wrong, or the key belongs to a different tenant.');
} else if (chat?.ok && !models?.ok) {
	console.log('The key works for chat/completions but not for /models.');
	console.log("n8n's in-path credential test calls /models, so it will report a failure");
	console.log('for a credential that is actually fine. Save it anyway and test with a');
	console.log('real agent run instead.');
} else if (anyOk) {
	console.log('Key accepted. Endpoints marked ACCEPTED above are the ones it works on.');
} else {
	console.log('No endpoint accepted the key and none reported "key not found".');
	console.log('Check the base URL and provider segment before suspecting the key.');
}
