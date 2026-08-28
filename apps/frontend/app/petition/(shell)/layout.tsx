"use client";

import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";

/**
 * Normal app chrome for the petition pages that are not the camera (#1073).
 *
 * A route group rather than a shared parent layout, because `/petition/capture`
 * must NOT have a header and footer. Putting them on `app/petition/layout.tsx`
 * would render them behind the camera's `fixed inset-0` overlay — invisible,
 * but still in the DOM, still in the tab order, and still read out by a screen
 * reader on top of the viewfinder.
 *
 * The group changes nothing about the URLs: `(shell)/page.tsx` is still
 * `/petition` and `(shell)/results` is still `/petition/results`.
 *
 * `/petition/map` stays outside it too — it paints its own full-screen chrome —
 * as do the `/petition/history` routes, which only redirect.
 */
export default function PetitionShellLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <>
      <Header />
      {children}
      <Footer />
    </>
  );
}
