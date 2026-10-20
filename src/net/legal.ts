// Alpha 1.8.4 — the documents of PRIME ID. The texts are static pages of the site (public/legal/…,
// opened directly at https://primetimeshowdown.online/legal/<ru|en>/<doc>.html and read inside the
// game); which ones must be ticked, and their versions, come from the server (/api/prime/config).

export const LEGAL_DOCS = ['terms', 'privacy', 'consent', 'parents'] as const;
export type LegalDocId = (typeof LEGAL_DOCS)[number];

export const CONTACT_EMAIL = 'primetimeshowdown.official@gmail.com';

/** The page of a document, relative to the game (the same folder on GitHub Pages and in `npm run dev`). */
export const legalPath = (lang: 'ru' | 'en', doc: LegalDocId) => `legal/${lang}/${doc}.html`;

export const LEGAL_TITLE: Record<LegalDocId, { ru: string; en: string }> = {
  terms: { ru: 'Пользовательское соглашение', en: 'Terms of Use' },
  privacy: { ru: 'Политика конфиденциальности', en: 'Privacy Policy' },
  consent: { ru: 'Согласие на обработку персональных данных', en: 'Consent to Personal Data Processing' },
  parents: { ru: 'Информация для родителей', en: "Parents' Information" },
};
