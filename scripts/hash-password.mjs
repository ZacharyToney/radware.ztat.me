#!/usr/bin/env node
/**
 * Produce the bcrypt hash n8n expects in N8N_INSTANCE_OWNER_PASSWORD_HASH.
 *
 * Reads the password from stdin so it never lands in shell history or in the
 * process list, where `ps` would show it to every user on the box.
 *
 *   pnpm hash-password
 */
import { createInterface } from 'node:readline/promises';
import bcrypt from 'bcryptjs';

const rl = createInterface({ input: process.stdin, output: process.stderr });
const password = await rl.question('Password for the n8n owner account: ');
rl.close();

if (password.length < 12) {
	console.error(
		'\nRefusing: this account is reachable from the public internet. Use 12 or more characters.',
	);
	process.exit(1);
}

// n8n hashes with a cost of 10.
const hash = bcrypt.hashSync(password, 10);

// A bcrypt hash always contains `$`, and Docker Compose interpolates `$` when
// it reads an env file. An unescaped hash silently becomes a truncated string
// and the owner account is provisioned with a password nobody knows. Emit the
// escaped form, because the env file is the only place this value is used.
const escaped = hash.split('$').join('$$');

console.error('\nAdd this line to deploy/.env exactly as printed:\n');
process.stdout.write(`N8N_INSTANCE_OWNER_PASSWORD_HASH=${escaped}\n`);
console.error(
	'\nThe doubled $$ is deliberate: Docker Compose collapses it back to a single $.\n',
);
