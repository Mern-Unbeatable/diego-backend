import { prisma } from '../../../config/db.js';
import { generateSlug, makeSlugUnique, createUniqueSlug, isValidSlug, slugExists }
    from './slug.utils.js';

/**
 * Slug service that provides convenient methods for different entity types
 */
export class SlugService {


    static async generateCourseSlug(titleObj, options = {}) {
        return await createUniqueSlug(titleObj, {
            ...options,
            preferredLanguages: ['en', 'it', 'fr', 'zh']
        });
    }

    /**
     * Check if a course slug exists
     * @param {string} slug - Slug to check
     * @param {string} excludeId - Course ID to exclude
     * @returns {Promise<boolean>}
     */
    static async courseSlugExists(slug, excludeId = null) {
        const where = {
            slug,
            ...(excludeId ? { id: { not: excludeId } } : {}),
        };
        const existing = await prisma.course.findFirst({
            where,
            select: { id: true }
        });
        return !!existing;
    }

    /**
     * Validate a slug for a specific entity type
     * @param {string} slug - Slug to validate
     * @param {string} entityType - Type of entity ('course', 'user', etc.)
     * @param {Object} options - Additional options
     * @returns {Object} Validation result
     */
    static async validateSlug(slug, entityType = 'course', options = {}) {
        const result = {
            valid: true,
            errors: [],
            slug: slug
        };

        // Check format
        if (!isValidSlug(slug)) {
            result.valid = false;
            result.errors.push('Invalid slug format');
            return result;
        }

        // Check uniqueness based on entity type
        const models = {
            course: prisma.course,
            user: prisma.user,
            tenant: prisma.tenant,
            category: prisma.category
        };

        const model = models[entityType];
        if (!model) {
            result.valid = false;
            result.errors.push(`Unsupported entity type: ${entityType}`);
            return result;
        }

        try {
            const where = { slug };
            if (options.excludeId) {
                where.id = { not: options.excludeId };
            }
            const existing = await model.findFirst({
                where,
                select: { id: true }
            });

            if (existing) {
                result.valid = false;
                result.errors.push(`Slug already exists for this ${entityType}`);
            }
        } catch (error) {
            result.valid = false;
            result.errors.push(`Error checking slug: ${error.message}`);
        }

        return result;
    }

    /**
     * Generate a slug for any entity type
     * @param {Object|string} titleObj - Title
     * @param {string} entityType - Entity type
     * @param {Object} options - Options
     * @returns {Promise<string>} Unique slug
     */
    static async generateSlugForEntity(titleObj, entityType = 'course', options = {}) {
        const baseSlug = generateSlug(titleObj, options.preferredLanguages);

        // Check if slug exists for this entity type
        const models = {
            course: prisma.course,
            user: prisma.user,
            tenant: prisma.tenant,
            category: prisma.category
        };

        const model = models[entityType];
        if (!model) {
            throw new Error(`Unsupported entity type: ${entityType}`);
        }

        let slug = baseSlug;
        let counter = 1;
        const maxAttempts = options.maxAttempts || 100;

        while (counter <= maxAttempts) {
            const where = { slug };
            if (options.excludeId) {
                where.id = { not: options.excludeId };
            }
            const existing = await model.findFirst({
                where,
                select: { id: true }
            });

            if (!existing) return slug;
            slug = `${baseSlug}-${counter++}`;
        }

        throw new Error(`Unable to generate unique slug after ${maxAttempts} attempts`);
    }
}

// Export singleton instance
export const slugService = SlugService;