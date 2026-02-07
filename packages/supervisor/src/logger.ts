import pino from 'pino';

const isDev = process.env.NODE_ENV !== 'production';
const archiveDir = process.env.LOG_ARCHIVE_DIR;

const targets: pino.TransportTargetOptions[] = [];

if (isDev) {
  targets.push({
    target: 'pino-pretty',
    options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
  });
} else {
  targets.push({ target: 'pino/file', options: { destination: 1 } });
}

if (archiveDir) {
  targets.push({
    target: 'pino-roll',
    options: {
      file: `${archiveDir}/supervisor`,
      frequency: 60_000, // 1 minute (testing)
      size: '50m',
      dateFormat: 'yyyy-MM-dd',
      mkdir: true,
      symlink: true,
    },
  });
}

export const logger = pino({
  name: 'supervisor',
  level: process.env.LOG_LEVEL || 'info',
  transport: { targets },
});

export default logger;
