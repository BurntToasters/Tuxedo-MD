import readline from 'node:readline/promises';

if (process.env.TUXEDO_RELEASE_CONFIRM === 'YES') process.exit(0);
if (!process.stdin.isTTY) {
  console.error('Set TUXEDO_RELEASE_CONFIRM=YES for a non-interactive release.');
  process.exit(1);
}
const prompt = readline.createInterface({ input: process.stdin, output: process.stdout });
const answer = await prompt.question(
  'This will create/upload release artifacts. Type RELEASE to continue: '
);
prompt.close();
if (answer !== 'RELEASE') process.exit(1);
