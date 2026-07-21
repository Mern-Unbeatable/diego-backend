import { Logger } from "../../../config/logger.js";


const log = new Logger('TranslateService');

const SUPPORTED_LOCALES = ['it', 'en', 'fr', 'zh'];
const SOURCE_LOCALE = 'it';
const API_KEY = process.env.GOOGLE_TRANSLATE_API_KEY;
const TRANSLATE_URL = 'https://translation.googleapis.com/language/translate/v2';


async function translateText(text, targetLocale) {
    if (!text || targetLocale === SOURCE_LOCALE) return text;

    if (!API_KEY) {
        log.warn('GOOGLE_TRANSLATE_API_KEY not set — skipping translation');
        return text;
    }

    try {
        const response = await fetch(
            `${TRANSLATE_URL}?key=${API_KEY}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    q: text,
                    source: SOURCE_LOCALE,
                    target: targetLocale,
                    format: 'text',
                }),
            },
        );

        if (!response.ok) {
            const err = await response.text();
            log.error(`Translate API error [${targetLocale}]: ${err}`);
            return text; // fallback: return source text
        }

        const data = await response.json();
        return data?.data?.translations?.[0]?.translatedText ?? text;
    } catch (error) {
        log.error(`translateText failed [${targetLocale}]: ${error.message}`);
        return text;
    }
}


export async function translateAll(italianText) {
    if (!italianText) {
        return { it: '', en: '', fr: '', zh: '' };
    }

    const [en, fr, zh] = await Promise.all([
        translateText(italianText, 'en'),
        translateText(italianText, 'fr'),
        translateText(italianText, 'zh'),
    ]);

    return { it: italianText, en, fr, zh };
}



export async function translateFields(fields) {
    const entries = Object.entries(fields).filter(([, v]) => v != null);
    const results = await Promise.all(entries.map(([key, value]) => translateAll(value)));
    return Object.fromEntries(entries.map(([key], i) => [key, results[i]]));
}


export function t(i18nJson, locale = SOURCE_LOCALE) {
    if (!i18nJson) return '';
    if (typeof i18nJson === 'string') return i18nJson; // legacy string field guard

    const obj = typeof i18nJson === 'string' ? JSON.parse(i18nJson) : i18nJson;
    return (
        obj[locale] ||
        obj[SOURCE_LOCALE] ||
        obj['en'] ||
        Object.values(obj).find(Boolean) ||
        ''
    );
}

export function localizeObject(obj, locale, i18nKeys) {
    // ✅ Check if obj exists
    if (!obj) return obj;

    // ✅ FIX: Check if i18nKeys is iterable
    if (!i18nKeys || !Array.isArray(i18nKeys)) {
        log.warn('⚠️ i18nKeys is not an array or is undefined, using empty array');
        // If no keys provided, return the object as-is
        return obj;
    }

    const result = { ...obj };

    // ✅ Only iterate if i18nKeys is an array
    for (const key of i18nKeys) {
        if (result[key] != null) {
            result[key] = t(result[key], locale);
        }
    }

    return result;
}


export function localizeArrayField(arrayObj, locale = SOURCE_LOCALE) {
    if (!arrayObj) return [];
    if (Array.isArray(arrayObj)) {
        // If it's already an array, just return it
        return arrayObj;
    }

    // It's an object with locale keys (like { it: [...], en: [...], ... })
    const result = arrayObj[locale] ||
        arrayObj[SOURCE_LOCALE] ||
        arrayObj['en'] ||
        arrayObj['fr'] ||
        arrayObj['zh'] ||
        [];

    // Ensure we return an array
    return Array.isArray(result) ? result : [];
}

export function localizeArray(obj, locale = SOURCE_LOCALE) {
    return localizeArrayField(obj, locale);
}