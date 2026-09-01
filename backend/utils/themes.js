/**
 * Table-based HTML email themes.
 *
 * Why tables and inline styles: Gmail strips <style> blocks on mobile, Outlook
 * (Word rendering engine) ignores flexbox/grid/float and div background-colors.
 * Everything here is <table role="presentation"> + style="" on each element,
 * capped at 600px, with no external CSS, no JS and no web fonts.
 *
 * Themes:
 *   plain    - near-raw HTML. Best deliverability, lands in Gmail "Primary".
 *              Default for cold outreach.
 *   branded  - light branding: gold rule, highlights panel, typographic
 *              wordmark (no image), dark footer. No logo file required.
 */

export const THEMES = ['plain', 'branded'];
export const DEFAULT_THEME = 'plain';

const PALETTE = {
  ink: '#1A1A1A',
  gold: '#B8944D',
  paper: '#FFFDF8',
  panel: '#F7F4EE',
  page: '#F4F4F4',
  text: '#2B2B2B',
  muted: '#8A8A8A',
  rule: '#E4DFD4',
};

const SERIF = "Georgia, 'Times New Roman', Times, serif";
const SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif";

const esc = (s = '') =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Preheader: the grey snippet Gmail shows after the subject in the inbox list.
 * Hidden in the body itself, then padded so no other body text leaks into it.
 */
function preheader(text) {
  if (!text) return '';
  return (
    `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;` +
    `font-size:1px;line-height:1px;color:${PALETTE.paper};opacity:0;">` +
    `${esc(text)}${'&#8199;&#65279;'.repeat(60)}</div>`
  );
}

/**
 * Plain theme — a light wrapper only: a 600px column and a readable font.
 * Deliberately boring so it reads as a person-to-person email.
 */
function renderPlain({ bodyHtml, preheaderText }) {
  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="light dark" />
<title></title>
</head>
<body style="margin:0;padding:0;background-color:#ffffff;">
${preheader(preheaderText)}
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#ffffff;">
  <tr>
    <td align="left" style="padding:16px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="width:600px;max-width:100%;">
        <tr>
          <td style="font-family:${SANS};font-size:15px;line-height:1.6;color:#222222;">
${bodyHtml}
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

/**
 * Branded theme — wordmark header, accent rule, optional highlights panel and
 * CTA button, dark footer. Typographic only: no hosted image is required, so
 * nothing breaks when a client blocks remote images.
 */
function renderBranded({
  bodyHtml,
  preheaderText,
  wordmark,
  tagline,
  highlights = [],
  ctaText,
  ctaUrl,
  footerLines = [],
  accentColor = PALETTE.gold,
}) {
  const highlightsBlock = highlights.length
    ? `
              <tr>
                <td style="padding:4px 0 20px 0;">
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:${PALETTE.panel};border-left:4px solid ${accentColor};">
                    <tr>
                      <td style="padding:18px 22px;font-family:${SANS};font-size:14px;line-height:1.7;color:${PALETTE.text};">
                        ${highlights.map((h) => `<div style="padding:3px 0;">${h}</div>`).join('\n                        ')}
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>`
    : '';

  // Bulletproof button: VML fallback so Outlook renders the fill, not a link.
  const ctaBlock =
    ctaText && ctaUrl
      ? `
              <tr>
                <td style="padding:4px 0 24px 0;">
                  <!--[if mso]>
                  <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word"
                    href="${esc(ctaUrl)}" style="height:44px;v-text-anchor:middle;width:220px;" arcsize="8%" strokecolor="${accentColor}" fillcolor="${accentColor}">
                    <w:anchorlock/>
                    <center style="color:#ffffff;font-family:${SANS};font-size:14px;font-weight:bold;">${esc(ctaText)}</center>
                  </v:roundrect>
                  <![endif]-->
                  <!--[if !mso]><!-- -->
                  <a href="${esc(ctaUrl)}" target="_blank"
                     style="display:inline-block;background-color:${accentColor};color:#ffffff;font-family:${SANS};font-size:14px;font-weight:bold;text-decoration:none;padding:13px 28px;border-radius:4px;">
                    ${esc(ctaText)}
                  </a>
                  <!--<![endif]-->
                </td>
              </tr>`
      : '';

  const footerBlock = footerLines.length
    ? footerLines
        .map(
          (line) =>
            `<div style="padding:3px 0;font-family:${SANS};font-size:12px;line-height:1.6;color:#BDBDBD;">${line}</div>`
        )
        .join('\n                        ')
    : '';

  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="light" />
<meta name="supported-color-schemes" content="light" />
<title></title>
<!--[if mso]>
<xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml>
<![endif]-->
</head>
<body style="margin:0;padding:0;background-color:${PALETTE.page};">
${preheader(preheaderText)}
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:${PALETTE.page};">
  <tr>
    <td align="center" style="padding:24px 12px;">

      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="width:600px;max-width:100%;background-color:${PALETTE.paper};">

        <!-- Header -->
        <tr>
          <td align="center" style="background-color:${PALETTE.ink};padding:26px 24px;">
            <div style="font-family:${SERIF};font-size:26px;letter-spacing:6px;color:${accentColor};text-transform:uppercase;">${esc(wordmark)}</div>
            ${tagline ? `<div style="font-family:${SANS};font-size:10px;letter-spacing:2px;color:${PALETTE.muted};text-transform:uppercase;padding-top:8px;">${esc(tagline)}</div>` : ''}
          </td>
        </tr>
        <tr><td style="height:3px;line-height:3px;font-size:0;background-color:${accentColor};">&nbsp;</td></tr>

        <!-- Body -->
        <tr>
          <td style="padding:34px 32px 8px 32px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
              <tr>
                <td style="font-family:${SANS};font-size:15px;line-height:1.65;color:${PALETTE.text};">
${bodyHtml}
                </td>
              </tr>
${highlightsBlock}
${ctaBlock}
            </table>
          </td>
        </tr>

        <tr>
          <td style="padding:0 32px 28px 32px;">
            <div style="height:1px;line-height:1px;font-size:0;background-color:${PALETTE.rule};">&nbsp;</div>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background-color:${PALETTE.ink};padding:22px 32px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
              <tr>
                <td>
                        ${footerBlock}
                </td>
              </tr>
            </table>
          </td>
        </tr>

      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

/**
 * Wrap already-personalized body HTML in the chosen theme.
 * Placeholder substitution happens BEFORE this, so [if job id] etc. still work.
 */
export function renderEmail(theme, options = {}) {
  const name = THEMES.includes(theme) ? theme : DEFAULT_THEME;
  if (name === 'plain') return renderPlain(options);
  return renderBranded(options);
}

export { PALETTE };
