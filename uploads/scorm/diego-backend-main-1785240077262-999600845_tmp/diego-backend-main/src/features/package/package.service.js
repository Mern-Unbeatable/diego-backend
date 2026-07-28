import { prisma } from '../../config/db.js';
import { localizeObject } from '../../shared/services/translate/translate.service.js';

const PACKAGE_I18N_KEYS = ['name', 'description'];
const generateSlug = (nameObj) => {
    const name = nameObj?.en || nameObj?.it || nameObj?.fr || nameObj?.zh || '';
    if (!name) throw new Error('Package name is required to generate slug');
    return name.toLowerCase().trim()
        .replace(/[^\w\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-');
};

const makeSlugUnique = async (baseSlug) => {
    let slug = baseSlug;
    let counter = 1;
    while (true) {
        const existing = await prisma.package.findUnique({ where: { slug }, select: { id: true } });
        if (!existing) return slug;
        slug = `${baseSlug}-${counter++}`;
    }
};

export class PackageService {

    async getAllPackages(queryParams = {}, locale = 'it', user = null) {
        const page = parseInt(queryParams.page) || 1;
        const limit = Math.min(parseInt(queryParams.limit) || 20, 100);
        const skip = (page - 1) * limit;

        const where = {};

        if (user?.level !== 'PLATFORM_ADMIN') {
            where.isActive = true;
        }

        if (queryParams.isActive !== undefined) {
            where.isActive = queryParams.isActive === 'true';
        }

        if (queryParams.tenantId) {
            where.tenantId = queryParams.tenantId;
        }

        if (queryParams.search) {
            where.OR = [
                { name: { path: ['it'], string_contains: queryParams.search } },
                { name: { path: ['en'], string_contains: queryParams.search } },
                { slug: { contains: queryParams.search, mode: 'insensitive' } },
            ];
        }

        const orderBy = { [queryParams.sortBy || 'createdAt']: queryParams.sortOrder === 'asc' ? 'asc' : 'desc' };

        const [packages, total] = await Promise.all([
            prisma.package.findMany({
                where,
                orderBy,
                skip,
                take: limit,
                include: {
                    items: {
                        include: {
                            course: {
                                select: {
                                    id: true,
                                    courseTitle: true,
                                    slug: true,
                                }
                            }
                        }
                    },
                    purchases: {
                        select: {
                            id: true,
                            companyId: true,
                            seatsTotal: true,
                            seatsUsed: true,
                            purchasedAt: true,
                            expiresAt: true,
                        }
                    },
                    _count: {
                        select: {
                            purchases: true,
                            items: true,
                        }
                    }
                }
            }),
            prisma.package.count({ where }),
        ]);

        return {
            meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
            packages: packages.map(pkg => ({
                ...localizeObject(pkg, locale, PACKAGE_I18N_KEYS),
                courseCount: pkg._count.items,
                purchaseCount: pkg._count.purchases,
                courses: pkg.items.map(item => ({
                    id: item.course.id,
                    title: localizeObject(item.course.courseTitle, locale),
                    slug: item.course.slug,
                })),
                recentPurchases: pkg.purchases.slice(0, 5),
            })),
        };
    }

    async getPackageById(id, locale = 'it', user = null) {
        const packageData = await prisma.package.findUnique({
            where: { id },
            include: {
                items: {
                    include: {
                        course: {
                            select: {
                                id: true,
                                courseTitle: true,
                                slug: true,
                                thumbnailUrl: true,
                                price: true,
                            }
                        }
                    }
                },
                purchases: {
                    include: {
                        company: {
                            select: {
                                id: true,
                                name: true,
                            }
                        }
                    },
                    orderBy: { purchasedAt: 'desc' },
                    take: 10,
                },
                _count: {
                    select: {
                        purchases: true,
                        items: true,
                    }
                }
            }
        });

        if (!packageData) return null;

        // Check permission
        if (user?.level !== 'PLATFORM_ADMIN' && !packageData.isActive) {
            return null;
        }

        return {
            ...localizeObject(packageData, locale, PACKAGE_I18N_KEYS),
            courseCount: packageData._count.items,
            purchaseCount: packageData._count.purchases,
            courses: packageData.items.map(item => ({
                id: item.course.id,
                title: localizeObject(item.course.courseTitle, locale),
                slug: item.course.slug,
                thumbnailUrl: item.course.thumbnailUrl,
                price: item.course.price,
            })),
            recentPurchases: packageData.purchases,
        };
    }

    async getPackageBySlug(slug, locale = 'it', user = null) {
        const packageData = await prisma.package.findUnique({
            where: { slug },
            include: {
                items: {
                    include: {
                        course: {
                            select: {
                                id: true,
                                courseTitle: true,
                                slug: true,
                                thumbnailUrl: true,
                                price: true,
                            }
                        }
                    }
                },
                purchases: {
                    include: {
                        company: {
                            select: {
                                id: true,
                                name: true,
                            }
                        }
                    },
                    orderBy: { purchasedAt: 'desc' },
                    take: 10,
                },
                _count: {
                    select: {
                        purchases: true,
                        items: true,
                    }
                }
            }
        });

        if (!packageData) return null;

        if (user?.level !== 'PLATFORM_ADMIN' && !packageData.isActive) {
            return null;
        }

        return {
            ...localizeObject(packageData, locale, PACKAGE_I18N_KEYS),
            courseCount: packageData._count.items,
            purchaseCount: packageData._count.purchases,
            courses: packageData.items.map(item => ({
                id: item.course.id,
                title: localizeObject(item.course.courseTitle, locale),
                slug: item.course.slug,
                thumbnailUrl: item.course.thumbnailUrl,
                price: item.course.price,
            })),
            recentPurchases: packageData.purchases,
        };
    }


    async createPackage(data, userId) {
        const { name, slug, courseIds, tenantId, ...rest } = data;

        let finalSlug = slug;
        if (!finalSlug) {
            finalSlug = await makeSlugUnique(generateSlug(name));
        } else {
            const exists = await prisma.package.findUnique({ where: { slug: finalSlug }, select: { id: true } });
            if (exists) throw new Error(`Slug "${finalSlug}" is already taken.`);
        }

        // Verify tenant exists if provided
        if (tenantId) {
            const tenant = await prisma.tenant.findUnique({
                where: { id: tenantId },
                select: { id: true, isActive: true }
            });
            if (!tenant) throw new Error('Tenant not found');
            if (!tenant.isActive) throw new Error('Tenant is not active');
        }

        // Verify courses exist if provided
        if (courseIds && courseIds.length > 0) {
            const courses = await prisma.course.findMany({
                where: { id: { in: courseIds } },
                select: { id: true }
            });
            if (courses.length !== courseIds.length) {
                throw new Error('One or more courses do not exist');
            }
        }

        // Create package with items
        return prisma.package.create({
            data: {
                name,
                slug: finalSlug,
                ...rest,
                ...(tenantId && { tenantId }),
                ...(courseIds && courseIds.length > 0 && {
                    items: {
                        create: courseIds.map(courseId => ({ courseId }))
                    }
                })
            },
            include: {
                items: {
                    include: {
                        course: {
                            select: {
                                id: true,
                                courseTitle: true,
                                slug: true,
                            }
                        }
                    }
                },
                _count: {
                    select: {
                        purchases: true,
                        items: true,
                    }
                }
            }
        });
    }

    async updatePackage(id, data, userId) {
        const existing = await prisma.package.findUnique({
            where: { id },
            select: { id: true, slug: true, tenantId: true }
        });
        if (!existing) throw new Error('Package not found');

        const { name, slug, courseIds, tenantId, ...rest } = data;

        // Handle slug update
        let finalSlug = slug;
        if (finalSlug && finalSlug !== existing.slug) {
            const exists = await prisma.package.findUnique({
                where: { slug: finalSlug },
                select: { id: true }
            });
            if (exists) throw new Error(`Slug "${finalSlug}" is already taken.`);
        }
        if (name && !finalSlug) {
            finalSlug = await makeSlugUnique(generateSlug(name));
        }

        // Verify tenant if changing
        if (tenantId && tenantId !== existing.tenantId) {
            const tenant = await prisma.tenant.findUnique({
                where: { id: tenantId },
                select: { id: true, isActive: true }
            });
            if (!tenant) throw new Error('Tenant not found');
            if (!tenant.isActive) throw new Error('Tenant is not active');
        }

        // Update package
        const updated = await prisma.package.update({
            where: { id },
            data: {
                ...rest,
                ...(name && { name }),
                ...(finalSlug && { slug: finalSlug }),
                ...(tenantId && { tenantId }),
            },
            include: {
                items: {
                    include: {
                        course: {
                            select: {
                                id: true,
                                courseTitle: true,
                                slug: true,
                            }
                        }
                    }
                },
                _count: {
                    select: {
                        purchases: true,
                        items: true,
                    }
                }
            }
        });

        // Update course items if provided
        if (courseIds !== undefined) {
            // Delete existing items
            await prisma.packageItem.deleteMany({
                where: { packageId: id }
            });

            // Create new items
            if (courseIds.length > 0) {
                await prisma.packageItem.createMany({
                    data: courseIds.map(courseId => ({
                        packageId: id,
                        courseId: courseId
                    }))
                });
            }

            // Fetch updated package with new items
            return prisma.package.findUnique({
                where: { id },
                include: {
                    items: {
                        include: {
                            course: {
                                select: {
                                    id: true,
                                    courseTitle: true,
                                    slug: true,
                                }
                            }
                        }
                    },
                    _count: {
                        select: {
                            purchases: true,
                            items: true,
                        }
                    }
                }
            });
        }

        return updated;
    }


    async deletePackage(id, userId) {
        const existing = await prisma.package.findUnique({
            where: { id },
            select: {
                id: true,
                _count: {
                    select: { purchases: true }
                }
            }
        });
        if (!existing) throw new Error('Package not found');

        // Check if package has purchases
        if (existing._count.purchases > 0) {
            throw new Error(
                `Cannot delete package with ${existing._count.purchases} purchase(s). Deactivate it instead.`
            );
        }

        // Delete package (cascade will delete items)
        return prisma.package.delete({
            where: { id },
            select: {
                id: true,
                slug: true,
                name: true,
            }
        });
    }

    async toggleActive(id, isActive, userId) {
        const existing = await prisma.package.findUnique({
            where: { id },
            select: { id: true }
        });
        if (!existing) throw new Error('Package not found');

        return prisma.package.update({
            where: { id },
            data: { isActive },
            select: {
                id: true,
                slug: true,
                name: true,
                isActive: true,
            }
        });
    }
    async getPackageStats(id, userId) {
        const existing = await prisma.package.findUnique({
            where: { id },
            select: { id: true }
        });
        if (!existing) throw new Error('Package not found');

        const [purchases, totalRevenue, averageSeats] = await Promise.all([
            prisma.packagePurchase.findMany({
                where: { packageId: id },
                select: {
                    id: true,
                    seatsTotal: true,
                    seatsUsed: true,
                    purchasedAt: true,
                    expiresAt: true,
                    company: {
                        select: {
                            id: true,
                            name: true,
                        }
                    }
                },
                orderBy: { purchasedAt: 'desc' },
            }),
            prisma.payment.aggregate({
                where: {
                    packagePurchaseId: { not: null },
                    packagePurchase: { packageId: id },
                    status: 'SUCCESS',
                },
                _sum: { amount: true },
            }),
            prisma.packagePurchase.aggregate({
                where: { packageId: id },
                _avg: { seatsTotal: true },
                _sum: { seatsTotal: true },
            }),
        ]);

        return {
            packageId: id,
            totalPurchases: purchases.length,
            totalRevenue: totalRevenue._sum.amount || 0,
            totalSeatsSold: averageSeats._sum.seatsTotal || 0,
            averageSeatsPerPurchase: Math.round(averageSeats._avg.seatsTotal || 0),
            recentPurchases: purchases.slice(0, 10),
        };
    }
}

export const packageService = new PackageService();