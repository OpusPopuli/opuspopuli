import {
  welcomeEmailTemplate,
  WelcomeTemplateData,
} from "../src/templates/welcome.template";
import {
  representativeContactTemplate,
  RepresentativeContactTemplateData,
  generateMailtoLink,
} from "../src/templates/representative-contact.template";

describe("Email Templates", () => {
  describe("welcomeEmailTemplate", () => {
    const baseData: WelcomeTemplateData = {
      platformName: "Opus Populi",
      loginUrl: "https://app.example.com/login",
    };

    it("should generate email with user name", () => {
      const result = welcomeEmailTemplate({
        ...baseData,
        userName: "John Doe",
      });

      expect(result.subject).toBe("Welcome to Opus Populi!");
      expect(result.html).toContain("Hello John Doe");
      expect(result.text).toContain("Hello John Doe");
      expect(result.html).toContain("https://app.example.com/login");
      expect(result.text).toContain("https://app.example.com/login");
    });

    it("should generate email without user name", () => {
      const result = welcomeEmailTemplate(baseData);

      expect(result.subject).toBe("Welcome to Opus Populi!");
      expect(result.html).toContain("Hello!");
      expect(result.text).toContain("Hello!");
      expect(result.html).not.toContain("Hello undefined");
    });

    it("should include platform name in content", () => {
      const result = welcomeEmailTemplate(baseData);

      expect(result.html).toContain("Opus Populi");
      expect(result.text).toContain("Opus Populi");
    });

    it("should include feature list", () => {
      const result = welcomeEmailTemplate(baseData);

      expect(result.html).toContain("Track your local representatives");
      expect(result.html).toContain("Stay informed on propositions and bills");
      expect(result.text).toContain("Track your local representatives");
    });

    it("should include Get Started button in HTML", () => {
      const result = welcomeEmailTemplate(baseData);

      expect(result.html).toContain("Get Started");
      expect(result.html).toContain('href="https://app.example.com/login"');
    });

    it("should include plain text fallback", () => {
      const result = welcomeEmailTemplate(baseData);

      expect(result.text).toBeTruthy();
      expect(result.text).toContain("Get started:");
      expect(result.text).not.toContain("<html>");
    });
  });

  describe("representativeContactTemplate", () => {
    const baseData: RepresentativeContactTemplateData = {
      senderName: "Jane Citizen",
      senderEmail: "jane@example.com",
      representativeName: "Rep. Smith",
      subject: "Regarding Education Bill",
      message: "I am writing to express my support for the education bill.",
      platformName: "Opus Populi",
    };

    it("should generate email with basic data", () => {
      const result = representativeContactTemplate(baseData);

      expect(result.html).toContain("Dear Rep. Smith");
      expect(result.html).toContain("Jane Citizen");
      expect(result.html).toContain("jane@example.com");
      expect(result.html).toContain(
        "I am writing to express my support for the education bill.",
      );
      expect(result.text).toContain("Dear Rep. Smith");
    });

    it("should include proposition title when provided", () => {
      const result = representativeContactTemplate({
        ...baseData,
        propositionTitle: "Education Reform Act",
        propositionId: "prop-123",
      });

      expect(result.html).toContain("Regarding:");
      expect(result.html).toContain("Education Reform Act");
      expect(result.text).toContain("Regarding: Education Reform Act");
    });

    it("should not include proposition section when not provided", () => {
      const result = representativeContactTemplate(baseData);

      expect(result.html).not.toContain("Regarding:");
      expect(result.text).not.toContain("Regarding:");
    });

    it("should include sender address when provided", () => {
      const result = representativeContactTemplate({
        ...baseData,
        senderAddress: "123 Main St, City, ST 12345",
      });

      expect(result.html).toContain("Address:");
      expect(result.html).toContain("123 Main St, City, ST 12345");
      expect(result.text).toContain("Address: 123 Main St, City, ST 12345");
    });

    it("should not include address section when not provided", () => {
      const result = representativeContactTemplate(baseData);

      expect(result.html).not.toContain("<strong>Address:</strong>");
    });

    it("should include platform verification notice", () => {
      const result = representativeContactTemplate(baseData);

      expect(result.html).toContain("This message was sent via Opus Populi");
      expect(result.html).toContain(
        "The sender's email address has been verified",
      );
      expect(result.text).toContain("This message was sent via Opus Populi");
    });

    it("should preserve message formatting", () => {
      const result = representativeContactTemplate({
        ...baseData,
        message: "Line 1\nLine 2\nLine 3",
      });

      expect(result.html).toContain("white-space: pre-wrap");
      expect(result.text).toContain("Line 1\nLine 2\nLine 3");
    });
  });

  describe("generateMailtoLink", () => {
    it("should generate valid mailto link", () => {
      const result = generateMailtoLink(
        "rep@congress.gov",
        "Test Subject",
        "Test body message",
      );

      expect(result).toBe(
        "mailto:rep@congress.gov?subject=Test%20Subject&body=Test%20body%20message",
      );
    });

    it("should encode special characters in subject", () => {
      const result = generateMailtoLink(
        "rep@congress.gov",
        "Subject with & special < characters >",
        "Body",
      );

      expect(result).toContain("Subject%20with%20%26%20special");
    });

    it("should encode special characters in body", () => {
      const result = generateMailtoLink(
        "rep@congress.gov",
        "Subject",
        "Body with\nnewlines and special & characters",
      );

      expect(result).toContain("Body%20with%0Anewlines");
    });

    it("should handle empty subject", () => {
      const result = generateMailtoLink("rep@congress.gov", "", "Body");

      expect(result).toBe("mailto:rep@congress.gov?subject=&body=Body");
    });

    it("should handle empty body", () => {
      const result = generateMailtoLink("rep@congress.gov", "Subject", "");

      expect(result).toBe("mailto:rep@congress.gov?subject=Subject&body=");
    });
  });
});
