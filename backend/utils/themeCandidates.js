/**
 * CANDIDATE THEMES — mockups for review, not yet wired into the send path.
 *
 * Same hard constraints as themes.js: table layout, fully inline styles, no
 * <style> block, no JS, no web fonts, 600px cap, backgrounds on <td>, MSO
 * conditionals. Everything here is genuinely sendable.
 *
 * Once you pick favourites they get promoted into themes.js / THEMES.
 */

const SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif";
const SERIF = "Georgia, 'Times New Roman', Times, serif";
const MONO = "'SF Mono', Consolas, Menlo, Monaco, 'Courier New', monospace";

const esc = (s = '') =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function preheader(text, bg) {
  if (!text) return '';
  return (
    `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;` +
    `font-size:1px;line-height:1px;color:${bg};opacity:0;">` +
    `${esc(text)}${'&#8199;&#65279;'.repeat(60)}</div>`
  );
}

function doc({ bg, body, preheaderText }) {
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
<body style="margin:0;padding:0;background-color:${bg};">
${preheader(preheaderText, bg)}
${body}
</body>
</html>`;
}

/* ────────────────────────────────────────────────────────────────────────────
 * 1. MINIMAL RULE
 * A single accent hairline above a name block. No colour panels at all.
 * Closest to plain text while still looking considered — the safest upgrade
 * for cold outreach because it keeps the Primary-tab "personal email" feel.
 * ──────────────────────────────────────────────────────────────────────────── */
function minimal({ bodyHtml, highlights = [], name, tagline, accent, footerLines = [], preheaderText }) {
  const items = highlights.length
    ? `<tr><td style="padding:2px 0 18px 0;font-family:${SANS};font-size:14px;line-height:1.75;color:#333333;">
         ${highlights.map((h) => `<div style="padding:2px 0;">&#8212;&nbsp; ${h}</div>`).join('\n         ')}
       </td></tr>`
    : '';

  return doc({
    bg: '#ffffff',
    preheaderText,
    body: `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#ffffff;">
  <tr><td align="left" style="padding:28px 20px;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="width:600px;max-width:100%;">
      <tr><td style="border-top:2px solid ${accent};padding-top:14px;">
        <div style="font-family:${SANS};font-size:15px;font-weight:bold;color:#111111;letter-spacing:0.3px;">${esc(name)}</div>
        <div style="font-family:${SANS};font-size:12px;color:#888888;padding-top:2px;">${esc(tagline)}</div>
      </td></tr>
      <tr><td style="padding:22px 0 0 0;font-family:${SANS};font-size:15px;line-height:1.65;color:#333333;">
${bodyHtml}
      </td></tr>
      ${items}
      <tr><td style="border-top:1px solid #EDEDED;padding-top:14px;font-family:${SANS};font-size:12px;line-height:1.7;color:#999999;">
        ${footerLines.join('<br/>')}
      </td></tr>
    </table>
  </td></tr>
</table>`,
  });
}

/* ────────────────────────────────────────────────────────────────────────────
 * 2. SIDEBAR ACCENT
 * Full-height coloured bar down the left edge. One structural flourish, no
 * heavy header. Reads as "designed" without looking like a marketing blast.
 * ──────────────────────────────────────────────────────────────────────────── */
function sidebar({ bodyHtml, highlights = [], name, tagline, accent, footerLines = [], preheaderText }) {
  const items = highlights.length
    ? `<tr><td style="padding:2px 0 18px 0;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
          ${highlights
            .map(
              (h) => `<tr>
            <td valign="top" style="width:18px;font-family:${SANS};font-size:14px;line-height:1.7;color:${accent};">&#9642;</td>
            <td style="font-family:${SANS};font-size:14px;line-height:1.7;color:#333333;padding-bottom:4px;">${h}</td>
          </tr>`
            )
            .join('\n          ')}
        </table>
      </td></tr>`
    : '';

  return doc({
    bg: '#F0F0F0',
    preheaderText,
    body: `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#F0F0F0;">
  <tr><td align="center" style="padding:24px 12px;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="width:600px;max-width:100%;background-color:#ffffff;">
      <tr>
        <td width="6" style="width:6px;background-color:${accent};font-size:0;line-height:0;">&nbsp;</td>
        <td style="padding:30px 32px;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
            <tr><td style="padding-bottom:20px;">
              <div style="font-family:${SANS};font-size:16px;font-weight:bold;color:#111111;">${esc(name)}</div>
              <div style="font-family:${SANS};font-size:12px;color:#8A8A8A;padding-top:2px;text-transform:uppercase;letter-spacing:1px;">${esc(tagline)}</div>
            </td></tr>
            <tr><td style="font-family:${SANS};font-size:15px;line-height:1.65;color:#333333;">
${bodyHtml}
            </td></tr>
            ${items}
            <tr><td style="border-top:1px solid #EEEEEE;padding-top:14px;font-family:${SANS};font-size:12px;line-height:1.7;color:#9A9A9A;">
              ${footerLines.join('<br/>')}
            </td></tr>
          </table>
        </td>
      </tr>
    </table>
  </td></tr>
</table>`,
  });
}

/* ────────────────────────────────────────────────────────────────────────────
 * 3. TERMINAL / DEVELOPER
 * Dark card, mono type, a fake shell prompt header. Strong personality —
 * lands well with engineering teams, risky with non-technical recruiters.
 * ──────────────────────────────────────────────────────────────────────────── */
function terminal({ bodyHtml, highlights = [], name, tagline, accent, footerLines = [], preheaderText }) {
  const items = highlights.length
    ? `<tr><td style="padding:2px 0 18px 0;font-family:${MONO};font-size:13px;line-height:1.8;color:#C8D3DE;">
        ${highlights.map((h) => `<div style="padding:2px 0;"><span style="color:${accent};">+</span>&nbsp; ${h}</div>`).join('\n        ')}
      </td></tr>`
    : '';

  return doc({
    bg: '#12161C',
    preheaderText,
    body: `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#12161C;">
  <tr><td align="center" style="padding:24px 12px;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="width:600px;max-width:100%;background-color:#1B212A;border:1px solid #2C343F;">
      <tr><td style="background-color:#232B36;padding:12px 18px;border-bottom:1px solid #2C343F;">
        <span style="font-family:${MONO};font-size:12px;color:#6E7A88;">&#9679; &#9679; &#9679;</span>
        <span style="font-family:${MONO};font-size:12px;color:#8794A3;padding-left:10px;">${esc(name.toLowerCase().replace(/\s+/g, '-'))} &#8212; intro</span>
      </td></tr>
      <tr><td style="padding:26px 28px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
          <tr><td style="padding-bottom:16px;font-family:${MONO};font-size:13px;color:${accent};">
            <span style="color:#5A6674;">$</span> whoami<br/>
            <span style="color:#E6EDF3;">${esc(name)}</span> <span style="color:#6E7A88;">// ${esc(tagline)}</span>
          </td></tr>
          <tr><td style="font-family:${SANS};font-size:15px;line-height:1.7;color:#C8D3DE;">
${bodyHtml}
          </td></tr>
          ${items}
          <tr><td style="border-top:1px solid #2C343F;padding-top:14px;font-family:${MONO};font-size:11px;line-height:1.8;color:#6E7A88;">
            ${footerLines.join('<br/>')}
          </td></tr>
        </table>
      </td></tr>
    </table>
  </td></tr>
</table>`,
  });
}

/* ────────────────────────────────────────────────────────────────────────────
 * 4. RESUME CARD
 * Two-column header (name left, contact right) over a light card, with
 * highlights as a bordered "selected work" block. Formal and CV-like.
 * ──────────────────────────────────────────────────────────────────────────── */
function resumeCard({ bodyHtml, highlights = [], name, tagline, accent, contactLines = [], footerLines = [], preheaderText }) {
  const items = highlights.length
    ? `<tr><td style="padding:6px 0 20px 0;">
        <div style="font-family:${SANS};font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:${accent};padding-bottom:8px;font-weight:bold;">Selected Work</div>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border:1px solid #E5E7EB;">
          ${highlights
            .map(
              (h, i) => `<tr><td style="padding:11px 16px;font-family:${SANS};font-size:14px;line-height:1.6;color:#374151;${
                i ? 'border-top:1px solid #F1F2F4;' : ''
              }">${h}</td></tr>`
            )
            .join('\n          ')}
        </table>
      </td></tr>`
    : '';

  return doc({
    bg: '#EEF0F3',
    preheaderText,
    body: `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#EEF0F3;">
  <tr><td align="center" style="padding:26px 12px;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="width:600px;max-width:100%;background-color:#ffffff;border:1px solid #DFE3E8;">
      <tr><td style="padding:26px 32px 18px 32px;border-bottom:3px solid ${accent};">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
          <tr>
            <td valign="top" style="font-family:${SERIF};font-size:23px;color:#111827;letter-spacing:0.2px;">
              ${esc(name)}
              <div style="font-family:${SANS};font-size:12px;color:#6B7280;padding-top:5px;letter-spacing:0.4px;">${esc(tagline)}</div>
            </td>
            <td valign="top" align="right" style="font-family:${SANS};font-size:11px;line-height:1.8;color:#6B7280;">
              ${contactLines.join('<br/>')}
            </td>
          </tr>
        </table>
      </td></tr>
      <tr><td style="padding:24px 32px 0 32px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
          <tr><td style="font-family:${SANS};font-size:15px;line-height:1.65;color:#374151;">
${bodyHtml}
          </td></tr>
          ${items}
        </table>
      </td></tr>
      <tr><td style="background-color:#F9FAFB;border-top:1px solid #E5E7EB;padding:16px 32px;font-family:${SANS};font-size:11px;line-height:1.7;color:#9CA3AF;">
        ${footerLines.join(' &nbsp;&middot;&nbsp; ')}
      </td></tr>
    </table>
  </td></tr>
</table>`,
  });
}

/* ────────────────────────────────────────────────────────────────────────────
 * 5. EDITORIAL
 * Serif, generous whitespace, drop-cap style intro, numbered highlights.
 * Magazine-like. Warm and human; good for longer notes.
 * ──────────────────────────────────────────────────────────────────────────── */
function editorial({ bodyHtml, highlights = [], name, tagline, accent, footerLines = [], preheaderText }) {
  const items = highlights.length
    ? `<tr><td style="padding:8px 0 22px 0;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
          ${highlights
            .map(
              (h, i) => `<tr>
            <td valign="top" style="width:30px;font-family:${SERIF};font-size:15px;color:${accent};padding:5px 0;">${String(i + 1).padStart(2, '0')}</td>
            <td style="font-family:${SERIF};font-size:15px;line-height:1.7;color:#3A3A3A;padding:5px 0;">${h}</td>
          </tr>`
            )
            .join('\n          ')}
        </table>
      </td></tr>`
    : '';

  return doc({
    bg: '#FBF9F5',
    preheaderText,
    body: `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#FBF9F5;">
  <tr><td align="center" style="padding:34px 12px;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="width:600px;max-width:100%;">
      <tr><td align="center" style="padding-bottom:22px;">
        <div style="font-family:${SERIF};font-size:21px;color:#1F1F1F;letter-spacing:1px;">${esc(name)}</div>
        <div style="width:38px;height:2px;line-height:2px;font-size:0;background-color:${accent};margin:11px auto;">&nbsp;</div>
        <div style="font-family:${SANS};font-size:10px;letter-spacing:2.5px;text-transform:uppercase;color:#9A9184;">${esc(tagline)}</div>
      </td></tr>
      <tr><td style="background-color:#FFFFFF;border:1px solid #EDE7DC;padding:30px 34px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
          <tr><td style="font-family:${SERIF};font-size:16px;line-height:1.75;color:#3A3A3A;">
${bodyHtml}
          </td></tr>
          ${items}
        </table>
      </td></tr>
      <tr><td align="center" style="padding-top:18px;font-family:${SANS};font-size:11px;line-height:1.8;color:#A39A8C;">
        ${footerLines.join('<br/>')}
      </td></tr>
    </table>
  </td></tr>
</table>`,
  });
}

export const CANDIDATES = {
  minimal: {
    render: minimal,
    label: 'Minimal Rule',
    blurb: 'Accent hairline + name block. Safest upgrade — keeps the personal-email feel.',
    risk: 'low',
  },
  sidebar: {
    render: sidebar,
    label: 'Sidebar Accent',
    blurb: 'Full-height colour bar on the left. Designed, but not shouty.',
    risk: 'low',
  },
  terminal: {
    render: terminal,
    label: 'Terminal',
    blurb: 'Dark card, mono type, shell prompt. Great for eng teams, risky elsewhere.',
    risk: 'high',
  },
  resume: {
    render: resumeCard,
    label: 'Resume Card',
    blurb: 'Two-column header, "Selected Work" table. Formal and CV-like.',
    risk: 'medium',
  },
  editorial: {
    render: editorial,
    label: 'Editorial',
    blurb: 'Serif, airy, numbered highlights. Warm — good for longer notes.',
    risk: 'medium',
  },
};

export function renderCandidate(key, opts) {
  const c = CANDIDATES[key];
  if (!c) throw new Error(`Unknown candidate theme: ${key}`);
  return c.render(opts);
}
