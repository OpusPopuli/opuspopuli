import type { Metadata } from "next";
import Link from "next/link";
import { Header } from "@/components/Header";

export const metadata: Metadata = {
  title: {
    absolute: "OPUS - Civic Engagement Platform | Opus Populi",
  },
};

export default function Home() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <Header />
      <main className="max-w-4xl mx-auto px-8 py-16">
        <div className="text-center mb-16">
          <h1 className="text-5xl font-bold text-gray-900 dark:text-white mb-4">
            Opus Populi
          </h1>
          <p className="text-xl text-gray-600 dark:text-gray-300">
            Quick start platform for building AI-powered applications
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <Link
            href="/rag-demo"
            className="group block p-6 bg-white dark:bg-gray-800 rounded-lg shadow hover:shadow-lg transition-shadow"
          >
            <h2 className="text-2xl font-semibold text-gray-900 dark:text-white mb-2 group-hover:text-blue-600 dark:group-hover:text-blue-400">
              RAG Demo
            </h2>
            <p className="text-gray-600 dark:text-gray-300">
              Upload documents, index them into the vector database, and ask
              questions using the Retrieval-Augmented Generation pipeline.
            </p>
          </Link>

          <div className="p-6 bg-white dark:bg-gray-800 rounded-lg shadow">
            <h2 className="text-2xl font-semibold text-gray-500 dark:text-gray-400 mb-2">
              More Features
            </h2>
            <p className="text-gray-600 dark:text-gray-400">
              Additional features and demos coming soon. The platform includes
              user management, file processing, and more.
            </p>
          </div>
        </div>

        <div className="mt-16 text-center">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
            Platform Features
          </h3>
          <div className="flex flex-wrap justify-center gap-4 text-sm text-gray-600 dark:text-gray-400">
            <span className="px-3 py-1 bg-gray-100 dark:bg-gray-800 rounded-full">
              GraphQL API
            </span>
            <span className="px-3 py-1 bg-gray-100 dark:bg-gray-800 rounded-full">
              Vector Database
            </span>
            <span className="px-3 py-1 bg-gray-100 dark:bg-gray-800 rounded-full">
              LLM Integration
            </span>
            <span className="px-3 py-1 bg-gray-100 dark:bg-gray-800 rounded-full">
              Document Processing
            </span>
            <span className="px-3 py-1 bg-gray-100 dark:bg-gray-800 rounded-full">
              User Authentication
            </span>
          </div>
        </div>
      </main>
    </div>
  );
}
