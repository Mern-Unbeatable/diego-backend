

const SUPPORTED = new Set(['it', 'en', 'fr', 'zh']);
const DEFAULT_LOCALE = 'it';

function parseAcceptLanguage(header) {
    if (!header) return null;
    // Parse "fr-FR,fr;q=0.9,en;q=0.8,it;q=0.7"
    const locales = header
        .split(',')
        .map((part) => {
            const [lang, q = 'q=1'] = part.trim().split(';');
            return { lang: lang.split('-')[0].toLowerCase(), q: parseFloat(q.split('=')[1]) || 1 };
        })
        .sort((a, b) => b.q - a.q);

    for (const { lang } of locales) {
        if (SUPPORTED.has(lang)) return lang;
    }
    return null;
}

export function i18nMiddleware(req, _res, next) {
    const fromQuery = req.query?.lang;
    const fromHeader = parseAcceptLanguage(req.headers['accept-language']);
    const fromUser = req.user?.preferredLanguage;

    const locale =
        (SUPPORTED.has(fromQuery) ? fromQuery : null) ||
        fromUser ||
        fromHeader ||
        DEFAULT_LOCALE;

    req.locale = locale;
    next();
}
