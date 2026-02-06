import { registerAs } from '@nestjs/config';

export default registerAs('email', () => ({
  resendApiKey: process.env.RESEND_API_KEY || '',
  fromEmail: process.env.EMAIL_FROM_ADDRESS || 'noreply@opuspopuli.org',
  fromName: process.env.EMAIL_FROM_NAME || 'Opus Populi',
  replyToEmail: process.env.EMAIL_REPLY_TO,
}));
