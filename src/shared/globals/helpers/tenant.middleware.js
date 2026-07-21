import { prisma } from "../../../config/db.js";

export const tenantMiddleware = async (req, res, next) => {
    try {

        let host = req.headers["x-tenant-host"] || req.get("host");

        // For localhost testing, 
        if (!host && req.query.tenant) {
            host = `${req.query.tenant}.${getMainDomain()}`;
        }

        if (!host) {
            return next();
        }

        // Normalize host (remove protocol, www, port)
        host = normalizeHost(host);

        const isLocalhost = isLocalhostEnvironment(host);
        const subdomain = extractSubdomain(host);
        const customDomain = extractCustomDomain(host);

        let tenant = null;

        // ── LOCALHOST DEVELOPMENT ──
        if (isLocalhost) {
            if (subdomain) {
                tenant = await prisma.tenant.findUnique({
                    where: { subdomain },
                    select: { id: true, name: true, isActive: true, subdomain: true, customDomain: true }
                });
            }

            if (!tenant && req.headers["x-tenant-id"]) {
                tenant = await prisma.tenant.findUnique({
                    where: { id: req.headers["x-tenant-id"] },
                    select: { id: true, name: true, isActive: true, subdomain: true, customDomain: true }
                });
            }

            if (!tenant && isMainLocalhost(host)) {
                req.tenant = null;
                req.tenantId = null;
                console.log(`[Tenant Middleware] No tenant for localhost, continuing...`);
                return next();
            }
        }

        // ── PRODUCTION ──
        if (!tenant) {
            if (customDomain) {
                console.log(`[Tenant Middleware] Looking for tenant with customDomain: ${customDomain}`);
                tenant = await prisma.tenant.findUnique({
                    where: { customDomain },
                    select: { id: true, name: true, isActive: true, subdomain: true, customDomain: true }
                });
                if (tenant) {
                    console.log(`[Tenant Middleware]  Found tenant by customDomain: ${tenant.name}`);
                }
            }

            // SECOND: Try to find tenant by subdomain
            if (!tenant && subdomain) {
                console.log(`[Tenant Middleware] Looking for tenant with subdomain: ${subdomain}`);
                tenant = await prisma.tenant.findUnique({
                    where: { subdomain },
                    select: { id: true, name: true, isActive: true, subdomain: true, customDomain: true }
                });
                if (tenant) {
                    console.log(`[Tenant Middleware]  Found tenant by subdomain: ${tenant.name}`);
                }
            }

            // THIRD: If host is exactly the main domain, check for platform tenant
            if (!tenant) {
                const mainDomain = getMainDomain();
                if (host === mainDomain) {

                    tenant = await prisma.tenant.findFirst({
                        where: {
                            OR: [
                                { customDomain: host },
                                { subdomain: 'platform' }
                            ]
                        },
                        select: { id: true, name: true, isActive: true, subdomain: true, customDomain: true }
                    });
                    if (tenant) {
                        console.log(`[Tenant Middleware]  Found platform tenant for main domain: ${tenant.name}`);
                    }
                }
            }

            //  If still no tenant, try to find by any matching domain
            if (!tenant) {
                tenant = await prisma.tenant.findFirst({
                    where: {
                        OR: [
                            { customDomain: host },
                            { subdomain: host.split('.')[0] }
                        ]
                    },
                    select: { id: true, name: true, isActive: true, subdomain: true, customDomain: true }
                });
                if (tenant) {
                    console.log(`[Tenant Middleware]  Found tenant by fallback: ${tenant.name}`);
                }
            }
        }

        // If tenant found and active, inject into request
        if (tenant) {
            if (!tenant.isActive) {
                return res.status(403).json({
                    status: 'error',
                    message: 'Tenant is not active'
                });
            }
            req.tenant = tenant;
            req.tenantId = tenant.id;
            console.log(`[Tenant Middleware]  Tenant set: ${tenant.name} (${tenant.id})`);
        } else {
            // No tenant found - clear tenant context
            req.tenant = null;
            req.tenantId = null;
            console.log(`[Tenant Middleware]  No tenant found for: ${host}`);
        }

        next();
    } catch (error) {
        console.error('Tenant middleware error:', error);
        next();
    }
};


function getMainDomain() {
    return process.env.MAIN_DOMAIN || 'maktechgroup.tech';
}

function normalizeHost(host) {
    if (!host) return null;
    host = host.replace(/^https?:\/\//, '');
    host = host.split(':')[0];
    if (host.startsWith('www.')) {
        host = host.substring(4);
    }
    return host;
}

function isLocalhostEnvironment(host) {
    if (!host) return false;
    const localhostPatterns = ['localhost', '127.0.0.1', '0.0.0.0', '::1'];
    return localhostPatterns.some(pattern =>
        host === pattern || host.endsWith(`.${pattern}`)
    );
}

function isMainLocalhost(host) {
    if (!host) return false;
    const mainDomain = getMainDomain();
    const localhostPatterns = ['localhost', '127.0.0.1', '0.0.0.0', '::1', mainDomain];
    return localhostPatterns.some(pattern =>
        host === pattern || host === `${pattern}:${process.env.PORT || 5000}`
    );
}

function extractSubdomain(host) {
    if (!host) return null;
    const mainDomain = getMainDomain();
    const hostWithoutPort = host.split(':')[0];
    const hostParts = hostWithoutPort.split('.');

    // For localhost
    if (isLocalhostEnvironment(host)) {
        if (hostParts.length > 2 && hostParts[hostParts.length - 1] === 'localhost') {
            return hostParts[hostParts.length - 2];
        }
        return null;
    }

    // For production
    if (hostWithoutPort.endsWith(`.${mainDomain}`)) {
        const parts = hostWithoutPort.replace(`.${mainDomain}`, '').split('.');
        if (parts.length === 1) {
            return parts[0];
        } else if (parts.length > 1) {
            return parts.join('.');
        }
    }

    return null;
}

function extractCustomDomain(host) {
    if (!host) return null;
    const mainDomain = getMainDomain();
    const hostWithoutPort = host.split(':')[0];

    if (isLocalhostEnvironment(host)) {
        return null;
    }

    // Check if it's a custom domain
    if (!hostWithoutPort.endsWith(`.${mainDomain}`) && hostWithoutPort !== mainDomain) {
        if (!/^\d+\.\d+\.\d+\.\d+$/.test(hostWithoutPort)) {
            return hostWithoutPort;
        }
    }

    return null;
}

/**
 * Tenant Guard - Ensures user has access to the tenant
 */
export const tenantGuard = (req, res, next) => {
    const user = req.user;
    const tenantId = req.tenantId;

    console.log(`[Tenant Guard] User: ${user?.email} (${user?.level})`);
    console.log(`[Tenant Guard] Tenant ID: ${tenantId}`);

    // Platform admins can access all tenants
    if (user?.level === 'PLATFORM_ADMIN') {
        console.log(`[Tenant Guard] ✅ Platform admin - access granted`);
        return next();
    }

    // If no tenant context, allow for platform admin routes
    if (!tenantId && user?.level === 'PLATFORM_ADMIN') {
        console.log(`[Tenant Guard] ✅ Platform admin - no tenant context, access granted`);
        return next();
    }

    // License users can only access their own tenant
    if (user?.level === 'LICENSE_USER') {
        if (!user.tenantId) {
            return res.status(403).json({
                status: 'error',
                message: 'License user must have a tenant'
            });
        }
        if (tenantId && user.tenantId !== tenantId) {
            return res.status(403).json({
                status: 'error',
                message: 'You do not have access to this tenant'
            });
        }
        if (!tenantId) {
            req.tenantId = user.tenantId;
        }
        return next();
    }

    // Regular users: must belong to the tenant
    if (tenantId && user?.tenantId !== tenantId) {
        return res.status(403).json({
            status: 'error',
            message: 'You do not have access to this tenant'
        });
    }

    next();
};

export const forceTenant = (tenantId) => {
    return async (req, res, next) => {
        const tenant = await prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { id: true, name: true, isActive: true }
        });

        if (!tenant) {
            return res.status(404).json({
                status: 'error',
                message: 'Tenant not found'
            });
        }

        req.tenant = tenant;
        req.tenantId = tenant.id;
        next();
    };
};

export const getTenantContext = (req) => {
    return {
        tenantId: req.tenantId,
        tenant: req.tenant,
        isTenantContext: !!req.tenantId
    };
};