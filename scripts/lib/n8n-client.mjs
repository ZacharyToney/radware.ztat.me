/**
 * Minimal client for n8n's internal REST API, using the owner login.
 *
 * n8n's Public API (/api/v1) needs an API key minted in the UI, which is one
 * more manual step than this repo wants. The internal API accepts a cookie
 * session, which is enough for import and inspection.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Parse deploy/.env without pulling in a dotenv dependency. */
export function loadEnv(file = join(root, 'deploy', '.env')) {
	const env = {};
	let text;
	try {
		text = readFileSync(file, 'utf8');
	} catch {
		return env;
	}
	for (const line of text.split('\n')) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#')) continue;
		const eq = trimmed.indexOf('=');
		if (eq === -1) continue;
		// Docker Compose collapses $$ to $ when it reads this file; do the same
		// so a value read here matches what the container actually received.
		env[trimmed.slice(0, eq)] = trimmed.slice(eq + 1).split('$$').join('$');
	}
	return env;
}

export class N8nClient {
	constructor({ baseUrl, email, password }) {
		this.baseUrl = baseUrl.replace(/\/+$/, '');
		this.email = email;
		this.password = password;
		this.cookie = null;
	}

	async login() {
		const res = await fetch(`${this.baseUrl}/rest/login`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ emailOrLdapLoginId: this.email, password: this.password }),
		});
		if (!res.ok) {
			throw new Error(`login failed: HTTP ${res.status} ${await res.text()}`);
		}
		const setCookie = res.headers.getSetCookie?.() ?? [];
		this.cookie = setCookie.map((c) => c.split(';')[0]).join('; ');
		if (!this.cookie) throw new Error('login returned no session cookie');
		return this;
	}

	async request(method, path, body) {
		const res = await fetch(`${this.baseUrl}${path}`, {
			method,
			headers: {
				'Content-Type': 'application/json',
				Cookie: this.cookie,
				'browser-id': 'radware-lab-cli',
			},
			body: body === undefined ? undefined : JSON.stringify(body),
		});
		const text = await res.text();
		if (!res.ok) {
			throw new Error(`${method} ${path} -> HTTP ${res.status}: ${text.slice(0, 400)}`);
		}
		return text ? JSON.parse(text) : null;
	}

	async listWorkflows() {
		const r = await this.request('GET', '/rest/workflows?includeScopes=false');
		return r.data ?? r;
	}

	async listCredentials() {
		const r = await this.request('GET', '/rest/credentials');
		return r.data ?? r;
	}

	createWorkflow(wf) {
		return this.request('POST', '/rest/workflows', wf);
	}

	updateWorkflow(id, wf) {
		return this.request('PATCH', `/rest/workflows/${id}`, wf);
	}
}
