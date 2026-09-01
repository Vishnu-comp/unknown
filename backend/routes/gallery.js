/**
 * Theme gallery — review-only route for comparing candidate designs.
 * Renders real, sendable HTML so what you see is what would actually go out.
 */
import express from 'express';
import { renderEmail, THEMES, THEME_META } from '../utils/themes.js';
import { getBranding } from '../utils/branding.js';
import { fillTemplate, extractHighlights, buildPreheader } from '../utils/template.js';

const router = express.Router();

const SAMPLE_CANDIDATE = {
  name: 'Priya',
  companyName: 'KukuFM',
  jobDescription: 'Backend / Frontend Engineer',
};

const SAMPLE_BODY = `<p>Hi [user name],</p>
<p>I understand your time is valuable, so I'll keep this brief.</p>
<p>I'm reaching out to express my interest in the <b>[job description]</b> role at <b>[company name]</b>.</p>
<p>Some of the things I've worked on:</p>
<ul>
<li>Developed a <b>CRM workflow</b> for CX, guests and drivers, cutting resolution time by <b>65%</b></li>
<li>Owned the <b>Recurring Ride feature</b> with upfront payment and automated trip creation</li>
<li>Built a <b>B2B webpage</b> that increased inquiries by <b>55%</b></li>
</ul>
<p>I'd love to explore relevant opportunities at <b>[company name]</b>.</p>
<p>Thanks for your time!</p>`;

function buildOpts() {
  const brand = getBranding();
  const personalized = fillTemplate(SAMPLE_BODY, SAMPLE_CANDIDATE);
  const { body, highlights } = extractHighlights(personalized);

  return {
    bodyHtml: body,
    highlights,
    preheaderText: buildPreheader(body),
    name: brand.wordmark,
    tagline: brand.tagline,
    accent: brand.accentColor,
    contactLines: ['+91-9967418222', 'vishnunair2323@gmail.com'],
    footerLines: [
      '+91-9967418222 &nbsp;&middot;&nbsp; vishnunair2323@gmail.com',
      'Portfolio &nbsp;&middot;&nbsp; GitHub &nbsp;&middot;&nbsp; LinkedIn',
    ],
  };
}

/** Raw HTML for one theme — used as the iframe src in the gallery. */
router.get('/gallery/frame/:key', (req, res) => {
  const { key } = req.params;
  const opts = buildOpts();

  if (!THEMES.includes(key)) {
    return res.status(404).type('html').send(`<p>Unknown theme: ${key}</p>`);
  }

  try {
    const brand = getBranding();
    const html = renderEmail(key, {
      ...opts,
      ...brand,
      bodyHtml: key === 'plain' ? fillTemplate(SAMPLE_BODY, SAMPLE_CANDIDATE) : opts.bodyHtml,
      name: brand.wordmark,
      tagline: brand.tagline,
      accent: brand.accentColor,
    });
    res.type('html').send(html);
  } catch (err) {
    res.status(500).type('html').send(`<p>${err.message}</p>`);
  }
});

/** The gallery itself. */
router.get('/gallery', (req, res) => {
  const all = THEMES.map((key) => ({ key, ...THEME_META[key] }));

  const riskColor = { low: '#16a34a', medium: '#d97706', high: '#dc2626' };

  const card = (t) => `
    <div style="background:#fff;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;">
      <div style="padding:14px 16px;border-bottom:1px solid #f0f0f0;">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
          <strong style="font-size:15px;color:#111;">${t.label}</strong>
          <span style="font-size:10px;text-transform:uppercase;letter-spacing:.6px;font-weight:700;color:${riskColor[t.risk]};border:1px solid ${riskColor[t.risk]};padding:2px 7px;border-radius:99px;">${t.risk} risk</span>
        </div>
        <div style="font-size:12.5px;color:#6b7280;margin-top:5px;line-height:1.5;">${t.blurb}</div>
        <div style="font-size:11px;color:#9ca3af;margin-top:6px;font-family:ui-monospace,monospace;">theme: "${t.key}"</div>
      </div>
      <iframe src="/api/gallery/frame/${t.key}" style="width:100%;height:560px;border:0;display:block;background:#fff;"></iframe>
    </div>`;

  res.type('html').send(`<!doctype html>
<html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Email theme gallery</title></head>
<body style="margin:0;background:#f7f8fa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1f2933;">
<div style="max-width:1400px;margin:0 auto;padding:28px 20px 60px;">
  <h1 style="font-size:22px;margin:0 0 6px;">Email theme gallery</h1>
  <p style="color:#6b7280;font-size:13.5px;margin:0 0 4px;max-width:800px;line-height:1.6;">
    Real sendable HTML, rendered in isolated iframes — not mockups. Every design uses
    table layout with fully inline styles, no &lt;style&gt; block, no JS, no web fonts,
    600px cap and MSO fallbacks.
  </p>
  <p style="color:#6b7280;font-size:13.5px;margin:0 0 24px;max-width:800px;line-height:1.6;">
    <b>Risk</b> = chance Gmail routes it to the Promotions tab instead of Primary.
    For cold outreach, lower is better.
  </p>

  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(400px,1fr));gap:20px;">
    ${all.map(card).join('')}
  </div>
</div>
</body></html>`);
});

export default router;
