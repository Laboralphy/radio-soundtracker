import i18next, { type TFunction } from 'i18next';
import FsBackend from 'i18next-fs-backend';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function detectLanguage(): string {
    const lang = process.env.LANG ?? process.env.LANGUAGE ?? 'en';
    return lang.split('_')[0].split('.')[0];
}

export async function initI18n(): Promise<TFunction> {
    return i18next.use(FsBackend).init({
        lng: detectLanguage(),
        fallbackLng: 'en',
        ns: ['commands'],
        defaultNS: 'commands',
        // messages go to a terminal and log files, not HTML: keep titles such as "'infinity' - necros/khyron" as is
        interpolation: { escapeValue: false },
        backend: {
            loadPath: path.join(__dirname, '../../locales/{{lng}}/{{ns}}.json')
        }
    });
}

export const t = i18next.t.bind(i18next);
