/**
 * Email Provider Types
 *
 * Interfaces for email operations (Resend, SendGrid, etc.)
 */

/**
 * Email sending options
 */
export interface ISendEmailOptions {
  to: string | string[];
  from?: string;
  subject: string;
  html?: string;
  text?: string;
  replyTo?: string;
  tags?: { name: string; value: string }[];
}

/**
 * Email sending result
 */
export interface IEmailResult {
  success: boolean;
  id?: string;
  error?: string;
}

/**
 * Email provider configuration
 */
export interface IEmailConfig {
  apiKey: string;
  fromEmail: string;
  fromName: string;
  replyToEmail?: string;
}

/**
 * Email provider interface
 */
export interface IEmailProvider {
  /**
   * Get provider name
   */
  getName(): string;

  /**
   * Send a single email
   */
  send(options: ISendEmailOptions): Promise<IEmailResult>;

  /**
   * Send multiple emails in batch
   */
  sendBatch(emails: ISendEmailOptions[]): Promise<IEmailResult[]>;
}

/**
 * Email error class
 */
export class EmailError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
    public readonly cause?: Error,
  ) {
    super(message);
    this.name = "EmailError";
  }
}
