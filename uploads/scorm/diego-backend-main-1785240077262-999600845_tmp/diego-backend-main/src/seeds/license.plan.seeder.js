import { prisma } from '../config/db.js';
import { Logger } from '../config/logger.js';

const log = new Logger('LicensePlanSeeder');

const PLANS = [
    {
        tier: 'BEGINNER',
        name: {
            it: 'Principiante',
            en: 'Beginner',
            fr: 'Débutant',
            zh: '初级'
        },
        description: {
            it: 'Perfetto per piccoli team e professionisti individuali',
            en: 'Perfect for small teams and individual professionals',
            fr: 'Parfait pour les petites équipes et les professionnels individuels',
            zh: '非常适合小型团队和个人专业人士'
        },
        features: {
            it: [
                ' Fino a 50 utenti',
                ' Accesso completo alla piattaforma',
                ' Supporto standard',
                ' 5 GB di archiviazione',
                ' Fino a 20 corsi',
                ' Reportistica di base'
            ],
            en: [
                ' Up to 50 users',
                ' Full access to the platform',
                ' Standard support',
                ' 5 GB storage',
                ' Up to 20 courses',
                ' Basic reporting'
            ],
            fr: [
                ' Jusqu\'à 50 utilisateurs',
                ' Accès complet à la plateforme',
                ' Support standard',
                ' 5 GB de stockage',
                ' Jusqu\'à 20 cours',
                ' Rapports de base'
            ],
            zh: [
                ' 最多50个用户',
                ' 完整平台访问权限',
                ' 标准支持',
                ' 5 GB存储空间',
                ' 最多20个课程',
                ' 基本报告'
            ]
        },
        supportLevel: {
            it: 'Supporto Standard - 24/7 via email',
            en: 'Standard Support - 24/7 via email',
            fr: 'Support Standard - 24/7 par email',
            zh: '标准支持 - 24/7 电子邮件支持'
        },
        maxUsers: 50,
        priceMonthly: 29,
        priceYearly: 290,
        priceAnnual: 290,
        storageMb: 5120,
        maxCourses: 20,
        isActive: true,
        sortOrder: 0,
    },
    {
        tier: 'STANDARD',
        name: {
            it: 'Standard',
            en: 'Standard',
            fr: 'Standard',
            zh: '标准'
        },
        description: {
            it: 'Ideale per aziende in crescita con più dipartimenti',
            en: 'Ideal for growing companies with multiple departments',
            fr: 'Idéal pour les entreprises en croissance avec plusieurs départements',
            zh: '适合拥有多个部门的发展中公司'
        },
        features: {
            it: [
                ' Fino a 100 utenti',
                ' Accesso completo alla piattaforma',
                ' Supporto standard',
                ' 10 GB di archiviazione',
                ' Fino a 50 corsi',
                ' Reportistica avanzata',
                ' Integrazione API',
                ' Multi-tenant'
            ],
            en: [
                ' Up to 100 users',
                ' Full access to the platform',
                ' Standard support',
                ' 10 GB storage',
                ' Up to 50 courses',
                ' Advanced reporting',
                ' API integration',
                ' Multi-tenant support'
            ],
            fr: [
                ' Jusqu\'à 100 utilisateurs',
                ' Accès complet à la plateforme',
                ' Support standard',
                ' 10 GB de stockage',
                ' Jusqu\'à 50 cours',
                ' Rapports avancés',
                ' Intégration API',
                ' Multi-tenant'
            ],
            zh: [
                ' 最多100个用户',
                ' 完整平台访问权限',
                ' 标准支持',
                ' 10 GB存储空间',
                ' 最多50个课程',
                ' 高级报告',
                ' API集成',
                ' 多租户支持'
            ]
        },
        supportLevel: {
            it: 'Supporto Standard - 24/7 via email e chat',
            en: 'Standard Support - 24/7 via email and chat',
            fr: 'Support Standard - 24/7 par email et chat',
            zh: '标准支持 - 24/7 电子邮件和聊天支持'
        },
        maxUsers: 100,
        priceMonthly: 59,
        priceYearly: 590,
        priceAnnual: 590,
        storageMb: 10240,
        maxCourses: 50,
        isActive: true,
        sortOrder: 1,
    },
    {
        tier: 'PREMIUM',
        name: {
            it: 'Premium',
            en: 'Premium',
            fr: 'Premium',
            zh: '高级'
        },
        description: {
            it: 'Per aziende consolidate con esigenze avanzate',
            en: 'For established companies with advanced needs',
            fr: 'Pour les entreprises établies avec des besoins avancés',
            zh: '适合有高级需求的成熟公司'
        },
        features: {
            it: [
                ' Fino a 200 utenti',
                ' Accesso completo alla piattaforma',
                ' Supporto prioritario',
                ' 20 GB di archiviazione',
                ' Fino a 100 corsi',
                ' Reportistica avanzata',
                ' Integrazione API completa',
                ' Multi-tenant',
                ' White-label branding',
                ' Supporto dedicato'
            ],
            en: [
                ' Up to 200 users',
                ' Full access to the platform',
                ' Priority support',
                ' 20 GB storage',
                ' Up to 100 courses',
                ' Advanced reporting',
                ' Full API integration',
                ' Multi-tenant support',
                ' White-label branding',
                ' Dedicated support'
            ],
            fr: [
                ' Jusqu\'à 200 utilisateurs',
                ' Accès complet à la plateforme',
                ' Support prioritaire',
                ' 20 GB de stockage',
                ' Jusqu\'à 100 cours',
                ' Rapports avancés',
                ' Intégration API complète',
                ' Multi-tenant',
                ' Marque white-label',
                ' Support dédié'
            ],
            zh: [
                ' 最多200个用户',
                ' 完整平台访问权限',
                ' 优先支持',
                ' 20 GB存储空间',
                ' 最多100个课程',
                ' 高级报告',
                ' 完整API集成',
                ' 多租户支持',
                ' 白标品牌',
                ' 专属支持'
            ]
        },
        supportLevel: {
            it: 'Supporto Prioritario - 24/7 via email, chat e telefono',
            en: 'Priority Support - 24/7 via email, chat and phone',
            fr: 'Support Prioritaire - 24/7 par email, chat et téléphone',
            zh: '优先支持 - 24/7 电子邮件、聊天和电话支持'
        },
        maxUsers: 200,
        priceMonthly: 99,
        priceYearly: 990,
        priceAnnual: 990,
        storageMb: 20480,
        maxCourses: 100,
        isActive: true,
        sortOrder: 2,
    },
    {
        tier: 'ENTERPRISE',
        name: {
            it: 'Enterprise',
            en: 'Enterprise',
            fr: 'Enterprise',
            zh: '企业'
        },
        description: {
            it: 'Soluzione completa per grandi organizzazioni',
            en: 'Complete solution for large organizations',
            fr: 'Solution complète pour les grandes organisations',
            zh: '大型组织的完整解决方案'
        },
        features: {
            it: [
                ' Fino a 500+ utenti',
                ' Accesso completo alla piattaforma',
                ' Supporto VIP 24/7',
                ' 50+ GB di archiviazione',
                ' Corsi illimitati',
                ' Reportistica personalizzata',
                ' Integrazione API completa',
                ' Multi-tenant',
                ' White-label branding',
                ' Supporto dedicato con account manager',
                ' Formazione personalizzata',
                ' SLA garantito'
            ],
            en: [
                ' Up to 500+ users',
                ' Full access to the platform',
                ' VIP 24/7 support',
                ' 50+ GB storage',
                ' Unlimited courses',
                ' Custom reporting',
                ' Full API integration',
                ' Multi-tenant support',
                ' White-label branding',
                ' Dedicated support with account manager',
                ' Custom training',
                ' Guaranteed SLA'
            ],
            fr: [
                ' Jusqu\'à 500+ utilisateurs',
                ' Accès complet à la plateforme',
                ' Support VIP 24/7',
                ' 50+ GB de stockage',
                ' Cours illimités',
                ' Rapports personnalisés',
                ' Intégration API complète',
                ' Multi-tenant',
                ' Marque white-label',
                ' Support dédié avec account manager',
                ' Formation personnalisée',
                ' SLA garanti'
            ],
            zh: [
                ' 最多500+个用户',
                ' 完整平台访问权限',
                ' VIP 24/7支持',
                ' 50+ GB存储空间',
                ' 无限课程',
                ' 自定义报告',
                ' 完整API集成',
                ' 多租户支持',
                ' 白标品牌',
                ' 专属支持与客户经理',
                ' 定制培训',
                ' 保证SLA'
            ]
        },
        supportLevel: {
            it: 'Supporto VIP 24/7 - Email, chat, telefono e account manager dedicato',
            en: 'VIP 24/7 Support - Email, chat, phone and dedicated account manager',
            fr: 'Support VIP 24/7 - Email, chat, téléphone et account manager dédié',
            zh: 'VIP 24/7支持 - 电子邮件、聊天、电话和专属客户经理'
        },
        maxUsers: 999999,
        priceMonthly: 199,
        priceYearly: 1990,
        priceAnnual: 1990,
        storageMb: 51200,
        maxCourses: 999999,
        isActive: true,
        sortOrder: 3,
    },
];

export async function seedLicensePlans() {
    let created = 0;
    let skipped = 0;

    for (const plan of PLANS) {
        const existing = await prisma.licensePlan.findUnique({
            where: { tier: plan.tier },
        });

        if (existing) {
            log.info(`LicensePlan already exists — tier: ${plan.tier}`);
            skipped++;
            continue;
        }

        await prisma.licensePlan.create({ data: plan });
        log.info(`LicensePlan created — tier: ${plan.tier} | €${plan.priceMonthly}/mo | ${plan.maxUsers} users`);
        created++;
    }

    log.info(`LicensePlan seed done — ${created} created, ${skipped} skipped`);
}