export const courseListSelect = {
    id: true,
    courseTitle: true,
    slug: true,
    description: true,
    format: true,
    navigationMode: true,
    price: true,
    basePrice: true,
    isActive: true,
    isB2BOnly: true,
    thumbnailUrl: true,
    durationMinutes: true,
    duration: true,
    validityDays: true,
    passScorePercent: true,
    courseStartDate: true,
    courseEndDate: true,

    // ── replaced raw JSON fields with package relations ──
    singleUserPackageId: true,
    singleUserPackage: {
        select: {
            id: true,
            title: true,
            features: true,
        },
    },
    companyPackageId: true,
    companyPackage: {
        select: {
            id: true,
            title: true,
            description: true,
            features: true,
        },
    },

    category: true,
    code: true,
    createdAt: true,
    updatedAt: true,
    tenantId: true,
    teacher: { select: { id: true, firstName: true, lastName: true, email: true } },
    tutorUser: { select: { id: true, firstName: true, lastName: true, email: true } },
    createdBy: { select: { id: true, firstName: true, lastName: true, email: true } },
    reviews: {
        select: {
            rating: true,
            id: true,
            comment: true,
            createdAt: true,
            user: {
                select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                    email: true,
                }
            }
        },
        orderBy: {
            createdAt: 'desc'
        }
    },
    _count: {
        select: {
            enrollments: true,
            lessons: true,
            reviews: true,
        }
    },
};

export const courseDetailSelect = {
    ...courseListSelect,
    trainingPlanTitle: true,
    trainingPlanId: true,
    trainingActionId: true,
    financingCompany: true,
    cig: true, cup: true, cip: true,
    type: true,
    scormPackageUrl: true,

    courseLocation: true, selectType: true, sector: true,
    fund: true, methodology: true, trainingProjectManager: true,
    tutorName: true, vat: true,
    documentUrl: true, videoUrl: true,

    lessons: {
        orderBy: { orderIndex: 'asc' },
        select: {
            id: true,
            title: true,
            orderIndex: true,
            contentType: true,
            scormPackageUrl: true,
            scormVersion: true,
            scormEntryPoint: true,
            contentUrl: true,
            youtubeUrl: true,
            durationSecs: true,
            isRequired: true,
            isLocked: true,
            createdAt: true,
        },
    },

    quizzes: {
        where: { isActive: true },
        select: {
            id: true,
            quizTitle: true,
            quizType: true,
            passScorePercent: true,
            isPublished: true,
            createdAt: true,
        },
    },

    pricingTiers: {
        where: { isActive: true },
        orderBy: { sortOrder: 'asc' },
        select: {
            id: true,
            minUsers: true,
            maxUsers: true,
            pricePerUser: true,
            sortOrder: true,
            isActive: true,
        }
    }
};