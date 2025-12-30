"use client";

import { useState } from "react";
import { useMutation, useLazyQuery } from "@apollo/client/react";
import {
  CONTACT_REPRESENTATIVE,
  GET_MAILTO_LINK,
  ContactRepresentativeInput,
  RepresentativeInfoInput,
  PropositionInfoInput,
  ContactRepresentativeData,
  MailtoLinkData,
} from "@/lib/graphql/email";

interface Props {
  representative: RepresentativeInfoInput;
  proposition?: PropositionInfoInput;
  onSuccess?: () => void;
  onCancel?: () => void;
}

export function ContactRepresentativeForm({
  representative,
  proposition,
  onSuccess,
  onCancel,
}: Readonly<Props>) {
  const [subject, setSubject] = useState(
    proposition ? `Regarding: ${proposition.title}` : "",
  );
  const [message, setMessage] = useState("");
  const [includeAddress, setIncludeAddress] = useState(true);
  const [sendMethod, setSendMethod] = useState<"platform" | "mailto">(
    "platform",
  );

  const [contactRepresentative, { loading, error }] =
    useMutation<ContactRepresentativeData>(CONTACT_REPRESENTATIVE);

  const [getMailtoLink] = useLazyQuery<MailtoLinkData>(GET_MAILTO_LINK);

  const handlePlatformSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!representative.email) {
      alert("Representative email not available");
      return;
    }

    const input: ContactRepresentativeInput = {
      representativeId: representative.id,
      subject,
      message,
      propositionId: proposition?.id,
      includeAddress,
    };

    try {
      const result = await contactRepresentative({
        variables: {
          input,
          representative: {
            id: representative.id,
            name: representative.name,
            email: representative.email,
            chamber: representative.chamber,
          },
          proposition: proposition
            ? {
                id: proposition.id,
                title: proposition.title,
              }
            : null,
        },
      });

      if (result.data?.contactRepresentative.success) {
        onSuccess?.();
      } else {
        alert(
          result.data?.contactRepresentative.error || "Failed to send email",
        );
      }
    } catch (err) {
      console.error("Error sending email:", err);
    }
  };

  const handleMailtoClick = async () => {
    if (!representative.email) {
      alert("Representative email not available");
      return;
    }

    const { data } = await getMailtoLink({
      variables: {
        representativeEmail: representative.email,
        subject,
        body: message,
      },
    });

    if (data?.representativeMailtoLink) {
      window.location.href = data.representativeMailtoLink;
    }
  };

  const hasEmail = !!representative.email;

  return (
    <form onSubmit={handlePlatformSubmit} className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-[#1e293b]">
          Contact {representative.name}
        </h2>
        {representative.chamber && (
          <p className="text-sm text-[#64748b] mt-1">
            {representative.chamber}
          </p>
        )}
      </div>

      {!hasEmail && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <p className="text-yellow-800">
            No email address available for this representative.
          </p>
        </div>
      )}

      {hasEmail && (
        <>
          {/* Send Method Toggle */}
          <div className="flex gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="sendMethod"
                value="platform"
                checked={sendMethod === "platform"}
                onChange={() => setSendMethod("platform")}
                className="text-[#1e293b]"
              />
              <span className="text-sm">Send via Platform</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="sendMethod"
                value="mailto"
                checked={sendMethod === "mailto"}
                onChange={() => setSendMethod("mailto")}
                className="text-[#1e293b]"
              />
              <span className="text-sm">Open in Email Client</span>
            </label>
          </div>

          {/* Subject */}
          <div>
            <label
              htmlFor="subject"
              className="block text-sm font-medium text-[#1e293b] mb-2"
            >
              Subject
            </label>
            <input
              id="subject"
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              required
              maxLength={200}
              className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:border-[#1e293b] focus:ring-1 focus:ring-[#1e293b] outline-none"
              placeholder="Subject of your message"
            />
          </div>

          {/* Message */}
          <div>
            <label
              htmlFor="message"
              className="block text-sm font-medium text-[#1e293b] mb-2"
            >
              Message
            </label>
            <textarea
              id="message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              required
              minLength={10}
              maxLength={5000}
              rows={8}
              className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:border-[#1e293b] focus:ring-1 focus:ring-[#1e293b] outline-none resize-y"
              placeholder="Write your message here..."
            />
            <p className="text-xs text-[#64748b] mt-1">
              {message.length}/5000 characters
            </p>
          </div>

          {/* Include Address Option (only for platform send) */}
          {sendMethod === "platform" && (
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={includeAddress}
                onChange={(e) => setIncludeAddress(e.target.checked)}
                className="rounded text-[#1e293b]"
              />
              <span className="text-sm text-[#64748b]">
                Include my address (helps verify you are a constituent)
              </span>
            </label>
          )}

          {/* Error Display */}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <p className="text-red-600 text-sm">{error.message}</p>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 justify-end">
            {onCancel && (
              <button
                type="button"
                onClick={onCancel}
                className="px-4 py-2 text-sm font-medium text-[#64748b] hover:text-[#1e293b] transition-colors"
              >
                Cancel
              </button>
            )}
            {sendMethod === "platform" ? (
              <button
                type="submit"
                disabled={loading || !subject || message.length < 10}
                className="px-6 py-2 text-sm font-medium text-white bg-[#1e293b] rounded-lg hover:bg-[#334155] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {loading ? "Sending..." : "Send Message"}
              </button>
            ) : (
              <button
                type="button"
                onClick={handleMailtoClick}
                disabled={!subject || message.length < 10}
                className="px-6 py-2 text-sm font-medium text-white bg-[#1e293b] rounded-lg hover:bg-[#334155] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Open in Email Client
              </button>
            )}
          </div>
        </>
      )}
    </form>
  );
}
