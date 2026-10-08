"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useSession } from "@/stores/session";
import {
  Avatar,
  Button,
  ErrorText,
  Icon,
  IconButton,
  Spinner,
  errorMessage,
} from "@/components/ui";
import ProfileEditor from "@/components/ProfileEditor";

const demos = [
  { name: "Alex Rivera", phone: "+15550000001", color: "A110" },
  { name: "Priya Sharma", phone: "+15550000002", color: "A150" },
  { name: "Marcus Chen", phone: "+15550000003", color: "A130" },
];

export default function Login() {
  const router = useRouter();
  const status = useSession((s) => s.status);
  const me = useSession((s) => s.me);
  const sessionError = useSession((s) => s.error);
  const [phone, setPhone] = useState("+15550000001");
  const [code, setCode] = useState("");
  const [devCode, setDevCode] = useState("");
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (status === "authenticated" && me?.display_name) router.replace("/chats");
  }, [status, me?.display_name, router]);
  async function requestCode(event?: FormEvent) {
    event?.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await api.auth.requestOtp(phone);
      setPhone(result.phone);
      setDevCode(result.dev_code);
      setCode("");
      setStep("code");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function verify(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await api.auth.verify(phone, code);
      useSession.getState().signIn(result.token, result.user);
      if (!result.is_new) router.replace("/chats");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="login-page">
      <div className="login-brand">
        <span className="signal-mark">
          <Icon name="chat" size={28} />
        </span>
        <span>
          Signal<span className="brand-clone">LOCAL EDITION</span>
        </span>
      </div>
      <section className="login-story">
        <span className="login-eyebrow">A LITTLE MORE CONNECTION.</span>
        <h1>
          Keep your
          <br />
          people close.
        </h1>
        <p>
          A familiar place for your everyday conversations.
          <br />
          Make plans, share moments, stay in touch.
        </p>
        <div className="login-art" aria-hidden="true">
          <div className="art-card art-card-one">
            <span className="art-avatar">P</span>
            <span>
              Same time tomorrow?
              <small>
                just now <Icon name="double-check" size={14} />
              </small>
            </span>
          </div>
          <div className="art-card art-card-two">
            <span>
              Wouldn’t miss it ☀️
              <small>
                10:42 <Icon name="double-check" size={14} />
              </small>
            </span>
          </div>
          <div className="art-orbit" />
          <div className="art-heart">♥</div>
        </div>
        <div className="login-local">
          <Icon name="shield" size={18} />
          Runs on your local server · Demo verification
        </div>
      </section>
      <section className="login-card">
        {status === "loading" ||
        (status === "authenticated" && me?.display_name) ? (
          <div className="login-loading">
            <Spinner />
            <p>Getting things ready…</p>
          </div>
        ) : status === "unavailable" ? (
          <>
            <h2>Let’s reconnect</h2>
            <p>Your saved session is waiting for the server.</p>
            <ErrorText>{sessionError}</ErrorText>
            <Button onClick={() => void useSession.getState().restore()}>
              Try again
            </Button>
          </>
        ) : status === "authenticated" && me ? (
          <>
            <span className="login-eyebrow">MAKE YOURSELF AT HOME</span>
            <h2>Your profile</h2>
            <p>Give your conversations a name and a face.</p>
            <ProfileEditor onboarding onSaved={() => router.replace("/chats")} />
          </>
        ) : step === "phone" ? (
          <>
            <span className="login-eyebrow">WELCOME TO SIGNAL</span>
            <h2>Let’s get started</h2>
            <p>Enter your phone number to sign in or create an account.</p>
            <form onSubmit={requestCode}>
              <label className="ui-field">
                Phone number
                <input
                  type="tel"
                  required
                  autoComplete="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+1 555 000 0001"
                  disabled={busy}
                />
                <small>Include your country code.</small>
              </label>
              <ErrorText>{error}</ErrorText>
              <Button
                type="submit"
                disabled={busy || !phone.trim()}
                className="login-submit"
              >
                {busy ? <Spinner /> : null}Continue
                <Icon name="arrow-right" size={18} />
              </Button>
            </form>
            <div className="login-divider">
              <span>OR TRY A DEMO ACCOUNT</span>
            </div>
            <div className="demo-accounts">
              {demos.map((demo) => (
                <button
                  key={demo.phone}
                  type="button"
                  aria-pressed={phone === demo.phone}
                  className={phone === demo.phone ? "selected" : ""}
                  disabled={busy}
                  onClick={() => setPhone(demo.phone)}
                >
                  <Avatar name={demo.name} color={demo.color} size={35} />
                  <span>{demo.name.split(" ")[0]}</span>
                </button>
              ))}
            </div>
            <p className="login-disclaimer">
              This is a local Signal-inspired project. No SMS is sent and
              messages are not end-to-end encrypted.
            </p>
          </>
        ) : (
          <>
            <IconButton
              name="arrow-left"
              label="Change phone number"
              onClick={() => {
                setStep("phone");
                setError("");
              }}
            />
            <h2>Verify your number</h2>
            <p>
              Signing in as <strong>{phone}</strong>.
            </p>
            <div className="demo-code">
              <Icon name="info" />
              <span>
                Demo verification code<strong>{devCode}</strong>
              </span>
            </div>
            <form onSubmit={verify}>
              <label className="ui-field">
                Verification code
                <input
                  className="otp-input"
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  autoComplete="one-time-code"
                  maxLength={6}
                  required
                  autoFocus
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                  placeholder="000000"
                  disabled={busy}
                />
              </label>
              <ErrorText>{error}</ErrorText>
              <Button
                className="login-submit"
                type="submit"
                disabled={busy || code.length !== 6}
              >
                {busy ? <Spinner /> : null}Verify and continue
              </Button>
              <button
                className="text-button"
                type="button"
                disabled={busy}
                onClick={() => void requestCode()}
              >
                Request code again
              </button>
            </form>
          </>
        )}
      </section>
      <footer className="login-footer">
        Thoughtful conversations, one message at a time.
      </footer>
    </main>
  );
}
