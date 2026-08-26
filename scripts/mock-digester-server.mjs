#!/usr/bin/env node
/**
 * Standalone mock of the Radware out-of-path digester, for local verification.
 *
 * Runs as a container on the same compose network as n8n, so no host-gateway
 * routing is involved. That matters more than it sounds: on a machine whose
 * firewall drops container-to-host traffic, a host-bound mock is unreachable
 * from n8n and every check silently fails closed, which looks exactly like a
 * working fail-close policy.
 *
 * Response behaviour is switched at runtime over the control endpoints so one
 * instance covers the whole matrix.
 *
 *   POST /llmp/digester/agentic-api   the mocked API
 *   PUT  /__control/behaviour         { "name": "block" }
 *   GET  /__control/received          bodies seen so far
 *   DELETE /__control/received        clear them
 */
import { createServer } from 'node:http';

import { BEHAVIOURS } from '../packages/radware-guard/tests/helpers/mock-digester.mjs';

const PORT = Number(process.env.PORT || 8080);
let behaviourName = process.env.BEHAVIOUR || 'allow';
let received = [];

function readBody(req) {
	return new Promise((resolve) => {
		let raw = '';
		req.on('data', (c) => {
			raw += c;
		});
		req.on('end', () => resolve(raw));
	});
}

function json(res, status, body) {
	res.writeHead(status, { 'Content-Type': 'application/json' });
	res.end(JSON.stringify(body));
}

const server = createServer(async (req, res) => {
	const url = new URL(req.url, 'http://mock');

	if (url.pathname === '/__control/behaviour' && req.method === 'PUT') {
		const { name } = JSON.parse((await readBody(req)) || '{}');
		if (!BEHAVIOURS[name]) return json(res, 400, { error: `unknown behaviour: ${name}` });
		behaviourName = name;
		return json(res, 200, { behaviour: behaviourName });
	}

	if (url.pathname === '/__control/received') {
		if (req.method === 'DELETE') {
			received = [];
			return json(res, 200, { cleared: true });
		}
		return json(res, 200, { received });
	}

	if (url.pathname === '/__control/health') return json(res, 200, { ok: true, behaviourName });

	const raw = await readBody(req);
	try {
		received.push(JSON.parse(raw));
	} catch {
		received.push({ unparseable: raw });
	}

	const behaviour = BEHAVIOURS[behaviourName];

	// Never answer, to drive the client-side timeout path.
	if (behaviour.hang) return;

	if (behaviour.raw !== undefined) {
		res.writeHead(behaviour.status, { 'Content-Type': 'text/html' });
		return res.end(behaviour.raw);
	}

	return json(res, behaviour.status, behaviour.body);
});

server.listen(PORT, '0.0.0.0', () => {
	console.log(`mock digester on :${PORT}, behaviour=${behaviourName}`);
});
