import { app, CORS_ORIGINS } from './app';

const PORT = parseInt(process.env.PORT ?? '3100', 10);

app.listen(PORT, () => {
  console.log(`[server] Listening on http://localhost:${PORT}`);
  console.log(`[server] CORS origins: ${CORS_ORIGINS.join(', ')}`);
});
