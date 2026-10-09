"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { authRoute, routes } from "@/lib/routes";
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
import "@/app/auth.css";

const demos = [
  {
    name: "Alex Rivera",
    phone: "+15550000001",
    color: "A110",
    avatar: "/api/demo-avatars/alex-v1.jpg",
  },
  {
    name: "Priya Sharma",
    phone: "+919876540102",
    color: "A150",
    avatar: "/api/demo-avatars/priya-v1.jpg",
  },
  {
    name: "Marcus Chen",
    phone: "+15550000003",
    color: "A130",
    avatar: "/api/demo-avatars/marcus-v1.jpg",
  },
];

export default function AuthScreen({
  mode,
  nextPath,
}: {
  mode: "login" | "signup";
  nextPath: string;
}) {
  const router = useRouter();
  const status = useSession((s) => s.status);
  const me = useSession((s) => s.me);
  const sessionError = useSession((s) => s.error);
  const [phone, setPhone] = useState("");
  const [countryCode, setCountryCode] = useState("+91");
  const [code, setCode] = useState("");
  const [devCode, setDevCode] = useState("");
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const creatingAccount = mode === "signup";

  useEffect(() => {
    if (mode === "login" && status === "authenticated" && me?.display_name)
      router.replace(nextPath);
  }, [mode, status, me?.display_name, router, nextPath]);

  async function requestCode(event?: FormEvent) {
    event?.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await api.auth.requestOtp(phone, countryCode);
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
      if (!result.is_new) router.replace(nextPath);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const profileStep = status === "authenticated" && me && !me.display_name;
  return (
    <main className="login-page">
      <Link
        className="login-brand auth-brand"
        href={routes.home}
        aria-label="Signal home"
      >
        <span className="signal-mark" aria-hidden="true">
          <span className="auth-signal-logo" />
        </span>
        <span>Signal</span>
      </Link>
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
          Your account. Your conversations.
        </div>
      </section>
      <section
        className={`login-card ${profileStep ? "auth-profile-card" : ""}`}
        aria-busy={busy || status === "loading"}
      >
        {status === "loading" ||
        (mode === "login" && status === "authenticated" && me?.display_name) ? (
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
        ) : status === "authenticated" && me?.display_name ? (
          <>
            <h2>You’re already signed in</h2>
            <p>
              Continue as {me.display_name}, or create an account with another
              number.
            </p>
            <Button
              className="login-submit"
              onClick={() => router.replace(nextPath)}
            >
              Open my conversations
            </Button>
            <Button
              className="login-submit"
              variant="secondary"
              onClick={() => useSession.getState().signOut("signup")}
            >
              Use another number
            </Button>
          </>
        ) : profileStep ? (
          <>
            <span className="login-eyebrow">YOUR ACCOUNT IS READY</span>
            <h2>Your profile</h2>
            <p>Add your name and a photo. A username helps friends find you.</p>
            <ProfileEditor
              onboarding
              onSaved={() => router.replace(nextPath)}
            />
          </>
        ) : step === "phone" ? (
          <>
            <nav className="auth-switch" aria-label="Account access">
              <Link
                href={authRoute("login", nextPath)}
                aria-current={!creatingAccount ? "page" : undefined}
              >
                Sign in
              </Link>
              <Link
                href={authRoute("signup", nextPath)}
                aria-current={creatingAccount ? "page" : undefined}
              >
                Create account
              </Link>
            </nav>
            <h2>{creatingAccount ? "Create your account" : "Welcome back"}</h2>
            <p>
              {creatingAccount
                ? "Use your own phone number, then choose your name and profile photo."
                : "Enter your phone number to open your conversations."}
            </p>
            <form
              onSubmit={requestCode}
              aria-label={creatingAccount ? "Create account" : "Sign in"}
            >
              <div className="auth-phone-fields">
                <label className="ui-field">
                  Country code
                  <input
                    type="tel"
                    autoComplete="tel-country-code"
                    value={countryCode}
                    onChange={(event) => setCountryCode(event.target.value)}
                    pattern="\+?[1-9][0-9]{0,2}"
                    maxLength={4}
                    required
                    disabled={busy}
                    placeholder="+91"
                    title="Enter a country code, such as +91 or +1"
                  />
                </label>
                <label className="ui-field">
                  Phone number
                  <input
                    type="tel"
                    required
                    autoComplete="tel"
                    aria-describedby="auth-phone-hint"
                    value={phone}
                    maxLength={32}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="98770 32297"
                    disabled={busy}
                  />
                </label>
              </div>
              <small id="auth-phone-hint" className="auth-phone-hint">
                Enter your local number with the country code above, or paste a
                full + international number. An existing number opens its
                account.
              </small>
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
            {!creatingAccount && (
              <>
                <div className="login-divider">
                  <h3>Try a demo account</h3>
                </div>
                <p id="auth-demo-hint" className="auth-demo-hint">
                  Choose a profile, then Continue. No SMS is sent; the next
                  screen shows the code to enter.
                </p>
                <div
                  className="demo-accounts"
                  role="group"
                  aria-label="Demo accounts"
                  aria-describedby="auth-demo-hint"
                >
                  {demos.map((demo) => (
                    <button
                      key={demo.phone}
                      type="button"
                      aria-label={demo.name}
                      aria-pressed={phone === demo.phone}
                      className={phone === demo.phone ? "selected" : ""}
                      disabled={busy}
                      onClick={() => {
                        setPhone(demo.phone);
                        setError("");
                      }}
                    >
                      <Avatar
                        name={demo.name}
                        color={demo.color}
                        url={demo.avatar}
                        size={35}
                      />
                      <span>{demo.name.split(" ")[0]}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
            <p className="login-disclaimer">
              Phone verification is simulated: no SMS is sent. The next screen
              shows your verification code. Messages are stored without
              end-to-end encryption. On the free hosted demo, accounts, messages
              and uploads may reset after a server restart.
            </p>
            <p className="auth-other-account">
              {creatingAccount ? "Already have an account? " : "New here? "}
              <Link
                href={authRoute(creatingAccount ? "login" : "signup", nextPath)}
              >
                {creatingAccount ? "Sign in" : "Create an account"}
              </Link>
            </p>
          </>
        ) : (
          <>
            <IconButton
              name="arrow-left"
              label="Change phone number"
              disabled={busy}
              onClick={() => {
                setStep("phone");
                setError("");
                setCode("");
              }}
            />
            <h2>Verify your number</h2>
            <p>
              Continue with <strong>{phone}</strong>.
            </p>
            <div className="demo-code">
              <Icon name="info" />
              <span>
                Mock verification code<strong>{devCode}</strong>
                <small>No SMS is sent. Enter the code above to continue.</small>
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
        <Link href={routes.home}>Home</Link>
        <span>Thoughtful conversations, one message at a time.</span>
      </footer>
    </main>
  );
}
