import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Playwright globalTeardown: reveal the output folder once capture finishes.
// Fire-and-forget and fully non-fatal — a headless/CI run (no desktop) just
// logs the path instead of failing.
export default function openOutputFolder(): void {
  const dir = fileURLToPath(new URL('../screenshots', import.meta.url));
  console.log(`\nScreenshots written to ${dir}`);

  const opener =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open';
  const child = spawn(opener, [dir], { detached: true, stdio: 'ignore' });
  child.on('error', () => {}); // no GUI / opener missing — the logged path is enough
  child.unref();
}
