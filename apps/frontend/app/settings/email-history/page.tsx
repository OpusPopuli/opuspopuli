"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@apollo/client/react";
import {
  GET_EMAIL_HISTORY,
  EmailHistoryData,
  EmailCorrespondence,
  EmailType,
  EmailStatus,
} from "@/lib/graphql/email";

const PAGE_SIZE = 10;

const STATUS_STYLES: Record<EmailStatus, { bg: string; text: string }> = {
  PENDING: { bg: "bg-yellow-100", text: "text-yellow-800" },
  SENT: { bg: "bg-blue-100", text: "text-blue-800" },
  DELIVERED: { bg: "bg-green-100", text: "text-green-800" },
  FAILED: { bg: "bg-red-100", text: "text-red-800" },
  BOUNCED: { bg: "bg-orange-100", text: "text-orange-800" },
};

const EMAIL_TYPE_LABELS: Record<EmailType, string> = {
  WELCOME: "Welcome",
  REPRESENTATIVE_CONTACT: "Representative Contact",
  CIVIC_UPDATE: "Civic Update",
  ELECTION_REMINDER: "Election Reminder",
  BALLOT_UPDATE: "Ballot Update",
  ACCOUNT_ACTIVITY: "Account Activity",
};

function StatusBadge({ status }: { readonly status: EmailStatus }) {
  const style = STATUS_STYLES[status];
  return (
    <span
      className={`px-2 py-0.5 text-xs font-medium rounded-full ${style.bg} ${style.text}`}
    >
      {status}
    </span>
  );
}

function EmailCard({ email }: { readonly email: EmailCorrespondence }) {
  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-4 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <StatusBadge status={email.status} />
            <span className="text-xs text-[#64748b]">
              {EMAIL_TYPE_LABELS[email.emailType]}
            </span>
            <span className="text-xs text-[#64748b]">
              {new Date(email.createdAt).toLocaleDateString()}
            </span>
          </div>
          <h3 className="font-medium text-[#1e293b] truncate">
            {email.subject}
          </h3>
          <p className="text-sm text-[#64748b] mt-1">
            To: {email.recipientName || email.recipientEmail}
          </p>
          {email.bodyPreview && (
            <p className="text-sm text-[#64748b] mt-2 line-clamp-2">
              {email.bodyPreview}
            </p>
          )}
          {email.errorMessage && (
            <p className="text-sm text-red-600 mt-2">
              Error: {email.errorMessage}
            </p>
          )}
        </div>
        {email.representativeId && (
          <Link
            href={`/region/representatives`}
            className="text-sm text-blue-600 hover:underline flex-shrink-0"
          >
            View Rep
          </Link>
        )}
      </div>
    </div>
  );
}

export default function EmailHistoryPage() {
  const [page, setPage] = useState(0);
  const [typeFilter, setTypeFilter] = useState<EmailType | "">("");

  const { data, loading, error } = useQuery<EmailHistoryData>(
    GET_EMAIL_HISTORY,
    {
      variables: {
        skip: page * PAGE_SIZE,
        take: PAGE_SIZE,
        emailType: typeFilter || undefined,
      },
    },
  );

  const emails = data?.myEmailHistory?.items || [];
  const total = data?.myEmailHistory?.total || 0;
  const hasMore = data?.myEmailHistory?.hasMore || false;

  const renderContent = () => {
    if (loading) {
      return (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="animate-pulse">
              <div className="bg-gray-200 rounded-lg h-24"></div>
            </div>
          ))}
        </div>
      );
    }

    if (error) {
      return (
        <div className="bg-red-50 border border-red-200 rounded-lg p-6">
          <p className="text-red-600">Failed to load email history.</p>
        </div>
      );
    }

    if (emails.length === 0) {
      return (
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-8 text-center">
          <svg
            className="w-12 h-12 text-gray-300 mx-auto mb-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
            />
          </svg>
          <p className="text-[#64748b]">No emails found.</p>
          <p className="text-sm text-[#64748b] mt-1">
            Emails you send will appear here.
          </p>
        </div>
      );
    }

    return (
      <>
        <div className="space-y-4">
          {emails.map((email) => (
            <EmailCard key={email.id} email={email} />
          ))}
        </div>

        {/* Pagination */}
        <div className="mt-8 flex items-center justify-between">
          <p className="text-sm text-[#64748b]">
            Showing {page * PAGE_SIZE + 1} -{" "}
            {Math.min((page + 1) * PAGE_SIZE, total)} of {total}
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="px-4 py-2 text-sm font-medium text-[#1e293b] bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Previous
            </button>
            <button
              onClick={() => setPage((p) => p + 1)}
              disabled={!hasMore}
              className="px-4 py-2 text-sm font-medium text-[#1e293b] bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Next
            </button>
          </div>
        </div>
      </>
    );
  };

  return (
    <div className="max-w-4xl mx-auto px-8 py-12">
      {/* Breadcrumb */}
      <nav className="mb-6">
        <Link
          href="/settings"
          className="text-sm text-blue-600 hover:text-blue-700 hover:underline"
        >
          Settings
        </Link>
        <span className="mx-2 text-[#64748b]">/</span>
        <span className="text-sm text-[#64748b]">Email History</span>
      </nav>

      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-[#1e293b]">Email History</h1>
        <p className="mt-2 text-[#64748b]">
          View your sent emails and correspondence
        </p>
      </div>

      {/* Filter */}
      <div className="mb-6 flex items-center gap-2">
        <label htmlFor="email-type-filter" className="text-sm text-[#64748b]">
          Filter by type:
        </label>
        <select
          id="email-type-filter"
          value={typeFilter}
          onChange={(e) => {
            setTypeFilter(e.target.value as EmailType | "");
            setPage(0);
          }}
          className="px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:border-[#1e293b] focus:ring-1 focus:ring-[#1e293b] outline-none"
        >
          <option value="">All Types</option>
          <option value="REPRESENTATIVE_CONTACT">Representative Contact</option>
          <option value="CIVIC_UPDATE">Civic Updates</option>
          <option value="WELCOME">Welcome</option>
          <option value="ELECTION_REMINDER">Election Reminders</option>
          <option value="BALLOT_UPDATE">Ballot Updates</option>
          <option value="ACCOUNT_ACTIVITY">Account Activity</option>
        </select>
      </div>

      {/* Content */}
      {renderContent()}
    </div>
  );
}
