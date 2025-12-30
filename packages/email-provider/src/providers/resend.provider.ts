import { Resend } from "resend";
import {
  IEmailProvider,
  IEmailConfig,
  ISendEmailOptions,
  IEmailResult,
  EmailError,
} from "@qckstrt/common";

/**
 * Resend Email Provider
 *
 * Implements email sending using the Resend API.
 */
export class ResendEmailProvider implements IEmailProvider {
  private readonly resend: Resend;
  private readonly defaultFrom: string;
  private readonly defaultReplyTo?: string;

  constructor(config: IEmailConfig) {
    this.resend = new Resend(config.apiKey);
    this.defaultFrom = `${config.fromName} <${config.fromEmail}>`;
    this.defaultReplyTo = config.replyToEmail;
  }

  getName(): string {
    return "resend";
  }

  async send(options: ISendEmailOptions): Promise<IEmailResult> {
    try {
      // Resend requires either html or text
      const emailContent = options.html
        ? { html: options.html, text: options.text }
        : { text: options.text || "" };

      const { data, error } = await this.resend.emails.send({
        from: options.from || this.defaultFrom,
        to: Array.isArray(options.to) ? options.to : [options.to],
        subject: options.subject,
        ...emailContent,
        replyTo: options.replyTo || this.defaultReplyTo,
        tags: options.tags,
      });

      if (error) {
        return { success: false, error: error.message };
      }

      return { success: true, id: data?.id };
    } catch (error) {
      const err = error as Error;
      throw new EmailError(err.message, "RESEND_ERROR", err);
    }
  }

  async sendBatch(emails: ISendEmailOptions[]): Promise<IEmailResult[]> {
    const results = await Promise.all(emails.map((email) => this.send(email)));
    return results;
  }
}
