import type { TFunction } from 'i18next';

/** One section of a legal page: an `h2` with an `id` (an in-page anchor), then paragraphs and lists. */
export type LegalSection = {
  id: string;
  title: string;
  blocks: ({ p: string } | { items: string[] })[];
};

export type LegalDoc = { title: string; intro: string; sections: LegalSection[] };

// Every key is a literal, so `make i18n-check` proves each one exists in he.json. `email` is the
// contact address; the page wraps it in a `<bdi>`.

export function termsDoc(t: TFunction, email: string): LegalDoc {
  return {
    title: t('legal.terms.title'),
    intro: t('legal.terms.intro', { email }),
    sections: [
      {
        id: 's1',
        title: t('legal.terms.s1.title'),
        blocks: [{ p: t('legal.terms.s1.p1', { email }) }],
      },
      {
        id: 's2',
        title: t('legal.terms.s2.title'),
        blocks: [
          {
            items: [
              t('legal.terms.s2.i1', { email }),
              t('legal.terms.s2.i2', { email }),
              t('legal.terms.s2.i3', { email }),
            ],
          },
        ],
      },
      {
        id: 's3',
        title: t('legal.terms.s3.title'),
        blocks: [
          {
            items: [
              t('legal.terms.s3.i1', { email }),
              t('legal.terms.s3.i2', { email }),
              t('legal.terms.s3.i3', { email }),
              t('legal.terms.s3.i4', { email }),
            ],
          },
        ],
      },
      {
        id: 's4',
        title: t('legal.terms.s4.title'),
        blocks: [
          {
            items: [
              t('legal.terms.s4.i1', { email }),
              t('legal.terms.s4.i2', { email }),
              t('legal.terms.s4.i3', { email }),
            ],
          },
        ],
      },
      {
        id: 's5',
        title: t('legal.terms.s5.title'),
        blocks: [{ p: t('legal.terms.s5.p1', { email }) }],
      },
      {
        id: 's6',
        title: t('legal.terms.s6.title'),
        blocks: [{ p: t('legal.terms.s6.p1', { email }) }],
      },
      {
        id: 's7',
        title: t('legal.terms.s7.title'),
        blocks: [{ p: t('legal.terms.s7.p1', { email }) }],
      },
      {
        id: 's8',
        title: t('legal.terms.s8.title'),
        blocks: [{ p: t('legal.terms.s8.p1', { email }) }],
      },
      {
        id: 's9',
        title: t('legal.terms.s9.title'),
        blocks: [{ p: t('legal.terms.s9.p1', { email }) }],
      },
      {
        id: 's10',
        title: t('legal.terms.s10.title'),
        blocks: [{ p: t('legal.terms.s10.p1', { email }) }],
      },
      {
        id: 's11',
        title: t('legal.terms.s11.title'),
        blocks: [{ p: t('legal.terms.s11.p1', { email }) }],
      },
      {
        id: 's12',
        title: t('legal.terms.s12.title'),
        blocks: [{ p: t('legal.terms.s12.p1', { email }) }],
      },
    ],
  };
}

export function privacyDoc(t: TFunction, email: string): LegalDoc {
  return {
    title: t('legal.privacy.title'),
    intro: t('legal.privacy.intro', { email }),
    sections: [
      {
        id: 's1',
        title: t('legal.privacy.s1.title'),
        blocks: [
          {
            items: [
              t('legal.privacy.s1.i1', { email }),
              t('legal.privacy.s1.i2', { email }),
              t('legal.privacy.s1.i3', { email }),
              t('legal.privacy.s1.i4', { email }),
              t('legal.privacy.s1.i5', { email }),
              t('legal.privacy.s1.i6', { email }),
              t('legal.privacy.s1.i7', { email }),
              t('legal.privacy.s1.i8', { email }),
              t('legal.privacy.s1.i9', { email }),
              t('legal.privacy.s1.i10', { email }),
              t('legal.privacy.s1.i11', { email }),
              t('legal.privacy.s1.i12', { email }),
              t('legal.privacy.s1.i13', { email }),
              t('legal.privacy.s1.i14', { email }),
              t('legal.privacy.s1.i15', { email }),
            ],
          },
        ],
      },
      {
        id: 's2',
        title: t('legal.privacy.s2.title'),
        blocks: [
          { p: t('legal.privacy.s2.p1', { email }) },
          {
            items: [
              t('legal.privacy.s2.i1', { email }),
              t('legal.privacy.s2.i2', { email }),
              t('legal.privacy.s2.i3', { email }),
            ],
          },
          { p: t('legal.privacy.s2.p2', { email }) },
        ],
      },
      {
        id: 's3',
        title: t('legal.privacy.s3.title'),
        blocks: [
          {
            items: [
              t('legal.privacy.s3.i1', { email }),
              t('legal.privacy.s3.i2', { email }),
              t('legal.privacy.s3.i3', { email }),
              t('legal.privacy.s3.i4', { email }),
              t('legal.privacy.s3.i5', { email }),
            ],
          },
        ],
      },
      {
        id: 's4',
        title: t('legal.privacy.s4.title'),
        blocks: [{ p: t('legal.privacy.s4.p1', { email }) }],
      },
      {
        id: 's5',
        title: t('legal.privacy.s5.title'),
        blocks: [
          {
            items: [
              t('legal.privacy.s5.i1', { email }),
              t('legal.privacy.s5.i2', { email }),
              t('legal.privacy.s5.i3', { email }),
              t('legal.privacy.s5.i4', { email }),
              t('legal.privacy.s5.i5', { email }),
              t('legal.privacy.s5.i6', { email }),
              t('legal.privacy.s5.i7', { email }),
              t('legal.privacy.s5.i8', { email }),
              t('legal.privacy.s5.i9', { email }),
              t('legal.privacy.s5.i10', { email }),
              t('legal.privacy.s5.i11', { email }),
              t('legal.privacy.s5.i12', { email }),
            ],
          },
        ],
      },
      {
        id: 'deletion',
        title: t('legal.privacy.s6.title'),
        blocks: [
          { p: t('legal.privacy.s6.p1', { email }) },
          {
            items: [
              t('legal.privacy.s6.i1', { email }),
              t('legal.privacy.s6.i2', { email }),
              t('legal.privacy.s6.i3', { email }),
              t('legal.privacy.s6.i4', { email }),
              t('legal.privacy.s6.i5', { email }),
              t('legal.privacy.s6.i6', { email }),
              t('legal.privacy.s6.i7', { email }),
            ],
          },
        ],
      },
      {
        id: 's7',
        title: t('legal.privacy.s7.title'),
        blocks: [{ p: t('legal.privacy.s7.p1', { email }) }],
      },
      {
        id: 's8',
        title: t('legal.privacy.s8.title'),
        blocks: [{ p: t('legal.privacy.s8.p1', { email }) }],
      },
      {
        id: 's9',
        title: t('legal.privacy.s9.title'),
        blocks: [{ p: t('legal.privacy.s9.p1', { email }) }],
      },
      {
        id: 's10',
        title: t('legal.privacy.s10.title'),
        blocks: [{ p: t('legal.privacy.s10.p1', { email }) }],
      },
    ],
  };
}
