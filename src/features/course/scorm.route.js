

import express from 'express';
import { authMiddleware } from '../../shared/globals/helpers/auth-middleware.js';
import { scormController } from './scorm.controller.js';

const router = express.Router();

router.use(authMiddleware.protect);
router.post('/launch', scormController.launch);
router.post('/commit', scormController.commit);

router.post('/finish', scormController.finish);
router.get('/progress/:enrollmentId', scormController.getProgress);
router.get('/sessions/:enrollmentId', scormController.getSessions);
router.get('/session/:sessionId', scormController.getSessionDetails);

export const scormRoutes = router;