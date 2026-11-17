/*
 * token-radar-01 entry program (Node 22, standard library only).
 *
 * What it does, in order:
 *   1. reads the sealed snapshot from /input/snapshot.json (or --input),
 *   2. scores every pre-token protocol with the radar-2 model in lib/model.ts,
 *   3. writes /output/board.json, the ranked board the gate reads,
 *   4. writes /output/data.js, the same board plus each row's farm plan so the
 *      page renders the plan from data instead of inventing it in the browser,
 *   5. copies dashboard/ and screenshots/ into /output,
 *   6. writes /output/dossier.json last with the vendored buildDossier, because
 *      the scorer rebuilds it from /output and compares the bytes.
 *
 * The page is static and reads ../data.js: no fetch, no network, no framework.
 * Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
 *
 *   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input input/snapshot.json
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

/** The dossier's text cap: a page past it reaches the judge only in part. */
const TEXT_MAX_BYTES = 65_536;

/** The gate's own screenshot caps, so a bad image fails here rather than at the site. */
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };

/** A file name the gate accepts: letters, digits and . _ -, not starting with . or -. */
const FILE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** The project root, whatever directory node was started from. */
const root = fileURLToPath(new URL('.', import.meta.url));

/** One `--flag value` or `--flag=value` out of the arguments, else the fallback. */
function flag(name: string, fallback: string): string {
  const args = process.argv;
  const at = args.indexOf(`--${name}`);
  if (at !== -1 && at + 1 < args.length) return args[at + 1] as string;
  const inline = args.find((a) => a.startsWith(`--${name}=`));
  if (inline !== undefined) return inline.slice(name.length + 3);
  return fallback;
}

/** Stop with a message the operator can act on. */
function die(message: string): never {
  process.stderr.write(`token radar: ${message}\n`);
  process.exit(1);
}

const inputArg = flag('input', '/input');
const snapshotPath = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(snapshotPath)) die(`no snapshot at ${snapshotPath}: pass --input <snapshot.json|directory>`);
const outDir = flag('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(snapshotPath, 'utf8'));
const { board, radar } = buildRadar(snapshot);

const issue = boardIssue(board, snapshot);
if (issue !== null) die(`the model wrote a board the gate refuses: ${issue}`);

/* board.json keeps a farm step as one sentence, which is the gate's shape.
 * The page shows the action, the cost and the time as three separate pieces,
 * so they are split here, once, rather than parsed again in the browser. A
 * step is written "<action> Cost: <cost>. Time: <time>." by lib/model.ts. */
const planBySlug = new Map(board.map((row) => [row.slug, row.farm_steps]));
const pageRows = radar.rows.map((row) => ({
  ...row,
  farm: (planBySlug.get(row.slug) ?? []).map((line) => {
    const cost = / Cost: (.*?)\. Time: /u.exec(line);
    const time = / Time: (.*)\.$/u.exec(line);
    return {
      action: line.replace(/ Cost: .*?\. Time: .*\.$/u, ''),
      cost: cost === null ? '' : (cost[1] as string),
      time: time === null ? '' : (time[1] as string),
    };
  }),
}));

const page = { ...radar, rows: pageRows, watchlist: snapshot.watchlist };

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(outDir, 'data.js'), `window.RADAR=${JSON.stringify(page)};\n`);

/** Copy the regular files of one directory, skipping dotfiles, and return their names. */
function copyTree(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

const dashboardFiles = copyTree(join(root, 'dashboard'), join(outDir, 'dashboard'));
if (!dashboardFiles.includes('index.html')) die('dashboard/index.html is missing');
if (!dashboardFiles.some((n) => n.endsWith('.css'))) die('dashboard/ needs at least one .css file');
if (!dashboardFiles.some((n) => n.endsWith('.js'))) die('dashboard/ needs at least one .js file');
for (const name of dashboardFiles) if (!FILE_NAME.test(name)) die(`dashboard/${name}: bad name`);

const shots = copyTree(join(root, 'screenshots'), join(outDir, 'screenshots'));
if (shots.length < 3) die(`screenshots/ holds ${shots.length}: hand in the board, a detail view and a filtered view`);
for (const name of shots) if (!FILE_NAME.test(name)) die(`screenshots/${name}: bad name`);

writeFileSync(
  join(outDir, 'dossier.json'),
  buildDossier(outDir, {
    text_max_bytes: TEXT_MAX_BYTES,
    screenshots: SCREENSHOT_CAPS,
    dashboard: { max_files: 400, max_bytes: 4_194_304 },
  }),
);

process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols read, ${snapshot.watchlist.length} on the watchlist\n` +
    `token radar: board ${board.length} rows (${radar.early_size} outside the watchlist), ${radar.live_size} live protocols set aside\n` +
    `token radar: wrote board.json, data.js, dashboard/ (${dashboardFiles.length} files), screenshots/ (${shots.length}), dossier.json\n`,
);
