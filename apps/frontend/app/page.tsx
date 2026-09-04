import type { Metadata } from "next";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { CountyHero } from "@/components/landing/CountyHero";
import { CountyArgument } from "@/components/landing/CountyArgument";

export const metadata: Metadata = {
  title: {
    absolute: "Who governs your county? | Opus Populi",
  },
  description:
    "Every California county publishes what it takes to put a measure on its own ballot. Look up yours, and see who is already close enough to use it.",
};

/**
 * The landing page makes one argument, in order: here is your county and what
 * it costs (hero), why the county is the scale that matters, why a formal
 * right was never enough on its own, what the four costs actually are, and how
 * to check every figure on the page.
 *
 * The feature grid it replaces described the software. This describes the
 * problem the software exists for, which is what a reader who has never heard
 * of us needs first. Product surfaces are still one click away in the header
 * and the footer.
 */
export default function Home() {
  return (
    <div className="flex min-h-screen flex-col bg-surface">
      <Header />
      <main className="flex-1">
        <CountyHero />
        <CountyArgument />
      </main>
      <Footer />
    </div>
  );
}
