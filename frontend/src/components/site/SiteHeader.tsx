"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

const links = [
  ["Get Signal", "/download"],
  ["Help", "https://support.signal.org/"],
  ["Blog", "https://signal.org/blog/"],
  ["Developers", "https://signal.org/docs/"],
  ["Careers", "https://signal.org/workworkwork/"],
  ["Donate", "https://signal.org/donate/"],
] as const;

const messengerLinks = [
  ["Open messenger", "/chats"],
  ["Sign in", "/login"],
  ["Create account", "/signup"],
] as const;

const languages = [
  ["Afrikaans", "af"],
  ["العربية", "ar"],
  ["Azərbaycanca", "az"],
  ["Bahasa Indonesia", "id"],
  ["Bahasa Melayu", "ms"],
  ["Български", "bg"],
  ["বাংলা", "bn"],
  ["Bosanski", "bs"],
  ["Català", "ca"],
  ["Česky", "cs"],
  ["Dansk", "da"],
  ["Deutsch", "de"],
  ["ελληνικά", "el"],
  ["English", "en"],
  ["Español", "es"],
  ["Eesti", "et"],
  ["Euskera", "eu"],
  ["فارسی", "fa"],
  ["Filipino", "fil"],
  ["Français", "fr"],
  ["Gaeilge", "ga"],
  ["Galego", "gl"],
  ["ગુજરાતી", "gu"],
  ["עברית", "he"],
  ["हिन्दी", "hi"],
  ["Hrvatski", "hr"],
  ["Italiano", "it"],
  ["ქართული", "ka"],
  ["Қазақша", "kk"],
  ["Кыргызча", "ky"],
  ["ಕನ್ನಡ", "kn"],
  ["ខ្មែរ", "km"],
  ["한국어", "ko"],
  ["Lietuviškai", "lt"],
  ["Latviešu", "lv"],
  ["Magyar", "hu"],
  ["Македонски", "mk"],
  ["മലയാളം", "ml"],
  ["मराठी", "mr"],
  ["မြန်မာ", "my"],
  ["日本語", "ja"],
  ["Norsk", "nb"],
  ["Nederlands", "nl"],
  ["Polski", "pl"],
  ["Português (Brasil)", "pt_BR"],
  ["Português (Portugal)", "pt_PT"],
  ["ਪੰਜਾਬੀ", "pa"],
  ["Română", "ro"],
  ["Pусский", "ru"],
  ["Slovenčina", "sk"],
  ["Slovenščina", "sl"],
  ["Shqip", "sq"],
  ["Српски", "sr"],
  ["Suomi", "fi"],
  ["Svenska", "sv"],
  ["Kiswahili", "sw"],
  ["தமிழ்", "ta"],
  ["తెలుగు", "te"],
  ["Українська", "uk"],
  ["اردو", "ur"],
  ["ئۇيغۇرچە", "ug"],
  ["ภาษาไทย", "th"],
  ["Tiếng Việt", "vi"],
  ["Türkçe", "tr"],
  ["廣東話 (香港)", "zh_YU"],
  ["简体中文", "zh_CN"],
  ["繁體中文", "zh_HK"],
] as const;

export default function SiteHeader() {
  const [menuOpen, setMenuOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const languageButton = useRef<HTMLButtonElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && menuOpen) {
        setMenuOpen(false);
        menuButton.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  return (
    <>
      <a className="site-skip-link" href="#main-content">
        Skip to content
      </a>
      <header className="site-header">
        <div className="site-container site-header-inner">
          <Link href="/" className="site-brand" aria-label="Signal home">
            {/* Exact reference assets are served locally at their original proportions. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/signal/logo.png" width="462" height="132" alt="Signal" />
          </Link>
          <button
            ref={menuButton}
            className="site-menu-toggle"
            aria-label={menuOpen ? "Close navigation" : "Open navigation"}
            aria-expanded={menuOpen}
            aria-controls="site-navigation"
            onClick={() => setMenuOpen(!menuOpen)}
          >
            <span />
            <span />
            <span />
          </button>
          <nav
            id="site-navigation"
            aria-label="Main navigation"
            className={menuOpen ? "site-nav is-open" : "site-nav"}
          >
            {links.map(([label, href]) =>
              href.startsWith("/") ? (
                <Link
                  key={label}
                  href={href}
                  className="site-reference-link"
                  onClick={() => setMenuOpen(false)}
                >
                  {label}
                </Link>
              ) : (
                <a
                  key={label}
                  href={href}
                  className={
                    label === "Developers" || label === "Careers"
                      ? "site-reference-link site-reference-extra"
                      : "site-reference-link"
                  }
                >
                  {label}
                </a>
              ),
            )}
            <div className="site-product-links">
              {messengerLinks.map(([label, href]) => (
                <Link
                  key={href}
                  href={href}
                  className={href === "/signup" ? "site-nav-signup" : undefined}
                  onClick={() => setMenuOpen(false)}
                >
                  {label}
                </Link>
              ))}
            </div>
            <button
              ref={languageButton}
              className="site-language-button"
              onClick={() => dialog.current?.showModal()}
              aria-haspopup="dialog"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                aria-hidden="true"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
              >
                <circle cx="12" cy="12" r="9" />
                <ellipse cx="12" cy="12" rx="4" ry="9" />
                <path d="M3 12h18M5 6.5h14M5 17.5h14" />
              </svg>
              English
            </button>
          </nav>
        </div>
      </header>
      <dialog
        className="site-language-dialog"
        ref={dialog}
        aria-labelledby="site-language-title"
        onClose={() => languageButton.current?.focus()}
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            const bounds = event.currentTarget.getBoundingClientRect();
            if (
              event.clientX < bounds.left ||
              event.clientX > bounds.right ||
              event.clientY < bounds.top ||
              event.clientY > bounds.bottom
            )
              dialog.current?.close();
          }
        }}
      >
        <div className="site-language-heading">
          <h2 id="site-language-title">Select your language</h2>
          <button
            autoFocus
            aria-label="Close language selector"
            onClick={() => dialog.current?.close()}
          >
            ×
          </button>
        </div>
        <div className="site-language-list">
          {languages.map(([label, code]) =>
            code === "en" ? (
              <Link
                href="/"
                key={code}
                lang={code}
                aria-current="true"
                onClick={() => {
                  dialog.current?.close();
                  setMenuOpen(false);
                }}
              >
                {label}
              </Link>
            ) : (
              <a
                key={code}
                lang={code.replace("_", "-")}
                href={`https://signal.org/${code}/`}
              >
                {label}
              </a>
            ),
          )}
        </div>
      </dialog>
    </>
  );
}
