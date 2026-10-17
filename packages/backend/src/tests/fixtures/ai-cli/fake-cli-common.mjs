// Shared helpers of the fake `claude` and `codex` binaries used by backend tests. Not a test of its own.
import fs from 'node:fs';
import path from 'node:path';

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function emit(event) {
  process.stdout.write(`${JSON.stringify(event)}\n`);
}

export function fail({ code, message }) {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

export async function readStdin() {
  const chunks = [];

  for await (const chunk of process.stdin) chunks.push(chunk);

  return Buffer.concat(chunks).toString('utf8');
}

/**
 * The Nth run answers with the Nth entry of `MM_FAKE_CLI_RESPONSE_FILE`, the last entry repeats,
 * and the cursor lives in `<file>.cursor`. Returns null when no file is configured.
 */
export function nextResponse() {
  const file = process.env.MM_FAKE_CLI_RESPONSE_FILE;

  if (!file) return null;

  const { responses } = JSON.parse(fs.readFileSync(file, 'utf8'));
  const cursorFile = `${file}.cursor`;
  const cursor = fs.existsSync(cursorFile) ? Number(fs.readFileSync(cursorFile, 'utf8')) : 0;

  fs.writeFileSync(cursorFile, String(cursor + 1));

  return responses[Math.min(cursor, responses.length - 1)] ?? null;
}

/** Appends one line per invocation to `<state dir>/runs.jsonl` so tests can assert argv, stdin and env. */
export function recordRun({ bin, argv, stdin, extra = {} }) {
  const dir = process.env.MM_FAKE_CLI_STATE_DIR;

  if (!dir) return;

  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(
    path.join(dir, 'runs.jsonl'),
    `${JSON.stringify({ bin, argv, stdin, pid: process.pid, cwd: process.cwd(), envKeys: Object.keys(process.env), ...extra })}\n`,
  );
}

/** Marks that a run got past the point where the adapter should have killed it. */
export function markRunCompleted() {
  const dir = process.env.MM_FAKE_CLI_STATE_DIR;

  if (!dir) return;

  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'run-completed'), '1');
}

export function flagValue({ argv, name }) {
  const index = argv.indexOf(name);

  return index === -1 ? undefined : argv[index + 1];
}

export function flagValues({ argv, name }) {
  return argv.flatMap((arg, index) => (arg === name ? [argv[index + 1]] : []));
}
