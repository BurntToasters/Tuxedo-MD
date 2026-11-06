#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import console from 'node:console';
import { readFileSync } from 'node:fs';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const RUST_TOOLCHAIN_FILE = fileURLToPath(
  new URL('../rust-toolchain.toml', import.meta.url)
);

const EXACT_RUST_VERSION = /^\d+\.\d+\.\d+$/u;

function malformed(filePath, line, detail) {
  return new Error(`Malformed rust-toolchain.toml at ${filePath}: ${detail} (line: ${line})`);
}

function parseQuotedString(token, key, line, filePath) {
  let match = token.match(/^"((?:[^"\\]|\\.)*)"$/u);
  if (match) {
    return match[1].replace(/\\(["\\])/gu, '$1');
  }
  match = token.match(/^'([^']*)'$/u);
  if (match) return match[1];
  throw malformed(filePath, line, `invalid string value for ${key}`);
}

function parseStringArray(value, key, line, filePath) {
  const match = value.match(/^\[(.*)\]\s*(?:#.*)?$/u);
  if (!match) throw malformed(filePath, line, `invalid array value for ${key}`);

  const inner = match[1].trim();
  if (!inner) return [];

  const items = [];
  const parts = inner.split(',');
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index].trim();
    if (!part) {
      if (index === parts.length - 1) continue;
      throw malformed(filePath, line, `empty ${key} array item`);
    }
    items.push(parseQuotedString(part, key, line, filePath));
  }
  return items;
}

function parseStringValue(value, key, line, filePath) {
  const match = value.match(/^("(?:[^"\\]|\\.)*"|'[^']*')\s*(?:#.*)?$/u);
  if (!match) throw malformed(filePath, line, `invalid string value for ${key}`);
  const parsed = parseQuotedString(match[1], key, line, filePath);
  if (!parsed.trim()) throw malformed(filePath, line, `empty ${key}`);
  if (/[\p{Cc}]/u.test(parsed)) {
    throw malformed(filePath, line, `${key} contains control characters`);
  }
  return parsed.trim();
}

export function readPinnedRustToolchain(filePath = RUST_TOOLCHAIN_FILE) {
  let text;
  try {
    text = readFileSync(filePath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new Error(`Rust toolchain pin not found: ${filePath}`, { cause: error });
    }
    throw error;
  }

  const lines = text.replace(/^\uFEFF/u, '').split(/\r?\n/u);
  let section = null;
  let sawToolchain = false;
  let channel;
  let profile;
  let components;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const sectionMatch = line.match(/^\[\s*([^\]]+?)\s*\]\s*(?:#.*)?$/u);
    if (sectionMatch) {
      section = sectionMatch[1];
      if (section === 'toolchain') sawToolchain = true;
      continue;
    }

    const pair = line.match(/^([A-Za-z0-9_-]+)\s*=\s*(.+)$/u);
    if (!pair) throw malformed(filePath, line, 'expected key = value');
    if (section !== 'toolchain') continue;

    const [, key, value] = pair;
    if (key === 'channel') {
      if (channel !== undefined) throw malformed(filePath, line, 'duplicate channel');
      channel = parseStringValue(value, key, line, filePath);
    } else if (key === 'profile') {
      if (profile !== undefined) throw malformed(filePath, line, 'duplicate profile');
      profile = parseStringValue(value, key, line, filePath);
    } else if (key === 'components') {
      if (components !== undefined) throw malformed(filePath, line, 'duplicate components');
      components = parseStringArray(value, key, line, filePath);
      if (components.length === 0) {
        throw malformed(filePath, line, 'components must not be empty');
      }
      if (components.some((component) => !component)) {
        throw malformed(filePath, line, 'components must not contain empty names');
      }
    }
  }

  if (!sawToolchain) {
    throw new Error(`Malformed rust-toolchain.toml at ${filePath}: missing [toolchain] table`);
  }
  if (channel === undefined) {
    throw new Error(`Malformed rust-toolchain.toml at ${filePath}: missing channel`);
  }
  if (!EXACT_RUST_VERSION.test(channel)) {
    throw new Error(
      `Malformed rust-toolchain.toml at ${filePath}: must pin an exact Rust version; found ${channel}`
    );
  }

  return {
    channel,
    profile,
    components: components ?? [],
  };
}

export function rustupInstallArguments({ channel, profile = undefined, components = [] }) {
  const args = ['toolchain', 'install', channel];
  if (profile) args.push('--profile', profile);
  for (const component of components) args.push('--component', component);
  return args;
}

export function rustupDefaultArguments({ channel }) {
  return ['default', channel];
}

export function rustupTargetArguments({ channel }, targets) {
  return ['target', 'add', ...targets, '--toolchain', channel];
}

function run(command, args) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32' && /\.cmd$/iu.test(command),
  });
  if (result.error) {
    if (result.error.code === 'ENOENT') {
      throw new Error(`${command} was not found on PATH`, { cause: result.error });
    }
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}`);
  }
}

export function parseCliArguments(argv) {
  const options = { install: false, setDefault: false, targets: [], help: false, print: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--install') {
      options.install = true;
    } else if (argument === '--default') {
      options.setDefault = true;
    } else if (argument === '--target') {
      const target = argv[index + 1];
      if (!target || target.startsWith('--')) {
        throw new Error('--target requires a target triple');
      }
      options.targets.push(target);
      index += 1;
    } else if (argument === '--print') {
      options.print = true;
    } else if (argument === '--help' || argument === '-h') {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  if (options.print && (options.install || options.setDefault || options.targets.length > 0)) {
    throw new Error('--print cannot be combined with an action');
  }
  return options;
}

function printUsage() {
  console.log(`Usage: node scripts/rust-toolchain.mjs [options]

With no options, prints the channel pinned in rust-toolchain.toml.

Options:
  --print           Print the pinned channel (same as no options)
  --install       Install the pinned toolchain, profile, and components
  --target TRIPLE   Add a target to the pinned toolchain (repeatable)
  --default         Set the pinned toolchain as the rustup default
  --help, -h        Show this help`);
}

function main(argv = process.argv.slice(2)) {
  const options = parseCliArguments(argv);
  if (options.help) {
    printUsage();
    return;
  }

  const config = readPinnedRustToolchain();

  if (!options.install && !options.setDefault && options.targets.length === 0) {
    process.stdout.write(`${config.channel}\n`);
    return;
  }

  if (options.install) run('rustup', rustupInstallArguments(config));
  if (options.setDefault) run('rustup', rustupDefaultArguments(config));
  if (options.targets.length > 0) run('rustup', rustupTargetArguments(config, options.targets));
}

const isMainModule = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMainModule) {
  try {
    main();
  } catch (error) {
    console.error(`rust-toolchain: ${error.message}`);
    process.exitCode = 1;
  }
}
