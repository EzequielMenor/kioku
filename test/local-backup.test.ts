import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, statSync, rmSync, copyFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const script = new URL('../scripts/kioku-backup.sh', import.meta.url).pathname;
function fixture(state = 'exited', mode = 'ok') {
  const dir = mkdtempSync(path.join(tmpdir(), 'kioku-backup-'));
  const bin = path.join(dir, 'bin'); mkdirSync(bin);
  const source = path.join(dir, 'source'); mkdirSync(source); mkdirSync(path.join(source, '.kioku'));
  writeFileSync(path.join(source, '.kioku', 'key'), 'secret-test-only');
  writeFileSync(path.join(source, 'note.md'), '# Fixture');
  const archive = path.join(dir, 'fixture.tar');
  assert.equal(spawnSync('tar', ['-cf', archive, '-C', source, '.']).status, 0);
  const log = path.join(dir, 'calls');
  writeFileSync(path.join(bin, 'docker'), `#!/bin/bash\necho "$1" >> "$LOG"\ncase "$1" in\ncompose) echo fixture-container;;\ninspect) echo "$STATE";;\ncp) case "$MODE" in fail) exit 7;; corrupt) printf garbage;; *) /bin/cat "$ARCHIVE";; esac;;\n*) exit 9;;\nesac\n`, { mode: 0o700 });
  const dest = path.join(dir, 'backup');
  const run = (...args: string[]) => spawnSync('bash', [script, ...args], { encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, STATE: state, MODE: mode, LOG: log, ARCHIVE: archive } });
  return { dir, dest, log, run, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
test('backup: exports full data including hidden credentials with private permissions and checksum', () => {
  const s = fixture(); try {
    const r = s.run(s.dest); assert.equal(r.status, 0, r.stderr);
    assert.match(readFileSync(path.join(s.dest, 'entries.txt'), 'utf8'), /\.kioku\/key/);
    assert.equal(statSync(s.dest).mode & 0o777, 0o700);
    assert.equal(statSync(path.join(s.dest, 'data.tar')).mode & 0o777, 0o600);
    assert.equal(spawnSync('shasum', ['-a', '256', '-c', 'SHA256SUMS'], { cwd: s.dest }).status, 0);
    assert.doesNotMatch(r.stdout + r.stderr, /secret-test-only/);
    assert.equal(readFileSync(s.log, 'utf8'), 'compose\ninspect\ncp\ninspect\n');
  } finally { s.cleanup(); }
});
for (const state of ['running', 'paused', 'unknown']) test(`backup: refuses ${state} before creating a destination`, () => {
  const s = fixture(state); try {
    const r = s.run(s.dest); assert.notEqual(r.status, 0); assert.equal(existsSync(s.dest), false);
    assert.doesNotMatch(readFileSync(s.log, 'utf8'), /cp/);
  } finally { s.cleanup(); }
});
for (const mode of ['fail', 'corrupt']) test(`backup: ${mode} export never reports success`, () => {
  const s = fixture('exited', mode); try {
    const r = s.run(s.dest); assert.notEqual(r.status, 0); assert.match(r.stderr, /incompleta/);
    assert.doesNotMatch(r.stdout, /checksum comprobado/);
    assert.equal(existsSync(path.join(s.dest, 'SHA256SUMS')), false);
  } finally { s.cleanup(); }
});
test('backup: rejects an in-repository destination through a symlinked checkout', () => {
  const s = fixture(); try {
    const checkout = path.join(s.dir, 'checkout');
    mkdirSync(path.join(checkout, 'scripts'), { recursive: true });
    copyFileSync(script, path.join(checkout, 'scripts', 'kioku-backup.sh'));
    const alias = path.join(s.dir, 'alias');
    symlinkSync(checkout, alias, 'dir');
    const dest = path.join(checkout, 'private-backup');
    const r = spawnSync('bash', [path.join(alias, 'scripts', 'kioku-backup.sh'), dest], {
      encoding: 'utf8', env: { ...process.env, PATH: `${path.join(s.dir, 'bin')}:${process.env.PATH}`, LOG: s.log, STATE: 'exited', MODE: 'ok', ARCHIVE: path.join(s.dir, 'fixture.tar') },
    });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /fuera del repositorio/);
    assert.equal(existsSync(dest), false);
  } finally { s.cleanup(); }
});

test('backup: never overwrites an existing destination; help needs no Docker', () => {
  const s = fixture(); try {
    mkdirSync(s.dest); writeFileSync(path.join(s.dest, 'keep'), 'untouched');
    assert.notEqual(s.run(s.dest).status, 0);
    assert.equal(readFileSync(path.join(s.dest, 'keep'), 'utf8'), 'untouched');
    assert.equal(existsSync(s.log), false);
    assert.equal(s.run('--help').status, 0);
    assert.notEqual(s.run('relative').status, 0);
  } finally { s.cleanup(); }
});
