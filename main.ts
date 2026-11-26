import { cpSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const CAPS = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
};

function countFiles(dir: string): number {
  let count = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      count += countFiles(full);
    } else if (entry.isFile()) {
      count += 1;
    }
  }
  return count;
}

function copyDirectory(name: string, sourceRoot: string, outputDir: string): number {
  const source = join(sourceRoot, name);
  const dest = join(outputDir, name);
  const st = statSync(source);
  if (!st.isDirectory()) {
    throw new Error(`${name}/ is not a directory: ${source}`);
  }
  const files = countFiles(source);
  rmSync(dest, { recursive: true, force: true });
  cpSync(source, dest, { recursive: true, force: true });
  return files;
}

/**
 * Fail fast with a plain message when the hand-in would break a cap anyway,
 * instead of surfacing a deep DossierError after the copy. Screenshots must
 * number 3 or 4 (the first by name is the cover) and each fit the byte cap;
 * the game tree must fit the file-count cap.
 */
function preflight(sourceRoot: string): void {
  const shotsDir = join(sourceRoot, 'screenshots');
  const images = readdirSync(shotsDir, { withFileTypes: true })
    .filter((e) => e.isFile() && ['.jpg', '.jpeg', '.png'].includes(extname(e.name).toLowerCase()))
    .map((e) => e.name)
    .sort();
  if (images.length < 3 || images.length > CAPS.screenshots.max) {
    throw new Error(`screenshots/ must hold 3 or 4 images, found ${images.length}`);
  }
  for (const name of images) {
    const size = statSync(join(shotsDir, name)).size;
    if (size > CAPS.screenshots.max_bytes) {
      throw new Error(`screenshots/${name} is ${size} bytes, over the ${CAPS.screenshots.max_bytes} cap`);
    }
  }
  const gameFiles = countFiles(join(sourceRoot, 'game'));
  if (gameFiles > CAPS.game_max_files) {
    throw new Error(`game/ holds ${gameFiles} files, over the ${CAPS.game_max_files} cap`);
  }
}

function main(): void {
  const sourceRoot = dirname(fileURLToPath(import.meta.url));
  const outputDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

  preflight(sourceRoot);

  mkdirSync(outputDir, { recursive: true });

  const gameFiles = copyDirectory('game', sourceRoot, outputDir);
  const screenshotFiles = copyDirectory('screenshots', sourceRoot, outputDir);
  const totalFiles = gameFiles + screenshotFiles;

  const dossier = buildDossier(outputDir, CAPS);
  const dossierPath = join(outputDir, 'dossier.json');
  writeFileSync(dossierPath, dossier);

  console.log(
    `Copied ${totalFiles} files (game: ${gameFiles}, screenshots: ${screenshotFiles}) to ${outputDir}`,
  );
  console.log(`Wrote dossier.json: ${dossier.length} bytes to ${dossierPath}`);
}

try {
  main();
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`Error: ${message}`);
  process.exit(1);
}
