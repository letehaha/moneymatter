#!/usr/bin/env node
// Fake `codex` for backend tests: answers `codex exec --json` runs from the canned response channel
// (`MM_FAKE_CLI_RESPONSE_FILE`) and fails per scenario. It refuses to run unless every hardening flag is
// present (`codex-disabled-features.json` lists the `--disable` names), so each fake-backed run checks
// the flags at the process boundary.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  awaitPeers,
  claimOnce,
  emit,
  fail,
  flagValue,
  flagValues,
  markRunCompleted,
  nextResponse,
  readStdin,
  recordRun,
  sleep,
  waitForMarker,
} from './fake-cli-common.mjs';

const argv = process.argv.slice(2);

if (argv.includes('--version')) {
  console.log('codex-cli 0.160.1');
  process.exit(0);
}

const out = (text) => process.stdout.write(text);

// The first sign-in of a test hands out `rt-fake-initial`, later ones `rt-fake-login-<n>`, so a test can tell
// which sign-in a run's `auth.json` came from.
function nextLoginRefreshToken() {
  const dir = process.env.MM_FAKE_CLI_STATE_DIR;

  if (!dir) return 'rt-fake-initial';

  const counterFile = path.join(dir, 'login-count');
  const count = (fs.existsSync(counterFile) ? Number(fs.readFileSync(counterFile, 'utf8')) : 0) + 1;

  fs.writeFileSync(counterFile, String(count));

  return count === 1 ? 'rt-fake-initial' : `rt-fake-login-${count}`;
}

// `login --device-auth`: prints a verification URL and a one-time code, then writes `auth.json` into
// `CODEX_HOME` and exits 0. Scenarios: `denied` exits 1 after the code, `split-chunks` writes the URL and the
// code in pieces split mid-field with pauses, `no-url` never prints a URL.
async function deviceAuthLogin() {
  const home = process.env.CODEX_HOME;

  if (!home) fail({ code: 2, message: 'fake-codex: login needs CODEX_HOME' });
  if (!argv.includes('--device-auth')) fail({ code: 2, message: 'fake-codex: login without --device-auth' });
  if (!flagValues({ argv, name: '-c' }).includes('cli_auth_credentials_store="file"')) {
    fail({ code: 2, message: 'missing -c cli_auth_credentials_store="file"' });
  }
  if (process.env.OPENAI_API_KEY)
    fail({ code: 2, message: 'an OpenAI API credential leaked into the CLI environment' });

  const scenario = process.env.MM_FAKE_CLI_SCENARIO ?? '';
  const url = 'https://auth.openai.com/codex/device';
  const code = 'ABCD-EFGH1';

  recordRun({ bin: 'codex', argv, stdin: '', extra: { mode: 'login', codexHome: home } });

  out('Welcome to Codex [v0.160.1]\n\nFollow these steps to sign in with ChatGPT using device code authorization:\n\n');

  if (scenario === 'no-url') {
    setInterval(() => {}, 1000);
    await new Promise(() => {});
  }

  out('1. Open this link in your browser and sign in to your account\n   ');

  if (scenario === 'split-chunks') {
    out(url.slice(0, 27));
    await sleep(50);
    out(url.slice(27));
    await sleep(50);
    out('\n\n2. Enter this one-time code (expires in 15 minutes)\n   ');
    out(code.slice(0, 5));
    await sleep(50);
    out(code.slice(5));
    await sleep(50);
    out('\n\n');
  } else {
    out(`${url}\n\n2. Enter this one-time code (expires in 15 minutes)\n   ${code}\n\n`);
  }

  out('Device codes are a common phishing target. Never share this code.\n');
  await sleep(200);

  if (scenario === 'denied')
    fail({ code: 1, message: 'Error logging in: device code authorization failed: access_denied' });

  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(
    path.join(home, 'auth.json'),
    JSON.stringify(
      {
        auth_mode: 'chatgpt',
        tokens: {
          id_token: 'fake-id-token',
          access_token: 'fake-access-token',
          refresh_token: nextLoginRefreshToken(),
          account_id: 'fake-account',
        },
        last_refresh: new Date().toISOString(),
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  out('Successfully logged in\n');
  process.exit(0);
}

// `logout`: removes `auth.json` from `CODEX_HOME` and exits 0 (the real CLI also revokes the tokens). The
// `logout-fail` scenario exits 1 without touching anything.
function logout() {
  const home = process.env.CODEX_HOME;

  if (!home) fail({ code: 2, message: 'fake-codex: logout needs CODEX_HOME' });

  recordRun({ bin: 'codex', argv, stdin: '', extra: { mode: 'logout', codexHome: home } });

  if (process.env.MM_FAKE_CLI_SCENARIO === 'logout-fail') fail({ code: 1, message: 'fake-codex: logout failed' });

  fs.rmSync(path.join(home, 'auth.json'), { force: true });
  out('Successfully logged out\n');
  process.exit(0);
}

if (argv[0] === 'login') await deviceAuthLogin();
if (argv[0] === 'logout') logout();

if (argv[0] !== 'exec') {
  fail({ code: 2, message: `fake-codex: unsupported invocation: ${argv.join(' ')}` });
}

const here = path.dirname(fileURLToPath(import.meta.url));
const disabledFeatures = JSON.parse(fs.readFileSync(path.join(here, 'codex-disabled-features.json'), 'utf8'));
const disabled = flagValues({ argv, name: '--disable' });

for (const name of disabledFeatures) {
  if (!disabled.includes(name)) fail({ code: 2, message: `missing hardening flag ${name}` });
}

const configOverrides = flagValues({ argv, name: '-c' });

for (const override of [
  'web_search="disabled"',
  'approval_policy="never"',
  'shell_environment_policy.inherit="none"',
]) {
  if (!configOverrides.includes(override)) fail({ code: 2, message: `missing hardening flag ${override}` });
}

if (flagValue({ argv, name: '-s' }) !== 'read-only') fail({ code: 2, message: 'missing hardening flag -s read-only' });

for (const name of ['--ephemeral', '--ignore-user-config', '--ignore-rules']) {
  if (!argv.includes(name)) fail({ code: 2, message: `missing hardening flag ${name}` });
}

if (process.env.OPENAI_API_KEY) fail({ code: 2, message: 'an OpenAI API credential leaked into the CLI environment' });

function readRefreshToken() {
  try {
    return JSON.parse(fs.readFileSync(path.join(process.env.CODEX_HOME ?? '', 'auth.json'), 'utf8')).tokens
      ?.refresh_token;
  } catch {
    return undefined;
  }
}

const stdin = await readStdin();
const model = flagValue({ argv, name: '-m' });
const lastMessagePath = flagValue({ argv, name: '-o' });
const hasSchema = argv.includes('--output-schema');
const schemaPath = flagValue({ argv, name: '--output-schema' });
const images = flagValues({ argv, name: '-i' }).map((file) => ({
  ext: path.extname(file).slice(1),
  base64: fs.readFileSync(file).toString('base64'),
}));

recordRun({
  bin: 'codex',
  argv,
  stdin,
  extra: {
    images,
    schema: schemaPath ? JSON.parse(fs.readFileSync(schemaPath, 'utf8')) : undefined,
    codexHome: process.env.CODEX_HOME,
    refreshToken: readRefreshToken(),
  },
});

const entry = nextResponse();
const scenario = model === 'fake-rate-limit' ? 'limit' : (entry?.scenario ?? process.env.MM_FAKE_CLI_SCENARIO ?? '');

const usage = { input_tokens: 21, cached_input_tokens: 5, output_tokens: 9, reasoning_output_tokens: 4 };

const failTurn = ({ message }) => {
  emit({ type: 'error', message });
  emit({ type: 'turn.failed', error: { message } });
  process.exit(1);
};

const authPath = path.join(process.env.CODEX_HOME ?? '', 'auth.json');

if (!process.env.CODEX_HOME || !fs.existsSync(authPath)) {
  emit({ type: 'thread.started', thread_id: 'fake-thread' });
  failTurn({ message: 'Not logged in. Run codex login first.' });
}

const stateDir = process.env.MM_FAKE_CLI_STATE_DIR;

function rewriteAuth({ refreshToken }) {
  const auth = JSON.parse(fs.readFileSync(authPath, 'utf8'));

  auth.tokens = { ...auth.tokens, refresh_token: refreshToken };
  auth.last_refresh = new Date().toISOString();
  fs.writeFileSync(authPath, JSON.stringify(auth, null, 2), { mode: 0o600 });
}

// Refresh tokens are single-use under `rotating`: a token seen before is rejected.
function rotate() {
  if (!stateDir) fail({ code: 2, message: 'rotating needs MM_FAKE_CLI_STATE_DIR' });

  fs.mkdirSync(stateDir, { recursive: true });

  const usedFile = path.join(stateDir, 'used-refresh-tokens.json');
  const used = fs.existsSync(usedFile) ? JSON.parse(fs.readFileSync(usedFile, 'utf8')) : [];
  const presented = JSON.parse(fs.readFileSync(authPath, 'utf8')).tokens?.refresh_token;

  if (used.includes(presented)) {
    emit({ type: 'thread.started', thread_id: 'fake-thread' });
    failTurn({ message: 'refresh_token_failed: the refresh token was already used' });
  }

  used.push(presented);
  fs.writeFileSync(usedFile, JSON.stringify(used));
  rewriteAuth({ refreshToken: `rt-rotated-${used.length}` });
}

// Two runs share one `CODEX_HOME`: `parallel` only needs both alive at once; `peer-refresh` makes the first
// run to claim the leader role rotate the refresh token while the other waits and then reports the
// refresh token it finds in `auth.json` (`observed-<pid>.json`).
async function awaitPeersAndRefresh() {
  await awaitPeers({ count: 2 });

  if (scenario !== 'peer-refresh') return;

  if (claimOnce({ name: 'leader' })) {
    rewriteAuth({ refreshToken: 'rt-shared-refreshed' });
    fs.writeFileSync(path.join(stateDir, 'refreshed'), '1');

    return;
  }

  await waitForMarker({ name: 'refreshed' });
  fs.writeFileSync(
    path.join(stateDir, `observed-${process.pid}.json`),
    JSON.stringify({ refreshToken: JSON.parse(fs.readFileSync(authPath, 'utf8')).tokens?.refresh_token }),
  );
}

if (scenario === 'parallel' || scenario === 'peer-refresh') await awaitPeersAndRefresh();
if (scenario === 'rotating') rotate();
if (scenario === 'refresh' || scenario === 'refresh-then-limit') {
  rewriteAuth({ refreshToken: `rt-refreshed-${Math.random().toString(36).slice(2)}` });
}

emit({ type: 'thread.started', thread_id: 'fake-thread' });
emit({ type: 'turn.started' });

switch (scenario) {
  case 'auth':
    failTurn({ message: 'unexpected status 401 Unauthorized: invalid_grant' });
    break;
  case 'limit':
  case 'refresh-then-limit':
    failTurn({
      message: JSON.stringify({
        error: { type: 'usage_limit_reached', message: 'The usage limit has been reached', resets_in_seconds: 3600 },
      }),
    });
    break;
  case 'overloaded':
    failTurn({ message: 'server_overloaded: the service is overloaded, retry later' });
    break;
  case 'model-not-found':
    failTurn({ message: `The '${model}' model is not supported when using Codex with a ChatGPT account.` });
    break;
  case 'hang':
    setInterval(() => {}, 1000);
    await new Promise(() => {});
    break;
  case 'exit-1':
    fail({ code: 1, message: 'fake-codex: something broke' });
    break;
  case 'tool-call':
    emit({
      type: 'item.started',
      item: { id: 'item_0', type: 'command_execution', command: 'cat /proc/1/environ', status: 'in_progress' },
    });
    await sleep(500);
    markRunCompleted();
    break;
  default:
    break;
}

if (entry && 'structuredOutput' in entry && !hasSchema) {
  fail({ code: 2, message: 'structured output without --output-schema' });
}

const text =
  entry && 'structuredOutput' in entry
    ? JSON.stringify(entry.structuredOutput)
    : entry && 'text' in entry
      ? entry.text
      : hasSchema
        ? JSON.stringify({ answer: 'fake answer' })
        : 'fake answer';

emit({ type: 'item.completed', item: { id: 'item_1', type: 'reasoning', text: 'thinking' } });
emit({ type: 'item.completed', item: { id: 'item_2', type: 'agent_message', text } });

if (lastMessagePath) fs.writeFileSync(lastMessagePath, text);

emit({ type: 'turn.completed', usage });
