import { Icon } from "@/components/ui";

export default function CallNetworkNotice() {
  return (
    <aside className="call-network-notice" aria-label="Calling demo note">
      <Icon name="info" size={18} />
      <p>
        For the best results, both devices should be on the same Wi-Fi. Calls
        between different networks may not connect.
      </p>
    </aside>
  );
}
