

import { catchAsync } from '../../shared/globals/decorators/catch-async.js';
import { ResponseHandler } from '../../shared/globals/helpers/response.handler.js';
import { scormService } from './scorm.service.js';
import { prisma } from '../../config/db.js';

class ScormController {

    launch = catchAsync(async (req, res) => {
        const { enrollmentId, lessonId } = req.body;

        if (!enrollmentId || !lessonId) {
            throw new Error('enrollmentId and lessonId are required');
        }


        const result = await scormService.launch({
            enrollmentId,
            lessonId,
            ipAddress: req.ip || req.connection?.remoteAddress || null,
            userAgent: req.headers['user-agent'] || null,
        });

        ResponseHandler.success(res, {
            message: 'SCORM session launched successfully',
            data: result
        });
    });

    commit = catchAsync(async (req, res) => {
        const { sessionId, cmiData } = req.body;

        if (!sessionId) {
            throw new Error('sessionId is required');
        }

        const result = await scormService.commit({
            sessionId,
            cmiData: cmiData ?? {}
        });

        ResponseHandler.success(res, {
            message: 'SCORM data committed successfully',
            data: result
        });
    });

    finish = catchAsync(async (req, res) => {
        const { sessionId, cmiData } = req.body;

        if (!sessionId) {
            throw new Error('sessionId is required');
        }

        const result = await scormService.finish({
            sessionId,
            cmiData: cmiData ?? {}
        });

        ResponseHandler.success(res, {
            message: 'SCORM session finished successfully',
            data: result
        });
    });

    getProgress = catchAsync(async (req, res) => {
        const { enrollmentId } = req.params;
        const { lessonId } = req.query;
        if (['PRIVATE_USER', 'COMPANY_EMPLOYEE'].includes(req.user.level)) {
            const enrollment = await prisma.enrollment.findUnique({
                where: { id: enrollmentId },
                select: { userId: true }
            });

            if (!enrollment || enrollment.userId !== req.user.id) {
                throw new Error('Permission denied: You can only view your own progress');
            }
        }

        const progress = await scormService.getProgress(enrollmentId, lessonId);

        ResponseHandler.success(res, {
            message: 'Progress fetched successfully',
            data: { progress }
        });
    });

    getSessions = catchAsync(async (req, res) => {
        if (!['PLATFORM_ADMIN', 'LICENSE_USER'].includes(req.user.level)) {
            throw new Error('Permission denied: Only admins can view SCORM sessions');
        }

        const { enrollmentId } = req.params;
        const { lessonId } = req.query;

        const sessions = await scormService.getSessions(enrollmentId, lessonId);

        ResponseHandler.success(res, {
            message: 'Sessions fetched successfully',
            data: { sessions }
        });
    });

    getSessionDetails = catchAsync(async (req, res) => {
        const { sessionId } = req.params;

        if (!['PLATFORM_ADMIN', 'LICENSE_USER'].includes(req.user.level)) {
            throw new Error('Permission denied: Only admins can view session details');
        }

        const session = await scormService.getSessionDetails(sessionId);

        if (!session) {
            throw new Error('SCORM session not found');
        }

        ResponseHandler.success(res, {
            message: 'Session details fetched successfully',
            data: { session }
        });
    });
}

export const scormController = new ScormController();