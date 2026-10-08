/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import SiteHeader from "@/components/site/SiteHeader";
import SiteFooter from "@/components/site/SiteFooter";
import "./site.css";

const features = [
  {
    image: "Media.png",
    title: "Say Anything",
    description:
      "Share text, voice messages, photos, videos, GIFs and files for free. Signal uses your phone's data connection so you can avoid SMS and MMS fees.",
  },
  {
    image: "Calls.png",
    title: "Speak Freely",
    description:
      "Make crystal-clear voice and video calls to people who live across town, or across the ocean, with no long-distance charges.",
  },
  {
    image: "Stickers.png",
    title: "Make Privacy Stick",
    description:
      "Add a new layer of expression to your conversations with encrypted stickers. You can also create and share your own sticker packs.",
  },
  {
    image: "Groups.png",
    title: "Get Together with Groups",
    description:
      "Group chats make it easy to stay connected to your family, friends, and coworkers.",
  },
];

export default function Home() {
  return (
    <div className="signal-site">
      <SiteHeader />
      <main id="main-content">
        <section className="site-hero" aria-labelledby="hero-title">
          <div className="site-container site-hero-grid">
            <div className="site-hero-copy">
              <h1 id="hero-title">Speak Freely</h1>
              <p>
                Say &quot;hello&quot; to a different messaging experience. An
                unexpected focus on privacy, combined with all of the features
                you expect.
              </p>
              <Link className="site-button site-button-white" href="/download">
                Get Signal
              </Link>
            </div>
            <div className="site-phones">
              <img
                className="site-iphone"
                src="/signal/signal-iphone.png"
                width="600"
                height="1233"
                alt="A group video call in Signal on iPhone"
                fetchPriority="high"
              />
              <img
                className="site-pixel"
                src="/signal/signal-pixel.png"
                width="600"
                height="1196"
                alt="A Signal conversation on Android"
                fetchPriority="high"
              />
            </div>
          </div>
        </section>
        <section className="site-section site-why" aria-labelledby="why-title">
          <div className="site-container">
            <h2 id="why-title">Why use Signal?</h2>
            <p>
              Explore below to see why Signal is a simple, powerful, and secure
              messenger
            </p>
          </div>
        </section>
        <section
          className="site-section site-information"
          aria-labelledby="privacy-title"
        >
          <div className="site-container site-information-grid">
            <div className="site-information-art site-encryption">
              <img
                src="/signal/encryption.png"
                width="1200"
                height="1178"
                alt="An encrypted conversation sharing a photo of a mountain lake"
              />
            </div>
            <div className="site-information-copy">
              <h2 id="privacy-title">Share Without Insecurity</h2>
              <p>
                State-of-the-art end-to-end encryption (powered by the open
                source Signal Protocol) keeps your conversations secure. We
                can&apos;t read your messages or listen to your calls, and no
                one else can either. Privacy isn’t an optional mode — it’s just
                the way that Signal works. Every message, every call, every
                time.
              </p>
            </div>
          </div>
        </section>
        <section
          className="site-section site-features"
          aria-label="Signal features"
        >
          <div className="site-container site-feature-grid">
            {features.map((feature) => (
              <article className="site-feature-card" key={feature.title}>
                <img
                  src={`/signal/${feature.image}`}
                  width="740"
                  height={feature.image === "Stickers.png" ? "744" : "740"}
                  alt=""
                  loading="lazy"
                />
                <h3>{feature.title}</h3>
                <p>{feature.description}</p>
              </article>
            ))}
          </div>
        </section>
        <section
          className="site-section site-information"
          aria-labelledby="no-ads-title"
        >
          <div className="site-container site-information-grid">
            <div className="site-information-art">
              <img
                src="/signal/No-Ads.png"
                width="1504"
                height="1178"
                alt="Advertisements crossed out inside a circle"
                loading="lazy"
              />
            </div>
            <div className="site-information-copy">
              <h2 id="no-ads-title">No ads. No trackers. No kidding.</h2>
              <p>
                There are no ads, no affiliate marketers, and no creepy tracking
                in Signal. So focus on sharing the moments that matter with the
                people who matter to you.
              </p>
            </div>
          </div>
        </section>
        <section
          className="site-section site-information site-nonprofit"
          aria-labelledby="nonprofit-title"
        >
          <div className="site-container site-information-grid">
            <div className="site-information-art">
              <img
                src="/signal/Nonprofit503.png"
                width="1504"
                height="1178"
                alt="A globe with conversation bubbles connecting people around the world"
                loading="lazy"
              />
            </div>
            <div className="site-information-copy">
              <h2 id="nonprofit-title">Free for Everyone</h2>
              <p>
                Signal is an independent nonprofit. We&apos;re not tied to any
                major tech companies, and we can never be acquired by one
                either. Development is supported by grants and donations from
                people like you.
              </p>
              <a
                className="site-button site-button-outline"
                href="https://signal.org/donate/"
              >
                Donate to Signal
              </a>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
