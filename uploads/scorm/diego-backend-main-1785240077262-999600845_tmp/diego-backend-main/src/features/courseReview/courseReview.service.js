import { prisma } from '../../config/db.js';

class CourseReviewService {
    async createCourseReview(data, user) {
        const { courseId, rating, comment } = data;

        // Check if user is enrolled
        const enrollment = await prisma.enrollment.findUnique({
            where: { userId_courseId: { userId: user.id, courseId } },
            select: { id: true, status: true },
        });
        if (!enrollment) throw new Error('You must be enrolled in this course to leave a review');

        // Check for duplicate review
        const existing = await prisma.courseReview.findUnique({
            where: { userId_courseId: { userId: user.id, courseId } },
            select: { id: true },
        });
        if (existing) throw new Error('You have already submitted a review for this course');

        // Get course details
        const course = await prisma.course.findUnique({
            where: { id: courseId },
            select: { id: true, tenantId: true, isActive: true },
        });
        if (!course) throw new Error('Course not found');
        if (!course.isActive) throw new Error('Course is not active');

        return prisma.courseReview.create({
            data: {
                userId: user.id,
                courseId,
                rating,
                comment: comment ?? null,
                tenantId: course.tenantId ?? null,
            },
            include: {
                user: { select: { id: true, firstName: true, lastName: true, email: true } },
                course: { select: { id: true, courseTitle: true, slug: true } },
            },
        });
    }

    async updateMyCourseReview(reviewId, data, userId) {
        const review = await prisma.courseReview.findUnique({
            where: { id: reviewId },
            select: { id: true, userId: true },
        });
        if (!review) throw new Error('Course review not found');
        if (review.userId !== userId) throw new Error('You can only update your own review');

        return prisma.courseReview.update({
            where: { id: reviewId },
            data: {
                ...(data.rating !== undefined && { rating: data.rating }),
                ...(data.comment !== undefined && { comment: data.comment }),
            },
            include: {
                user: { select: { id: true, firstName: true, lastName: true } },
                course: { select: { id: true, courseTitle: true, slug: true } },
            },
        });
    }

    async deleteMyCourseReview(reviewId, userId) {
        const review = await prisma.courseReview.findUnique({
            where: { id: reviewId },
            select: { id: true, userId: true },
        });
        if (!review) throw new Error('Course review not found');
        if (review.userId !== userId) throw new Error('You can only delete your own review');

        return prisma.courseReview.delete({ where: { id: reviewId } });
    }

    async getMyCourseReviews(userId, queryParams = {}) {
        const page = parseInt(queryParams.page) || 1;
        const limit = Math.min(parseInt(queryParams.limit) || 20, 100);
        const skip = (page - 1) * limit;

        const where = { userId };
        if (queryParams.courseId) where.courseId = queryParams.courseId;

        const [reviews, total] = await Promise.all([
            prisma.courseReview.findMany({
                where,
                orderBy: { createdAt: 'desc' },
                skip,
                take: limit,
                include: {
                    course: { select: { id: true, courseTitle: true, slug: true, thumbnailUrl: true } },
                },
            }),
            prisma.courseReview.count({ where }),
        ]);

        return {
            meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
            reviews,
        };
    }

    async getCourseReviews(courseId, queryParams = {}) {
        const page = parseInt(queryParams.page) || 1;
        const limit = Math.min(parseInt(queryParams.limit) || 20, 100);
        const skip = (page - 1) * limit;

        const where = { courseId };
        if (queryParams.rating) where.rating = parseInt(queryParams.rating);

        const orderBy = {
            [queryParams.sortBy || 'createdAt']: queryParams.sortOrder === 'asc' ? 'asc' : 'desc',
        };

        const [reviews, total, ratingStats] = await Promise.all([
            prisma.courseReview.findMany({
                where,
                orderBy,
                skip,
                take: limit,
                include: {
                    user: { select: { id: true, firstName: true, lastName: true } },
                },
            }),
            prisma.courseReview.count({ where }),
            prisma.courseReview.groupBy({
                by: ['rating'],
                where: { courseId },
                _count: { _all: true },
            }),
        ]);

        // Calculate rating distribution
        const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
        let totalRatingSum = 0;
        let totalRatingCount = 0;
        for (const stat of ratingStats) {
            distribution[stat.rating] = stat._count._all;
            totalRatingSum += stat.rating * stat._count._all;
            totalRatingCount += stat._count._all;
        }
        const averageRating = totalRatingCount > 0
            ? Math.round((totalRatingSum / totalRatingCount) * 10) / 10
            : 0;

        return {
            meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
            stats: {
                averageRating,
                totalReviews: totalRatingCount,
                distribution,
            },
            reviews: reviews.map(r => ({
                id: r.id,
                rating: r.rating,
                comment: r.comment,
                createdAt: r.createdAt,
                user: {
                    id: r.user.id,
                    name: `${r.user.firstName || ''} ${r.user.lastName || ''}`.trim(),
                },
            })),
        };
    }

    async getAllCourseReviews(queryParams = {}, user) {
        const page = parseInt(queryParams.page) || 1;
        const limit = Math.min(parseInt(queryParams.limit) || 20, 100);
        const skip = (page - 1) * limit;

        const where = {};

        // Tenant scope based on user level
        if (user.level === 'PLATFORM_ADMIN') {
            if (queryParams.tenantId) where.tenantId = queryParams.tenantId;
        } else if (user.level === 'LICENSE_USER') {
            const dbUser = await prisma.user.findUnique({
                where: { id: user.id },
                select: { tenantId: true },
            });
            if (!dbUser?.tenantId) throw new Error('License user must have a tenant');
            where.tenantId = dbUser.tenantId;
        } else if (user.level === 'COMPANY_ADMIN') {
            const dbUser = await prisma.user.findUnique({
                where: { id: user.id },
                select: { companyId: true },
            });
            if (!dbUser?.companyId) throw new Error('Company admin must have a company');
            // Get all users in the company
            const companyUsers = await prisma.user.findMany({
                where: { companyId: dbUser.companyId },
                select: { id: true },
            });
            where.userId = { in: companyUsers.map(u => u.id) };
        }

        if (queryParams.courseId) where.courseId = queryParams.courseId;
        if (queryParams.userId) where.userId = queryParams.userId;
        if (queryParams.rating) where.rating = parseInt(queryParams.rating);

        if (queryParams.search) {
            where.OR = [
                { comment: { contains: queryParams.search, mode: 'insensitive' } },
                { user: { email: { contains: queryParams.search, mode: 'insensitive' } } },
                { user: { firstName: { contains: queryParams.search, mode: 'insensitive' } } },
                { user: { lastName: { contains: queryParams.search, mode: 'insensitive' } } },
            ];
        }

        const orderBy = {
            [queryParams.sortBy || 'createdAt']: queryParams.sortOrder === 'asc' ? 'asc' : 'desc',
        };

        const [reviews, total] = await Promise.all([
            prisma.courseReview.findMany({
                where,
                orderBy,
                skip,
                take: limit,
                include: {
                    user: { select: { id: true, firstName: true, lastName: true, email: true } },
                    course: { select: { id: true, courseTitle: true, slug: true } },
                },
            }),
            prisma.courseReview.count({ where }),
        ]);

        return {
            meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
            reviews,
        };
    }

    async deleteCourseReview(reviewId, user) {
        const review = await prisma.courseReview.findUnique({
            where: { id: reviewId },
            select: { id: true, tenantId: true, userId: true },
        });
        if (!review) throw new Error('Course review not found');

        // Permission checks
        if (user.level === 'LICENSE_USER') {
            const dbUser = await prisma.user.findUnique({
                where: { id: user.id },
                select: { tenantId: true },
            });
            if (review.tenantId !== dbUser?.tenantId) {
                throw new Error('Permission denied');
            }
        } else if (user.level === 'COMPANY_ADMIN') {
            const dbUser = await prisma.user.findUnique({
                where: { id: user.id },
                select: { companyId: true },
            });
            const reviewUser = await prisma.user.findUnique({
                where: { id: review.userId },
                select: { companyId: true },
            });
            if (reviewUser?.companyId !== dbUser?.companyId) {
                throw new Error('Permission denied');
            }
        } else if (!['PLATFORM_ADMIN'].includes(user.level)) {
            throw new Error('Permission denied');
        }

        return prisma.courseReview.delete({ where: { id: reviewId } });
    }

    async getCourseReviewById(reviewId, user) {
        const review = await prisma.courseReview.findUnique({
            where: { id: reviewId },
            include: {
                user: { select: { id: true, firstName: true, lastName: true, email: true } },
                course: { select: { id: true, courseTitle: true, slug: true } },
            },
        });
        if (!review) throw new Error('Course review not found');

        // Permission check for regular users
        if (user.level === 'PRIVATE_USER' || user.level === 'COMPANY_EMPLOYEE') {
            if (review.userId !== user.id) throw new Error('Permission denied');
        }

        return review;
    }
}

export const courseReviewService = new CourseReviewService();