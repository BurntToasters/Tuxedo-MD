import { execFileSync } from 'node:child_process';

const dryRun = process.argv.includes('--dry-run');
const force = process.argv.includes('--force');
const git = (args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
git(['fetch', '--prune']);
const current = git(['branch', '--show-current']);
const branches = git(['for-each-ref', '--format=%(refname:short) %(upstream:track)', 'refs/heads'])
  .split('\n')
  .filter(Boolean)
  .filter((line) => line.endsWith('[gone]'))
  .map((line) => line.split(' ')[0])
  .filter((branch) => branch !== current && !['main', 'beta'].includes(branch));
for (const branch of branches) {
  if (dryRun) console.log(`Would delete ${branch}`);
  else {
    execFileSync('git', ['branch', force ? '-D' : '-d', branch], { stdio: 'inherit' });
  }
}
if (!branches.length) console.log('No gone local branches found.');
