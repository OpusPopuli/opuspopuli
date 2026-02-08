"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@apollo/client/react";
import { GET_MEETINGS, MeetingsData, Meeting } from "@/lib/graphql/region";

const PAGE_SIZE = 10;

function MeetingCard({ meeting }: Readonly<{ meeting: Meeting }>) {
  const scheduledAt = new Date(meeting.scheduledAt);
  const isPast = scheduledAt < new Date();

  const formattedDate = scheduledAt.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const formattedTime = scheduledAt.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    <div className="bg-white rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] p-6 hover:shadow-[0_4px_16px_rgba(0,0,0,0.1)] transition-shadow">
      <div className="flex items-start gap-4">
        {/* Date Badge */}
        <div
          className={`flex-shrink-0 w-16 h-16 rounded-lg flex flex-col items-center justify-center ${
            isPast ? "bg-gray-100" : "bg-blue-100"
          }`}
        >
          <span
            className={`text-xs font-medium uppercase ${
              isPast ? "text-gray-600" : "text-blue-700"
            }`}
          >
            {scheduledAt.toLocaleDateString("en-US", { month: "short" })}
          </span>
          <span
            className={`text-xl font-bold ${
              isPast ? "text-gray-700" : "text-blue-700"
            }`}
          >
            {scheduledAt.getDate()}
          </span>
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-semibold text-[#222222] line-clamp-1">
              {meeting.title}
            </h3>
            {isPast && (
              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600">
                Past
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-[#555555]">{meeting.body}</p>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-[#555555]">
            <span>{formattedDate}</span>
            <span>{formattedTime}</span>
            {meeting.location && <span>{meeting.location}</span>}
          </div>
        </div>
      </div>

      {/* Links */}
      {(meeting.agendaUrl || meeting.videoUrl) && (
        <div className="mt-4 pt-4 border-t border-gray-100 flex items-center gap-4">
          {meeting.agendaUrl && (
            <a
              href={meeting.agendaUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-700 hover:underline"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                />
              </svg>
              Agenda
            </a>
          )}
          {meeting.videoUrl && (
            <a
              href={meeting.videoUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-700 hover:underline"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
                />
              </svg>
              Video
            </a>
          )}
        </div>
      )}
    </div>
  );
}

export default function MeetingsPage() {
  const [page, setPage] = useState(0);
  const { data, loading, error } = useQuery<MeetingsData>(GET_MEETINGS, {
    variables: { skip: page * PAGE_SIZE, take: PAGE_SIZE },
  });

  const renderContent = () => {
    if (loading) {
      return (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="animate-pulse">
              <div className="bg-gray-200 rounded-xl h-32"></div>
            </div>
          ))}
        </div>
      );
    }

    if (error) {
      return (
        <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
          <p className="text-red-600">
            Failed to load meetings. Please try again later.
          </p>
        </div>
      );
    }

    if (data?.meetings.items.length === 0) {
      return (
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-8 text-center">
          <p className="text-[#555555]">No meetings found.</p>
        </div>
      );
    }

    return (
      <>
        <div className="space-y-4">
          {data?.meetings.items.map((meeting) => (
            <MeetingCard key={meeting.id} meeting={meeting} />
          ))}
        </div>

        {/* Pagination */}
        <div className="mt-8 flex items-center justify-between">
          <p className="text-sm text-[#555555]">
            Showing {page * PAGE_SIZE + 1} -{" "}
            {Math.min((page + 1) * PAGE_SIZE, data?.meetings.total || 0)} of{" "}
            {data?.meetings.total || 0}
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="px-4 py-2 text-sm font-medium text-[#222222] bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Previous
            </button>
            <button
              onClick={() => setPage((p) => p + 1)}
              disabled={!data?.meetings.hasMore}
              className="px-4 py-2 text-sm font-medium text-[#222222] bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
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
          href="/region"
          className="text-sm text-blue-600 hover:text-blue-700 hover:underline"
        >
          Region
        </Link>
        <span className="mx-2 text-[#555555]">/</span>
        <span className="text-sm text-[#555555]">Meetings</span>
      </nav>

      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-[#222222]">Meetings</h1>
        <p className="mt-2 text-[#555555]">
          Legislative sessions and public hearings
        </p>
      </div>

      {/* Content */}
      {renderContent()}
    </div>
  );
}
