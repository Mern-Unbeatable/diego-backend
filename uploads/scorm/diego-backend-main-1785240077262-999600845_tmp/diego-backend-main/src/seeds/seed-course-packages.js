import { prisma } from '../config/db.js';

export const seedCoursePackages = async () => {
    await prisma.coursePackage.upsert({
        where: { id: 'default-single-user-package' },
        update: {},
        create: {
            id: 'default-single-user-package',
            type: 'SINGLE_USER',
            key: 'default-single-user',
            isDefault: true,
            title: {
                en: 'Single course',
                fr: 'Cours individuel',
                it: 'Corso singolo',
                zh: '单人课程',
            },
            features: [
                { en: 'Lifetime access', fr: 'Accès à vie', it: 'Accesso a vita', zh: '终身访问' },
                { en: 'SCORM compatible', fr: 'Compatible SCORM', it: 'Compatibile SCORM', zh: '支持 SCORM' },
                { en: 'Mobile friendly', fr: 'Compatible mobile', it: 'Compatibile con dispositivi mobili', zh: '支持移动设备' },
                { en: 'Certificate included', fr: 'Certificat inclus', it: 'Certificato incluso', zh: '包含证书' },
            ],
        },
    });

    await prisma.coursePackage.upsert({
        where: { id: 'default-company-package' },
        update: {},
        create: {
            id: 'default-company-package',
            type: 'COMPANY',
            key: 'default-company',
            isDefault: true,
            title: {
                en: 'Company package',
                fr: 'Pack entreprise',
                it: 'Pacchetto aziendale',
                zh: '企业套餐',
            },
            description: {
                en: 'Solution to support companies in monitoring regulatory deadlines, ensuring timely assistance and compliance. Training: the right size for you.',
                fr: 'Solution pour aider les entreprises à respecter les obligations réglementaires. Formation adaptée à vos besoins.',
                it: 'Soluzione per supportare le aziende nel monitoraggio delle scadenze normative, garantendo assistenza tempestiva e conformità. Formazione: la soluzione giusta per te.',
                zh: '帮助企业监控法规期限并确保合规，为企业提供合适的培训方案。',
            },
            features: [
                {
                    type: 'pricing',
                    label: { en: '1-20 users - €150/user', fr: '1-20 utilisateurs - 150 €/utilisateur', it: '1-20 utenti - €150/utente', zh: '1-20 名用户 - €150/用户' },
                    price: 150, currency: 'EUR', minUsers: 1, maxUsers: 20,
                },
                {
                    type: 'pricing',
                    label: { en: '21-50 users - €420/user', fr: '21-50 utilisateurs - 420 €/utilisateur', it: '21-50 utenti - €420/utente', zh: '21-50 名用户 - €420/用户' },
                    price: 420, currency: 'EUR', minUsers: 21, maxUsers: 50,
                },
                {
                    type: 'pricing',
                    label: { en: '51-200 users - €1000/user', fr: '51-200 utilisateurs - 1000 €/utilisateur', it: '51-200 utenti - €1000/utente', zh: '51-200 名用户 - €1000/用户' },
                    price: 1000, currency: 'EUR', minUsers: 51, maxUsers: 200,
                },
                {
                    type: 'feature',
                    label: { en: 'Includes administration panel', fr: "Comprend un panneau d'administration", it: 'Include pannello di amministrazione', zh: '包含管理后台' },
                    currency: 'EUR',
                },
            ],
        },
    });
};