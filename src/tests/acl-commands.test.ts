import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function parseTomlAllowList(toml: string): string[] {
  const match = toml.match(/commands\.allow\s*=\s*\[([\s\S]*?)\]/);
  if (!match) return [];
  return [...match[1].matchAll(/"([^"]+)"/g)].map((item) => item[1]).sort();
}

function parseHandlerList(source: string): string[] {
  const match = source.match(/generate_handler!\s*\[\s*([\s\S]*?)\]/);
  if (!match) return [];
  return match[1]
    .split(',')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('//'))
    .sort();
}

describe('Tauri ACL command parity', () => {
  it('keeps allow-app-commands aligned with generate_handler!', () => {
    const permissions = fs.readFileSync(
      path.join(root, 'src-tauri/permissions/app-commands.toml'),
      'utf8'
    );
    const lib = fs.readFileSync(path.join(root, 'src-tauri/src/lib.rs'), 'utf8');
    const capabilities = JSON.parse(
      fs.readFileSync(path.join(root, 'src-tauri/capabilities/default.json'), 'utf8')
    ) as { permissions: string[] };

    const allowed = parseTomlAllowList(permissions);
    const handlers = parseHandlerList(lib);

    expect(allowed).toEqual(handlers);
    expect(capabilities.permissions).toContain('allow-app-commands');
  });
});
