export const config = {
  logDir: process.env.LOG_DIR || '/data/logs',
  webPort: parseInt(process.env.WEB_PORT || '3200', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
};
