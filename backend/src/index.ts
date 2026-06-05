import { app, CORS_ORIGINS } from './app';
import { logger } from './helpers/logger';

const PORT = parseInt(process.env.PORT ?? '3100', 10);

app.listen(PORT, () => {
  logger.info('server', `Listening on http://localhost:${PORT}`);
  logger.info('server', `CORS origins: ${CORS_ORIGINS.join(', ')}`);
});
