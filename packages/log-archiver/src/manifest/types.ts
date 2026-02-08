export interface ManifestEntry {
  filename: string;
  merkleRoot: string;
  leafCount: number;
  fileSize: number;
  processedAt: string;
  treeFilename: string;
}
