/**
 * Representative Contact Email Template
 *
 * Sent when a user contacts their representative about an issue.
 */

export interface RepresentativeContactTemplateData {
  senderName: string;
  senderEmail: string;
  senderAddress?: string;
  representativeName: string;
  representativeTitle?: string;
  subject: string;
  message: string;
  propositionTitle?: string;
  propositionId?: string;
  platformName: string;
}

export function representativeContactTemplate(
  data: RepresentativeContactTemplateData,
): {
  html: string;
  text: string;
} {
  const propositionSection = data.propositionTitle
    ? `<p style="color: #475569; margin-bottom: 16px;"><strong>Regarding:</strong> ${data.propositionTitle}</p>`
    : "";

  const propositionTextSection = data.propositionTitle
    ? `Regarding: ${data.propositionTitle}\n\n`
    : "";

  const addressSection = data.senderAddress
    ? `<br><strong>Address:</strong> ${data.senderAddress}`
    : "";

  const addressTextSection = data.senderAddress
    ? `\nAddress: ${data.senderAddress}`
    : "";

  return {
    html: `
<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
  </head>
  <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #1e293b;">
    <p style="color: #475569; line-height: 1.6;">
      Dear ${data.representativeName},
    </p>

    ${propositionSection}

    <div style="white-space: pre-wrap; color: #475569; line-height: 1.6; background-color: #f8fafc; padding: 20px; border-radius: 8px; margin: 20px 0;">
${data.message}
    </div>

    <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;">

    <div style="color: #64748b; font-size: 14px;">
      <p style="margin: 4px 0;"><strong>From:</strong> ${data.senderName}</p>
      <p style="margin: 4px 0;"><strong>Email:</strong> ${data.senderEmail}${addressSection}</p>
    </div>

    <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;">

    <p style="color: #94a3b8; font-size: 11px; text-align: center;">
      This message was sent via ${data.platformName}. The sender's email address has been verified.
    </p>
  </body>
</html>
    `.trim(),
    text: `Dear ${data.representativeName},

${propositionTextSection}${data.message}

---
From: ${data.senderName}
Email: ${data.senderEmail}${addressTextSection}

---
This message was sent via ${data.platformName}. The sender's email address has been verified.`,
  };
}

/**
 * Generate a mailto link for fallback email client opening
 */
export function generateMailtoLink(
  email: string,
  subject: string,
  body: string,
): string {
  const encodedSubject = encodeURIComponent(subject);
  const encodedBody = encodeURIComponent(body);
  return `mailto:${email}?subject=${encodedSubject}&body=${encodedBody}`;
}
