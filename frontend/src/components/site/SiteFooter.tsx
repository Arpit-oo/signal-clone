import Link from "next/link";

const groups = [
  {
    title: "Organization",
    links: [
      ["Donate", "https://signal.org/donate/"],
      ["Careers", "https://signal.org/workworkwork/"],
      ["Blog", "https://signal.org/blog/"],
      ["Brand Assets", "https://signal.org/brand/"],
      ["Terms & Privacy Policy", "https://signal.org/legal/"],
    ],
  },
  {
    title: "Download",
    links: [
      ["Android", "https://signal.org/download/android/"],
      ["iPhone & iPad", "https://signal.org/download/ios/"],
      ["Windows", "https://signal.org/download/windows/"],
      ["Mac", "https://signal.org/download/macos/"],
      ["Linux", "https://signal.org/download/linux/"],
    ],
  },
  {
    title: "Social",
    links: [
      ["Bluesky", "https://bsky.app/profile/signal.org"],
      ["GitHub", "https://github.com/signalapp"],
      ["Instagram", "https://www.instagram.com/signal_app/"],
      ["Mastodon", "https://mastodon.world/@signalapp"],
      ["X", "https://x.com/signalapp"],
    ],
  },
  {
    title: "Help",
    links: [
      ["Support Center", "https://support.signal.org/"],
      ["Community", "https://community.signalusers.org/"],
    ],
  },
];

export default function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-container site-footer-grid">
        <div className="site-copyright">
          <p>
            © 2013–2026 Signal, a 501c3 nonprofit.
            <br />
            &quot;Signal&quot;, Signal logos, and other trademarks are
            trademarks or registered trademarks of Signal Technology Foundation
            in the United States and other countries (
            <a href="https://signal.org/brand/">more info here</a>).
          </p>
          <p>
            For media inquiries, contact{" "}
            <a href="mailto:press@signal.org">press@signal.org</a>
          </p>
          <nav className="site-footer-product" aria-label="Messenger links">
            <Link href="/chats">Open messenger</Link>
            <Link href="/login">Sign in</Link>
            <Link href="/signup">Create account</Link>
          </nav>
        </div>
        {groups.map((group) => (
          <div key={group.title}>
            <strong>{group.title}</strong>
            <ul>
              {group.links.map(([label, href]) => (
                <li key={label}>
                  <a href={href}>{label}</a>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </footer>
  );
}
