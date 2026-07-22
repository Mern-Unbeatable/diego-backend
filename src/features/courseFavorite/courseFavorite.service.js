import { prisma } from '../../config/db.js';
import { localizeObject } from '../../shared/services/translate/translate.service.js';
import { courseListSelect } from '../course/course.utils.js';

const COURSE_I18N_KEYS = ['courseTitle', 'description', 'trainingPlanTitle', 'financingCompany'];

class CourseFavoriteService {
    async _assertCourseCanBeFavorited(courseId, userId) {
        const course = await prisma.course.findUnique({
            where: { id: courseId },
            select: { id: true, isActive: true, tenantId: true },
        });

        if (!course) throw new Error('Course not found');

        if (!course.isActive) {
            const enrolled = await prisma.enrollment.findUnique({
                where: { userId_courseId: { userId, courseId } },
                select: { id: true },
            });
            if (!enrolled) throw new Error('This course is not available to favorite');
        }

        return course;
    }

    async addFavorite(courseId, userId, tenantId = null) {
        const course = await this._assertCourseCanBeFavorited(courseId, userId);

        const existing = await prisma.courseFavorite.findUnique({
            where: { userId_courseId: { userId, courseId } },
            select: { id: true },
        });
        if (existing) throw new Error('Course is already in your favorites');

        return prisma.courseFavorite.create({
            data: {
                userId,
                courseId,
                tenantId: tenantId || course.tenantId || null,
            },
            select: {
                id: true,
                courseId: true,
                createdAt: true,
            },
        });
    }

    async removeFavorite(courseId, userId) {
        const favorite = await prisma.courseFavorite.findUnique({
            where: { userId_courseId: { userId, courseId } },
            select: { id: true, courseId: true },
        });

        if (!favorite) throw new Error('Course is not in your favorites');

        await prisma.courseFavorite.delete({ where: { id: favorite.id } });
        return { courseId: favorite.courseId, removed: true };
    }

    async isFavorite(courseId, userId) {
        const favorite = await prisma.courseFavorite.findUnique({
            where: { userId_courseId: { userId, courseId } },
            select: { id: true, createdAt: true },
        });

        return {
            courseId,
            isFavorite: Boolean(favorite),
            favoritedAt: favorite?.createdAt ?? null,
        };
    }

    async getMyFavoriteCourseIds(userId) {
        const favorites = await prisma.courseFavorite.findMany({
            where: { userId },
            select: { courseId: true },
            orderBy: { createdAt: 'desc' },
        });

        return favorites.map((f) => f.courseId);
    }

    async getMyFavoriteCourses(userId, queryParams = {}, locale = 'it', tenantId = null) {
        const page = parseInt(queryParams.page) || 1;
        const limit = Math.min(parseInt(queryParams.limit) || 20, 100);
        const skip = (page - 1) * limit;

        const courseWhere = {};
        if (tenantId) courseWhere.tenantId = tenantId;

        if (queryParams.category) {
            courseWhere.category = queryParams.category.toUpperCase();
        }

        if (queryParams.format) {
            courseWhere.format = queryParams.format;
        }

        if (queryParams.search) {
            const search = queryParams.search.trim();
            courseWhere.OR = [
                { courseTitle: { path: ['it'], string_contains: search } },
                { courseTitle: { path: ['en'], string_contains: search } },
                { courseTitle: { path: ['fr'], string_contains: search } },
                { courseTitle: { path: ['zh'], string_contains: search } },
                { slug: { contains: search, mode: 'insensitive' } },
            ];
        }

        const where = {
            userId,
            ...(Object.keys(courseWhere).length > 0 && { course: courseWhere }),
        };

        const sortField = queryParams.sortBy || 'favoritedAt';
        const sortOrder = queryParams.sortOrder === 'asc' ? 'asc' : 'desc';

        let orderBy;
        if (sortField === 'favoritedAt' || sortField === 'createdAt') {
            orderBy = { createdAt: sortOrder };
        } else if (sortField === 'price') {
            orderBy = { course: { price: sortOrder } };
        } else if (sortField === 'courseTitle') {
            orderBy = { course: { courseTitle: { path: ['it'], order: sortOrder } } };
        } else {
            orderBy = { createdAt: 'desc' };
        }

        const [favorites, total] = await Promise.all([
            prisma.courseFavorite.findMany({
                where,
                orderBy,
                skip,
                take: limit,
                select: {
                    id: true,
                    createdAt: true,
                    course: { select: courseListSelect },
                },
            }),
            prisma.courseFavorite.count({ where }),
        ]);

        return {
            meta: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit),
                tenantId: tenantId ?? null,
            },
            favorites: favorites.map((favorite) => {
                const course = favorite.course;
                const localized = localizeObject(course, locale, COURSE_I18N_KEYS);

                const reviews = course.reviews || [];
                const totalReviews = reviews.length;
                const averageRating = totalReviews > 0
                    ? Math.round((reviews.reduce((sum, r) => sum + r.rating, 0) / totalReviews) * 10) / 10
                    : 0;

                localized.averageRating = averageRating;
                localized.totalReviews = totalReviews;
                localized.isFavorite = true;
                localized.favoritedAt = favorite.createdAt;
                delete localized.reviews;

                return {
                    favoriteId: favorite.id,
                    favoritedAt: favorite.createdAt,
                    course: localized,
                };
            }),
        };
    }
}

export const courseFavoriteService = new CourseFavoriteService();
