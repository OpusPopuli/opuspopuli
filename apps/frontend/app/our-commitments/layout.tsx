import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Our Public Commitments | Opus Populi",
  description:
    "Opus Populi's binding public commitments to citizens on data ethics, privacy, and political neutrality. Incorporated by reference into our Terms of Service.",
};

export default function OurCommitmentsLayout({
  children,
}: {
  children: ReactNode;
}) {
  return <>{children}</>;
}
