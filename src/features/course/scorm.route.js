

import express from 'express';
import { authMiddleware } from '../../shared/globals/helpers/auth-middleware.js';
import { scormController } from './scorm.controller.js';

const router = express.Router();

// SCORM packages call these from inside an iframe (no Authorization header).
router.get('/player/:sessionId', scormController.renderPlayer);
router.post('/runtime/commit', scormController.runtimeCommit);
router.post('/runtime/finish', scormController.runtimeFinish);

router.use(authMiddleware.protect);
router.post('/launch', scormController.launch);
router.post('/commit', scormController.commit);

router.post('/finish', scormController.finish);
router.get('/progress/:enrollmentId', scormController.getProgress);
router.get('/sessions/:enrollmentId', scormController.getSessions);
router.get('/session/:sessionId', scormController.getSessionDetails);

export const scormRoutes = router;