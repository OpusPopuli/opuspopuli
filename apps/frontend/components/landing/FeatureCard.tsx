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
      <div className="w-12 h-12 bg-surface-alt/10 rounded-lg flex items-center justify-center mb-4 text-content-dim">
        {icon}
      </div>
      <h3 className="text-lg font-semibold text-content mb-2">{title}</h3>
      <p className="text-sm text-content-dim">{description}</p>
    </>
  );

  if (href) {
    return (
      <Link
        href={href}
        className="group block p-6 bg-surface rounded-lg transition-shadow"
      >
        {content}
      </Link>
    );
  }

  return <div className="p-6 bg-surface rounded-lg">{content}</div>;
}
