import { prisma } from '../../config/db.js';
import { localizeObject } from '../../shared/services/translate/translate.service.js';
import { enrollmentService } from '../enrollment/enrollment.service.js';

const QUIZ_I18N_KEYS = ['quizTitle', 'feedback'];

const quizListSelect = {
    id: true, courseId: true, quizTitle: true, quizType: true,
    passScorePercent: true, minimumScorePercent: true, failScorePercent: true,
    isActive: true, isPublished: true, feedback: true, tenantId: true, maxAttempts: true,
    createdAt: true, updatedAt: true,
    _count: { select: { attempts: true } },
};

const quizDetailSelect = { ...quizListSelect, questions: true };

class QuizService {

    async _resolveTenantId(user) {
        if (!user) return null;
        if (user.tenantId) return user.tenantId;
        if (user.id) {
            const dbUser = await prisma.user.findUnique({ where: { id: user.id }, select: { tenantId: true } });
            return dbUser?.tenantId ?? null;
        }
        return null;
    }

    async _getCourseWithTenantCheck(courseId, user) {
        const course = await prisma.course.findUnique({
            where: { id: courseId },
            select: { id: true, tenantId: true },
        });
        if (!course) throw new Error('Course not found');

        if (user?.level === 'PLATFORM_ADMIN') return course;

        if (user?.level === 'LICENSE_USER') {
            const tenantId = await this._resolveTenantId(user);
            if (!tenantId) throw new Error('Licensee user must have a tenant');
            if (course.tenantId !== tenantId) {
                throw new Error('You do not have permission to manage quizzes for this course');
            }
            return course;
        }
        return course;
    }

    async _getQuizWithTenantCheck(quizId, user) {
        const quiz = await prisma.quiz.findUnique({
            where: { id: quizId },
            select: { id: true, tenantId: true }
        });
        if (!quiz) return null;

        if (user?.level === 'LICENSE_USER') {
            const tenantId = await this._resolveTenantId(user);
            if (!tenantId || quiz.tenantId !== tenantId) return null;
        }
        return quiz;
    }

    // ── Validates enrollment ownership; auto-resolves from userId + courseId when omitted ──
    async _resolveStudentEnrollment(courseId, userId, enrollmentId = null) {
        if (enrollmentId) {
            return this._validateStudentEnrollment(enrollmentId, courseId, userId);
        }

        const enrollment = await prisma.enrollment.findUnique({
            where: { userId_courseId: { userId, courseId } },
            select: { id: true, userId: true, courseId: true, status: true },
        });

        if (!enrollment) {
            throw new Error('You are not enrolled in this course. Please enroll before starting the quiz.');
        }
        if (enrollment.status === 'EXPIRED') throw new Error('Your enrollment has expired');
        if (enrollment.status === 'SUSPENDED') throw new Error('Your enrollment is suspended');

        return enrollment;
    }

    async _validateStudentEnrollment(enrollmentId, courseId, userId) {
        const enrollment = await prisma.enrollment.findUnique({
            where: { id: enrollmentId },
            select: { id: true, userId: true, courseId: true, status: true },
        });
        if (!enrollment) throw new Error('Enrollment not found');
        if (enrollment.userId !== userId) throw new Error('This enrollment does not belong to you');
        if (enrollment.courseId !== courseId) throw new Error('Enrollment is not for this course');
        if (enrollment.status === 'EXPIRED') throw new Error('Your enrollment has expired');
        if (enrollment.status === 'SUSPENDED') throw new Error('Your enrollment is suspended');
        return enrollment;
    }

    async getQuizzesByCourse(courseId, locale = 'it', queryParams = {}, user = null) {
        const page = parseInt(queryParams.page) || 1;
        const limit = Math.min(parseInt(queryParams.limit) || 20, 100);
        const skip = (page - 1) * limit;

        const course = await prisma.course.findUnique({
            where: { id: courseId },
            select: { id: true, tenantId: true },
        });
        if (!course) throw new Error('Course not found');

        if (user?.level === 'LICENSE_USER') {
            const tenantId = await this._resolveTenantId(user);
            if (!tenantId || course.tenantId !== tenantId) {
                throw new Error('You do not have permission to view quizzes for this course');
            }
        }

        const where = { courseId };
        const isLearner = user && !['PLATFORM_ADMIN', 'LICENSE_USER'].includes(user.level);

        if (queryParams.quizType) where.quizType = queryParams.quizType;

        if (isLearner) {
            where.isPublished = true;
            where.isActive = true;
        } else {
            if (queryParams.isPublished !== undefined) where.isPublished = queryParams.isPublished === 'true';
            if (queryParams.isActive !== undefined) where.isActive = queryParams.isActive === 'true';
        }

        const [quizzes, total] = await Promise.all([
            prisma.quiz.findMany({ where, orderBy: { createdAt: 'asc' }, skip, take: limit, select: quizListSelect }),
            prisma.quiz.count({ where }),
        ]);

        return {
            meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
            quizzes: quizzes.map((q) => localizeObject(q, locale, QUIZ_I18N_KEYS)),
        };
    }

    async getQuizById(quizId, locale = 'it', user = null) {
        const quiz = await prisma.quiz.findUnique({ where: { id: quizId }, select: quizDetailSelect });
        if (!quiz) return null;

        if (user?.level === 'LICENSE_USER') {
            const tenantId = await this._resolveTenantId(user);
            if (!tenantId || quiz.tenantId !== tenantId) return null;
        }

        return localizeObject(quiz, locale, QUIZ_I18N_KEYS);
    }


    async getQuizForLearner(quizId, courseId, userId, locale = 'it', enrollmentId = null) {
        const enrollment = await this._resolveStudentEnrollment(courseId, userId, enrollmentId);
        const resolvedEnrollmentId = enrollment.id;

        const quiz = await this.getQuizById(quizId, locale, null);
        if (!quiz) return null;
        if (quiz.courseId !== courseId) return null;
        if (!quiz.isPublished) throw new Error('Quiz is not available');
        if (!quiz.isActive) throw new Error('Quiz is not available');

        if (quiz.quizType === 'FINAL_TEST') {
            const requiredLessons = await prisma.lesson.findMany({
                where: { courseId, isRequired: true },
                select: { id: true, contentType: true },
            });
            if (requiredLessons.length > 0) {
                const progressRecords = await prisma.lessonProgress.findMany({
                    where: { enrollmentId: resolvedEnrollmentId, lessonId: { in: requiredLessons.map(l => l.id) } },
                    select: { lessonId: true, completed: true, scormStatus: true },
                });
                const progressMap = new Map(progressRecords.map(p => [p.lessonId, p]));
                const allDone = requiredLessons.every(l => {
                    const p = progressMap.get(l.id);
                    if (!p) return false;
                    if (['SCORM', 'SCORM_12'].includes(l.contentType)) {
                        return ['COMPLETED', 'PASSED'].includes(p.scormStatus);
                    }
                    return p.completed === true;
                });
                if (!allDone) {
                    throw new Error('Please complete all course lessons before taking the final test');
                }
            }
        }

        const alreadyPassed = await prisma.quizAttempt.findFirst({
            where: { quizId, enrollmentId: resolvedEnrollmentId, passed: true },
            select: { id: true, scorePercent: true, attemptedAt: true },
        });
        const attemptsUsed = await prisma.quizAttempt.count({ where: { quizId, enrollmentId: resolvedEnrollmentId } });

        if (quiz.maxAttempts && attemptsUsed >= quiz.maxAttempts && !alreadyPassed) {
            throw new Error(`Maximum attempts (${quiz.maxAttempts}) reached for this quiz`);
        }

        // Correct answer client-এ পাঠানো যাবে না
        if (Array.isArray(quiz.questions)) {
            quiz.questions = quiz.questions.map((q) => {
                if (q.type === 'FREE_TEXT') {
                    const { expectedAnswers: _hidden, ...rest } = q;
                    return rest;
                }
                return { ...q, options: (q.options ?? []).map(({ isCorrect: _hidden, ...opt }) => opt) };
            });
        }

        return {
            ...quiz,
            enrollmentId: resolvedEnrollmentId,
            alreadyPassed: !!alreadyPassed,
            bestAttempt: alreadyPassed ?? null,
            attemptsUsed,
            attemptsRemaining: quiz.maxAttempts ? Math.max(quiz.maxAttempts - attemptsUsed, 0) : null,
        };
    }

    async createQuiz(courseId, data, user = null) {
        const course = await this._getCourseWithTenantCheck(courseId, user);

        if (data.quizType === 'FINAL_TEST') {
            const existing = await prisma.quiz.findFirst({ where: { courseId, quizType: 'FINAL_TEST' }, select: { id: true } });
            if (existing) throw new Error('A FINAL_TEST already exists for this course');
        }

        return prisma.quiz.create({
            data: {
                quizTitle: data.quizTitle,
                quizType: data.quizType,
                passScorePercent: data.passScorePercent ?? 80,
                minimumScorePercent: data.minimumScorePercent ?? 0,
                failScorePercent: data.failScorePercent ?? 0,
                isActive: data.isActive ?? true,
                isPublished: data.isPublished ?? false,
                questions: data.questions ?? [],
                feedback: data.feedback ?? null,
                maxAttempts: data.maxAttempts ?? null,
                courseId,
                ...(course.tenantId && { tenantId: course.tenantId }),
            },
            select: quizDetailSelect,
        });
    }

    async updateQuiz(quizId, data, user = null) {
        const quizCheck = await this._getQuizWithTenantCheck(quizId, user);
        if (!quizCheck) throw new Error('Quiz not found or permission denied');

        return prisma.quiz.update({
            where: { id: quizId },
            data: {
                ...(data.quizTitle !== undefined && { quizTitle: data.quizTitle }),
                ...(data.quizType !== undefined && { quizType: data.quizType }),
                ...(data.passScorePercent !== undefined && { passScorePercent: data.passScorePercent }),
                ...(data.minimumScorePercent !== undefined && { minimumScorePercent: data.minimumScorePercent }),
                ...(data.failScorePercent !== undefined && { failScorePercent: data.failScorePercent }),
                ...(data.isActive !== undefined && { isActive: data.isActive }),
                ...(data.isPublished !== undefined && { isPublished: data.isPublished }),
                ...(data.questions !== undefined && { questions: data.questions }),
                ...(data.feedback !== undefined && { feedback: data.feedback }),
                ...(data.maxAttempts !== undefined && { maxAttempts: data.maxAttempts }),
            },
            select: quizDetailSelect,
        });
    }

    async deleteQuiz(quizId, user = null) {
        const quiz = await prisma.quiz.findUnique({
            where: { id: quizId },
            select: { id: true, tenantId: true, _count: { select: { attempts: true } } },
        });
        if (!quiz) throw new Error('Quiz not found');

        if (user?.level === 'LICENSE_USER') {
            const tenantId = await this._resolveTenantId(user);
            if (!tenantId || quiz.tenantId !== tenantId) throw new Error('Quiz not found or permission denied');
        }

        if (quiz._count.attempts > 0) {
            throw new Error('Cannot delete quiz with existing attempts. Deactivate it instead.');
        }

        return prisma.quiz.delete({ where: { id: quizId } });
    }

    async publishQuiz(quizId, isPublished, user = null) {
        const quiz = await prisma.quiz.findUnique({
            where: { id: quizId },
            select: { id: true, tenantId: true, questions: true }
        });
        if (!quiz) throw new Error('Quiz not found');

        if (user?.level === 'LICENSE_USER') {
            const tenantId = await this._resolveTenantId(user);
            if (!tenantId || quiz.tenantId !== tenantId) throw new Error('Quiz not found or permission denied');
        }

        if (isPublished) {
            const questions = Array.isArray(quiz.questions) ? quiz.questions : [];
            if (questions.length === 0) throw new Error('Cannot publish a quiz with no questions');
        }

        return prisma.quiz.update({
            where: { id: quizId },
            data: { isPublished },
            select: { id: true, isPublished: true, quizType: true, courseId: true },
        });
    }

    // ── ✅ FIX: এখন সরাসরি enrollment.update করে না, checkAndUpdateEnrollmentStatus কল করে ──
    async submitQuizAttempt(quizId, courseId, userId, answers, enrollmentId = null) {
        const quiz = await prisma.quiz.findUnique({
            where: { id: quizId },
            select: {
                id: true, courseId: true, quizType: true, isPublished: true, isActive: true,
                passScorePercent: true, questions: true, maxAttempts: true,
            },
        });
        if (!quiz) throw new Error('Quiz not found');
        if (quiz.courseId !== courseId) throw new Error('Quiz does not belong to this course');
        if (!quiz.isPublished || !quiz.isActive) throw new Error('Quiz is not published yet');

        const enrollment = await this._resolveStudentEnrollment(courseId, userId, enrollmentId);
        const resolvedEnrollmentId = enrollment.id;

        if (quiz.maxAttempts) {
            const attemptCount = await prisma.quizAttempt.count({ where: { quizId, enrollmentId: resolvedEnrollmentId } });
            if (attemptCount >= quiz.maxAttempts) {
                throw new Error(`Maximum attempts (${quiz.maxAttempts}) reached for this quiz`);
            }
        }

        const alreadyPassed = await prisma.quizAttempt.findFirst({
            where: { quizId, enrollmentId: resolvedEnrollmentId, passed: true },
            select: { id: true },
        });
        if (alreadyPassed) {
            throw new Error('You have already passed this quiz');
        }

        const questions = Array.isArray(quiz.questions) ? quiz.questions : [];
        if (questions.length === 0) throw new Error('Quiz has no questions');

        const answerMap = new Map(answers.map((a) => [a.questionId, a]));
        let earnedPoints = 0;
        let hasPendingManualReview = false;

        // ── প্রতিটা প্রশ্নের উত্তর মিলিয়ে right/wrong নির্ণয় করা হয় এখানে ──
        const gradedAnswers = questions.map((question) => {
            const points = question.points ?? 1;
            const qType = question.type ?? 'SINGLE';
            const submitted = answerMap.get(question.id);

            if (qType === 'FREE_TEXT') {
                const textAnswer = (submitted?.textAnswer ?? '').trim();
                const canAutoGrade = !question.requiresManualGrading
                    && Array.isArray(question.expectedAnswers)
                    && question.expectedAnswers.length > 0;

                if (!canAutoGrade) {
                    hasPendingManualReview = true;
                    return { questionId: question.id, type: qType, textAnswer, isCorrect: null, pendingReview: true, points };
                }

                const normalized = textAnswer.toLowerCase();
                const isCorrect = question.expectedAnswers.some((exp) => exp.trim().toLowerCase() === normalized);
                if (isCorrect) earnedPoints += points;

                return { questionId: question.id, type: qType, textAnswer, isCorrect, pendingReview: false, points };
            }

            // SINGLE / MULTIPLE / TRUE_FALSE — selected options বনাম correct options মিলিয়ে দেখা হয়
            const selected = submitted?.selectedOptionIds ?? [];
            const correctOptionIds = (question.options ?? []).filter((o) => o.isCorrect).map((o) => o.id);

            const isCorrect =
                selected.length === correctOptionIds.length &&
                selected.every((id) => correctOptionIds.includes(id));

            if (isCorrect) earnedPoints += points;

            return { questionId: question.id, type: qType, selectedOptionIds: selected, correctOptionIds, isCorrect, pendingReview: false, points };
        });

        const autoGradedTotal = gradedAnswers
            .filter((a) => !a.pendingReview)
            .reduce((sum, a) => sum + a.points, 0);

        const scorePercent = autoGradedTotal > 0 ? Math.round((earnedPoints / autoGradedTotal) * 100) : 0;
        const passed = !hasPendingManualReview && scorePercent >= quiz.passScorePercent;

        const attempt = await prisma.quizAttempt.create({
            data: { quizId, enrollmentId: resolvedEnrollmentId, scorePercent, passed, answers: gradedAnswers },
        });

        // ✅ FIX: enrollment completion-এর একমাত্র সোর্স এখন enrollmentService
        if (passed) {
            await enrollmentService.checkAndUpdateEnrollmentStatus(resolvedEnrollmentId);
        }

        return {
            attemptId: attempt.id,
            enrollmentId: resolvedEnrollmentId,
            scorePercent,
            passed,
            pendingManualReview: hasPendingManualReview,
            passScorePercent: quiz.passScorePercent,
            totalQuestions: questions.length,
            correctCount: gradedAnswers.filter((a) => a.isCorrect === true).length,
            gradedAnswers,
        };
    }

    // ── ✅ NEW: Admin/Licensee FREE_TEXT pending answer manually grade করবে ──
    async gradeManualAnswer(attemptId, questionId, isCorrect, user = null) {
        const attempt = await prisma.quizAttempt.findUnique({
            where: { id: attemptId },
            include: {
                quiz: { select: { id: true, courseId: true, tenantId: true, passScorePercent: true, questions: true } },
            },
        });
        if (!attempt) throw new Error('Attempt not found');

        if (user?.level === 'LICENSE_USER') {
            const tenantId = await this._resolveTenantId(user);
            if (!tenantId || attempt.quiz.tenantId !== tenantId) throw new Error('Permission denied');
        }

        const answers = Array.isArray(attempt.answers) ? [...attempt.answers] : [];
        const idx = answers.findIndex((a) => a.questionId === questionId);
        if (idx === -1) throw new Error('Question not found in this attempt');
        if (!answers[idx].pendingReview) throw new Error('This answer is not pending manual review');

        answers[idx] = { ...answers[idx], isCorrect, pendingReview: false };

        const questions = Array.isArray(attempt.quiz.questions) ? attempt.quiz.questions : [];
        const stillPending = answers.some((a) => a.pendingReview);

        let earnedPoints = 0;
        let totalPoints = 0;
        for (const a of answers) {
            const q = questions.find((q) => q.id === a.questionId);
            const points = q?.points ?? a.points ?? 1;
            totalPoints += points;
            if (a.isCorrect) earnedPoints += points;
        }
        const scorePercent = totalPoints > 0 ? Math.round((earnedPoints / totalPoints) * 100) : 0;
        const passed = !stillPending && scorePercent >= attempt.quiz.passScorePercent;

        const updated = await prisma.quizAttempt.update({
            where: { id: attemptId },
            data: { answers, scorePercent, passed },
        });

        if (passed) {
            await enrollmentService.checkAndUpdateEnrollmentStatus(attempt.enrollmentId);
        }

        return updated;
    }

    // ── ✅ NEW: Admin দেখবে কোন কোন attempt-এ manual review বাকি আছে ──
    async getPendingManualReviews(quizId, user = null) {
        const quizCheck = await this._getQuizWithTenantCheck(quizId, user);
        if (!quizCheck) throw new Error('Quiz not found or permission denied');

        const attempts = await prisma.quizAttempt.findMany({
            where: { quizId },
            include: {
                enrollment: { select: { id: true, user: { select: { id: true, firstName: true, lastName: true, email: true } } } },
            },
            orderBy: { attemptedAt: 'desc' },
        });

        return attempts
            .map((a) => ({
                attemptId: a.id,
                enrollmentId: a.enrollmentId,
                student: a.enrollment.user,
                attemptedAt: a.attemptedAt,
                pendingQuestions: (a.answers || []).filter((ans) => ans.pendingReview),
            }))
            .filter((a) => a.pendingQuestions.length > 0);
    }

    async getMyAttemptDetail(quizId, courseId, attemptId, userId) {
        const quiz = await prisma.quiz.findUnique({
            where: { id: quizId },
            select: { id: true, courseId: true, quizTitle: true, passScorePercent: true },
        });
        if (!quiz) throw new Error('Quiz not found');
        if (quiz.courseId !== courseId) throw new Error('Quiz does not belong to this course');

        const attempt = await prisma.quizAttempt.findUnique({
            where: { id: attemptId },
            include: { enrollment: { select: { id: true, userId: true } } },
        });
        if (!attempt) throw new Error('Attempt not found');
        if (attempt.quizId !== quizId) throw new Error('Attempt does not belong to this quiz');
        if (attempt.enrollment.userId !== userId) throw new Error('This attempt does not belong to you');

        return {
            attemptId: attempt.id,
            quizTitle: quiz.quizTitle,
            scorePercent: attempt.scorePercent,
            passed: attempt.passed,
            passScorePercent: quiz.passScorePercent,
            attemptedAt: attempt.attemptedAt,
            gradedAnswers: attempt.answers,
        };
    }

    async getQuizAttempts(quizId, queryParams = {}, user = null) {
        const quizCheck = await this._getQuizWithTenantCheck(quizId, user);
        if (!quizCheck) throw new Error('Quiz not found or permission denied');

        const page = parseInt(queryParams.page) || 1;
        const limit = Math.min(parseInt(queryParams.limit) || 20, 100);
        const skip = (page - 1) * limit;

        const where = { quizId };
        if (queryParams.enrollmentId) where.enrollmentId = queryParams.enrollmentId;

        const [attempts, total] = await Promise.all([
            prisma.quizAttempt.findMany({
                where, orderBy: { attemptedAt: 'desc' }, skip, take: limit,
                include: { enrollment: { select: { id: true, user: { select: { id: true, firstName: true, lastName: true, email: true } } } } },
            }),
            prisma.quizAttempt.count({ where }),
        ]);

        return { meta: { page, limit, total, totalPages: Math.ceil(total / limit) }, attempts };
    }

    async getQuizStats(quizId, user = null) {
        const quizCheck = await this._getQuizWithTenantCheck(quizId, user);
        if (!quizCheck) throw new Error('Quiz not found or permission denied');

        const [totalStats, passStats] = await Promise.all([
            prisma.quizAttempt.aggregate({ where: { quizId }, _count: { _all: true }, _avg: { scorePercent: true }, _max: { scorePercent: true }, _min: { scorePercent: true } }),
            prisma.quizAttempt.aggregate({ where: { quizId, passed: true }, _count: { _all: true } }),
        ]);

        const total = totalStats._count._all;

        return {
            quizId,
            totalAttempts: total,
            averageScore: Math.round(totalStats._avg.scorePercent ?? 0),
            maxScore: totalStats._max.scorePercent ?? 0,
            minScore: totalStats._min.scorePercent ?? 0,
            passCount: passStats._count._all,
            failCount: total - passStats._count._all,
            passRate: total > 0 ? Math.round((passStats._count._all / total) * 100) : 0,
        };
    }

    async getMyQuizProgress(courseId, userId) {
        const course = await prisma.course.findUnique({ where: { id: courseId }, select: { id: true } });
        if (!course) throw new Error('Course not found');

        const enrollment = await prisma.enrollment.findUnique({
            where: { userId_courseId: { userId, courseId } },
            select: { id: true },
        });

        const quizzes = await prisma.quiz.findMany({
            where: { courseId, isActive: true },
            select: {
                id: true, quizTitle: true, quizType: true, passScorePercent: true, isPublished: true,
                attempts: enrollment
                    ? { where: { enrollmentId: enrollment.id }, orderBy: { attemptedAt: 'desc' }, select: { id: true, scorePercent: true, passed: true, attemptedAt: true } }
                    : false,
            },
        });

        return quizzes.map((quiz) => ({
            quizId: quiz.id,
            quizTitle: quiz.quizTitle,
            quizType: quiz.quizType,
            passScorePercent: quiz.passScorePercent,
            isPublished: quiz.isPublished,
            totalAttempts: (quiz.attempts || []).length,
            bestScore: quiz.attempts?.length ? Math.max(...quiz.attempts.map((a) => a.scorePercent)) : null,
            hasPassed: quiz.attempts?.some((a) => a.passed) ?? false,
            lastAttempt: quiz.attempts?.[0] ?? null,
        }));
    }

    async getMyAllProgress(userId) {
        const enrollments = await prisma.enrollment.findMany({
            where: { userId, status: { notIn: ['EXPIRED', 'SUSPENDED'] } },
            select: { id: true, courseId: true },
        });

        if (enrollments.length === 0) return [];

        const courseIds = enrollments.map(e => e.courseId);

        const quizzes = await prisma.quiz.findMany({
            where: { courseId: { in: courseIds }, isActive: true },
            select: {
                id: true, courseId: true, quizTitle: true, quizType: true, passScorePercent: true, isPublished: true,
                attempts: {
                    where: { enrollment: { userId } },
                    orderBy: { attemptedAt: 'desc' },
                    select: { id: true, scorePercent: true, passed: true, attemptedAt: true }
                }
            },
        });

        return quizzes.map((quiz) => ({
            quizId: quiz.id,
            courseId: quiz.courseId,
            quizTitle: quiz.quizTitle,
            quizType: quiz.quizType,
            passScorePercent: quiz.passScorePercent,
            isPublished: quiz.isPublished,
            totalAttempts: (quiz.attempts || []).length,
            bestScore: quiz.attempts?.length ? Math.max(...quiz.attempts.map((a) => a.scorePercent)) : null,
            hasPassed: quiz.attempts?.some((a) => a.passed) ?? false,
            lastAttempt: quiz.attempts?.[0] ?? null,
        }));
    }
}

export const quizService = new QuizService();