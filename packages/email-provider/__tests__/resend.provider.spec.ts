/* eslint-disable @typescript-eslint/no-explicit-any */
import { ResendEmailProvider } from "../src/providers/resend.provider";
import { EmailError, IEmailConfig } from "@qckstrt/common";

// Mock the Resend client
const mockEmails = {
  send: jest.fn(),
};

jest.mock("resend", () => ({
  Resend: jest.fn().mockImplementation(() => ({
    emails: mockEmails,
  })),
}));

describe("ResendEmailProvider", () => {
  let provider: ResendEmailProvider;
  const defaultConfig: IEmailConfig = {
    apiKey: "test-api-key",
    fromEmail: "test@example.com",
    fromName: "Test App",
    replyToEmail: "reply@example.com",
  };

  beforeEach(() => {
    jest.clearAllMocks();
    provider = new ResendEmailProvider(defaultConfig);
  });

  describe("constructor", () => {
    it("should initialize with config", () => {
      expect(provider).toBeDefined();
      expect(provider.getName()).toBe("resend");
    });

    it("should set default from address correctly", () => {
      const provider = new ResendEmailProvider({
        apiKey: "key",
        fromEmail: "noreply@test.com",
        fromName: "My App",
      });
      expect(provider.getName()).toBe("resend");
    });
  });

  describe("send", () => {
    it("should send email successfully with html content", async () => {
      mockEmails.send.mockResolvedValue({
        data: { id: "email-id-123" },
        error: null,
      });

      const result = await provider.send({
        to: "recipient@example.com",
        subject: "Test Subject",
        html: "<p>Hello World</p>",
        text: "Hello World",
      });

      expect(result).toEqual({ success: true, id: "email-id-123" });
      expect(mockEmails.send).toHaveBeenCalledWith({
        from: "Test App <test@example.com>",
        to: ["recipient@example.com"],
        subject: "Test Subject",
        html: "<p>Hello World</p>",
        text: "Hello World",
        replyTo: "reply@example.com",
        tags: undefined,
      });
    });

    it("should send email successfully with text-only content", async () => {
      mockEmails.send.mockResolvedValue({
        data: { id: "email-id-456" },
        error: null,
      });

      const result = await provider.send({
        to: "recipient@example.com",
        subject: "Test Subject",
        text: "Hello World plain text",
      });

      expect(result).toEqual({ success: true, id: "email-id-456" });
      expect(mockEmails.send).toHaveBeenCalledWith({
        from: "Test App <test@example.com>",
        to: ["recipient@example.com"],
        subject: "Test Subject",
        text: "Hello World plain text",
        replyTo: "reply@example.com",
        tags: undefined,
      });
    });

    it("should handle multiple recipients", async () => {
      mockEmails.send.mockResolvedValue({
        data: { id: "email-id-789" },
        error: null,
      });

      const result = await provider.send({
        to: ["user1@example.com", "user2@example.com"],
        subject: "Bulk Test",
        html: "<p>Hello everyone</p>",
      });

      expect(result.success).toBe(true);
      expect(mockEmails.send).toHaveBeenCalledWith(
        expect.objectContaining({
          to: ["user1@example.com", "user2@example.com"],
        }),
      );
    });

    it("should use custom from address when provided", async () => {
      mockEmails.send.mockResolvedValue({
        data: { id: "email-id" },
        error: null,
      });

      await provider.send({
        to: "recipient@example.com",
        subject: "Test",
        html: "<p>Test</p>",
        from: "Custom Sender <custom@example.com>",
      });

      expect(mockEmails.send).toHaveBeenCalledWith(
        expect.objectContaining({
          from: "Custom Sender <custom@example.com>",
        }),
      );
    });

    it("should use custom replyTo when provided", async () => {
      mockEmails.send.mockResolvedValue({
        data: { id: "email-id" },
        error: null,
      });

      await provider.send({
        to: "recipient@example.com",
        subject: "Test",
        html: "<p>Test</p>",
        replyTo: "custom-reply@example.com",
      });

      expect(mockEmails.send).toHaveBeenCalledWith(
        expect.objectContaining({
          replyTo: "custom-reply@example.com",
        }),
      );
    });

    it("should include tags when provided", async () => {
      mockEmails.send.mockResolvedValue({
        data: { id: "email-id" },
        error: null,
      });

      await provider.send({
        to: "recipient@example.com",
        subject: "Test",
        html: "<p>Test</p>",
        tags: [
          { name: "type", value: "notification" },
          { name: "campaign", value: "welcome" },
        ],
      });

      expect(mockEmails.send).toHaveBeenCalledWith(
        expect.objectContaining({
          tags: [
            { name: "type", value: "notification" },
            { name: "campaign", value: "welcome" },
          ],
        }),
      );
    });

    it("should return failure on API error", async () => {
      mockEmails.send.mockResolvedValue({
        data: null,
        error: { message: "Rate limit exceeded" },
      });

      const result = await provider.send({
        to: "recipient@example.com",
        subject: "Test",
        html: "<p>Test</p>",
      });

      expect(result).toEqual({
        success: false,
        error: "Rate limit exceeded",
      });
    });

    it("should throw EmailError on exception", async () => {
      mockEmails.send.mockRejectedValue(new Error("Network error"));

      await expect(
        provider.send({
          to: "recipient@example.com",
          subject: "Test",
          html: "<p>Test</p>",
        }),
      ).rejects.toThrow(EmailError);
    });

    it("should handle empty text fallback", async () => {
      mockEmails.send.mockResolvedValue({
        data: { id: "email-id" },
        error: null,
      });

      await provider.send({
        to: "recipient@example.com",
        subject: "Test",
      });

      expect(mockEmails.send).toHaveBeenCalledWith(
        expect.objectContaining({
          text: "",
        }),
      );
    });
  });

  describe("sendBatch", () => {
    it("should send multiple emails successfully", async () => {
      mockEmails.send
        .mockResolvedValueOnce({ data: { id: "id-1" }, error: null })
        .mockResolvedValueOnce({ data: { id: "id-2" }, error: null })
        .mockResolvedValueOnce({ data: { id: "id-3" }, error: null });

      const emails = [
        { to: "user1@example.com", subject: "Test 1", html: "<p>1</p>" },
        { to: "user2@example.com", subject: "Test 2", html: "<p>2</p>" },
        { to: "user3@example.com", subject: "Test 3", html: "<p>3</p>" },
      ];

      const results = await provider.sendBatch(emails);

      expect(results).toHaveLength(3);
      expect(results[0]).toEqual({ success: true, id: "id-1" });
      expect(results[1]).toEqual({ success: true, id: "id-2" });
      expect(results[2]).toEqual({ success: true, id: "id-3" });
      expect(mockEmails.send).toHaveBeenCalledTimes(3);
    });

    it("should handle partial failures in batch", async () => {
      mockEmails.send
        .mockResolvedValueOnce({ data: { id: "id-1" }, error: null })
        .mockResolvedValueOnce({
          data: null,
          error: { message: "Invalid email" },
        })
        .mockResolvedValueOnce({ data: { id: "id-3" }, error: null });

      const emails = [
        { to: "valid@example.com", subject: "Test 1", html: "<p>1</p>" },
        { to: "invalid", subject: "Test 2", html: "<p>2</p>" },
        { to: "valid2@example.com", subject: "Test 3", html: "<p>3</p>" },
      ];

      const results = await provider.sendBatch(emails);

      expect(results).toHaveLength(3);
      expect(results[0].success).toBe(true);
      expect(results[1].success).toBe(false);
      expect(results[1].error).toBe("Invalid email");
      expect(results[2].success).toBe(true);
    });

    it("should handle empty batch", async () => {
      const results = await provider.sendBatch([]);

      expect(results).toEqual([]);
      expect(mockEmails.send).not.toHaveBeenCalled();
    });
  });

  describe("getName", () => {
    it("should return provider name", () => {
      expect(provider.getName()).toBe("resend");
    });
  });
});
