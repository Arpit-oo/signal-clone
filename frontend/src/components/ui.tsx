"use client";

import {
  useEffect,
  useEffectEvent,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
  type SVGProps,
} from "react";
import { fileUrl } from "@/lib/api";
import { AVATAR_COLORS, AVATAR_FOREGROUNDS } from "@/lib/avatarColors";
export { AVATAR_COLORS } from "@/lib/avatarColors";

const paths: Record<string, ReactNode> = {
  "arrow-left": <path d="m14 5-7 7 7 7M7 12h14" />,
  "arrow-right": <path d="m10 5 7 7-7 7M17 12H3" />,
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m16 16 5 5" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6m0-10v.1" />
    </>
  ),
  more: (
    <>
      <circle cx="5" cy="12" r="1" />
      <circle cx="12" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
    </>
  ),
  close: <path d="m6 6 12 12M6 18 18 6" />,
  "chevron-down": <path d="m6 9 6 6 6-6" />,
  "chevron-up": <path d="m6 15 6-6 6 6" />,
  "chevron-right": <path d="m9 6 6 6-6 6" />,
  "chevron-left": <path d="m15 6-6 6 6 6" />,
  reply: <path d="m9 5-7 6 7 6v-4c7 0 10 2 13 7-1-9-5-13-13-13V5Z" />,
  edit: (
    <>
      <path d="m16 3 5 5-12 12-6 1 1-6L16 3Zm-2 2 5 5" />
      <path d="M13 21h8" />
    </>
  ),
  trash: (
    <>
      <path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7" />
    </>
  ),
  forward: <path d="m15 5 7 6-7 6v-4c-7 0-10 2-13 7C3 11 7 7 15 7V5Z" />,
  smile: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 14a4 4 0 0 0 8 0M8 9h.01M16 9h.01" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  attachment: (
    <path d="m9 13 6-6a3 3 0 0 1 4 4l-8 8a5 5 0 0 1-7-7l9-9a2 2 0 0 1 3 3l-9 9" />
  ),
  mic: (
    <>
      <rect x="9" y="2" width="6" height="13" rx="3" />
      <path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8" />
    </>
  ),
  "mic-off": <><path d="M9 5V4a3 3 0 0 1 6 0v6M5 10v2a7 7 0 0 0 12 5M19 10v2M12 19v3M8 22h8M3 3l18 18" /></>,
  phone: <path d="m5 3 4 5-2 3a14 14 0 0 0 6 6l3-2 5 4-2 3C9 22 2 15 2 5l3-2Z" />,
  video: <><rect x="3" y="5" width="13" height="14" rx="3" /><path d="m16 9 5-3v12l-5-3" /></>,
  "video-off": <><path d="M3 3l18 18M3 7v10a2 2 0 0 0 2 2h9M8 5h6a2 2 0 0 1 2 2v6m0-4 5-3v12" /></>,
  send: <path d="m3 3 19 9-19 9 4-9-4-9Zm4 9h15" />,
  check: <path d="m5 12 4 4L19 6" />,
  "double-check": (
    <>
      <path d="m2 12 4 4L16 6m-5 9 2 2L23 7" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  file: (
    <>
      <path d="M14 2H5v20h14V7l-5-5Zm0 0v5h5M8 12h8m-8 4h5" />
    </>
  ),
  note: (
    <>
      <rect x="5" y="2" width="14" height="20" rx="2" />
      <path d="M8 7h8M8 11h8M8 15h8M8 19h5" />
    </>
  ),
  download: <path d="M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4" />,
  play: <path d="m8 4 12 8-12 8V4Z" />,
  pause: (
    <>
      <path d="M7 4v16M17 4v16" strokeWidth="4" />
    </>
  ),
  stop: <rect x="6" y="6" width="12" height="12" rx="1" />,
  shield: <path d="M12 2 3 6v6c0 5 9 10 9 10s9-5 9-10V6l-9-4Zm-4 10 3 3 5-6" />,
  alert: (
    <>
      <path d="m12 3 10 18H2L12 3Zm0 6v5m0 3v.1" />
    </>
  ),
  copy: (
    <>
      <rect x="8" y="8" width="13" height="13" rx="2" />
      <path d="M16 8V3H3v13h5" />
    </>
  ),
  chat: <path d="M21 11a9 9 0 0 1-9 9H7l-5 2 2-5v-6a9 9 0 0 1 17 0Z" />,
  "chat-filled": (
    <path
      fill="currentColor"
      stroke="none"
      d="M12 2a10 10 0 0 0-8.8 14.7L2 22l5.3-1.2A10 10 0 1 0 12 2Z"
    />
  ),
  stories: (
    <>
      <rect x="8" y="3" width="12" height="18" rx="3" />
      <path d="m6 5-2 1c-1 .3-1.5 1.3-1.2 2.4l2.8 10" />
    </>
  ),
  "stories-filled": (
    <>
      <rect
        x="8"
        y="3"
        width="12"
        height="18"
        rx="3"
        fill="currentColor"
        stroke="none"
      />
      <path d="m6 5-2 1c-1 .3-1.5 1.3-1.2 2.4l2.8 10" />
    </>
  ),
  compose: (
    <>
      <path d="M20 13v7H4V4h7m3 10-5 1 1-5 8-8 4 4-8 8Z" />
    </>
  ),
  settings: (
    <>
      <path d="m9 3-1 3-3 1-2 3 2 2-1 3 2 3 3-1 3 2 3-2 3 1 2-3-1-3 2-2-2-3-3-1-1-3H9Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  archive: (
    <>
      <path d="M3 3h18v5H3V3Zm2 5v13h14V8M9 12h6" />
    </>
  ),
  pin: <path d="m8 3 8 2-1 5 4 5-8-1-5 3 1-7 1-7Zm3 11-3 8" />,
  bell: (
    <>
      <path d="M18 8a6 6 0 0 0-12 0c0 8-3 8-3 10h18c0-2-3-2-3-10M10 21h4" />
    </>
  ),
  "bell-off": (
    <>
      <path d="M18 8a6 6 0 0 0-6-6M7 4a6 6 0 0 0-1 4c0 8-3 8-3 10h14m-7 3h4M3 3l18 18" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="7" r="4" />
      <path d="M2 21v-3a7 7 0 0 1 14 0v3M17 3a4 4 0 0 1 0 8m1 3a6 6 0 0 1 4 6" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="7" r="4" />
      <path d="M4 21v-3a8 8 0 0 1 16 0v3" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="10" width="14" height="11" rx="2" />
      <path d="M8 10V6a4 4 0 0 1 8 0v4m-4 4v3" />
    </>
  ),
  logout: (
    <>
      <path d="M9 3H3v18h6M9 12h13m-5-5 5 5-5 5" />
    </>
  ),
  image: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8" cy="8" r="1.5" />
      <path d="m3 17 5-5 4 4 4-6 5 7" />
    </>
  ),
  moon: <path d="M21 13a9 9 0 0 1-10-10 9 9 0 1 0 10 10Z" />,
  block: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m6 6 12 12" />
    </>
  ),
};

const openDialogs: symbol[] = [];

export function Icon({
  name,
  size = 20,
  ...props
}: SVGProps<SVGSVGElement> & { name: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {paths[name] ?? paths.info}
    </svg>
  );
}

/* Protected local avatar URLs are intentionally loaded without the Next image optimizer. */
/* eslint-disable @next/next/no-img-element */
export function Avatar({
  name,
  color = "A110",
  url,
  size = 44,
}: {
  name: string;
  color?: string;
  url?: string | null;
  size?: number;
}) {
  const initials =
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0])
      .join("")
      .toUpperCase() || "?";
  return (
    <span
      className="ui-avatar"
      style={{
        width: size,
        height: size,
        backgroundColor: AVATAR_COLORS[color] ?? AVATAR_COLORS.A110,
        color: AVATAR_FOREGROUNDS[color] ?? AVATAR_FOREGROUNDS.A110,
        fontSize: Math.max(12, size * 0.36),
      }}
    >
      {url ? (
        <img
          key={url}
          src={fileUrl(url)}
          alt=""
          onError={(e) => {
            e.currentTarget.style.display = "none";
          }}
        />
      ) : null}
      <span>{initials}</span>
    </span>
  );
}

export function IconButton({
  name,
  label,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { name: string; label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`ui-icon-button ${className}`}
      {...props}
    >
      <Icon name={name} />
    </button>
  );
}

export function Button({
  children,
  variant = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger";
}) {
  return (
    <button
      type="button"
      className={`ui-button ui-button-${variant} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
export const ActionButton = Button;
export function Spinner({ label = "Loading" }: { label?: string }) {
  return <span className="ui-spinner" role="status" aria-label={label} />;
}
export function ErrorText({ children }: { children?: ReactNode }) {
  return children ? (
    <p className="ui-error" role="alert">
      <Icon name="alert" size={16} />
      {children}
    </p>
  ) : null;
}

export function Modal({
  title,
  onClose,
  children,
  className = "",
  dismissible = true,
  role = "dialog",
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  dismissible?: boolean;
  role?: "dialog" | "alertdialog";
}) {
  const titleId = useId();
  const ref = useRef<HTMLDivElement>(null);
  const [leaving, setLeaving] = useState(false);
  const closingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeCallback = useRef(onClose);
  useEffect(() => { closeCallback.current = onClose; }, [onClose]);
  const close = () => {
    if (!dismissible || closingTimer.current) return;
    setLeaving(true);
    const delay = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 160;
    closingTimer.current = setTimeout(() => closeCallback.current(), delay);
  };
  const closeFromKeyboard = useEffectEvent(close);
  useEffect(() => {
    const dialogId = Symbol();
    openDialogs.push(dialogId);
    const previous = document.activeElement as HTMLElement | null;
    const frame = requestAnimationFrame(() => {
      const field = ref.current?.querySelector<HTMLElement>(
        "input:not([type='file']),textarea,select",
      );
      const fallback = ref.current?.querySelector<HTMLElement>(
        "button,[tabindex='0']",
      );
      (field ?? fallback)?.focus();
    });
    function keydown(event: KeyboardEvent) {
      if (openDialogs[openDialogs.length - 1] !== dialogId) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeFromKeyboard();
      }
      if (event.key !== "Tab") return;
      const all = Array.from(
        ref.current?.querySelectorAll<HTMLElement>(
          "button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),a[href],[tabindex='0']",
        ) ?? [],
      ).filter((el) => el.getClientRects().length > 0);
      if (!all.length) {
        event.preventDefault();
        return;
      }
      if (!ref.current?.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? all[all.length - 1] : all[0]).focus();
        return;
      }
      if (event.shiftKey && document.activeElement === all[0]) {
        event.preventDefault();
        all[all.length - 1].focus();
      } else if (
        !event.shiftKey &&
        document.activeElement === all[all.length - 1]
      ) {
        event.preventDefault();
        all[0].focus();
      }
    }
    document.addEventListener("keydown", keydown);
    return () => {
      openDialogs.splice(openDialogs.indexOf(dialogId), 1);
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", keydown);
      if (closingTimer.current) clearTimeout(closingTimer.current);
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  return (
    <div
      className={`ui-modal-backdrop ${leaving ? "is-leaving" : ""}`}
      onMouseDown={(e) => {
        if (dismissible && e.target === e.currentTarget) close();
      }}
    >
      <div
        ref={ref}
        className={`ui-modal animate-pop-in ${className}`}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <header className="ui-modal-header">
          <h2 id={titleId}>{title}</h2>
          <IconButton
            name="close"
            label="Close dialog"
            onClick={close}
            disabled={!dismissible}
          />
        </header>
        {children}
      </div>
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
}) {
  return (
    <label className="ui-toggle-row">
      <span>
        <strong>{label}</strong>
        {description && <small>{description}</small>}
      </span>
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="ui-toggle" aria-hidden="true" />
    </label>
  );
}

export function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "Something went wrong. Please try again.";
}

export function useNow() {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);
  return now;
}
