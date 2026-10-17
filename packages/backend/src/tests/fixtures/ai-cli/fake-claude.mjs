#!/usr/bin/env node
// Fake `claude` for backend tests: answers `-p ... --output-format stream-json` runs from the canned
// response channel (`MM_FAKE_CLI_RESPONSE_FILE`) and fails per scenario. Mirrors the real stream: with
// `--json-schema` it emits a `StructuredOutput` tool_use before the `result` event that carries `structured_output`.

import {
  emit,
  fail,
  flagValue,
  markRunCompleted,
  nextResponse,
  readStdin,
  recordRun,
  sleep,
} from './fake-cli-common.mjs';

const argv = process.argv.slice(2);

if (argv.includes('--version')) {
  console.log('2.1.292 (Claude Code)');
  process.exit(0);
}

const out = (text) => process.stdout.write(text);

// `setup-token`: an Ink TUI in the real CLI, so it insists on a TTY. Prints an authorize URL and a paste prompt,
// then the token for any code except `bad-code`. Scenarios: `split-chunks` writes the URL and the token in
// pieces split mid-field with pauses, `token-at-exit` prints the token as the very last bytes before exiting,
// `no-url` never prints a URL, `no-token` takes the code and then never prints a token.
async function setupToken() {
  if (!process.stdin.isTTY) fail({ code: 2, message: 'fake-claude: setup-token needs a TTY' });
  if (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) {
    fail({ code: 2, message: 'an Anthropic API credential leaked into the CLI environment' });
  }

  const scenario = process.env.MM_FAKE_CLI_SCENARIO ?? '';
  const url =
    'https://claude.com/cai/oauth/authorize?code=true&client_id=fake-client&response_type=code' +
    '&redirect_uri=https%3A%2F%2Fplatform.claude.com%2Foauth%2Fcode%2Fcallback&scope=user%3Ainference&state=fake-state';
  const token = 'sk-ant-oat01-FAKE0123456789abcdefghijklmnopqrstuvwxyz';

  out("\x1b[1mWelcome to Claude Code\x1b[0m\n\nBrowser didn't open? Use the url below to sign in\n\n");

  if (scenario === 'no-url') {
    setInterval(() => {}, 1000);
    await new Promise(() => {});
  }

  if (scenario === 'split-chunks') {
    const cut = url.indexOf('&scope=') + 4;

    out(url.slice(0, cut));
    await sleep(50);
    out(url.slice(cut));
    await sleep(50);
    out('\n\n');
  } else {
    out(`\x1b[36m${url}\x1b[0m\n\n`);
  }

  out('Paste code here if prompted > ');

  // Like the real (Ink) prompt: a multi-character chunk is a paste, so a newline inside it is text, and only
  // a chunk that is exactly Enter submits.
  const code = await new Promise((resolve) => {
    let typed = '';
    process.stdin.setRawMode(true);
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      if (chunk === '\r' || chunk === '\n') {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        resolve(typed);
        return;
      }
      typed += chunk.replace(/[\r\n]/g, '');
    });
  });

  recordRun({
    bin: 'claude',
    argv,
    stdin: '',
    extra: { mode: 'setup-token', code, browser: process.env.BROWSER, home: process.env.HOME },
  });

  if (scenario === 'no-token') {
    setInterval(() => {}, 1000);
    await new Promise(() => {});
  }

  if (code.trim() === 'bad-code') {
    out('\nError: Invalid code. Please make sure the full code was copied\n');
    process.exit(1);
  }

  out('\n\u2713 Long-lived authentication token created successfully!\n\nYour OAuth token (valid for 1 year):\n\n');

  if (scenario === 'split-chunks') {
    out(token.slice(0, 25));
    await sleep(50);
    out(token.slice(25));
    await sleep(50);
    out("\n\nStore this token securely. You won't be able to see it again.\n");
  } else if (scenario === 'token-at-exit') {
    out(token);
  } else {
    out(`${token}\n\nStore this token securely. You won't be able to see it again.\n`);
  }

  process.exit(0);
}

if (argv[0] === 'setup-token') await setupToken();

if (!argv.includes('-p')) {
  fail({ code: 2, message: `fake-claude: unsupported invocation: ${argv.join(' ')}` });
}

for (const [name, expected] of [
  ['--tools', ''],
  ['--setting-sources', ''],
]) {
  if (flagValue({ argv, name }) !== expected) fail({ code: 2, message: `missing hardening flag ${name}` });
}

for (const name of ['--strict-mcp-config', '--no-session-persistence']) {
  if (!argv.includes(name)) fail({ code: 2, message: `missing hardening flag ${name}` });
}

if (argv.includes('--bare')) fail({ code: 2, message: '--bare ignores CLAUDE_CODE_OAUTH_TOKEN' });
if (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) {
  fail({ code: 2, message: 'an Anthropic API credential leaked into the CLI environment' });
}

const stdin = await readStdin();

recordRun({ bin: 'claude', argv, stdin, extra: { hasToken: Boolean(process.env.CLAUDE_CODE_OAUTH_TOKEN) } });

const model = flagValue({ argv, name: '--model' });
const hasSchema = argv.includes('--json-schema');
const entry = nextResponse();
const scenario = model === 'fake-rate-limit' ? 'limit' : (entry?.scenario ?? process.env.MM_FAKE_CLI_SCENARIO ?? '');

const usage = { input_tokens: 11, output_tokens: 7, cache_read_input_tokens: 3, cache_creation_input_tokens: 2 };

const assistant = (content) => emit({ type: 'assistant', message: { role: 'assistant', content } });
const toolUse = (name, input = {}) => ({
  type: 'tool_use',
  id: `toolu_${Math.random().toString(36).slice(2)}`,
  name,
  input,
});
const errorResult = ({ text, status }) =>
  emit({ type: 'result', subtype: 'success', is_error: true, api_error_status: status ?? null, result: text, usage });

emit({ type: 'system', subtype: 'init', model, tools: [] });

if (!process.env.CLAUDE_CODE_OAUTH_TOKEN || scenario === 'auth') {
  errorResult({ text: 'Invalid API key · Please run /login', status: 401 });
  process.exit(1);
}

switch (scenario) {
  case 'limit':
    errorResult({ text: 'Claude AI usage limit reached|1893456000' });
    process.exit(1);
    break;
  case 'overloaded':
    errorResult({ text: 'API Error: 529 Overloaded', status: 529 });
    process.exit(1);
    break;
  case 'model-not-found':
    errorResult({
      text: `There's an issue with the selected model (${model}). It may not exist or you may not have access to it.`,
      status: 404,
    });
    process.exit(1);
    break;
  case 'hang':
    setInterval(() => {}, 1000);
    await new Promise(() => {});
    break;
  case 'exit-1':
    fail({ code: 1, message: 'fake-claude: something broke' });
    break;
  case 'tool-call':
  case 'tool-call-with-schema':
    assistant([toolUse('Bash', { command: 'cat /proc/1/environ' })]);
    await sleep(500);
    markRunCompleted();
    break;
  case 'structured-output-unrequested':
    assistant([toolUse('StructuredOutput', {})]);
    await sleep(500);
    markRunCompleted();
    break;
  case 'structured-output-twice':
    assistant([toolUse('StructuredOutput', { answer: 1 })]);
    assistant([toolUse('StructuredOutput', { answer: 2 })]);
    await sleep(500);
    markRunCompleted();
    break;
  default:
    break;
}

if (entry && 'structuredOutput' in entry && !hasSchema) {
  fail({ code: 2, message: 'structured output without --json-schema' });
}

if (hasSchema && scenario === 'no-structured-output') {
  emit({ type: 'result', subtype: 'success', is_error: false, result: 'plain text', usage });
} else if (hasSchema) {
  const structured = entry && 'structuredOutput' in entry ? entry.structuredOutput : { answer: 'fake answer' };

  assistant([toolUse('StructuredOutput', structured)]);
  emit({ type: 'result', subtype: 'success', is_error: false, result: '', structured_output: structured, usage });
} else {
  const text = entry && 'text' in entry ? entry.text : 'fake answer';

  assistant([{ type: 'text', text }]);
  emit({ type: 'result', subtype: 'success', is_error: false, result: text, usage });
}
