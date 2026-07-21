import { prisma } from '../../../config/db.js';
export const generateSlug = (titleObj, preferredLanguages = ['en', 'it', 'fr', 'zh']) => {
    let title = '';

    if (typeof titleObj === 'string') {
        title = titleObj;
    } else if (titleObj && typeof titleObj === 'object') {
        // Try to get title from preferred languages
        for (const lang of preferredLanguages) {
            if (titleObj[lang]) {
                title = titleObj[lang];
                break;
            }
        }
        // Fallback to any available language
        if (!title) {
            const firstKey = Object.keys(titleObj)[0];
            title = firstKey ? titleObj[firstKey] : '';
        }
    }

    if (!title) {
        throw new Error('Title is required to generate slug');
    }

    // Convert to slug format
    return title
        .toLowerCase()
        .trim()
        .replace(/[^\w\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-+|-+$/g, '');
};


export const slugExists = async (slug, excludeId = null) => {
    const where = {
        slug,
        ...(excludeId ? { id: { not: excludeId } } : {}),
    };
    const existing = await prisma.course.findFirst({
        where,
        select: { id: true }
    });
    return !!existing;
};


export const makeSlugUnique = async (baseSlug, excludeId = null, maxAttempts = 100) => {
    // Clean the base slug first
    const cleanBaseSlug = baseSlug
        .toLowerCase()
        .trim()
        .replace(/[^\w\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-+|-+$/g, '');

    let slug = cleanBaseSlug;
    let counter = 1;

    if (!slug) {
        slug = 'untitled';
    }

    while (counter <= maxAttempts) {
        const exists = await slugExists(slug, excludeId);
        if (!exists) return slug;

        slug = `${cleanBaseSlug}-${counter++}`;
    }

    throw new Error(`Unable to generate unique slug after ${maxAttempts} attempts`);
};

export const createUniqueSlug = async (titleObj, options = {}) => {
    const {
        excludeId = null,
        preferredLanguages = ['en', 'it', 'fr', 'zh'],
        maxAttempts = 100
    } = options;

    const baseSlug = generateSlug(titleObj, preferredLanguages);
    return await makeSlugUnique(baseSlug, excludeId, maxAttempts);
};


export const isValidSlug = (slug) => {
    if (!slug || typeof slug !== 'string') return false;
    return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug);
};