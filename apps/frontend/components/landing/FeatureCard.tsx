import Link from "next/link";
import { ReactNode } from "react";

interface FeatureCardProps {
  readonly icon: ReactNode;
  readonly title: string;
  readonly description: string;
  readonly href?: string;
}

export function FeatureCard({
  icon,
  title,
  description,
  href,
}: FeatureCardProps) {
  const content = (
    <>
      <div className="w-12 h-12 bg-[#6f42c1]/10 dark:bg-[#6f42c1]/20 rounded-xl flex items-center justify-center mb-4 text-[#6f42c1]">
        {icon}
      </div>
      <h3 className="text-lg font-semibold text-[#222222] dark:text-white mb-2">
        {title}
      </h3>
      <p className="text-sm text-[#4d4d4d] dark:text-gray-300">{description}</p>
    </>
  );

  if (href) {
    return (
      <Link
        href={href}
        className="group block p-6 bg-white dark:bg-gray-800 rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] hover:shadow-[0_4px_16px_rgba(0,0,0,0.1)] transition-shadow"
      >
        {content}
      </Link>
    );
  }

  return (
    <div className="p-6 bg-white dark:bg-gray-800 rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.06)]">
      {content}
    </div>
  );
}
