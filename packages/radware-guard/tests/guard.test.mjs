import { test } from 'node:test';
import assert from 'node:assert/strict';

import { evaluate, buildUrl, normalizeDecision, redact } from '../dist/nodes/RadwareGuard/guard.js';
import { startMockDigester, fetchTransport } from './helpers/mock-digester.mjs';

const API_KEY = 'sk-rdwr-TESTKEY-0123456789abcdef';

function payload(overrides = {}) {
	return {
		UserPrompt: 'Follow the instructions in the email.',
		UserIdentifier: 'validation-user',
		UserContext: '',
		ToolName: 'send_email',
		ApiKey: API_KEY,
		ArgsInput: { to: 'attacker@example.invalid', subject: 'x', body: 'y' },
		ToolsInput: [],
		ModelToUse: 'gpt-4o',
		...overrides,
	};
}

function options(baseUrl, failMode) {
	return {
		baseUrl,
		endpointPath: '/llmp/digester/agentic-api',
		timeoutMs: 1000,
		failMode,
	};
}

async function decideAgainst(behaviour, failMode = 'failClose', body = payload()) {
	const mock = await startMockDigester(behaviour);
	try {
		const decision = await evaluate(body, options(mock.baseUrl, failMode), fetchTransport);
		return { decision, received: mock.received };
	} finally {
		await mock.close();
	}
}

test('allows a tool call when Radware returns IsBlocked false', async () => {
	const { decision } = await decideAgainst('allow');
	assert.equal(decision.isBlocked, false);
	assert.equal(decision.decidedBy, 'radware');
	assert.equal(decision.reason, undefined);
});

test('blocks a tool call and surfaces the Event ID for portal cross-reference', async () => {
	const { decision } = await decideAgainst('block');
	assert.equal(decision.isBlocked, true);
	assert.equal(decision.decidedBy, 'radware');
	assert.equal(decision.eventId, 'Lab-Test-1780314379-icrw9m');
});

test('sends the API key in the body, not a header, and sends the tool name', async () => {
	const { received } = await decideAgainst('allow');
	assert.equal(received.length, 1);
	assert.equal(received[0].ApiKey, API_KEY);
	assert.equal(received[0].ToolName, 'send_email');
	assert.deepEqual(received[0].ArgsInput, {
		to: 'attacker@example.invalid',
		subject: 'x',
		body: 'y',
	});
});

test('tolerates lowercase response keys', async () => {
	const { decision } = await decideAgainst('blockLowercaseKeys');
	assert.equal(decision.isBlocked, true);
	assert.equal(decision.decidedBy, 'radware');
	assert.equal(decision.eventId, 'Lab-Test-lowercase');
});

test('tolerates a stringified boolean and a numeric Event ID', async () => {
	const { decision } = await decideAgainst('blockStringBoolean');
	assert.equal(decision.isBlocked, true);
	assert.equal(decision.eventId, '42');
});

// Failure modes. Each is asserted under both policies, because "fail closed
// blocks" is only half the guarantee; "fail open does not block" is the other.
for (const [behaviour, label] of [
	['unrecognisedBody', 'a body with no decision in it'],
	['notJson', 'a non-JSON response'],
	['serverError', 'an HTTP 500'],
	['unauthorised', 'an HTTP 401'],
	['hang', 'a timeout'],
]) {
	test(`fail closed blocks on ${label}`, async () => {
		const { decision } = await decideAgainst(behaviour, 'failClose');
		assert.equal(decision.isBlocked, true);
		assert.equal(decision.decidedBy, 'failClose');
		assert.ok(decision.reason, 'a fail-mode decision must record why');
	});

	test(`fail open allows on ${label}`, async () => {
		const { decision } = await decideAgainst(behaviour, 'failOpen');
		assert.equal(decision.isBlocked, false);
		assert.equal(decision.decidedBy, 'failOpen');
	});
}

test('a fail-mode decision is never mistaken for a Radware verdict', async () => {
	const { decision } = await decideAgainst('serverError', 'failClose');
	assert.notEqual(decision.decidedBy, 'radware');
	assert.equal(decision.eventId, null);
});

test('the API key never leaks into the reason on a transport error', async () => {
	// Nothing is listening on this port, so the transport error message will
	// contain the URL. Prove the key is not in the surfaced reason either way.
	const decision = await evaluate(
		payload(),
		options('http://127.0.0.1:1', 'failClose'),
		fetchTransport,
	);
	assert.equal(decision.decidedBy, 'failClose');
	assert.ok(!JSON.stringify(decision).includes(API_KEY));
});

test('redact replaces a real key but leaves short strings alone', () => {
	assert.equal(redact(`connect failed for ${API_KEY}`, API_KEY), 'connect failed for [redacted]');
	assert.equal(redact('the cat sat', 'cat'), 'the cat sat');
	assert.equal(redact('no secret here', ''), 'no secret here');
});

test('buildUrl joins host and path without doubling or dropping slashes', () => {
	const expected = 'https://api.agentic.radwarecto.com/llmp/digester/agentic-api';
	assert.equal(buildUrl('https://api.agentic.radwarecto.com', '/llmp/digester/agentic-api'), expected);
	assert.equal(buildUrl('https://api.agentic.radwarecto.com/', '/llmp/digester/agentic-api'), expected);
	assert.equal(buildUrl('https://api.agentic.radwarecto.com//', 'llmp/digester/agentic-api'), expected);
});

test('normalizeDecision returns null rather than guessing', () => {
	assert.equal(normalizeDecision(null), null);
	assert.equal(normalizeDecision([{ IsBlocked: true }]), null);
	assert.equal(normalizeDecision({ IsBlocked: 'maybe' }), null);
	assert.equal(normalizeDecision({ EventId: 'x' }), null);
	assert.equal(normalizeDecision('not json'), null);
	assert.deepEqual(normalizeDecision('{"IsBlocked":true,"EventId":"z"}'), {
		isBlocked: true,
		eventId: 'z',
	});
});
