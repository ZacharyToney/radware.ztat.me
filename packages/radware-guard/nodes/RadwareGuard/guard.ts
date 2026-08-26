/**
 * Out-of-path enforcement logic for Radware Agentic AI Protection.
 *
 * Deliberately free of n8n imports so the decision path can be exercised over
 * real HTTP in tests. The node supplies a transport backed by n8n's
 * `helpers.httpRequest`; the tests supply one backed by `fetch` pointed at a
 * local mock of the digester API.
 *
 * Request and response shapes follow the Radware Agentic AI Protection User
 * Guide 26.03.1, "If Using Out-of-Path Enforcement (Explicit API Call)".
 */

export type FailMode = 'failClose' | 'failOpen';

/** Request body accepted by POST /llmp/digester/agentic-api. */
export interface GuardPayload {
	UserPrompt: string;
	UserIdentifier: string;
	UserContext: string;
	ToolName: string;
	ApiKey: string;
	ArgsInput: unknown;
	ToolsInput: unknown;
	ModelToUse: string;
}

export interface TransportResponse {
	statusCode: number;
	body: unknown;
}

export type Transport = (
	url: string,
	payload: GuardPayload,
	timeoutMs: number,
) => Promise<TransportResponse>;

export interface GuardOptions {
	baseUrl: string;
	endpointPath: string;
	timeoutMs: number;
	failMode: FailMode;
}

export interface GuardDecision {
	isBlocked: boolean;
	/** Radware security Event ID, for cross-referencing in the portal. */
	eventId: string | null;
	/** `radware` when the service answered; otherwise the fail mode that decided. */
	decidedBy: 'radware' | 'failOpen' | 'failClose';
	/** Set only when the service did not return a usable decision. */
	reason?: string;
}

export function buildUrl(baseUrl: string, endpointPath: string): string {
	const base = baseUrl.replace(/\/+$/, '');
	const path = endpointPath.startsWith('/') ? endpointPath : `/${endpointPath}`;
	return `${base}${path}`;
}

/**
 * Replace a secret wherever it appears in text destined for logs or node
 * output. Secrets shorter than 8 characters are left alone: at that length a
 * naive replace is more likely to corrupt unrelated text than to protect
 * anything, and a key that short is not a real credential.
 */
export function redact(text: string, secret: string): string {
	if (!secret || secret.length < 8) return text;
	return text.split(secret).join('[redacted]');
}

function lookup(source: Record<string, unknown>, wanted: string): unknown {
	const target = wanted.toLowerCase();
	for (const key of Object.keys(source)) {
		if (key.toLowerCase() === target) return source[key];
	}
	return undefined;
}

function toBoolean(value: unknown): boolean | null {
	if (typeof value === 'boolean') return value;
	if (typeof value === 'number') {
		if (value === 1) return true;
		if (value === 0) return false;
		return null;
	}
	if (typeof value === 'string') {
		const v = value.trim().toLowerCase();
		if (v === 'true' || v === '1' || v === 'yes') return true;
		if (v === 'false' || v === '0' || v === 'no') return false;
	}
	return null;
}

/**
 * Extract the decision from a response body.
 *
 * Key casing is matched case-insensitively: the User Guide documents
 * `IsBlocked` and `EventId`, but a protection decision is too important to
 * hinge on the service never changing its casing. Returns null when no usable
 * decision is present, which the caller treats as a service failure rather
 * than as an allow.
 */
export function normalizeDecision(
	body: unknown,
): { isBlocked: boolean; eventId: string | null } | null {
	let parsed: unknown = body;

	if (typeof parsed === 'string') {
		try {
			parsed = JSON.parse(parsed);
		} catch {
			return null;
		}
	}

	if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;

	const record = parsed as Record<string, unknown>;
	const isBlocked = toBoolean(lookup(record, 'isblocked'));
	if (isBlocked === null) return null;

	const rawEventId = lookup(record, 'eventid');
	const eventId =
		typeof rawEventId === 'string' || typeof rawEventId === 'number' ? String(rawEventId) : null;

	return { isBlocked, eventId };
}

function failDecision(failMode: FailMode, reason: string): GuardDecision {
	return {
		isBlocked: failMode === 'failClose',
		eventId: null,
		decidedBy: failMode,
		reason,
	};
}

function describeError(error: unknown): string {
	if (error instanceof Error) return error.message;
	if (typeof error === 'string') return error;
	return 'unknown transport error';
}

/**
 * Ask Radware whether a tool call may proceed.
 *
 * Never throws. Any failure to obtain a decision resolves to the configured
 * fail mode, with `decidedBy` recording which path produced the answer so that
 * validation evidence can distinguish a real Radware block from a fail-close.
 */
export async function evaluate(
	payload: GuardPayload,
	options: GuardOptions,
	transport: Transport,
): Promise<GuardDecision> {
	const url = buildUrl(options.baseUrl, options.endpointPath);

	let response: TransportResponse;
	try {
		response = await transport(url, payload, options.timeoutMs);
	} catch (error) {
		return failDecision(options.failMode, redact(describeError(error), payload.ApiKey));
	}

	if (response.statusCode < 200 || response.statusCode >= 300) {
		return failDecision(options.failMode, `protection service returned HTTP ${response.statusCode}`);
	}

	const decision = normalizeDecision(response.body);
	if (decision === null) {
		return failDecision(options.failMode, 'protection service returned an unrecognised body');
	}

	return { isBlocked: decision.isBlocked, eventId: decision.eventId, decidedBy: 'radware' };
}
