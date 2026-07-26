import { prisma } from '../../config/db.js';
import { localizeObject } from '../../shared/services/translate/translate.service.js';
import { slugService } from '../../shared/utils/slug/slug.service.js';
import { isValidSlug, slugExists } from '../../shared/utils/slug/slug.utils.js';
import { courseDetailSelect, courseListSelect } from './course.utils.js';
import { assertCanManageCourse } from './course.permission.js';

export const TRACKED_TYPES = new Set(['SCORM', 'SCORM_12']);
export const isTracked = (contentType) => TRACKED_TYPES.has(contentType);

const COURSE_I18N_KEYS = ['courseTitle', 'description', 'trainingPlanTitle', 'financingCompany'];

const VALID_COURSE_CATEGORIES = ['SEVESO', 'MANDATORY', 'CATALOG'];

const buildCourseSearchOrConditions = (searchTerm) => {
    const search = String(searchTerm || '').trim();
    if (!search) return null;

    const searchUpper = search.toUpperCase();
    const conditions = [
        { courseTitle: { path: ['it'], string_contains: search } },
        { courseTitle: { path: ['en'], string_contains: search } },
        { courseTitle: { path: ['fr'], string_contains: search } },
        { courseTitle: { path: ['zh'], string_contains: search } },
        { slug: { contains: search, mode: 'insensitive' } },
        { code: { path: ['en'], string_contains: search } },
        { code: { path: ['it'], string_contains: search } },
    ];

    if (VALID_COURSE_CATEGORIES.includes(searchUpper)) {
        conditions.push({ category: { equals: searchUpper } });
    }

    if (!Number.isNaN(Number(search))) {
        conditions.push({ duration: Number(search) });
    }

    return conditions;
};

const resolveLicenseeTenantId = async (user) => {
    if (user?.tenantId) return user.tenantId;
    if (!user?.id) return null;
    const dbUser = await prisma.user.findUnique({
        where: { id: user.id },
        select: { tenantId: true },
    });
    return dbUser?.tenantId ?? null;
};

const isLessonProgressComplete = (progress, contentType) => {
    if (['SCORM', 'SCORM_12'].includes(contentType)) {
        return ['COMPLETED', 'PASSED'].includes(progress?.scormStatus);
    }
    return progress?.completed === true;
};

async function attachCourseListStats(courses = []) {
    if (!courses.length) return courses;

    const courseIds = courses.map((course) => course.id);

    const [lessonCounts, enrollments] = await Promise.all([
        prisma.lesson.groupBy({
            by: ['courseId'],
            where: { courseId: { in: courseIds } },
            _count: { _all: true },
        }),
        prisma.enrollment.findMany({
            where: { courseId: { in: courseIds } },
            select: {
                id: true,
                courseId: true,
                lessonProgress: {
                    select: {
                        completed: true,
                        scormStatus: true,
                        lesson: { select: { contentType: true } },
                    },
                },
            },
        }),
    ]);

    const lessonCountMap = new Map(
        lessonCounts.map((row) => [row.courseId, row._count._all]),
    );

    const progressByCourse = new Map();

    for (const enrollment of enrollments) {
        const totalLessons = lessonCountMap.get(enrollment.courseId) ?? 0;
        let percentage = 0;

        if (totalLessons > 0) {
            const completedLessons = enrollment.lessonProgress.filter((row) =>
                isLessonProgressComplete(row, row.lesson?.contentType),
            ).length;

            percentage = Math.round((completedLessons / totalLessons) * 100);
        }

        if (!progressByCourse.has(enrollment.courseId)) {
            progressByCourse.set(enrollment.courseId, []);
        }
        progressByCourse.get(enrollment.courseId).push(percentage);
    }

    return courses.map((course) => {
        const progressValues = progressByCourse.get(course.id) ?? [];
        const averageProgress = progressValues.length
            ? Math.round(progressValues.reduce((sum, value) => sum + value, 0) / progressValues.length)
            : 0;

        return {
            ...course,
            enrollmentCount: course._count?.enrollments ?? progressValues.length,
            averageProgress,
        };
    });
}

export class CourseService {

    async getAllCourses(queryParams = {}, locale = 'it', user = null, tenantId = null) {
        console.log('🔍 Received queryParams:', JSON.stringify(queryParams, null, 2));

        const page = parseInt(queryParams.page) || 1;
        const limit = Math.min(parseInt(queryParams.limit) || 20, 100);
        const skip = (page - 1) * limit;

        const where = {};
        const userLevel = user?.level;
        const isPlatformAdmin = userLevel === 'PLATFORM_ADMIN';
        const isLicensee = userLevel === 'LICENSE_USER';

        // Tenant + ownership filtering
        if (isLicensee) {
            const licenseetenantId = await resolveLicenseeTenantId(user);
            if (!licenseetenantId) throw new Error('Licensee user has no tenant assigned. Contact admin.');
            where.tenantId = licenseetenantId;
            where.createdById = user.id;
            if (queryParams.isActive !== undefined) {
                where.isActive = queryParams.isActive === 'true';
            }
        } else if (isPlatformAdmin) {
            where.createdById = user.id;
            const filterTenant = queryParams.tenantId || tenantId;
            if (filterTenant) where.tenantId = filterTenant;
        } else {
            const effectiveTenant = queryParams.tenantId || tenantId || user?.tenantId;
            if (effectiveTenant) where.tenantId = effectiveTenant;
            where.isActive = true;
        }

        // Status
        if (queryParams.isActive !== undefined && !isLicensee) {
            where.isActive = queryParams.isActive === 'true';
        }

        if (queryParams.isB2BOnly !== undefined) {
            where.isB2BOnly = queryParams.isB2BOnly === 'true';
        }

        // ===== CATEGORY FILTER - FIXED =====
        if (queryParams.category) {
            // Ensure category is uppercase and is a valid enum
            const categoryValue = queryParams.category.toUpperCase();
            // Validate against allowed categories
            const validCategories = VALID_COURSE_CATEGORIES;
            if (validCategories.includes(categoryValue)) {
                where.category = categoryValue;
                console.log(`✅ Applying category filter: ${categoryValue}`);
            } else {
                console.warn(`⚠️ Invalid category: ${queryParams.category}`);
            }
        }

        // ===== FORMAT FILTER =====
        if (queryParams.format) {
            where.format = queryParams.format;
        }

        // ===== DURATION FILTERS =====
        if (queryParams.duration) {
            where.duration = Number(queryParams.duration);
        }

        if (queryParams.minDuration || queryParams.maxDuration) {
            where.duration = {};
            if (queryParams.minDuration) {
                where.duration.gte = Number(queryParams.minDuration);
            }
            if (queryParams.maxDuration) {
                where.duration.lte = Number(queryParams.maxDuration);
            }
        }

        // ===== SEARCH =====
        if (queryParams.search) {
            const searchConditions = buildCourseSearchOrConditions(queryParams.search);
            if (searchConditions) {
                where.OR = searchConditions;
            }
        }

        // ===== CODE FILTER =====
        if (queryParams.code) {
            where.code = {
                path: ['en'],
                string_contains: queryParams.code,
            };
        }

        // ===== SORTING =====
        const orderBy = {};
        const sortField = queryParams.sortBy || 'createdAt';
        const sortOrder = queryParams.sortOrder === 'asc' ? 'asc' : 'desc';

        if (sortField === 'duration') {
            orderBy.duration = sortOrder;
        } else if (sortField === 'courseTitle') {
            orderBy.courseTitle = {
                path: ['it'],
                order: sortOrder,
            };
        } else {
            orderBy[sortField] = sortOrder;
        }

        // ===== DEBUG: Log the final where clause =====
        console.log('📋 Final WHERE clause:', JSON.stringify(where, null, 2));

        // ===== EXECUTE QUERY =====
        const [courses, total] = await Promise.all([
            prisma.course.findMany({
                where,
                orderBy,
                skip,
                take: limit,
                select: courseListSelect,
            }),
            prisma.course.count({ where }),
        ]);

        console.log(`📊 Found ${courses.length} courses (total: ${total})`);

        let processedCourses = courses.map(c => {
                const localized = localizeObject(c, locale, COURSE_I18N_KEYS);
                const reviews = c.reviews || [];
                const totalReviews = reviews.length;
                const averageRating = totalReviews > 0
                    ? Math.round((reviews.reduce((sum, r) => sum + r.rating, 0) / totalReviews) * 10) / 10
                    : 0;

                localized.averageRating = averageRating;
                localized.totalReviews = totalReviews;
                delete localized.reviews;
                return localized;
            });

        if (isLicensee || isPlatformAdmin) {
            processedCourses = await attachCourseListStats(processedCourses);
        }

        // Process results
        return {
            meta: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit),
                tenantId: where.tenantId ?? null,
                isPublic: !isPlatformAdmin && !isLicensee,
                appliedFilters: {
                    category: queryParams.category || null,
                    format: queryParams.format || null,
                    duration: queryParams.duration || null,
                    minDuration: queryParams.minDuration || null,
                    maxDuration: queryParams.maxDuration || null,
                    search: queryParams.search || null,
                    code: queryParams.code || null,
                    isActive: queryParams.isActive || null,
                    isB2BOnly: queryParams.isB2BOnly || null,
                },
            },
            courses: processedCourses,
        };
    }

    async getCourseById(id, locale = 'it', user = null, tenantId = null) {
        const isPlatformAdmin = user?.level === 'PLATFORM_ADMIN';
        const isLicensee = user?.level === 'LICENSE_USER';

        const where = { id };

        if (isLicensee || isPlatformAdmin) {
            if (!user?.id) return null;
            where.createdById = user.id;
            if (isLicensee) {
                const effectiveTenant = tenantId || await resolveLicenseeTenantId(user);
                if (effectiveTenant) where.tenantId = effectiveTenant;
            } else if (tenantId) {
                where.tenantId = tenantId;
            }
        } else if (user) {
            const effectiveTenant = tenantId || user?.tenantId;
            if (effectiveTenant) where.tenantId = effectiveTenant;
        }

        const course = await prisma.course.findFirst({ where, select: courseDetailSelect });
        if (!course) return null;

        if (!user || (!isPlatformAdmin && !isLicensee)) {
            if (!course.isActive) {
                if (!user?.id) return null;
                const enrolled = await prisma.enrollment.findUnique({
                    where: { userId_courseId: { userId: user.id, courseId: id } },
                    select: { id: true },
                });
                if (!enrolled) return null;
            }
        }

        return this._buildCourseDetailResponse(course, locale);
    }

    async getCourseBySlug(slug, locale = 'it', user = null, tenantId = null) {
        const isPlatformAdmin = user?.level === 'PLATFORM_ADMIN';
        const isLicensee = user?.level === 'LICENSE_USER';

        const where = { slug };

        if (isLicensee || isPlatformAdmin) {
            if (!user?.id) return null;
            where.createdById = user.id;
            if (isLicensee) {
                const effectiveTenant = tenantId || await resolveLicenseeTenantId(user);
                if (effectiveTenant) where.tenantId = effectiveTenant;
            } else if (tenantId) {
                where.tenantId = tenantId;
            }
        } else if (user) {
            const effectiveTenant = tenantId || user?.tenantId;
            if (effectiveTenant) where.tenantId = effectiveTenant;
        }

        const course = await prisma.course.findFirst({ where, select: courseDetailSelect });
        if (!course) return null;

        if (!user || (!isPlatformAdmin && !isLicensee)) {
            if (!course.isActive) return null;
        }

        return this._buildCourseDetailResponse(course, locale);
    }


    _buildCourseDetailResponse(course, locale) {
        const reviews = course.reviews || [];
        const totalReviews = reviews.length;
        const averageRating = totalReviews > 0
            ? Math.round((reviews.reduce((sum, r) => sum + r.rating, 0) / totalReviews) * 10) / 10
            : 0;

        const localized = this._localizeCourse(course, locale);

        localized.averageRating = averageRating;
        localized.totalReviews = totalReviews;

        localized.recentReviews = reviews.slice(0, 5).map(r => ({
            id: r.id,
            rating: r.rating,
            comment: r.comment,
            createdAt: r.createdAt,
            user: {
                id: r.user.id,
                name: `${r.user.firstName || ''} ${r.user.lastName || ''}`.trim() || r.user.email,
            },
        }));

        delete localized.reviews;

        localized.pricing = this._buildPricingBlock(course, locale);

        return localized;
    }
    _buildPricingBlock(course, locale) {
        const pick = (json) => json?.[locale] || json?.en || null;

        const suPkg = course.singleUserPackage;
        const coPkg = course.companyPackage;

        const pickFeatureLabel = (f) => {
            // simple i18n-string feature (single-user) vs {label:{...}} feature (company)
            if (f && typeof f === 'object' && f.label) {
                return { ...f, label: pick(f.label) };
            }
            return pick(f);
        };

        return {
            singleUser: {
                title: pick(suPkg?.title) || 'Single course',
                price: course.price,
                features: (suPkg?.features || []).map(pickFeatureLabel).filter(Boolean),
            },
            company: {
                title: pick(coPkg?.title) || 'Company package',
                description: pick(coPkg?.description) || '',
                features: (coPkg?.features || []).map(pickFeatureLabel).filter(Boolean),
                tiers: (course.pricingTiers || [])
                    .filter(t => t.isActive)
                    .sort((a, b) => a.sortOrder - b.sortOrder || a.minUsers - b.minUsers)
                    .map(t => ({
                        id: t.id,
                        minUsers: t.minUsers,
                        maxUsers: t.maxUsers,
                        pricePerUser: t.pricePerUser,
                    })),
            },
        };
    }

    _localizeCourse(course, locale) {
        if (!course) return null;

        const localized = { ...course };

        const jsonFields = [
            'courseTitle', 'description', 'trainingPlanTitle', 'financingCompany',
            'type', 'courseLocation', 'selectType', 'sector', 'fund', 'methodology',
            'trainingProjectManager', 'tutorName', 'vat',
        ];

        for (const field of jsonFields) {
            if (course[field] && typeof course[field] === 'object' && !Array.isArray(course[field])) {
                localized[field] = course[field][locale] || course[field]['en'] || null;
            }
        }

        if (course.lessons && Array.isArray(course.lessons)) {
            localized.lessons = course.lessons.map(lesson => {
                const localizedLesson = { ...lesson };
                if (lesson.title && typeof lesson.title === 'object') {
                    localizedLesson.title = lesson.title[locale] || lesson.title['en'] || null;
                }
                return localizedLesson;
            });
        }

        if (course.quizzes && Array.isArray(course.quizzes)) {
            localized.quizzes = course.quizzes.map(quiz => {
                const localizedQuiz = { ...quiz };
                if (quiz.quizTitle && typeof quiz.quizTitle === 'object') {
                    localizedQuiz.quizTitle = quiz.quizTitle[locale] || quiz.quizTitle['en'] || null;
                }
                return localizedQuiz;
            });
        }

        return localized;
    }

    // async createCourse(data, createdById, tenantIdFromRequest = null) {
    //     const {
    //         teacherId, tutorId, tenantId, slug, courseTitle,
    //         lessons: lessonData, pricingTiers,
    //         singleUserPackageId, companyPackageId,
    //         ...rest
    //     } = data;

    //     if (singleUserPackageId) await this._validatePackage(singleUserPackageId, 'SINGLE_USER', finalTenantId);
    //     if (companyPackageId) await this._validatePackage(companyPackageId, 'COMPANY', finalTenantId);

    //     const user = await prisma.user.findUnique({
    //         where: { id: createdById },
    //         select: { level: true, tenantId: true },
    //     });

    //     if (!user) throw new Error('User not found');
    //     if (!['PLATFORM_ADMIN', 'LICENSE_USER'].includes(user.level)) {
    //         throw new Error('Only Platform Admin and Licensee users can create courses');
    //     }

    //     let finalTenantId = tenantId || tenantIdFromRequest;
    //     if (user.level === 'LICENSE_USER') {
    //         const lt = user.tenantId || (await resolveLicenseeTenantId({ id: createdById }));
    //         if (!lt) throw new Error('Licensee user has no tenant. Contact admin.');
    //         finalTenantId = lt;
    //     }
    //     if (user.level === 'PLATFORM_ADMIN' && !finalTenantId) {
    //         throw new Error('Platform Admin must provide tenantId.');
    //     }

    //     if (finalTenantId) {
    //         const tenant = await prisma.tenant.findUnique({ where: { id: finalTenantId }, select: { id: true, isActive: true } });
    //         if (!tenant) throw new Error('Tenant not found');
    //         if (!tenant.isActive) throw new Error('Tenant is not active');
    //     }

    //     let finalSlug = slug;
    //     if (!finalSlug) {
    //         finalSlug = await slugService.generateCourseSlug(courseTitle);
    //     } else {
    //         if (!isValidSlug(finalSlug)) throw new Error(`Invalid slug format: "${finalSlug}"`);
    //         const exists = await slugExists(finalSlug);
    //         if (exists) throw new Error(`Slug "${finalSlug}" is already taken.`);
    //     }


    //     if (teacherId) await this._validateTenantUser(teacherId, finalTenantId, 'Teacher');
    //     if (tutorId) await this._validateTenantUser(tutorId, finalTenantId, 'Tutor');


    //     if (pricingTiers?.length) this._validatePricingTiers(pricingTiers);

    //     // ── Create course ──
    //     return prisma.course.create({
    //         data: {
    //             ...rest,
    //             courseTitle,
    //             slug: finalSlug,
    //             ...(teacherId && { teacherId }),
    //             ...(tutorId && { tutorId }),
    //             ...(singleUserPackageId && { singleUserPackageId }),
    //             ...(companyPackageId && { companyPackageId }),
    //             tenantId: finalTenantId,
    //             createdById,
    //             ...(lessonData?.length && {
    //                 lessons: { create: lessonData.map((l, idx) => this._buildLessonData(l, idx)) },
    //             }),
    //             ...(pricingTiers?.length && {
    //                 pricingTiers: {
    //                     create: pricingTiers.map((t, idx) => ({
    //                         minUsers: t.minUsers,
    //                         maxUsers: t.maxUsers ?? null,
    //                         pricePerUser: t.pricePerUser,
    //                         sortOrder: t.sortOrder ?? idx,
    //                         isActive: t.isActive ?? true,
    //                     })),
    //                 },
    //             }),
    //         },
    //         select: courseDetailSelect,
    //     });
    // }
    async createCourse(data, createdById, tenantIdFromRequest = null) {
        const {
            teacherId, tutorId, tenantId, slug, courseTitle,
            lessons: lessonData, pricingTiers,
            singleUserPackageId, companyPackageId,
            ...rest
        } = data;

        // ❌ REMOVE these two lines from here (they used finalTenantId before it existed)
        // if (singleUserPackageId) await this._validatePackage(singleUserPackageId, 'SINGLE_USER', finalTenantId);
        // if (companyPackageId) await this._validatePackage(companyPackageId, 'COMPANY', finalTenantId);

        const user = await prisma.user.findUnique({
            where: { id: createdById },
            select: { level: true, tenantId: true },
        });

        if (!user) throw new Error('User not found');
        if (!['PLATFORM_ADMIN', 'LICENSE_USER'].includes(user.level)) {
            throw new Error('Only Platform Admin and Licensee users can create courses');
        }

        let finalTenantId = tenantId || tenantIdFromRequest;
        if (user.level === 'LICENSE_USER') {
            const lt = user.tenantId || (await resolveLicenseeTenantId({ id: createdById }));
            if (!lt) throw new Error('Licensee user has no tenant. Contact admin.');
            finalTenantId = lt;
        }
        if (!finalTenantId && user.tenantId) {
            finalTenantId = user.tenantId;
        }
        if (!finalTenantId) {
            throw new Error('Unable to resolve tenant for course creation. Contact admin.');
        }

        if (finalTenantId) {
            const tenant = await prisma.tenant.findUnique({ where: { id: finalTenantId }, select: { id: true, isActive: true } });
            if (!tenant) throw new Error('Tenant not found');
            if (!tenant.isActive) throw new Error('Tenant is not active');
        }

        // ✅ ADD the validation calls HERE instead — after finalTenantId exists
        if (singleUserPackageId) await this._validatePackage(singleUserPackageId, 'SINGLE_USER', finalTenantId);
        if (companyPackageId) await this._validatePackage(companyPackageId, 'COMPANY', finalTenantId);

        let finalSlug = slug;
        if (!finalSlug) {
            finalSlug = await slugService.generateCourseSlug(courseTitle);
        } else {
            if (!isValidSlug(finalSlug)) throw new Error(`Invalid slug format: "${finalSlug}"`);
            const exists = await slugExists(finalSlug);
            if (exists) throw new Error(`Slug "${finalSlug}" is already taken.`);
        }

        if (teacherId) await this._validateTenantUser(teacherId, finalTenantId, 'Teacher');
        if (tutorId) await this._validateTenantUser(tutorId, finalTenantId, 'Tutor');

        if (pricingTiers?.length) this._validatePricingTiers(pricingTiers);

        // ── Create course ──
        return prisma.course.create({
            data: {
                ...rest,
                courseTitle,
                slug: finalSlug,
                ...(teacherId && { teacherId }),
                ...(tutorId && { tutorId }),
                ...(singleUserPackageId && { singleUserPackageId }),
                ...(companyPackageId && { companyPackageId }),
                tenantId: finalTenantId,
                createdById,
                ...(lessonData?.length && {
                    lessons: { create: lessonData.map((l, idx) => this._buildLessonData(l, idx)) },
                }),
                ...(pricingTiers?.length && {
                    pricingTiers: {
                        create: pricingTiers.map((t, idx) => ({
                            minUsers: t.minUsers,
                            maxUsers: t.maxUsers ?? null,
                            pricePerUser: t.pricePerUser,
                            sortOrder: t.sortOrder ?? idx,
                            isActive: t.isActive ?? true,
                        })),
                    },
                }),
            },
            select: courseDetailSelect,
        });
    }

    async _validatePackage(packageId, expectedType, tenantId) {
        const pkg = await prisma.coursePackage.findUnique({
            where: { id: packageId },
            select: { id: true, type: true, tenantId: true, isActive: true },
        });
        if (!pkg || !pkg.isActive) throw new Error(`Package ${packageId} not found or inactive`);
        if (pkg.type !== expectedType) throw new Error(`Package ${packageId} is not a ${expectedType} package`);
        if (pkg.tenantId && pkg.tenantId !== tenantId) throw new Error(`Package ${packageId} does not belong to this tenant`);
    }

    async updateCourse(id, data, userId = null, userLevel = null) {
        const course = await prisma.course.findUnique({
            where: { id },
            select: { id: true, tenantId: true, createdById: true, slug: true },
        });
        if (!course) throw new Error('Course not found');

        await this._checkCoursePermission(course, userId, userLevel);

        const {
            teacherId, tutorId, tenantId, slug, courseTitle,
            pricingTiers,
            singleUserPackageId,
            companyPackageId,
            ...rest
        } = data;

        let finalSlug = slug;
        if (finalSlug && finalSlug !== course.slug) {
            if (!isValidSlug(finalSlug)) throw new Error(`Invalid slug format: "${finalSlug}"`);
            const exists = await slugExists(finalSlug, id);
            if (exists) throw new Error(`Slug "${finalSlug}" is already taken.`);
        }
        if (courseTitle && !finalSlug) {
            finalSlug = await slugService.generateCourseSlug(courseTitle, { excludeId: id });
        }

        const targetTenant = tenantId || course.tenantId;
        if (teacherId) await this._validateTenantUser(teacherId, targetTenant, 'Teacher');
        if (tutorId) await this._validateTenantUser(tutorId, targetTenant, 'Tutor');

        if (singleUserPackageId) {
            await this._validatePackage(singleUserPackageId, 'SINGLE_USER', targetTenant);
        }
        if (companyPackageId) {
            await this._validatePackage(companyPackageId, 'COMPANY', targetTenant);
        }

        if (tenantId && userLevel === 'PLATFORM_ADMIN') {
            const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true, isActive: true } });
            if (!tenant) throw new Error('Tenant not found');
            if (!tenant.isActive) throw new Error('Tenant is not active');
        }

        if (pricingTiers !== undefined) {
            if (pricingTiers.length) this._validatePricingTiers(pricingTiers);
            await this._syncPricingTiers(id, pricingTiers);
        }

        return prisma.course.update({
            where: { id },
            data: {
                ...rest,
                ...(courseTitle && { courseTitle }),
                ...(finalSlug && { slug: finalSlug }),
                ...(teacherId !== undefined && { teacherId }),
                ...(tutorId !== undefined && { tutorId }),
                ...(singleUserPackageId !== undefined && { singleUserPackageId }),
                ...(companyPackageId !== undefined && { companyPackageId }),
                ...(tenantId !== undefined && userLevel === 'PLATFORM_ADMIN' && { tenantId }),
            },
            select: courseDetailSelect,
        });
    }

    async deleteCourse(id, userId = null, userLevel = null) {
        const course = await prisma.course.findUnique({
            where: { id },
            select: { id: true, tenantId: true, createdById: true, _count: { select: { enrollments: true } } },
        });
        if (!course) throw new Error('Course not found');
        await this._checkCoursePermission(course, userId, userLevel);
        if (course._count.enrollments > 0) {
            throw new Error(`Cannot delete course with ${course._count.enrollments} enrollment(s). Deactivate it instead.`);
        }
        return prisma.course.delete({ where: { id } });
    }

    async toggleActive(id, isActive, userId = null, userLevel = null) {
        const course = await prisma.course.findUnique({
            where: { id },
            select: { id: true, tenantId: true, createdById: true },
        });
        if (!course) throw new Error('Course not found');
        await this._checkCoursePermission(course, userId, userLevel);
        return prisma.course.update({
            where: { id },
            data: { isActive },
            select: { id: true, isActive: true, slug: true, tenantId: true },
        });
    }

    async getCourseStats(id, userId = null, userLevel = null) {
        const course = await prisma.course.findUnique({
            where: { id },
            select: { id: true, tenantId: true, createdById: true },
        });
        if (!course) throw new Error('Course not found');
        await this._checkCoursePermission(course, userId, userLevel);

        const [enrollmentsByStatus, certificatesCount, avgScore, scormCompletions] = await Promise.all([
            prisma.enrollment.groupBy({ by: ['status'], where: { courseId: id }, _count: { _all: true } }),
            prisma.certificate.count({ where: { courseId: id } }),
            prisma.quizAttempt.aggregate({ where: { quiz: { courseId: id }, passed: true }, _avg: { scorePercent: true } }),
            prisma.lessonProgress.count({
                where: { enrollment: { courseId: id }, scormStatus: { in: ['COMPLETED', 'PASSED'] } },
            }),
        ]);

        return {
            courseId: id,
            tenantId: course.tenantId,
            enrollmentsByStatus: enrollmentsByStatus.reduce((acc, r) => ({ ...acc, [r.status]: r._count._all }), {}),
            totalCertificates: certificatesCount,
            avgPassScore: avgScore._avg.scorePercent ?? 0,
            scormCompletions,
        };
    }



    _validatePricingTiers(tiers) {
        const sorted = [...tiers].sort((a, b) => a.minUsers - b.minUsers);
        for (let i = 0; i < sorted.length - 1; i++) {
            const cur = sorted[i];
            const next = sorted[i + 1];
            if (cur.maxUsers == null || cur.maxUsers >= next.minUsers) {
                throw new Error(`Pricing tiers overlap: ${cur.minUsers}-${cur.maxUsers ?? '∞'} vs ${next.minUsers}-${next.maxUsers ?? '∞'}`);
            }
        }
    }

    async _syncPricingTiers(courseId, tiers) {
        const incomingIds = tiers.filter(t => t.id).map(t => t.id);

        await prisma.coursePricingTier.deleteMany({
            where: { courseId, id: { notIn: incomingIds.length ? incomingIds : ['__none__'] } },
        });

        for (const [idx, t] of tiers.entries()) {
            const payload = {
                minUsers: t.minUsers,
                maxUsers: t.maxUsers ?? null,
                pricePerUser: t.pricePerUser,
                sortOrder: t.sortOrder ?? idx,
                isActive: t.isActive ?? true,
            };
            if (t.id) {
                await prisma.coursePricingTier.update({ where: { id: t.id }, data: payload });
            } else {
                await prisma.coursePricingTier.create({ data: { courseId, ...payload } });
            }
        }
    }

    // ─────────────────────────────────────────
    // ✅ NEW: Company employee seat assignment
    // ─────────────────────────────────────────
    async assignEmployeeToCompanyCourse({ companyCoursePurchaseId, employeeUserId, requestingUserId }) {
        return prisma.$transaction(async (tx) => {
            const purchase = await tx.companyCoursePurchase.findUnique({
                where: { id: companyCoursePurchaseId },
                select: { id: true, companyId: true, courseId: true, seatsTotal: true, seatsUsed: true, expiresAt: true },
            });
            if (!purchase) throw new Error('Corporate purchase not found');
            if (purchase.expiresAt < new Date()) throw new Error('This corporate package has expired. Please renew.');
            if (purchase.seatsUsed >= purchase.seatsTotal) {
                throw new Error(`No seats left (${purchase.seatsUsed}/${purchase.seatsTotal}). Please renew with more seats.`);
            }

            const requester = await tx.user.findUnique({ where: { id: requestingUserId }, select: { level: true, companyId: true } });
            if (requester?.level !== 'PLATFORM_ADMIN' && requester?.companyId !== purchase.companyId) {
                throw new Error('Permission denied: not your company purchase');
            }

            const employee = await tx.user.findFirst({
                where: { id: employeeUserId, companyId: purchase.companyId },
                select: { id: true },
            });
            if (!employee) throw new Error('This user is not an employee of this company');

            const existing = await tx.enrollment.findUnique({
                where: { userId_courseId: { userId: employeeUserId, courseId: purchase.courseId } },
            });
            if (existing) throw new Error('Employee already enrolled in this course');

            const enrollment = await tx.enrollment.create({
                data: {
                    userId: employeeUserId,
                    courseId: purchase.courseId,
                    companyCoursePurchaseId: purchase.id,
                    companyContextId: purchase.companyId,
                    expiresAt: purchase.expiresAt,
                    status: 'NOT_STARTED',
                },
            });

            await tx.companyCoursePurchase.update({
                where: { id: purchase.id },
                data: { seatsUsed: { increment: 1 } },
            });

            return enrollment;
        });
    }

    async removeEmployeeFromCompanyCourse({ enrollmentId, requestingUserId }) {
        return prisma.$transaction(async (tx) => {
            const enrollment = await tx.enrollment.findUnique({ where: { id: enrollmentId } });
            if (!enrollment?.companyCoursePurchaseId) throw new Error('Invalid enrollment or not a corporate seat');

            const purchase = await tx.companyCoursePurchase.findUnique({
                where: { id: enrollment.companyCoursePurchaseId },
                select: { companyId: true },
            });

            const requester = await tx.user.findUnique({ where: { id: requestingUserId }, select: { level: true, companyId: true } });
            if (requester?.level !== 'PLATFORM_ADMIN' && requester?.companyId !== purchase?.companyId) {
                throw new Error('Permission denied: not your company purchase');
            }

            await tx.enrollment.delete({ where: { id: enrollmentId } });
            await tx.companyCoursePurchase.update({
                where: { id: enrollment.companyCoursePurchaseId },
                data: { seatsUsed: { decrement: 1 } },
            });
        });
    }

    async _checkCoursePermission(course, userId, userLevel) {
        assertCanManageCourse(
            course,
            userId ? { id: userId, level: userLevel } : null,
            'manage'
        );
    }

    async _validateTenantUser(userId, tenantId, role) {
        const user = await prisma.user.findFirst({
            where: { id: userId, ...(tenantId && { tenantId }) },
            select: { id: true },
        });
        if (!user) throw new Error(`${role} not found in this tenant`);
    }

    _buildLessonData(lesson, defaultIndex) {
        const { contentType } = lesson;
        const tracked = isTracked(contentType);

        if (tracked && !lesson.scormPackageUrl) {
            throw new Error(`SCORM lesson "${lesson.title?.en || lesson.title?.it}" requires scormPackageUrl`);
        }
        if (tracked && !lesson.scormEntryPoint) {
            throw new Error(`SCORM lesson "${lesson.title?.en}" requires scormEntryPoint (e.g. "index_lms.html")`);
        }

        return {
            title: lesson.title,
            orderIndex: lesson.orderIndex ?? defaultIndex,
            contentType,
            scormPackageUrl: tracked ? lesson.scormPackageUrl : null,
            scormVersion: tracked ? (lesson.scormVersion ?? '1.2') : null,
            scormEntryPoint: tracked ? lesson.scormEntryPoint : null,
            contentUrl: !tracked ? (lesson.contentUrl ?? null) : null,
            youtubeUrl: contentType === 'VIDEO_YOUTUBE' ? lesson.youtubeUrl : null,
            durationSecs: lesson.durationSecs ?? null,
            isRequired: lesson.isRequired ?? true,
            isLocked: lesson.isLocked ?? false,
        };
    }

    async getPublicCourses(queryParams = {}, locale = 'it') {
        const page = parseInt(queryParams.page) || 1;
        const limit = Math.min(parseInt(queryParams.limit) || 20, 100);
        const skip = (page - 1) * limit;

        const where = {
            isActive: true
        };

        // ===== TENANT FILTER =====
        if (queryParams.tenantId) {
            where.tenantId = queryParams.tenantId;
        }

        // ===== CATEGORY FILTER =====
        if (queryParams.category) {
            const categoryValue = queryParams.category.toUpperCase();
            const validCategories = VALID_COURSE_CATEGORIES;
            if (validCategories.includes(categoryValue)) {
                where.category = categoryValue;
            }
        }

        // ===== FORMAT FILTER =====
        if (queryParams.format) {
            where.format = queryParams.format;
        }

        // ===== B2B FILTER =====
        if (queryParams.isB2BOnly !== undefined) {
            where.isB2BOnly = queryParams.isB2BOnly === 'true';
        }

        // ===== DURATION FILTERS =====
        if (queryParams.duration) {
            where.duration = Number(queryParams.duration);
        }

        if (queryParams.minDuration || queryParams.maxDuration) {
            where.duration = {};
            if (queryParams.minDuration) {
                where.duration.gte = Number(queryParams.minDuration);
            }
            if (queryParams.maxDuration) {
                where.duration.lte = Number(queryParams.maxDuration);
            }
        }

        // ===== SEARCH =====
        if (queryParams.search) {
            const searchConditions = buildCourseSearchOrConditions(queryParams.search);
            if (searchConditions) {
                where.OR = searchConditions;
            }
        }

        // ===== CODE FILTER =====
        if (queryParams.code) {
            where.code = {
                path: ['en'],
                string_contains: queryParams.code,
            };
        }

        // ===== SORTING =====
        const orderBy = {};
        const sortField = queryParams.sortBy || 'createdAt';
        const sortOrder = queryParams.sortOrder === 'asc' ? 'asc' : 'desc';

        if (sortField === 'duration') {
            orderBy.duration = sortOrder;
        } else if (sortField === 'courseTitle') {
            orderBy.courseTitle = {
                path: ['it'],
                order: sortOrder,
            };
        } else if (sortField === 'price') {
            orderBy.price = sortOrder;
        } else if (sortField === 'category') {
            orderBy.category = sortOrder;
        } else {
            orderBy[sortField] = sortOrder;
        }

        // ===== DEBUG LOGGING =====
        console.log('🔍 Search term:', queryParams.search);
        console.log('📋 WHERE clause:', JSON.stringify(where, null, 2));

        // ===== EXECUTE QUERIES =====
        const [courses, total] = await Promise.all([
            prisma.course.findMany({
                where,
                orderBy,
                skip,
                take: limit,
                select: courseListSelect,
            }),
            prisma.course.count({ where }),
        ]);

        // ===== RETURN RESULTS =====
        return {
            meta: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit),
                isPublic: true,
                searchTerm: queryParams.search || null,
                appliedFilters: {
                    category: queryParams.category || null,
                    format: queryParams.format || null,
                    duration: queryParams.duration || null,
                    minDuration: queryParams.minDuration || null,
                    maxDuration: queryParams.maxDuration || null,
                    search: queryParams.search || null,
                    code: queryParams.code || null,
                    isB2BOnly: queryParams.isB2BOnly || null,
                    tenantId: queryParams.tenantId || null,
                },
            },
            courses: courses.map(c => {
                const localized = localizeObject(c, locale, COURSE_I18N_KEYS);

                const reviews = c.reviews || [];
                const totalReviews = reviews.length;
                const averageRating = totalReviews > 0
                    ? Math.round((reviews.reduce((sum, r) => sum + r.rating, 0) / totalReviews) * 10) / 10
                    : 0;

                localized.averageRating = averageRating;
                localized.totalReviews = totalReviews;
                delete localized.reviews;

                return localized;
            }),
        };
    }

    async getMyCourses(queryParams = {}, locale = 'it', user = null, tenantId = null) {
        const page = parseInt(queryParams.page) || 1;
        const limit = Math.min(parseInt(queryParams.limit) || 20, 100);
        const skip = (page - 1) * limit;

        const where = { createdById: user?.id };

        const userLevel = user?.level;
        const isPlatformAdmin = userLevel === 'PLATFORM_ADMIN';
        const isLicensee = userLevel === 'LICENSE_USER';

        if (isLicensee) {
            const licenseeTenantId = await resolveLicenseeTenantId(user);
            if (!licenseeTenantId) throw new Error('Licensee user has no tenant assigned');
            where.tenantId = licenseeTenantId;
        } else if (isPlatformAdmin && queryParams.tenantId) {
            where.tenantId = queryParams.tenantId;
        } else if (tenantId) {
            where.tenantId = tenantId;
        }

        if (queryParams.isActive !== undefined) where.isActive = queryParams.isActive === 'true';
        if (queryParams.isB2BOnly !== undefined) where.isB2BOnly = queryParams.isB2BOnly === 'true';
        if (queryParams.format) where.format = queryParams.format;

        if (queryParams.search) {
            const searchConditions = buildCourseSearchOrConditions(queryParams.search);
            if (searchConditions) {
                where.OR = searchConditions;
            }
        }

        const orderBy = { [queryParams.sortBy || 'createdAt']: queryParams.sortOrder === 'asc' ? 'asc' : 'desc' };

        const [courses, total] = await Promise.all([
            prisma.course.findMany({ where, orderBy, skip, take: limit, select: courseListSelect }),
            prisma.course.count({ where }),
        ]);

        let processedCourses = courses.map(c => localizeObject(c, locale, COURSE_I18N_KEYS));

        if (isLicensee || isPlatformAdmin) {
            processedCourses = await attachCourseListStats(processedCourses);
        }

        return {
            meta: { page, limit, total, totalPages: Math.ceil(total / limit), createdBy: user?.id, tenantId: where.tenantId ?? null },
            courses: processedCourses,
        };
    }
}

export const courseService = new CourseService();