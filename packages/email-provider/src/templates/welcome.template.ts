/**
 * Welcome Email Template
 *
 * Sent to new users after registration.
 */

export interface WelcomeTemplateData {
  userName?: string;
  platformName: string;
  loginUrl: string;
}

export function welcomeEmailTemplate(data: WelcomeTemplateData): {
  html: string;
  text: string;
  subject: string;
} {
  const greeting = data.userName ? `Hello ${data.userName}` : "Hello";

  return {
    subject: `Welcome to ${data.platformName}!`,
    html: `
<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
  </head>
  <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #1e293b;">
    <div style="text-align: center; margin-bottom: 32px;">
      <h1 style="color: #1e293b; font-size: 24px; margin: 0;">${data.platformName}</h1>
    </div>

    <h2 style="color: #1e293b; font-size: 20px;">${greeting}!</h2>

    <p style="color: #475569; line-height: 1.6;">
      Welcome to ${data.platformName}! We're excited to have you join our community of engaged citizens.
    </p>

    <p style="color: #475569; line-height: 1.6;">
      You now have access to:
    </p>

    <ul style="color: #475569; line-height: 1.8;">
      <li>Track your local representatives</li>
      <li>Stay informed on propositions and bills</li>
      <li>Engage directly with your elected officials</li>
      <li>Receive updates on issues that matter to you</li>
    </ul>

    <div style="text-align: center; margin: 32px 0;">
      <a href="${data.loginUrl}"
         style="background-color: #1e293b; color: white; padding: 14px 28px;
                text-decoration: none; border-radius: 8px; display: inline-block;
                font-weight: 500;">
        Get Started
      </a>
    </div>

    <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 32px 0;">

    <p style="color: #94a3b8; font-size: 12px; text-align: center;">
      This email was sent by ${data.platformName}. If you did not create an account, please ignore this email.
    </p>
  </body>
</html>
    `.trim(),
    text: `${greeting}!

Welcome to ${data.platformName}! We're excited to have you join our community of engaged citizens.

You now have access to:
- Track your local representatives
- Stay informed on propositions and bills
- Engage directly with your elected officials
- Receive updates on issues that matter to you

Get started: ${data.loginUrl}

---
This email was sent by ${data.platformName}. If you did not create an account, please ignore this email.`,
  };
}
