// The service worker precaches an explicit list; a file added to public/ but
// not to SHELL would quietly be missing offline.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const publicDir = fileURLToPath(new URL('../public/', import.meta.url));

test('the service worker precaches every file in public/', () => {
    const sw = readFileSync(`${publicDir}sw.js`, 'utf8');
    const shell = [...sw.match(/const SHELL = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    const files = readdirSync(publicDir, { recursive: true, withFileTypes: true })
        .filter((d) => d.isFile())
        .map((d) => `${d.parentPath ?? d.path}/${d.name}`.slice(publicDir.length).replace(/^\//, ''))
        .filter((f) => f !== 'sw.js');
    assert.deepEqual(shell.filter((f) => f !== './').sort(), files.sort());
});
