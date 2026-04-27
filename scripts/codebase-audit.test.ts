import { spawnSync } from 'node:child_process';

type AuditStep = {
  label: string;
  command: string;
  args: string[];
};

const steps: AuditStep[] = [
  {
    label: 'TypeScript',
    command: 'npx',
    args: ['tsc', '--noEmit', '--pretty', 'false', '--incremental', 'false'],
  },
  {
    label: 'WTR unit suite',
    command: 'npm',
    args: ['run', 'test:wtr-live', '--', '--unit'],
  },
];

let failed = false;

console.log('\n=== MIYO Codebase Audit ===\n');

for (const step of steps) {
  console.log(`--- ${step.label} ---`);
  const result = spawnSync(step.command, step.args, {
    stdio: 'pipe',
    encoding: 'utf8',
    timeout: 180_000,
  });

  const stdout = result.stdout?.trim();
  const stderr = result.stderr?.trim();

  if (stdout) console.log(stdout);
  if (stderr) console.error(stderr);

  if (result.error) {
    failed = true;
    console.error(`[${step.label}] execution error: ${result.error.message}`);
    continue;
  }

  if (result.status !== 0) {
    failed = true;
    console.error(`[${step.label}] failed with exit code ${result.status}.`);
  } else {
    console.log(`[${step.label}] passed.\n`);
  }
}

if (failed) {
  console.error('Codebase audit finished with failures.');
  process.exit(1);
}

console.log('Codebase audit passed.');
