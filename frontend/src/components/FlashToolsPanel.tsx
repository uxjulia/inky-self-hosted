import { Zap } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  BrowserFirmwareFlasher,
  fetchStickyBootApp0,
  fetchStickyBootloader,
  STICKY_PARTITION_TABLE
} from "../lib/flasher.js";
import type { FlashStepState } from "../lib/flasher.js";

type FlashDeviceId = "xteink" | "sticky";
type StableVariantId = "tiny" | "xlarge" | "sticky";
type FlashStatus = { tone: "success" | "error"; message: string } | null;
type StableReleaseInfo = {
  tag: string;
  channel: "stable" | "beta";
  published_at: string;
  html_url: string;
  variants: Array<{ id: StableVariantId; filename: string; size: number }>;
};

const DEVICES: Array<{ id: FlashDeviceId; name: string; detail: string }> = [
  { id: "xteink", name: "Xteink X3 / X4", detail: "Shared ESP32-C3 firmware" },
  { id: "sticky", name: "Seeed Studio Sticky", detail: "ESP32-S3 firmware" }
];

const STANDARD_STEPS = [
  "Connect to device",
  "Validate partition table",
  "Read OTA data",
  "Flash firmware",
  "Update boot partition",
  "Disconnect"
];

const STICKY_STEPS = [
  "Connect to device",
  "Write bootloader + partition table + firmware",
  "Verify partition table",
  "Reset device"
];

const STICKY_SERIAL_FILTERS = [
  { usbVendorId: 0x303a },
  { usbVendorId: 0x2886 },
  { usbVendorId: 0x10c4 },
  { usbVendorId: 0x1a86 }
];

function messageFromUnknown(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function FlashToolsPanel() {
  const serialSupported = useMemo(() => typeof navigator !== "undefined" && "serial" in navigator, []);
  const progressRef = useRef<HTMLDivElement | null>(null);
  const [device, setDevice] = useState<FlashDeviceId | null>(null);
  const [firmwareChoice, setFirmwareChoice] = useState<StableVariantId | null>(null);
  const [stableReleases, setStableReleases] = useState<StableReleaseInfo[]>([]);
  const [selectedReleaseTag, setSelectedReleaseTag] = useState("");
  const [stableReleaseError, setStableReleaseError] = useState("");
  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState<string[]>([]);
  const [stepStates, setStepStates] = useState<FlashStepState[]>([]);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<FlashStatus>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/firmware/crossink/releases")
      .then(async (response) => {
        if (!response.ok) throw new Error("CrossInk releases are temporarily unavailable.");
        return response.json() as Promise<{ releases: StableReleaseInfo[] }>;
      })
      .then(({ releases }) => {
        if (cancelled) return;
        setStableReleases(releases);
      })
      .catch((error: unknown) => {
        if (!cancelled) setStableReleaseError(messageFromUnknown(error));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const compatibleStableReleases = stableReleases.filter(
    (release) =>
      release.channel === "stable" &&
      release.variants.some((variant) =>
        device === "sticky" ? variant.id === "sticky" : variant.id === "tiny" || variant.id === "xlarge"
      )
  );
  const stickyBetaRelease = stableReleases.find(
    (release) => release.channel === "beta" && release.variants.some((variant) => variant.id === "sticky")
  ) || null;

  useEffect(() => {
    if (!device) return;
    setSelectedReleaseTag((currentTag) =>
      compatibleStableReleases.some((release) => release.tag === currentTag)
        ? currentTag
        : compatibleStableReleases[0]?.tag || ""
    );
  }, [device, stableReleases]);

  function selectDevice(nextDevice: FlashDeviceId) {
    if (running) return;
    setDevice(nextDevice);
    setFirmwareChoice(null);
    setSteps([]);
    setStepStates([]);
    setProgress(0);
    setStatus(null);
  }

  function selectFirmware(nextChoice: StableVariantId) {
    if (running) return;
    setFirmwareChoice(nextChoice);
    setSteps([]);
    setStepStates([]);
    setProgress(0);
    setStatus(null);
  }

  async function flashFirmware() {
    if (!device || !firmwareChoice || !selectedReleaseTag || running) return;

    let serialPort: unknown;
    try {
      serialPort = await BrowserFirmwareFlasher.requestPort(device === "sticky" ? STICKY_SERIAL_FILTERS : undefined);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "NotFoundError")) {
        setStatus({ tone: "error", message: messageFromUnknown(error) });
      }
      return;
    }

    const activeSteps = device === "sticky" ? STICKY_STEPS : STANDARD_STEPS;
    const states: FlashStepState[] = activeSteps.map(() => "pending");
    setRunning(true);
    setSteps(activeSteps);
    setStepStates([...states]);
    setProgress(0);
    setStatus(null);
    window.setTimeout(() => progressRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);

    try {
      const response = await fetch(
        `/api/firmware/crossink/releases/${encodeURIComponent(selectedReleaseTag)}/${firmwareChoice}`
      );
      if (!response.ok) {
        const detail = await response.json().catch(() => null) as { detail?: string } | null;
        throw new Error(detail?.detail || "Unable to download CrossInk firmware.");
      }
      const firmwareData = new Uint8Array(await response.arrayBuffer());
      const callbacks = {
        onStepChange: (index: number, _name: string, state: FlashStepState) => {
          states[index] = state;
          setStepStates([...states]);
        },
        onProgress: (_step: string, current: number, total: number) => {
          setProgress(total > 0 ? (current / total) * 100 : 0);
        }
      };

      if (device === "sticky") {
        const [bootloaderData, otadataData] = await Promise.all([
          fetchStickyBootloader(),
          fetchStickyBootApp0()
        ]);
        const flasher = new BrowserFirmwareFlasher(serialPort, { baudrate: 921600 });
        await flasher.repairBootRegion(STICKY_PARTITION_TABLE, {
          ...callbacks,
          bootloaderData,
          firmwareData,
          otadataData
        });
      } else {
        const flasher = new BrowserFirmwareFlasher(serialPort);
        await flasher.flashFirmware(firmwareData, { ...callbacks, skipReset: true });
      }

      setProgress(100);
      setStatus({ tone: "success", message: "Flash complete. Follow the restart instructions below." });
    } catch (error) {
      const runningStep = states.findIndex((state) => state === "running");
      if (runningStep >= 0) {
        states[runningStep] = "error";
        setStepStates([...states]);
      }
      setStatus({ tone: "error", message: messageFromUnknown(error) });
    } finally {
      setRunning(false);
    }
  }

  const selectedRelease = stableReleases.find((release) => release.tag === selectedReleaseTag) || null;
  const selectedStableRelease =
    compatibleStableReleases.find((release) => release.tag === selectedReleaseTag) ||
    compatibleStableReleases[0] ||
    null;
  const selectedStableVariant = selectedRelease?.variants.find((variant) => variant.id === firmwareChoice) || null;
  const selectedFirmwareName = selectedStableVariant?.filename || "firmware.bin";
  const firmwareReady = Boolean(device && firmwareChoice && selectedStableVariant);
  const stableVariantIds: StableVariantId[] =
    device === "sticky"
      ? compatibleStableReleases.length > 0
        ? ["sticky"]
        : []
      : ["tiny", "xlarge"];

  return (
    <section className="flash-tools-page" role="tabpanel" id="flash-tools-panel" aria-labelledby="flash-tools-tab">
      <div className="flash-tools-content">
        <div className="panel flash-tools-intro">
          <div className="heading-line">
            <Zap size={16} />
            <h2>Flash Tools</h2>
          </div>
          <p>Install a CrossInk release directly from your browser over USB.</p>
        </div>

        {!serialSupported && (
          <div className="flash-message warning">
            Web Serial is unavailable. Use Chrome or Edge on a desktop computer to flash firmware.
          </div>
        )}

        <section className="panel flash-step-card">
          <div className="flash-step-heading">
            <span>1</span>
            <h2>Select your device</h2>
          </div>
          <div className="flash-device-grid">
            {DEVICES.map((option) => (
              <button
                key={option.id}
                type="button"
                className={device === option.id ? "selected" : ""}
                disabled={running}
                onClick={() => selectDevice(option.id)}
              >
                <strong>{option.name}</strong>
                <small>{option.detail}</small>
              </button>
            ))}
          </div>
        </section>

        {device && (
          <section className="panel flash-step-card">
            <div className="flash-step-heading">
              <span>2</span>
              <h2>Choose firmware</h2>
            </div>
            {compatibleStableReleases.length > 0 && (
              <label className="field flash-version-field">
                <span>CrossInk version</span>
                <select
                  value={selectedStableRelease?.tag || ""}
                  disabled={running}
                  onChange={(event) => {
                    setSelectedReleaseTag(event.target.value);
                    setFirmwareChoice(null);
                    setSteps([]);
                    setStepStates([]);
                    setProgress(0);
                    setStatus(null);
                  }}
                >
                  {compatibleStableReleases.map((release, index) => (
                    <option key={release.tag} value={release.tag}>
                      {release.tag}{index === 0 ? " (latest)" : ""}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <div className="flash-firmware-grid">
              {stableVariantIds.map((variantId) => {
                const variant = selectedStableRelease?.variants.find((item) => item.id === variantId);
                return (
                  <button
                    key={variantId}
                    type="button"
                    className={selectedRelease?.channel === "stable" && firmwareChoice === variantId ? "selected" : ""}
                    disabled={running || !variant}
                    onClick={() => {
                      if (selectedStableRelease) setSelectedReleaseTag(selectedStableRelease.tag);
                      selectFirmware(variantId);
                    }}
                  >
                    <strong>{variantId === "tiny" ? "Tiny" : variantId === "xlarge" ? "XLarge" : "Sticky"}</strong>
                    <small>
                      {variant
                        ? `${variantId === "tiny" ? "10–16 pt font" : variantId === "xlarge" ? "16–20 pt font" : "ESP32-S3"} · ${(variant.size / 1024 / 1024).toFixed(1)} MB`
                        : selectedStableRelease
                          ? "Unavailable"
                          : stableReleases.length > 0
                            ? "Unavailable"
                            : "Loading…"}
                    </small>
                  </button>
                );
              })}
              {device === "sticky" && stickyBetaRelease && (() => {
                const variant = stickyBetaRelease.variants.find((item) => item.id === "sticky");
                if (!variant) return null;
                const selected = selectedReleaseTag === stickyBetaRelease.tag && firmwareChoice === "sticky";
                return (
                  <button
                    key={stickyBetaRelease.tag}
                    type="button"
                    className={selected ? "selected" : ""}
                    disabled={running}
                    onClick={() => {
                      setSelectedReleaseTag(stickyBetaRelease.tag);
                      selectFirmware("sticky");
                    }}
                  >
                    <strong>Sticky Beta</strong>
                    <small>ESP32-S3 · {(variant.size / 1024 / 1024).toFixed(1)} MB</small>
                  </button>
                );
              })()}
            </div>
            {device === "sticky" && !stableReleaseError && stableReleases.length > 0 && !stickyBetaRelease && compatibleStableReleases.length === 0 && (
              <div className="flash-message warning">
                No Sticky firmware is available in the latest three stable CrossInk releases.
              </div>
            )}
            {stableReleaseError && <div className="flash-message error">{stableReleaseError}</div>}
          </section>
        )}

        {firmwareReady && device && (
          <section className="panel flash-step-card">
            <div className="flash-step-heading">
              <span>3</span>
              <h2>Flash</h2>
            </div>
            <div className="flash-message warning">
              Keep the device awake at its home screen and leave the USB cable connected until flashing completes.
            </div>
            <button className="primary icon-text flash-action" type="button" disabled={running || !serialSupported} onClick={flashFirmware}>
              <Zap size={16} />
              {running ? "Flashing…" : `Flash ${selectedFirmwareName}`}
            </button>
          </section>
        )}

        {steps.length > 0 && (
          <section ref={progressRef} className="panel flash-progress-card">
            <h2>Flash progress</h2>
            <ol>
              {steps.map((step, index) => (
                <li key={step} className={stepStates[index] || "pending"}>
                  <span aria-hidden="true">
                    {stepStates[index] === "done" ? "✓" : stepStates[index] === "error" ? "×" : "•"}
                  </span>
                  <div>
                    <strong>{step}</strong>
                    {stepStates[index] === "running" &&
                      (step.toLowerCase().includes("flash") || step.toLowerCase().includes("write")) && (
                        <progress max="100" value={progress} aria-label={`${progress.toFixed(0)}% flashed`} />
                      )}
                  </div>
                </li>
              ))}
            </ol>
            {status && <div className={`flash-message ${status.tone}`}>{status.message}</div>}
          </section>
        )}

        {status?.tone === "success" && device && (
          <section className="panel flash-restart-card">
            <h2>After flashing</h2>
            <p>Unplug and reconnect the USB cable, then press and hold the power button for 3–5 seconds.</p>
          </section>
        )}
      </div>
    </section>
  );
}
