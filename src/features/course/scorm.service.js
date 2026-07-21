
import { prisma } from '../../config/db.js';
import { enrollmentService } from '../enrollment/enrollment.service.js';
import { notificationService } from '../notification/notification.service.js';
import { Logger } from '../../config/logger.js';
import { STATUS_MAP, STATUS_PRIORITY } from './course.constant.js';

const log = new Logger('ScormService');



const isTracked = (contentType) => ['SCORM', 'SCORM_12'].includes(contentType);

const mapStatus = (raw) => STATUS_MAP[raw?.toLowerCase()] ?? 'UNKNOWN';

const parseScormTime = (timeStr) => {
    if (!timeStr) return 0;
    const match12 = timeStr.match(/^(\d+):(\d+):(\d+)/);
    if (match12) {
        return parseInt(match12[1]) * 3600 + parseInt(match12[2]) * 60 + parseInt(match12[3]);
    }
    const match2004 = timeStr.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    if (match2004) {
        return (parseInt(match2004[1] || 0)) * 3600
            + (parseInt(match2004[2] || 0)) * 60
            + (parseInt(match2004[3] || 0));
    }
    return 0;
};

class ScormService {

    async launch({ enrollmentId, lessonId, ipAddress, userAgent }) {
        const enrollment = await prisma.enrollment.findUnique({
            where: { id: enrollmentId },
            select: { id: true, status: true, expiresAt: true, userId: true, courseId: true },
        });

        if (!enrollment) throw new Error('Enrollment not found');
        if (enrollment.status === 'EXPIRED') throw new Error('Enrollment has expired');
        if (enrollment.status === 'SUSPENDED') throw new Error('Enrollment is suspended');
        if (enrollment.expiresAt < new Date()) {
            await prisma.enrollment.update({
                where: { id: enrollmentId },
                data: { status: 'EXPIRED' },
            });
            throw new Error('Course access has expired');
        }

        const lesson = await prisma.lesson.findUnique({
            where: { id: lessonId },
            select: {
                id: true,
                contentType: true,
                scormPackageUrl: true,
                scormVersion: true,
                scormEntryPoint: true,
                isLocked: true,
            },
        });

        if (!lesson) throw new Error('Lesson not found');
        if (!isTracked(lesson.contentType)) throw new Error('This lesson type does not support SCORM tracking');
        if (!lesson.scormPackageUrl) throw new Error('SCORM package not uploaded for this lesson');
        if (lesson.isLocked) throw new Error('This lesson is locked');

        const lastProgress = await prisma.lessonProgress.findUnique({
            where: { enrollmentId_lessonId: { enrollmentId, lessonId } },
            select: { scormData: true, scormStatus: true, timeSpentSecs: true },
        });

        // Create new session
        const session = await prisma.scormSession.create({
            data: { enrollmentId, lessonId, ipAddress, userAgent, status: 'NOT_ATTEMPTED' },
        });

        // Mark enrollment as started if first launch
        if (enrollment.status === 'NOT_STARTED') {
            await prisma.enrollment.update({
                where: { id: enrollmentId },
                data: { status: 'IN_PROGRESS', startedAt: new Date() },
            });
        }

        return {
            sessionId: session.id,
            scormVersion: lesson.scormVersion ?? '1.2',
            scormEntryPoint: lesson.scormEntryPoint,
            scormPackageUrl: lesson.scormPackageUrl,
            resumeData: lastProgress?.scormData ?? null,
            lastStatus: lastProgress?.scormStatus ?? 'NOT_ATTEMPTED',
            totalTimeSecs: lastProgress?.timeSpentSecs ?? 0,
        };
    }


    async commit({ sessionId, cmiData }) {
        const session = await prisma.scormSession.findUnique({
            where: { id: sessionId },
            select: { id: true, enrollmentId: true, lessonId: true },
        });
        if (!session) throw new Error('SCORM session not found');

        await prisma.scormSession.update({
            where: { id: sessionId },
            data: { cmiData },
        });

        return { success: true };
    }


    async finish({ sessionId, cmiData }) {
        const session = await prisma.scormSession.findUnique({
            where: { id: sessionId },
            select: { id: true, enrollmentId: true, lessonId: true, launchedAt: true },
        });
        if (!session) throw new Error('SCORM session not found');

        const rawStatus = cmiData?.['cmi.core.lesson_status']
            ?? cmiData?.['cmi.completion_status']
            ?? 'INCOMPLETE';
        const rawScore = parseFloat(
            cmiData?.['cmi.core.score.raw'] ?? cmiData?.['cmi.score.raw'] ?? '0'
        ) || 0;
        const sessionTime = cmiData?.['cmi.core.session_time']
            ?? cmiData?.['cmi.session_time']
            ?? '00:00:00';
        const location = cmiData?.['cmi.core.lesson_location']
            ?? cmiData?.['cmi.location']
            ?? null;

        const sessionSecs = parseScormTime(sessionTime);
        const mappedStatus = mapStatus(rawStatus);
        const now = new Date();

        // Persist session exit data
        await prisma.scormSession.update({
            where: { id: sessionId },
            data: { exitedAt: now, sessionSecs, cmiData, status: mappedStatus, score: rawScore, location },
        });

        const existing = await prisma.lessonProgress.findUnique({
            where: {
                enrollmentId_lessonId: {
                    enrollmentId: session.enrollmentId,
                    lessonId: session.lessonId,
                },
            },
            select: {
                timeSpentSecs: true,
                scormStatus: true,
                scormPassed: true,
                scormScore: true,
                completed: true,
                completedAt: true,
            },
        });

        const isCompleted = ['COMPLETED', 'PASSED'].includes(mappedStatus);
        const isPassed = mappedStatus === 'PASSED';

        const existingPriority = STATUS_PRIORITY[existing?.scormStatus ?? 'NOT_ATTEMPTED'] ?? 0;
        const newPriority = STATUS_PRIORITY[mappedStatus] ?? 0;
        const finalStatus = newPriority >= existingPriority ? mappedStatus : existing.scormStatus;
        const finalPassed = isPassed || (existing?.scormPassed ?? false);
        const finalScore = rawScore || existing?.scormScore || 0;
        const accumulatedSecs = (existing?.timeSpentSecs ?? 0) + sessionSecs;

        await prisma.lessonProgress.upsert({
            where: {
                enrollmentId_lessonId: {
                    enrollmentId: session.enrollmentId,
                    lessonId: session.lessonId,
                },
            },
            create: {
                enrollmentId: session.enrollmentId,
                lessonId: session.lessonId,
                completed: isCompleted,
                completedAt: isCompleted ? now : null,
                scormStatus: finalStatus,
                scormScore: finalScore,
                scormPassed: finalPassed,
                timeSpentSecs: sessionSecs,
                scormData: cmiData,
                startedAt: session.launchedAt,
            },
            update: {
                completed: isCompleted || (existing?.completed ?? false),
                ...(isCompleted && !existing?.completed ? { completedAt: now } : {}),
                scormStatus: finalStatus,
                scormScore: finalScore,
                scormPassed: finalPassed,
                timeSpentSecs: accumulatedSecs,
                scormData: cmiData,
            },
        });

        await this._checkCourseCompletion(session.enrollmentId);

        return {
            success: true,
            status: finalStatus,
            score: finalScore,
            sessionSecs,
            totalSecs: accumulatedSecs,
        };
    }


    async getProgress(enrollmentId, lessonId = null) {
        const where = { enrollmentId };
        if (lessonId) where.lessonId = lessonId;

        const progresses = await prisma.lessonProgress.findMany({
            where,
            include: {
                lesson: {
                    select: {
                        id: true,
                        title: true,
                        contentType: true,
                        isRequired: true,
                        orderIndex: true,
                    },
                },
            },
            orderBy: { lesson: { orderIndex: 'asc' } },
        });

        return progresses.map(p => ({
            lessonId: p.lessonId,
            lessonTitle: p.lesson.title,
            contentType: p.lesson.contentType,
            isTracked: isTracked(p.lesson.contentType),
            isRequired: p.lesson.isRequired,
            completed: p.completed,
            completedAt: p.completedAt,
            scormStatus: p.scormStatus,
            scormScore: p.scormScore,
            scormPassed: p.scormPassed,
            timeSpentSecs: p.timeSpentSecs,
            timeSpentFormatted: this._formatTime(p.timeSpentSecs),
        }));
    }


    async getSessions(enrollmentId, lessonId = null) {
        const where = { enrollmentId };
        if (lessonId) where.lessonId = lessonId;

        return prisma.scormSession.findMany({
            where,
            orderBy: { launchedAt: 'desc' },
            select: {
                id: true,
                launchedAt: true,
                exitedAt: true,
                sessionSecs: true,
                status: true,
                score: true,
                location: true,
                ipAddress: true,
                userAgent: true,
                cmiData: true,
                lesson: {
                    select: { id: true, title: true, orderIndex: true },
                },
            },
        });
    }

    async getSessionDetails(sessionId) {
        return prisma.scormSession.findUnique({
            where: { id: sessionId },
            include: {
                enrollment: {
                    include: {
                        user: {
                            select: { id: true, email: true, firstName: true, lastName: true },
                        },
                    },
                },
                lesson: {
                    select: { id: true, title: true, contentType: true, courseId: true },
                },
            },
        });
    }

    async _checkCourseCompletion(enrollmentId) {
        const enrollment = await prisma.enrollment.findUnique({
            where: { id: enrollmentId },
            select: { courseId: true, status: true, userId: true },
        });

        if (!enrollment || enrollment.status === 'COMPLETED') return;

        await enrollmentService.checkAndUpdateEnrollmentStatus(enrollmentId);

        const updated = await prisma.enrollment.findUnique({
            where: { id: enrollmentId },
            select: { status: true },
        });

        if (updated?.status !== 'COMPLETED') {
            await this._maybeNotifyTestAvailable(enrollment);
        } else {
            log.info(`Enrollment ${enrollmentId} marked COMPLETED via enrollment service`);
        }
    }

    async _maybeNotifyTestAvailable(enrollment) {
        try {
            const finalQuiz = await prisma.quiz.findFirst({
                where: {
                    courseId: enrollment.courseId,
                    quizType: 'FINAL_TEST',
                    isActive: true,

                },
                select: { id: true },
            });

            if (!finalQuiz) return;

            const course = await prisma.course.findUnique({
                where: { id: enrollment.courseId },
                select: { courseTitle: true, tenantId: true },
            });

            const courseTitle = course?.courseTitle?.['it']
                || course?.courseTitle?.['en']
                || 'Course';

            await notificationService.notifyTestAvailable({
                userId: enrollment.userId,
                courseTitle,
                tenantId: course?.tenantId ?? null,
            });
        } catch (err) {
            log.error(`_maybeNotifyTestAvailable failed: ${err.message}`);
        }
    }


    _formatTime(secs) {
        if (!secs) return '0s';
        const h = Math.floor(secs / 3600);
        const m = Math.floor((secs % 3600) / 60);
        const s = secs % 60;
        if (h > 0) return `${h}h ${m}m`;
        if (m > 0) return `${m}m ${s}s`;
        return `${s}s`;
    }
}

export const scormService = new ScormService();