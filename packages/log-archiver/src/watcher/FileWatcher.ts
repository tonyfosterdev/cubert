import { watch, type FSWatcher } from 'chokidar';
import { promises as fs } from 'fs';
import path from 'path';
import { BatchProcessor } from '../processor/BatchProcessor';
import { Manifest } from '../manifest/Manifest';
import { TimestampService } from '../ots/TimestampService';
import logger from '../logger';

export class FileWatcher {
  private watcher: FSWatcher | null = null;
  private processor: BatchProcessor;
  private manifest: Manifest;
  private logDir: string;

  constructor(logDir: string, timestampService?: TimestampService) {
    this.logDir = logDir;
    this.manifest = new Manifest(logDir);
    this.processor = new BatchProcessor(this.manifest, timestampService);
  }

  async start(): Promise<void> {
    logger.info({ logDir: this.logDir }, 'Starting file watcher');

    // pino-roll names files as: supervisor.1, supervisor.2, etc.
    // Watch the entire directory and filter in shouldIgnore
    this.watcher = watch(this.logDir, {
      ignoreInitial: false,
      depth: 0,
      awaitWriteFinish: {
        stabilityThreshold: 5000,
        pollInterval: 1000,
      },
      ignored: (filePath: string) => this.shouldIgnore(filePath),
    });

    this.watcher.on('add', (filePath: string) => this.onFile(filePath));
    this.watcher.on('error', (err: unknown) => {
      logger.error({ err }, 'Watcher error');
    });
  }

  private shouldIgnore(filePath: string): boolean {
    const basename = path.basename(filePath);

    // Ignore the directory itself
    if (basename === path.basename(this.logDir)) return false;

    // Ignore .tree files, .ots files, manifest.json, current.log symlink
    if (basename.endsWith('.tree')) return true;
    if (basename.endsWith('.ots')) return true;
    if (basename === 'manifest.json') return true;
    if (basename === 'manifest.json.tmp') return true;
    if (basename === 'current.log') return true;

    // Only watch files matching pino-roll pattern: supervisor.N or supervisor.YYYY-MM-DD.N
    if (!basename.startsWith('supervisor.')) return true;

    return false;
  }

  private async onFile(filePath: string): Promise<void> {
    const basename = path.basename(filePath);

    try {
      // Resolve symlink to find the active file and skip it
      const symlinkPath = path.join(this.logDir, 'current.log');
      try {
        const activeFile = await fs.readlink(symlinkPath);
        const activeBasename = path.basename(activeFile);
        if (basename === activeBasename) {
          logger.debug({ filename: basename }, 'Skipping active log file');
          return;
        }
      } catch {
        // No symlink exists yet — that's fine
      }

      await this.processor.process(filePath);
    } catch (err) {
      logger.error({ err, filename: basename }, 'Error processing file');
    }
  }

  async stop(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
      logger.info('File watcher stopped');
    }
  }

  getManifest(): Manifest {
    return this.manifest;
  }
}
