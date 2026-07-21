import { prisma } from '../../config/db.js';

class ReviewService {
    async createReview(data, tenantId) {
        const { name, rating, comment } = data;


        const finalTenantId = tenantId || null;

        return prisma.review.create({
            data: {
                name: name,
                rating: rating,
                comment: comment ?? null,
                tenantId: finalTenantId,
                isPublished: false,
                isPublic: false,
            },
        });
    }

    async getReviews(queryParams = {}, tenantId) {
        const page = parseInt(queryParams.page) || 1;
        const limit = Math.min(parseInt(queryParams.limit) || 20, 100);
        const skip = (page - 1) * limit;

        const where = {
            isPublished: true,
            isPublic: true,
        };


        if (tenantId) {
            where.tenantId = tenantId;
        }


        if (queryParams.rating) {
            where.rating = parseInt(queryParams.rating);
        }

        if (queryParams.search) {
            where.OR = [
                { name: { path: ['en'], string_contains: queryParams.search } },
                { comment: { path: ['en'], string_contains: queryParams.search } },
            ];
        }

        const orderBy = {
            [queryParams.sortBy || 'createdAt']: queryParams.sortOrder === 'asc' ? 'asc' : 'desc',
        };

        const [reviews, total, ratingStats] = await Promise.all([
            prisma.review.findMany({
                where,
                orderBy,
                skip,
                take: limit,
            }),
            prisma.review.count({ where }),
            prisma.review.groupBy({
                by: ['rating'],
                where: {
                    isPublished: true,
                    isPublic: true,
                    ...(tenantId && { tenantId })
                },
                _count: { _all: true },
            }),
        ]);

        // Rating distribution calculate
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
                name: r.name,
                rating: r.rating,
                comment: r.comment,
                createdAt: r.createdAt,
            })),
        };
    }

    async getAllReviews(queryParams = {}, tenantId) {
        const page = parseInt(queryParams.page) || 1;
        const limit = Math.min(parseInt(queryParams.limit) || 20, 100);
        const skip = (page - 1) * limit;

        const where = {};

        // Filter by tenant
        if (tenantId) {
            where.tenantId = tenantId;
        }

        // Optional filters
        if (queryParams.rating) {
            where.rating = parseInt(queryParams.rating);
        }

        if (queryParams.isPublished !== undefined) {
            where.isPublished = queryParams.isPublished === 'true' || queryParams.isPublished === true;
        }

        if (queryParams.isPublic !== undefined) {
            where.isPublic = queryParams.isPublic === 'true' || queryParams.isPublic === true;
        }

        if (queryParams.search) {
            where.OR = [
                { name: { path: ['en'], string_contains: queryParams.search } },
                { comment: { path: ['en'], string_contains: queryParams.search } },
            ];
        }

        const orderBy = {
            [queryParams.sortBy || 'createdAt']: queryParams.sortOrder === 'asc' ? 'asc' : 'desc',
        };

        const [reviews, total] = await Promise.all([
            prisma.review.findMany({
                where,
                orderBy,
                skip,
                take: limit,
            }),
            prisma.review.count({ where }),
        ]);

        return {
            meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
            reviews,
        };
    }

    async publishReview(reviewId, data, tenantId) {
        const review = await prisma.review.findUnique({
            where: { id: reviewId },
            select: { id: true, tenantId: true },
        });

        if (!review) {
            throw new Error('Review not found');
        }

        // Check if review belongs to the tenant
        if (tenantId && review.tenantId !== tenantId) {
            throw new Error('Permission denied: Review does not belong to your tenant');
        }

        return prisma.review.update({
            where: { id: reviewId },
            data: {
                isPublished: data.isPublished,
                isPublic: data.isPublic !== undefined ? data.isPublic : data.isPublished,
            },
        });
    }

    async deleteReview(reviewId, tenantId) {
        const review = await prisma.review.findUnique({
            where: { id: reviewId },
            select: { id: true, tenantId: true },
        });

        if (!review) {
            throw new Error('Review not found');
        }

        if (tenantId && review.tenantId !== tenantId) {
            throw new Error('Permission denied: Review does not belong to your tenant');
        }

        return prisma.review.delete({ where: { id: reviewId } });
    }


}

export const reviewService = new ReviewService();