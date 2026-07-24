import { prisma } from '../../config/db.js';

const SENT_FROM_LABELS = {
    COMPANY_ADMIN: "Dall'amministratore dell'azienda",
    LICENSE_USER: 'Dal licenziatario',
    PLATFORM_ADMIN: "Dall'amministratore piattaforma",
};

class CredentialDeliveryService {
    _formatCourseTitle(courseTitle) {
        if (!courseTitle) return 'Corso';
        if (typeof courseTitle === 'string') return courseTitle;
        return courseTitle.it || courseTitle.en || Object.values(courseTitle)[0] || 'Corso';
    }

    _resolveSentFromLabel(assigner) {
        if (!assigner?.level) return SENT_FROM_LABELS.COMPANY_ADMIN;
        return SENT_FROM_LABELS[assigner.level] || SENT_FROM_LABELS.COMPANY_ADMIN;
    }

    _mapRecord(record) {
        return {
            id: record.id,
            username: record.username,
            password: record.temporaryPassword ?? null,
            courseName: record.courseName,
            sentBy: record.sentFromLabel,
            sentFromType: record.sentFromType,
            courseId: record.courseId,
            enrollmentId: record.enrollmentId,
            viewedAt: record.viewedAt,
            createdAt: record.createdAt,
            hasPassword: Boolean(record.temporaryPassword),
        };
    }

    async recordForEnrollments({
        enrollments = [],
        assignedBy = null,
        username,
        temporaryPassword = null,
    }) {
        if (!enrollments.length || !username) return [];

        const sentFromType = assignedBy?.level ?? 'COMPANY_ADMIN';
        const sentFromLabel = this._resolveSentFromLabel(assignedBy);
        const assignedById = assignedBy?.id ?? null;

        const created = await prisma.$transaction(
            enrollments.map((enrollment) =>
                prisma.credentialDelivery.create({
                    data: {
                        userId: enrollment.userId ?? enrollment.user?.id,
                        courseId: enrollment.courseId ?? enrollment.course?.id ?? null,
                        enrollmentId: enrollment.id ?? null,
                        assignedById,
                        username,
                        temporaryPassword: temporaryPassword || null,
                        courseName: this._formatCourseTitle(enrollment.course?.courseTitle),
                        sentFromLabel,
                        sentFromType,
                    },
                }),
            ),
        );

        return created.map((record) => this._mapRecord(record));
    }

    async getMyCredentials(userId, queryParams = {}) {
        const unreadOnly =
            queryParams.unreadOnly === true
            || queryParams.unreadOnly === 'true'
            || queryParams.unreadOnly === '1';

        const page = parseInt(queryParams.page, 10) || 1;
        const limit = Math.min(parseInt(queryParams.limit, 10) || 20, 50);
        const skip = (page - 1) * limit;

        const where = { userId };
        if (unreadOnly) where.viewedAt = null;

        const [records, total] = await Promise.all([
            prisma.credentialDelivery.findMany({
                where,
                orderBy: { createdAt: 'desc' },
                skip,
                take: limit,
            }),
            prisma.credentialDelivery.count({ where }),
        ]);

        return {
            meta: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit) || 1,
                unreadOnly,
            },
            credentials: records.map((record) => this._mapRecord(record)),
            latest: records[0] ? this._mapRecord(records[0]) : null,
        };
    }

    async markViewed(userId, credentialId) {
        const record = await prisma.credentialDelivery.findFirst({
            where: { id: credentialId, userId },
        });
        if (!record) throw new Error('Credential not found');

        const updated = await prisma.credentialDelivery.update({
            where: { id: credentialId },
            data: { viewedAt: record.viewedAt ?? new Date() },
        });

        return this._mapRecord(updated);
    }
}

export const credentialDeliveryService = new CredentialDeliveryService();
