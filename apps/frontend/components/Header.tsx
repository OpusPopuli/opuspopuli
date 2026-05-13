"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";

export function Header() {
  const { user, isAuthenticated, logout, isLoading } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);

  const closeMenu = useCallback(() => setMenuOpen(false), []);

  // Close menu on Escape key
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === "Escape") setMenuOpen(false);
  }, []);

  useEffect(() => {
    if (menuOpen) {
      document.addEventListener("keydown", handleKeyDown);
      return () => document.removeEventListener("keydown", handleKeyDown);
    }
  }, [menuOpen, handleKeyDown]);

  const navLinkClass =
    "text-sm text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white transition-colors";

  function renderDesktopNav() {
    if (isLoading) {
      return <span className="text-sm text-gray-400">Loading...</span>;
    }
    if (isAuthenticated && user) {
      return (
        <>
          <Link href="/region" className={navLinkClass}>
            Region
          </Link>
          <Link href="/petition" className={navLinkClass}>
            Petitions
          </Link>
          <Link
            href="/settings"
            className="text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white transition-colors"
            aria-label="Profile settings"
            title={user.email}
          >
            <svg
              className="w-6 h-6"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5.121 17.804A13.937 13.937 0 0112 16c2.5 0 4.847.655 6.879 1.804M15 10a3 3 0 11-6 0 3 3 0 016 0zm6 2a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </Link>
          <button
            onClick={logout}
            className="text-sm px-4 py-2 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white transition-colors"
          >
            Sign out
          </button>
        </>
      );
    }
    return (
      <>
        <Link href="/transparency" className={navLinkClass}>
          Transparency
        </Link>
        <Link href="/login" className={navLinkClass}>
          Sign in
        </Link>
        <Link
          href="/register"
          className="text-sm px-4 py-2 bg-[#5A7A6A] text-white rounded-md hover:bg-[#4A6A5A] transition-colors"
        >
          Get started
        </Link>
      </>
    );
  }

  function renderMobileNav() {
    if (isLoading) {
      return <span className="text-sm text-gray-400">Loading...</span>;
    }
    if (isAuthenticated && user) {
      return (
        <>
          <Link href="/region" className={navLinkClass} onClick={closeMenu}>
            Region
          </Link>
          <Link href="/petition" className={navLinkClass} onClick={closeMenu}>
            Petitions
          </Link>
          <Link
            href="/settings"
            className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white transition-colors"
            onClick={closeMenu}
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5.121 17.804A13.937 13.937 0 0112 16c2.5 0 4.847.655 6.879 1.804M15 10a3 3 0 11-6 0 3 3 0 016 0zm6 2a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            Profile
          </Link>
          <button
            onClick={() => {
              closeMenu();
              logout();
            }}
            className="text-sm text-left text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white transition-colors"
          >
            Sign out
          </button>
        </>
      );
    }
    return (
      <>
        <Link href="/transparency" className={navLinkClass} onClick={closeMenu}>
          Transparency
        </Link>
        <Link href="/login" className={navLinkClass} onClick={closeMenu}>
          Sign in
        </Link>
        <Link
          href="/register"
          className="text-sm px-4 py-2 bg-[#5A7A6A] text-white rounded-md hover:bg-[#4A6A5A] transition-colors text-center"
          onClick={closeMenu}
        >
          Get started
        </Link>
      </>
    );
  }

  return (
    <header className="border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
      <div className="max-w-6xl mx-auto px-8 py-4 flex items-center justify-between">
        <Link
          href="/"
          className="text-xl font-bold text-gray-900 dark:text-white hover:text-[#5A7A6A] dark:hover:text-[#A3BEB0] transition-colors"
        >
          Opus Populi
        </Link>

        {/* Desktop nav */}
        <nav className="hidden md:flex items-center gap-4">
          {renderDesktopNav()}
        </nav>

        {/* Mobile hamburger button */}
        <button
          type="button"
          className="md:hidden p-2 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white"
          onClick={() => setMenuOpen(!menuOpen)}
          aria-expanded={menuOpen}
          aria-controls="mobile-menu"
          aria-label={menuOpen ? "Close menu" : "Open menu"}
        >
          {menuOpen ? (
            <svg
              className="w-6 h-6"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          ) : (
            <svg
              className="w-6 h-6"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 6h16M4 12h16M4 18h16"
              />
            </svg>
          )}
        </button>
      </div>

      {/* Mobile menu */}
      {menuOpen && (
        <nav
          id="mobile-menu"
          className="md:hidden border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 animate-layer-enter"
        >
          <div className="max-w-6xl mx-auto px-8 py-4 flex flex-col gap-3">
            {renderMobileNav()}
          </div>
        </nav>
      )}
    </header>
  );
}
