/**
 * Sender identity used by the "branded" theme.
 * Overridable via env so the repo is not hardcoded to one person.
 */

export function getBranding() {
  return {
    wordmark: process.env.BRAND_WORDMARK || 'Vishnu Nair',
    tagline: process.env.BRAND_TAGLINE || 'Full Stack Developer',
    accentColor: process.env.BRAND_ACCENT || '#B8944D',
    ctaText: process.env.BRAND_CTA_TEXT || 'View Portfolio',
    ctaUrl: process.env.BRAND_CTA_URL || 'https://vishnunairportfolio.vercel.app/',
    footerLines: [
      '+91-9967418222 &nbsp;&middot;&nbsp; <a href="mailto:vishnunair2323@gmail.com" style="color:#B8944D;text-decoration:none;">vishnunair2323@gmail.com</a>',
      '<a href="https://vishnunairportfolio.vercel.app/" style="color:#B8944D;text-decoration:none;">Portfolio</a> &nbsp;&middot;&nbsp; <a href="https://github.com/Vishnu-comp" style="color:#B8944D;text-decoration:none;">GitHub</a> &nbsp;&middot;&nbsp; <a href="https://linkedin.com/in/vishnu-nair-tech" style="color:#B8944D;text-decoration:none;">LinkedIn</a>',
    ],
  };
}
