#!/usr/bin/env node
/**
 * A tiny fake git HTTP remote for offline auth and timeout checks.
 *
 * Git speaks smart HTTP to its remote, so two failure modes can be reproduced
 * without a network. `--mode=401` answers every request with an authentication
 * challenge, which makes git fail with "terminal prompts disabled" under the
 * app's env policy (GIT_TERMINAL_PROMPT=0), and `--mode=stall` accepts the
 * connection but never answers, so the timeout path can be exercised. Milestone
 * 9 (remote operations) builds its verification on this server.
 */
import http from 'node:http';
import process from 'node:process';

/** Fixed default port so `scripts/make-scratch-repos.mjs` can hardcode the origin URL. */
export const defaultPort = 49_321;

const modes = ['401', 'stall'];

const usage =
	'usage: node scripts/fake-auth-server.mjs [--mode=401|stall] [--port <port>]';

/** Report a bad invocation without `process.exit`, which would skip cleanup. */
const fail = message => {
	process.stderr.write(`${message}\n${usage}\n`);
	process.exitCode = 1;
};

const parsePort = value => {
	const port = Number.parseInt(value, 10);

	if (!Number.isInteger(port) || port < 0 || port > 65_535) {
		fail(`invalid port: ${value}`);
		return undefined;
	}

	return port;
};

/** Parse `--mode` and `--port` (both `--flag value` and `--flag=value`). */
const parseArgs = argv => {
	const options = { mode: '401', port: defaultPort };
	let index = 0;

	while (index < argv.length) {
		const arg = argv[index];
		index += 1;

		if (arg === undefined) {
			continue;
		}

		if (arg.startsWith('--mode=')) {
			const value = arg.slice('--mode='.length);

			if (!modes.includes(value)) {
				fail(`unknown mode: ${value} (expected ${modes.join(' or ')})`);
				return undefined;
			}

			options.mode = value;
			continue;
		}

		if (arg === '--port' || arg.startsWith('--port=')) {
			const raw = arg === '--port' ? argv[index] : arg.slice('--port='.length);

			if (raw === undefined) {
				fail('--port needs a value');
				return undefined;
			}

			const port = parsePort(raw);

			if (port === undefined) {
				return undefined;
			}

			index += arg === '--port' ? 1 : 0;
			options.port = port;
			continue;
		}

		fail(`unknown argument: ${arg}`);
		return undefined;
	}

	return options;
};

const start = ({ mode, port }) => {
	const server = http.createServer((_request, response) => {
		if (mode === 'stall') {
			// Deliberately never answer: the socket stays open until the client
			// gives up, which is what the app's timeout cleanup must cut short.
			return;
		}

		// A 401 with a challenge is exactly what git reports as an auth failure,
		// and it keeps the response hermetic (no credentials are ever checked).
		response.writeHead(401, {
			'content-type': 'text/plain',
			'www-authenticate': 'Basic realm="gitminal fake auth"',
		});
		response.end('authentication required\n');
	});

	server.listen(port, '127.0.0.1', () => {
		process.stdout.write(
			`fake auth server: mode=${mode} http://127.0.0.1:${port} (ctrl+c to stop)\n`,
		);
	});
};

const options = parseArgs(process.argv.slice(2));

if (options !== undefined) {
	start(options);
}
