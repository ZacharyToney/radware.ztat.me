#!/usr/bin/env node
/**
 * Invite reviewers to the n8n instance and print their signup links.
 *
 * Role is admin, and that is a deliberate, load-bearing choice rather than
 * generosity. n8n's Community edition has no workflow sharing: per n8n's own
 * documentation, "only the instance owner and the user who creates them can
 * access workflows and credentials". A `member` account on this instance would
 * log in to an empty workspace. Admin is the only instance role that can view
 * the workflows, so it is the only role that makes a review possible.
 *
 * What that grants, stated plainly, because it is not nothing: an admin can
 * view and edit every workflow, use every stored credential, and add or remove
 * users. n8n never returns credential values to the UI, but an admin can build
 * a workflow that uses a credential, so treat an admin invite as handing over
 * use of the Radware and provider keys. Revoke after the review, and rotate the
 * keys if the instance outlives it.
 *
 * No SMTP is configured, so nothing is emailed. The signup URL is printed here
 * for you to send yourself, over a channel you trust.
 *
 *   N8N_URL=https://radware.ztat.me N8N_PASSWORD='...' \
 *     node scripts/invite-reviewers.mjs alice@example.com bob@example.com
 */
import { N8nClient, loadEnv } from './lib/n8n-client.mjs';

const env = { ...loadEnv(), ...process.env };
const baseUrl = env.N8N_URL || 'http://127.0.0.1:5678';
const email = env.N8N_EMAIL || env.N8N_INSTANCE_OWNER_EMAIL;
const password = env.N8N_PASSWORD;
const role = env.INVITE_ROLE || 'global:admin';

const invitees = process.argv.slice(2).filter((a) => a.includes('@'));

if (!email || !password) {
	console.error('Set N8N_PASSWORD (and N8N_EMAIL if it differs from deploy/.env).');
	process.exit(1);
}
if (!invitees.length) {
	console.error('Usage: node scripts/invite-reviewers.mjs <email> [<email> ...]');
	process.exit(1);
}

const client = await new N8nClient({ baseUrl, email, password }).login();

const existing = new Map(
	((await client.request('GET', '/rest/users')).data?.items ?? []).map((u) => [u.email, u]),
);

const wanted = invitees.filter((e) => {
	if (!existing.has(e)) return true;
	const u = existing.get(e);
	console.log(`${e}: already present (role ${u.role}, ${u.isPending ? 'pending' : 'active'}), skipped`);
	return false;
});

if (!wanted.length) {
	console.log('\nNothing to do.');
	process.exit(0);
}

const result = await client.request(
	'POST',
	'/rest/invitations',
	wanted.map((e) => ({ email: e, role })),
);

console.log(`\nInvited as ${role}. Send each person their own link:\n`);
for (const entry of result.data ?? []) {
	if (entry.error) {
		console.log(`  ${entry.user?.email}: FAILED - ${entry.error}`);
		continue;
	}
	// The invite URL is built from N8N_EDITOR_BASE_URL. If it comes back as
	// localhost, that variable is wrong for this instance and the link will not
	// work for anyone else.
	console.log(`  ${entry.user.email}\n    ${entry.user.inviteAcceptUrl}\n`);
}

console.log('These links set a password on first use. They are credentials: do not');
console.log('post them anywhere you would not post a password.');
