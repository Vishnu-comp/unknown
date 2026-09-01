// Default copy for the outreach + follow-up emails.
//
// Placeholders ([user name], [company name], [job description], [job id]) are
// substituted on the server per candidate, so the text you edit in the UI is
// the text that actually gets sent.

export const DEFAULT_SUBJECT =
  '[job description] Opportunity at [company name][if job id] (Job ID: [job id])[/if job id]';

export const DEFAULT_FOLLOWUP_SUBJECT =
  'Following Up: [job description] Opportunity at [company name][if job id] (Job ID: [job id])[/if job id]';

export const DEFAULT_TEMPLATE = `<p>Hi [user name],</p>

<p>I understand your time is valuable, so I'll keep this brief.</p>

<p>I'm reaching out to express my interest in the <b>[job description]</b> role at <b>[company name]</b>[if job id] (Job ID: <b>[job id]</b>)[/if job id].</p>

<p>I'm <b>Vishnu Nair</b>, currently working as a Full Stack Developer at <b><a href="https://www.shoffr.in/" target="_blank" rel="noreferrer">Shoffr</a></b>.</p>

<p>Some of the things I've worked on:</p>

<ul>
  <li>Developed a <b>CRM workflow</b> for CX, guests, operations and drivers, reducing resolution time by <b>65%</b></li>
  <li>Owned the <b>Recurring Ride feature</b> enabling weekly bookings with upfront payment and automated trip creation</li>
  <li>Built <b>real-time backend/frontend synchronization</b> with validation handling</li>
  <li>Integrated <b>Paytm payment links</b> with auto-verification</li>
  <li>Built a <b><a href="https://www.shoffr.in/corporate" target="_blank" rel="noreferrer">B2B webpage</a></b> that increased inquiries by <b>55%</b></li>
</ul>

<p><b>Tech stack:</b> React, Next.js, Spring Boot, MySQL, Thymeleaf, Python, TypeScript, RabbitMQ, WebSocket, Redux</p>

<p>I'd love to explore relevant opportunities at <b>[company name]</b> and would really appreciate any guidance or referrals.</p>

<p>Thanks for your time!</p>

<p>Best regards,<br/>
<b>Vishnu Nair</b><br/>
+91-9967418222 | <a href="mailto:vishnunair2323@gmail.com">vishnunair2323@gmail.com</a></p>

<p><a href="https://vishnunairportfolio.vercel.app/" target="_blank" rel="noreferrer">Portfolio</a><br/>
<a href="https://github.com/Vishnu-comp" target="_blank" rel="noreferrer">GitHub</a><br/>
<a href="https://linkedin.com/in/vishnu-nair-tech" target="_blank" rel="noreferrer">LinkedIn</a></p>`;

export const DEFAULT_FOLLOWUP_TEMPLATE = `<p>Hi [user name],</p>

<p>I wanted to follow up on my previous email about the <b>[job description]</b> opportunity at <b>[company name]</b>[if job id] (Job ID: <b>[job id]</b>)[/if job id]. I'm still very interested in the role and would appreciate any updates or next steps.</p>

<p>Looking forward to your response.</p>

<p>Best regards,<br/><b>Vishnu Nair</b></p>`;
