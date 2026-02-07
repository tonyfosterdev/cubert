import { promises as fs } from 'fs';
import path from 'path';
import { ManifestEntry } from './types';
import logger from '../logger';

export class Manifest {
  private filePath: string;
  private writing = false;
  private pendingWrites: Array<() => void> = [];

  constructor(logDir: string) {
    this.filePath = path.join(logDir, 'manifest.json');
  }

  async load(): Promise<ManifestEntry[]> {
    try {
      const data = await fs.readFile(this.filePath, 'utf-8');
      return JSON.parse(data);
    } catch (err: any) {
      if (err.code === 'ENOENT') return [];
      throw err;
    }
  }

  async addEntry(entry: ManifestEntry): Promise<void> {
    // Simple in-memory write lock
    if (this.writing) {
      await new Promise<void>((resolve) => this.pendingWrites.push(resolve));
    }

    this.writing = true;
    try {
      const entries = await this.load();
      entries.push(entry);

      // Atomic write: temp file + rename
      const tmpPath = this.filePath + '.tmp';
      await fs.writeFile(tmpPath, JSON.stringify(entries, null, 2), 'utf-8');
      await fs.rename(tmpPath, this.filePath);

      logger.info({ filename: entry.filename, merkleRoot: entry.merkleRoot }, 'Manifest entry added');
    } finally {
      this.writing = false;
      const next = this.pendingWrites.shift();
      if (next) next();
    }
  }

  async hasEntry(filename: string): Promise<boolean> {
    const entries = await this.load();
    return entries.some((e) => e.filename === filename);
  }
}
