import { Router } from 'express';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const router = Router();

router.get('/health', (_req, res) => {
  res.status(200).json({
    status: 'success',
    message: 'Server is healthy',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

router.get('/', (_req, res) => {
  res.status(200).json({
    status: 'success',
    message: 'diego server is running',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

export { router as healthRoutes };