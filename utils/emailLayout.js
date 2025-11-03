// Simple branded email layout wrapper for consistent formatting across project

function escapeHtml(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function makePreheader(preheader) {
  if (!preheader) return '';
  return `<span style="display:none!important;visibility:hidden;mso-hide:all;font-size:1px;color:#fff;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${escapeHtml(preheader)}</span>`;
}

module.exports = function renderEmailLayout({ subject, title, preheader, contentHtml, cta }) {
  const brand = process.env.BRAND_NAME || 'MV Store';
  const brandUrl = process.env.FRONTEND_URL || process.env.CLIENT_URL || 'http://localhost:3000';
  const primary = '#2563eb';
  const textColor = '#374151';

  const ctaHtml = cta && cta.href && cta.label ? `
    <div style="margin-top:24px;text-align:center;">
      <a href="${cta.href}" target="_blank" style="background:${primary};color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none;display:inline-block;font-weight:600;">${escapeHtml(cta.label)}</a>
    </div>
  ` : '';

  return `<!doctype html>
  <html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(subject || title || brand)}</title>
  </head>
  <body style="margin:0;background:#f8fafc;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${textColor};">
    ${makePreheader(preheader || subject)}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="640" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #e5e7eb;border-radius:10px;box-shadow:0 1px 2px rgba(0,0,0,0.04);overflow:hidden;">
            <tr>
              <td style="padding:16px 20px;border-bottom:1px solid #e5e7eb;background:#ffffff;">
                <a href="${brandUrl}" style="text-decoration:none;color:${primary};font-weight:700;font-size:18px;">${escapeHtml(brand)}</a>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 24px 8px 24px;">
                <h1 style="margin:0 0 8px 0;font-size:20px;line-height:28px;color:#111827;">${escapeHtml(title || subject || brand)}</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:0 24px 24px 24px;font-size:14px;line-height:22px;">
                ${contentHtml || ''}
                ${ctaHtml}
              </td>
            </tr>
            <tr>
              <td style="padding:14px 24px;border-top:1px solid #e5e7eb;background:#f9fafb;font-size:12px;color:#6b7280;">
                <div>
                  This is an automated message from ${escapeHtml(brand)}. Please do not reply.
                </div>
                <div style="margin-top:4px;">
                  © ${new Date().getFullYear()} ${escapeHtml(brand)}. All rights reserved.
                </div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
  </html>`;
};


