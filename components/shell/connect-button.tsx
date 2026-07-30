"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactElement,
  type ReactNode,
} from "react";
import {
  Check,
  ChevronDown,
  Copy,
  ExternalLink,
  LogOut,
  Wallet,
} from "lucide-react";
import {
  useAccount,
  useBalance,
  useConnect,
  useConnectors,
  useDisconnect,
} from "wagmi";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  GIWA_SEPOLIA_ID,
  UP_ID_SUFFIX,
  explorerAddress,
  shortenAddress,
} from "@/lib/giwa";
import { useUpIdName } from "@/lib/use-up-id";
import { cn, formatEth, seededRandom } from "@/lib/utils";

const WALLET_HELP_URL = "https://docs.giwa.io/get-started/connect-to-giwa";

const noopSubscribe = () => () => {};
const alwaysTrue = () => true;
const alwaysFalse = () => false;

export function ConnectButton(): ReactElement {
  /** false during SSR and the hydrating render, true from the commit onward. */
  const mounted = useSyncExternalStore(noopSubscribe, alwaysTrue, alwaysFalse);

  const { address, isConnected } = useAccount();
  const connectors = useConnectors();
  const { mutate: connect, isPending, error: connectError } = useConnect();
  const { disconnect } = useDisconnect();

  // Not useEnsName: GIWA Sepolia has no ENS Universal Resolver, so that hook
  // never resolves and every wallet falls back to a hex address.
  const { name: upIdName, verified } = useUpIdName(address);

  const { data: balance } = useBalance({
    address,
    chainId: GIWA_SEPOLIA_ID,
    query: { enabled: Boolean(address), refetchInterval: 20_000 },
  });

  const [open, setOpen] = useState(false);
  const [pendingUid, setPendingUid] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      const target = event.target;
      if (rootRef.current && target instanceof Node) {
        if (!rootRef.current.contains(target)) setOpen(false);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const copyAddress = useCallback(() => {
    if (!address) return;
    void navigator.clipboard
      .writeText(address)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {
        // Clipboard is unavailable outside secure contexts — fail quietly.
      });
  }, [address]);

  // useAccount resolves differently on the server than on the first client
  // paint, so nothing wallet-derived may render before hydration completes.
  if (!mounted) {
    return <Skeleton className="h-9.5 w-[124px] rounded-[11px]" />;
  }

  if (!isConnected || !address) {
    return (
      <div ref={rootRef} className="relative">
        <Button
          variant="primary"
          icon={Wallet}
          iconRight={ChevronDown}
          loading={isPending}
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-haspopup="menu"
        >
          <span className="hidden sm:inline">Connect wallet</span>
          <span className="sm:hidden">Connect</span>
        </Button>

        {open ? (
          <Dropdown>
            <p className="px-3 pt-2.5 pb-1.5 text-[11px] tracking-[0.14em] text-ink-faint uppercase">
              Available wallets
            </p>
            {/* wagmi types useConnectors() as a non-empty tuple, so a direct
                length check is statically impossible. Widen to a plain array —
                the list really can be empty when no EIP-6963 provider injects. */}
            {[...connectors].length === 0 ? (
              <div className="px-3 pt-1 pb-3">
                <p className="text-[13px] text-ink-muted">No wallet detected.</p>
                <a
                  href={WALLET_HELP_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-flex items-center gap-1.5 text-[12.5px] font-medium text-[#7fb2ff] transition-opacity duration-200 hover:opacity-80"
                >
                  How to connect to GIWA
                  <ExternalLink className="size-3.5" strokeWidth={2} />
                </a>
              </div>
            ) : (
              <div className="pb-1.5">
                {connectors.map((connector) => (
                  <MenuRow
                    key={connector.uid}
                    onClick={() => {
                      setPendingUid(connector.uid);
                      connect(
                        { connector },
                        {
                          onSuccess: () => setOpen(false),
                          onSettled: () => setPendingUid(null),
                        },
                      );
                    }}
                    disabled={isPending}
                  >
                    <ConnectorIcon
                      icon={connector.icon}
                      name={connector.name}
                    />
                    <span className="truncate">{connector.name}</span>
                    {pendingUid === connector.uid && isPending ? (
                      <span className="ml-auto text-[11px] text-ink-faint">
                        Approve in wallet…
                      </span>
                    ) : null}
                  </MenuRow>
                ))}
              </div>
            )}
            {connectError ? (
              <p className="border-t border-hairline px-3 py-2 text-[12px] text-critical">
                {connectError.message.split("\n")[0]}
              </p>
            ) : null}
          </Dropdown>
        ) : null}
      </div>
    );
  }

  const upId = upIdName?.endsWith(UP_ID_SUFFIX) ? upIdName : null;
  // A verified reader with no resolvable label still gets a truthful badge
  // rather than a blank — the name lives off-chain and the lookup can fail.
  const label = upId ?? shortenAddress(address);
  const gradient = addressGradient(address);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className={cn(
          "flex h-9.5 max-w-[210px] items-center gap-2 rounded-[11px] bg-elevated px-2 pr-2.5",
          "border border-hairline shadow-[inset_0_1px_0_rgba(255,255,255,0.045)]",
          "transition-colors duration-200 hover:bg-overlay",
        )}
      >
        <span
          aria-hidden
          className="size-[18px] shrink-0 rounded-[6px]"
          style={{
            backgroundImage: `linear-gradient(135deg, ${gradient.from}, ${gradient.to})`,
          }}
        />
        <span className="min-w-0 truncate text-[13px] font-medium text-ink">
          {label}
        </span>
        {/* Balance lives in the dropdown only — the trigger names the account. */}
        <ChevronDown className="size-3.5 shrink-0 text-ink-faint" strokeWidth={2} />
      </button>

      {open ? (
        <Dropdown>
          <div className="px-3 pt-3 pb-2.5">
            <p className="text-[11px] tracking-[0.14em] text-ink-faint uppercase">
              {upId
                ? "Upbit Web3 Name"
                : verified
                  ? "Verified · up.id held"
                  : "Connected account"}
            </p>
            <p className="mt-1.5 truncate text-sm font-semibold text-ink">
              {label}
            </p>
            <p className="mt-0.5 font-mono text-[11.5px] break-all text-ink-faint">
              {address}
            </p>
            <div className="mt-3 flex items-center justify-between gap-3 rounded-[10px] bg-white/[0.035] px-2.5 py-2">
              <span className="text-[11.5px] text-ink-muted">Balance</span>
              <span className="font-mono text-[12.5px] tabular-nums text-ink">
                {balance ? formatEth(balance.value) : "—"}
              </span>
            </div>
          </div>

          <div className="border-t border-hairline py-1.5">
            <MenuRow onClick={copyAddress}>
              {copied ? (
                <Check className="size-3.5 shrink-0 text-positive" strokeWidth={2.1} />
              ) : (
                <Copy className="size-3.5 shrink-0 text-ink-faint" strokeWidth={2} />
              )}
              {copied ? "Copied" : "Copy address"}
            </MenuRow>

            <a
              href={explorerAddress(address)}
              target="_blank"
              rel="noreferrer"
              onClick={() => setOpen(false)}
              className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] text-ink-muted transition-colors duration-150 hover:bg-white/[0.045] hover:text-ink"
            >
              <ExternalLink className="size-3.5 shrink-0 text-ink-faint" strokeWidth={2} />
              View on GIWA Explorer
            </a>

            <MenuRow
              onClick={() => {
                disconnect();
                setOpen(false);
              }}
              tone="critical"
            >
              <LogOut className="size-3.5 shrink-0" strokeWidth={2} />
              Disconnect
            </MenuRow>
          </div>
        </Dropdown>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function Dropdown({ children }: { children: ReactNode }): ReactElement {
  return (
    <div
      role="menu"
      className="animate-rise panel absolute top-[calc(100%+8px)] right-0 z-50 w-[268px] overflow-hidden"
    >
      {children}
    </div>
  );
}

function MenuRow({
  children,
  onClick,
  disabled,
  tone = "default",
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  tone?: "default" | "critical";
}): ReactElement {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px]",
        "transition-colors duration-150 disabled:opacity-45",
        tone === "critical"
          ? "text-critical hover:bg-critical/[0.1]"
          : "text-ink-muted hover:bg-white/[0.045] hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}

/**
 * EIP-6963 mandates data-URI icons. Anything else would be a remote asset, so
 * it is dropped in favour of the monogram fallback.
 */
function ConnectorIcon({
  icon,
  name,
}: {
  icon?: string;
  name: string;
}): ReactElement {
  if (icon && icon.startsWith("data:")) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- a data: URI needs no loader, and next/image is barred by the no-remote-assets rule
      <img
        src={icon}
        alt=""
        aria-hidden
        className="size-[18px] shrink-0 rounded-[5px]"
      />
    );
  }
  return (
    <span
      aria-hidden
      className="grid size-[18px] shrink-0 place-items-center rounded-[5px] bg-white/[0.07] text-[10px] font-semibold text-ink-muted"
    >
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

function addressGradient(address: string): { from: string; to: string } {
  const next = seededRandom(address.toLowerCase());
  const hue = Math.floor(next() * 360);
  const shift = 45 + Math.floor(next() * 70);
  return {
    from: `hsl(${hue} 88% 63%)`,
    to: `hsl(${(hue + shift) % 360} 76% 42%)`,
  };
}
