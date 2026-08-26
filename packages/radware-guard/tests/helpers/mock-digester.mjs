import { createServer } from 'node:http';

/**
 * Mock of Radware's out-of-path digester endpoint.
 *
 * Real HTTP on an ephemeral port, so the tests exercise the actual transport,
 * timeout and status-code paths rather than a stubbed promise.
 */
export const BEHAVIOURS = {
	allow: { status: 200, body: { IsBlocked: false, EventId: null } },
	block: { status: 200, body: { IsBlocked: true, EventId: 'Lab-Test-1780314379-icrw9m' } },
	blockLowercaseKeys: { status: 200, body: { isblocked: true, eventid: 'Lab-Test-lowercase' } },
	blockStringBoolean: { status: 200, body: { IsBlocked: 'true', EventId: 42 } },
	unrecognisedBody: { status: 200, body: { detail: 'no decision here' } },
	notJson: { status: 200, raw: 'upstream proxy error page' },
	serverError: { status: 500, body: { error: 'internal' } },
	unauthorised: { status: 401, body: { error: 'invalid api key' } },
	hang: { hang: true },
};

/**
 * @param behaviourName one of BEHAVIOURS
 * @param host bind address. Defaults to loopback; the in-n8n integration check
 *   binds 0.0.0.0 so the container can reach it through the host gateway.
 */
export async function startMockDigester(behaviourName, { host = '127.0.0.1' } = {}) {
	let behaviour = BEHAVIOURS[behaviourName];
	if (!behaviour) throw new Error(`unknown mock behaviour: ${behaviourName}`);

	/** Bodies the mock received, so tests can assert what the node actually sent. */
	const received = [];

	const server = createServer((req, res) => {
		let raw = '';
		req.on('data', (chunk) => {
			raw += chunk;
		});
		req.on('end', () => {
			try {
				received.push(JSON.parse(raw));
			} catch {
				received.push({ unparseable: raw });
			}

			// Never answer, to drive the client-side timeout path.
			if (behaviour.hang) return;

			if (behaviour.raw !== undefined) {
				res.writeHead(behaviour.status, { 'Content-Type': 'text/html' });
				res.end(behaviour.raw);
				return;
			}

			res.writeHead(behaviour.status, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify(behaviour.body));
		});
	});

	await new Promise((resolve) => server.listen(0, host, resolve));
	const { port } = server.address();

	return {
		port,
		baseUrl: `http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${port}`,
		received,
		/** Switch the response shape without restarting, so one server covers a matrix. */
		setBehaviour(name) {
			if (!BEHAVIOURS[name]) throw new Error(`unknown mock behaviour: ${name}`);
			behaviour = BEHAVIOURS[name];
		},
		async close() {
			server.closeAllConnections();
			await new Promise((resolve) => server.close(resolve));
		},
	};
}

/**
 * Transport equivalent to the one the node builds from n8n's httpRequest
 * helper: POST JSON, do not throw on non-2xx, honour the timeout.
 */
export async function fetchTransport(url, payload, timeoutMs) {
	const response = await fetch(url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(payload),
		signal: AbortSignal.timeout(timeoutMs),
	});

	const text = await response.text();
	let body;
	try {
		body = JSON.parse(text);
	} catch {
		body = text;
	}

	return { statusCode: response.status, body };
}
