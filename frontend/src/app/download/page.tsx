import type { Metadata } from "next";
import Link from "next/link";
import SiteHeader from "@/components/site/SiteHeader";
import SiteFooter from "@/components/site/SiteFooter";
import "../site.css";

export const metadata: Metadata = { title: "Get Signal" };

export default function Download() {
  return (
    <div className="signal-site">
      <SiteHeader />
      <main id="main-content" className="site-download">
        <div className="site-container">
          <div className="site-download-heading">
            <h1>Get Signal</h1>
            <p>Stay connected. Choose where you’d like to start.</p>
          </div>
          <div className="site-download-grid">
            <section className="site-download-card">
              <h2>Try the web messenger</h2>
              <p>
                Open this project’s messenger to send messages, share files, and
                make a group with the demo accounts.
              </p>
              <Link className="site-button site-button-white" href="/chats">
                Open web messenger
              </Link>
              <small>
                This is an independent Signal-inspired demo. Verification code:{" "}
                <strong>123456</strong>. No SMS is sent. Messages are stored on
                the local server without end-to-end encryption. Calling and
                device linking are not available.
              </small>
            </section>
            <section className="site-download-card">
              <h2>Download Signal</h2>
              <p>Get the official Signal app for your phone or computer.</p>
              <div className="site-platform-links">
                {[
                  ["Android", "android"],
                  ["iPhone & iPad", "ios"],
                  ["Windows", "windows"],
                  ["Mac", "macos"],
                  ["Linux", "linux"],
                ].map(([label, platform]) => (
                  <a
                    key={platform}
                    href={`https://signal.org/download/${platform}/`}
                  >
                    {label}
                  </a>
                ))}
              </div>
              <small>
                These links take you to the official Signal website.
              </small>
            </section>
          </div>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
