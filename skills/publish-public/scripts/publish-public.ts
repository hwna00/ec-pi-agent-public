import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, rmdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// Only committed blobs are exported. Private Git objects never enter Public.
const source = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

function git(cwd: string, args: string[], input?: string | Uint8Array) {
  const result = spawnSync('git', ['-C', cwd, ...args], {
    input, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr.toString().trim() || `git ${args[0]} failed`);
  return result.stdout;
}

const text = (cwd: string, ...args: string[]) => git(cwd, args).toString().trim();
const normalizeRemote = (value: string) => value.replace(/^git@github\.com:/, 'https://github.com/').replace(/\.git\/?$/, '').replace(/\/$/, '');
const inside = (parent: string, child: string) => child === parent || child.startsWith(parent + sep);

function secretFindings(path: string, content: string) {
  const rules: [string, RegExp][] = [
    ['API key', /\b(?:sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{30,}|AKIA[A-Z0-9]{16}|AIza[A-Za-z0-9_-]{35}|lsv2_pt_[A-Za-z0-9_]{20,})\b/g],
    ['private key', /-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----/g],
    ['private IP', /\b(?:10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2})\b/g],
    ['personal path', /(?:\/Users\/[^/\s]+\/|\/home\/[^/\s]+\/|[A-Z]:[\\/]Users[\\/])/g],
  ];
  const findings: string[] = [];
  const add = (kind: string, match: RegExpMatchArray) => findings.push(`${path}:${content.slice(0, match.index).split('\n').length} (${kind})`);
  for (const [kind, pattern] of rules) {
    for (const match of content.matchAll(pattern)) add(kind, match);
  }
  const example = /^(?:<[^>]+>|\$\{[^}]+\}|user(?:name)?|pass(?:word)?|test(?:[-_].*)?|dummy(?:[-_].*)?|fake(?:[-_].*)?|fixture(?:[-_].*)?|example(?:[-_].*)?|your[-_].*|placeholder)$/i;
  const testFile = /(?:^|\/)(?:tests?|__tests__)\/|\.(?:test|spec)\./.test(path);
  for (const match of content.matchAll(/(?:postgres(?:ql)?|mongodb(?:\+srv)?|redis|https?):\/\/([^\s/"':]+):([^\s/@"']+)@([^\s/:"']+)/g)) {
    const localFixture = testFile && ['127.0.0.1', 'localhost'].includes(match[3]) &&
      [match[1], match[2]].every(value => /^(?:fixture|search|test)[-_](?:user|password)$/.test(value));
    if (!localFixture && (!example.test(match[1]) || !example.test(match[2]))) add('credential URI', match);
  }
  for (const match of content.matchAll(/["']?(?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password|passwd)["']?\s*[:=]\s*["']([^"'\n]+)["']/gi)) {
    if (!example.test(match[1].trim()) && !(testFile && match[1].trim() === 'secret')) add('literal credential', match);
  }
  return [...new Set(findings)];
}

function removeFile(root: string, path: string) {
  const full = join(root, path);
  unlinkSync(full);
  for (let dir = dirname(full); dir !== root; dir = dirname(dir)) {
    try { rmdirSync(dir); } catch (error) {
      if (['ENOTEMPTY', 'EEXIST'].includes((error as NodeJS.ErrnoException).code ?? '')) break;
      throw error;
    }
  }
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log('npm run publish:public:check  # inspect committed source; no upload\nnpm run publish:public        # sync, commit, and push\nSettings: public-export.json; exclusions: Public .gitignore');
    return;
  }
  if (args.some(arg => !['--check', '--push'].includes(arg)) || args.includes('--check') && args.includes('--push')) {
    throw new Error('Use --check or --push.');
  }
  const push = args.includes('--push');
  const config: { repository: string; directory: string; branch: string } = JSON.parse(readFileSync(join(source, 'public-export.json'), 'utf8'));
  const targetPath = resolve(source, config.directory);
  const branch = config.branch;
  const sourceRoot = realpathSync(text(source, 'rev-parse', '--show-toplevel'));
  if (sourceRoot !== realpathSync(source)) throw new Error('Run from the Private repository.');
  if (normalizeRemote(text(source, 'remote', 'get-url', 'origin')) === normalizeRemote(config.repository)) {
    throw new Error('Private and Public remotes must differ.');
  }
  const existingParent = realpathSync(dirname(targetPath));
  const target = existsSync(targetPath) ? realpathSync(targetPath) : join(existingParent, basename(targetPath));
  if (inside(sourceRoot, target) || inside(target, sourceRoot)) throw new Error('Private and Public directories must not overlap.');
  if (!existsSync(target)) {
    if (!push) throw new Error('Public checkout is missing. Clone the configured repository first, or run --push.');
    git(source, ['clone', '--single-branch', '--branch', branch, '--', config.repository, target]);
  }
  if (realpathSync(text(target, 'rev-parse', '--show-toplevel')) !== target) throw new Error('Public must be a separate Git checkout.');
  if (normalizeRemote(text(target, 'remote', 'get-url', 'origin')) !== normalizeRemote(config.repository)) {
    throw new Error('Public origin does not match public-export.json.');
  }
  if (text(target, 'symbolic-ref', '--short', 'HEAD') !== branch) throw new Error(`Public must be on ${branch}.`);
  if (text(target, 'status', '--porcelain', '--untracked-files=all')) throw new Error('Public has local changes. Commit or restore them first.');

  const commit = text(source, 'rev-parse', 'HEAD');
  if (push) {
    const sourceBranch = text(source, 'symbolic-ref', '--short', 'HEAD');
    git(source, ['fetch', 'origin', sourceBranch]);
    if (commit !== text(source, 'rev-parse', 'FETCH_HEAD')) throw new Error('Push the Private commit first.');
    git(target, ['pull', '--ff-only', 'origin', branch]);
  }
  const ignore = readFileSync(join(target, '.gitignore'));
  const temp = mkdtempSync(join(tmpdir(), 'pi-public-export-'));
  try {
    // A fresh filter repository prevents Private nested .gitignore overrides.
    git(temp, ['init', '--quiet']);
    writeFileSync(join(temp, '.gitignore'), ignore);
    const entries = git(source, ['ls-tree', '-r', '-z', '--full-tree', commit]).toString().split('\0').filter(Boolean).map(entry => {
      const tab = entry.indexOf('\t');
      const [mode, type, oid] = entry.slice(0, tab).split(' ');
      return { mode, type, oid, path: entry.slice(tab + 1) };
    }).filter(entry => entry.path.split('/').at(-1) !== '.gitignore' && entry.path !== '.github/workflows/publish-public.yml');
    const result = spawnSync('git', ['-c', 'core.excludesFile=', '-C', temp, 'check-ignore', '--no-index', '--stdin', '-z'], {
      input: entries.map(entry => entry.path + '\0').join(''), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    });
    if (result.error) throw result.error;
    if (result.status !== 0 && result.status !== 1) throw new Error(result.stderr.trim() || 'Git ignore check failed.');
    const ignored = new Set(result.stdout.split('\0'));
    const files = new Map<string, { content: Buffer; mode: number }>();
    const findings: string[] = [];
    for (const entry of entries) {
      if (ignored.has(entry.path)) continue;
      if (!['100644', '100755'].includes(entry.mode) || entry.type !== 'blob') {
        throw new Error(`Review symlink/submodule before export: ${entry.path}`);
      }
      const content = git(source, ['cat-file', 'blob', entry.oid]);
      findings.push(...secretFindings(entry.path, content.toString('utf8')));
      files.set(entry.path, { content, mode: entry.mode === '100755' ? 0o755 : 0o644 });
    }
    console.log(`Source: ${commit.slice(0, 12)}; export: ${files.size}; excluded: ${entries.length - files.size}`);
    if (text(source, 'status', '--porcelain')) console.log('Uncommitted changes are not exported.');
    if (findings.length) throw new Error('Review these files or exclude them in Public .gitignore:\n' + findings.join('\n'));
    const tracked = git(target, ['ls-files', '-z']).toString().split('\0').filter(path => path && path !== '.gitignore');
    const changes: string[] = [];
    for (const path of tracked) if (!files.has(path)) changes.push(`D ${path}`);
    for (const [path, file] of files) {
      const full = join(target, path);
      if (!tracked.includes(path)) changes.push(`A ${path}`);
      else if (!readFileSync(full).equals(file.content) || Boolean(statSync(full).mode & 0o111) !== (file.mode === 0o755)) changes.push(`M ${path}`);
    }
    console.log(changes.join('\n') || 'No content changes.');
    if (!push) {
      console.log('Check complete. Public was not modified or uploaded.');
      return;
    }
    // Remove tracked exports only; leave .gitignore and ignored local files alone.
    for (const path of tracked) removeFile(target, path);
    for (const [path, file] of files) {
      const full = join(target, path);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, file.content, { mode: file.mode });
    }
    git(target, ['add', '--all']);
    if (text(target, 'diff', '--cached', '--name-only')) git(target, ['commit', '-m', 'Update public sources']);
    git(target, ['push', 'origin', branch]);
    console.log('Public updated.');
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

try { main(); } catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
