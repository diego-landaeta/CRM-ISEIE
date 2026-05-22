import { Router } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { logger } from '../../shared/utils/logger.js';

const router = Router();

const limiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => `client-err-ip-${ipKeyGenerator(req)}`,
});

router.post('/', limiter, (req, res) => {
  const { message, stack, componentStack, url, userAgent } = req.body || {};
  logger.error({
    clientError: true,
    message: String(message || '').slice(0, 500),
    stack: String(stack || '').slice(0, 4000),
    componentStack: String(componentStack || '').slice(0, 4000),
    url: String(url || '').slice(0, 500),
    userAgent: String(userAgent || '').slice(0, 300),
    ip: req.ip,
  }, 'Frontend ErrorBoundary trigger');
  res.status(204).end();
});

export default { prefix: '/api/client-errors', router };
