#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const logsDir = path.join(projectRoot, 'perf-logs');

function getNpmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      ...options,
    });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`));
      }
    });
  });
}

function startPreviewServer() {
  const npmCommand = getNpmCommand();
  const child = spawn(
    npmCommand,
    ['run', 'preview', '--', '--host', '127.0.0.1', '--port', '0'],
    {
      cwd: projectRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    },
  );

  return new Promise((resolve, reject) => {
    let resolved = false;
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        child.kill('SIGTERM');
        reject(new Error('Timed out waiting for Vite preview server to start.'));
      }
    }, 30000);

    const handleOutput = (buffer) => {
      const text = buffer.toString();
      process.stdout.write(text);
      const match = text.match(/http:\/\/(?:127\.0\.0\.1|localhost|0\.0\.0\.0):(\d+)/);
      if (match && !resolved) {
        resolved = true;
        clearTimeout(timeout);
        const port = Number(match[1]);
        resolve({
          port,
          url: `http://127.0.0.1:${port}`,
          child,
        });
      }
    };

    const handleErrorOutput = (buffer) => {
      const text = buffer.toString();
      process.stderr.write(text);
    };

    child.stdout?.on('data', handleOutput);
    child.stderr?.on('data', (data) => {
      handleErrorOutput(data);
      if (!resolved) {
        const text = data.toString();
        const match = text.match(/http:\/\/(?:127\.0\.0\.1|localhost|0\.0\.0\.0):(\d+)/);
        if (match) {
          resolved = true;
          clearTimeout(timeout);
          const port = Number(match[1]);
          resolve({
            port,
            url: `http://127.0.0.1:${port}`,
            child,
          });
        }
      }
    });

    child.on('error', (error) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        reject(error);
      }
    });

    child.on('exit', (code) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        reject(new Error(`Vite preview exited early with code ${code}`));
      }
    });
  });
}

function waitForProcessExit(child) {
  return new Promise((resolve) => {
    if (!child) {
      resolve();
      return;
    }
    const onExit = () => {
      child.off('exit', onExit);
      child.off('close', onExit);
      resolve();
    };
    child.on('exit', onExit);
    child.on('close', onExit);
  });
}

async function stopPreviewServer(child) {
  if (!child) {
    return;
  }
  child.kill('SIGTERM');
  const timeout = setTimeout(() => {
    if (!child.killed) {
      child.kill('SIGKILL');
    }
  }, 5000);
  await waitForProcessExit(child);
  clearTimeout(timeout);
}

function formatValue(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return '—';
  }
  if (Math.abs(value) >= 100 || Number.isInteger(value)) {
    return value.toFixed(0);
  }
  return value.toFixed(2);
}

function buildSummaryTable(metrics = {}) {
  const lines = ['| Metric | Average | Min | Max |', '| --- | ---: | ---: | ---: |'];
  for (const [key, aggregate] of Object.entries(metrics)) {
    if (!aggregate || typeof aggregate !== 'object') {
      continue;
    }
    lines.push(
      `| ${key} | ${formatValue(aggregate.average)} | ${formatValue(aggregate.min)} | ${formatValue(aggregate.max)} |`,
    );
  }
  if (lines.length === 2) {
    lines.push('| _(no metrics)_ | — | — | — |');
  }
  return lines.join('\n');
}

async function writeReport(metrics) {
  await fs.mkdir(logsDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filePath = path.join(logsDir, `perf-flight-${timestamp}.md`);
  const summaryLines = [
    `# Perf Flight Report`,
    '',
    `- Generated: ${new Date().toISOString()}`,
    `- Started at: ${metrics?.startedAt ?? 'n/a'}`,
    `- Duration (ms): ${metrics?.durationMs ?? 'n/a'}`,
    `- Frame count: ${metrics?.frameCount ?? 'n/a'}`,
    '',
    '## Summary',
    '',
    buildSummaryTable(metrics?.metrics),
    '',
    '## Raw Metrics',
    '',
    '```json',
    JSON.stringify(metrics, null, 2),
    '```',
    '',
  ];
  await fs.writeFile(filePath, summaryLines.join('\n'), 'utf8');
  return filePath;
}

async function collectPerfMetrics(page) {
  return new Promise(async (resolve, reject) => {
    let settled = false;
    const safeResolve = (value) => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };
    const safeReject = (error) => {
      if (!settled) {
        settled = true;
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    };

    try {
      await page.exposeFunction('perfFlightReport', (value) => {
        safeResolve(value);
      });
      await page.exposeFunction('perfFlightReportError', (message) => {
        safeReject(new Error(message));
      });
    } catch (error) {
      safeReject(error);
      return;
    }

    try {
      await page.evaluate(() => {
        const runPerfFlight = () => {
          const namespace = window.__VOXEL_DEBUG__;
          if (!namespace?.perfFlight?.run) {
            throw new Error('window.__VOXEL_DEBUG__.perfFlight.run is not available.');
          }
          return namespace.perfFlight
            .run()
            .then((result) => {
              window.perfFlightReport(result);
            })
            .catch((error) => {
              const message =
                (error && typeof error === 'object' && 'stack' in error && error.stack) ||
                (error && typeof error === 'object' && 'message' in error && error.message) ||
                String(error);
              window.perfFlightReportError(message);
            });
        };

        if (document.readyState === 'complete') {
          return runPerfFlight();
        }

        return new Promise((resolve) => {
          window.addEventListener(
            'load',
            () => {
              resolve(runPerfFlight());
            },
            { once: true },
          );
        });
      });
    } catch (error) {
      safeReject(error);
    }
  });
}

async function main() {
  const npmCommand = getNpmCommand();

  await runCommand(npmCommand, ['run', 'build'], { cwd: projectRoot });

  const preview = await startPreviewServer();

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    const page = await browser.newPage();
    page.on('console', (message) => {
      console.log(`[browser] ${message.text()}`);
    });

    const url = `${preview.url}/?perfFlight=auto`;
    console.log(`Navigating to ${url}`);
    await page.goto(url, { waitUntil: 'networkidle0' });
    await page.waitForFunction(
      () => window.__VOXEL_DEBUG__?.perfFlight?.run,
      { timeout: 60000 },
    );

    const metrics = await collectPerfMetrics(page);
    const reportPath = await writeReport(metrics);
    const relativePath = path.relative(projectRoot, reportPath);
    console.log(`Perf flight report written to ${relativePath}`);
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch (error) {
        console.warn('Failed to close browser cleanly.', error);
      }
    }
    await stopPreviewServer(preview?.child);
  }
}

main().catch((error) => {
  console.error('Perf flight script failed.', error);
  process.exit(1);
});
