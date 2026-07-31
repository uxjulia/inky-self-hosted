import { ChevronDown, Download, Zap } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  BrowserFirmwareFlasher,
  fetchStickyBootApp0,
  fetchStickyBootloader,
  STICKY_PARTITION_TABLE
} from "../lib/flasher.js";
import type { FlashStepState } from "../lib/flasher.js";
import { crossInkSerialFilters } from "../serialTransfer";

type FlashDeviceId = "xteink" | "sticky";
type StableVariantId = "tiny" | "xlarge" | "x3-x4" | "sticky";
type FlashStatus = { tone: "success" | "error"; message: string } | null;
type StableReleaseInfo = {
  tag: string;
  channel: "stable" | "prerelease";
  download_tag?: string;
  published_at: string;
  html_url: string;
  variants: Array<{ id: StableVariantId; filename: string; size: number }>;
};

const DEVICES: Array<{ id: FlashDeviceId; name: string; detail: string }> = [
  { id: "xteink", name: "Xteink X3 / X4", detail: "Shared ESP32-C3 firmware" },
  { id: "sticky", name: "Seeed Studio Sticky", detail: "ESP32-S3 firmware" }
];

const DEVICE_CHIPS: Record<FlashDeviceId, string> = {
  xteink: "ESP32-C3",
  sticky: "ESP32-S3"
};

const XTEINK_VARIANT_IDS: StableVariantId[] = ["x3-x4", "tiny", "xlarge"];

function releaseSupportsDevice(release: StableReleaseInfo, device: FlashDeviceId | null) {
  return release.variants.some((variant) =>
    device === "sticky" ? variant.id === "sticky" : XTEINK_VARIANT_IDS.includes(variant.id)
  );
}

function firmwareVariantLabel(variantId: StableVariantId) {
  if (variantId === "x3-x4") return "X3 / X4";
  if (variantId === "tiny") return "Tiny";
  if (variantId === "xlarge") return "XLarge";
  return "Sticky";
}

function firmwareVariantDetail(variantId: StableVariantId) {
  if (variantId === "x3-x4") return "Shared ESP32-C3 firmware";
  if (variantId === "tiny") return "10–16 pt font";
  if (variantId === "xlarge") return "16–20 pt font";
  return "ESP32-S3";
}

function releaseVariantIds(release: StableReleaseInfo | null, device: FlashDeviceId | null) {
  if (!release) return [];
  const expectedIds: StableVariantId[] = device === "sticky" ? ["sticky"] : XTEINK_VARIANT_IDS;
  return expectedIds.filter((variantId) => release.variants.some((variant) => variant.id === variantId));
}

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

function messageFromUnknown(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function withDevelopmentPrerelease(releases: StableReleaseInfo[]) {
  if (!import.meta.env.DEV || releases.some((release) => release.channel === "prerelease")) return releases;

  const latestStable = releases.find((release) => release.channel === "stable");
  if (!latestStable) return releases;

  return [
    ...releases,
    {
      ...latestStable,
      tag: `${latestStable.tag}-dev-preview`,
      channel: "prerelease" as const,
      download_tag: latestStable.tag
    }
  ];
}

function firmwareDownloadTag(releases: StableReleaseInfo[], selectedTag: string) {
  return releases.find((release) => release.tag === selectedTag)?.download_tag || selectedTag;
}

export function FlashToolsPanel() {
  const serialSupported = useMemo(() => typeof navigator !== "undefined" && "serial" in navigator, []);
  const progressRef = useRef<HTMLDivElement | null>(null);
  const [device, setDevice] = useState<FlashDeviceId | null>(null);
  const [firmwareChoice, setFirmwareChoice] = useState<StableVariantId | null>(null);
  const [stableReleases, setStableReleases] = useState<StableReleaseInfo[]>([]);
  const [selectedReleaseTag, setSelectedReleaseTag] = useState("");
  const [stableReleaseError, setStableReleaseError] = useState("");
  const [lockedDevice, setLockedDevice] = useState(false);
  const [running, setRunning] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState("");
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
        setStableReleases(withDevelopmentPrerelease(releases));
      })
      .catch((error: unknown) => {
        if (!cancelled) setStableReleaseError(messageFromUnknown(error));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const compatibleStableReleases = stableReleases.filter(
    (release) => release.channel === "stable" && releaseSupportsDevice(release, device)
  );
  const compatiblePrereleaseReleases = stableReleases.filter(
    (release) => release.channel === "prerelease" && releaseSupportsDevice(release, device)
  );

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
    setDownloadError("");
  }

  function selectFirmware(nextChoice: StableVariantId) {
    if (running) return;
    setFirmwareChoice(nextChoice);
    setSteps([]);
    setStepStates([]);
    setProgress(0);
    setStatus(null);
    setDownloadError("");
  }

  async function downloadFirmware(downloadFilename: string) {
    if (!firmwareChoice || !selectedReleaseTag || downloading) return;

    const downloadTag = firmwareDownloadTag(stableReleases, selectedReleaseTag);
    setDownloading(true);
    setDownloadError("");
    try {
      const response = await fetch(
        `/api/firmware/crossink/releases/${encodeURIComponent(downloadTag)}/${firmwareChoice}`
      );
      if (!response.ok) {
        const detail = await response.json().catch(() => null) as { detail?: string } | null;
        throw new Error(detail?.detail || "Unable to download CrossInk firmware.");
      }

      const objectUrl = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = downloadFilename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (error) {
      setDownloadError(messageFromUnknown(error));
    } finally {
      setDownloading(false);
    }
  }

  async function flashFirmware() {
    if (!device || !firmwareChoice || !selectedReleaseTag || running) return;

    const downloadTag = firmwareDownloadTag(stableReleases, selectedReleaseTag);

    let serialPort: unknown;
    try {
      serialPort = await BrowserFirmwareFlasher.requestPort(device === "sticky" ? crossInkSerialFilters : undefined);
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
        `/api/firmware/crossink/releases/${encodeURIComponent(downloadTag)}/${firmwareChoice}`
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
        const flasher = new BrowserFirmwareFlasher(serialPort, {
          baudrate: 921600,
          expectedChip: DEVICE_CHIPS[device],
          deviceName: DEVICES.find((candidate) => candidate.id === device)?.name
        });
        await flasher.repairBootRegion(STICKY_PARTITION_TABLE, {
          ...callbacks,
          bootloaderData,
          firmwareData,
          otadataData
        });
      } else {
        const flasher = new BrowserFirmwareFlasher(serialPort, {
          expectedChip: DEVICE_CHIPS[device],
          deviceName: DEVICES.find((candidate) => candidate.id === device)?.name
        });
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
  const selectedPrereleaseRelease =
    compatiblePrereleaseReleases.find((release) => release.tag === selectedReleaseTag) ||
    compatiblePrereleaseReleases[0] ||
    null;
  const selectedStableVariant = selectedRelease?.variants.find((variant) => variant.id === firmwareChoice) || null;
  const selectedFirmwareName = selectedStableVariant?.filename || "firmware.bin";
  const firmwareReady = Boolean(device && firmwareChoice && selectedStableVariant);
  const stableVariantIds = releaseVariantIds(selectedStableRelease, device);
  const prereleaseVariantIds = releaseVariantIds(selectedPrereleaseRelease, device);

  return (
    <section className="flash-tools-page" role="tabpanel" id="flash-tools-panel" aria-labelledby="flash-tools-tab">
      <div className="flash-tools-content">
        <div className="panel flash-tools-intro">
          <div className="heading-line">
            <Zap size={16} />
            <h2>Flash Tools</h2>
          </div>
          {!lockedDevice ? <p>Install a Cross<span className="serif">I</span>nk release directly from your browser over USB.</p> : <p>Download a Cross<span className="serif">I</span>nk release as an <code>update.bin</code> file to copy to your SD card.</p>}

          <label className="toggle-field flash-locked-toggle">
            <input
              type="checkbox"
              checked={lockedDevice}
              disabled={running || downloading}
              onChange={(event) => {
                const nextLockedDevice = event.target.checked;
                setLockedDevice(nextLockedDevice);
                if (nextLockedDevice) {
                  setDevice("xteink");
                  setFirmwareChoice(null);
                }
                setSteps([]);
                setStepStates([]);
                setProgress(0);
                setStatus(null);
                setDownloadError("");
              }}
            />
            <span>I have a locked device</span>
          </label>
        </div>

        {!serialSupported && !lockedDevice && (
          <div className="flash-message warning">
            Web Serial is unavailable. Use Chrome or Edge on a desktop computer to flash firmware.
          </div>
        )}

        <section className="panel flash-step-card">
          <div className="flash-step-heading">
            <span>1</span>
            <h2>Select your device</h2>
          </div>
          <div className={`flash-device-grid${lockedDevice ? " single" : ""}`}>
            {DEVICES.filter((option) => !lockedDevice || option.id === "xteink").map((option) => (
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
                <span>Stable Cross<span className="serif">I</span>nk version (last 3 shown)</span>
                <span className="select-control">
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
                      setDownloadError("");
                    }}
                  >
                    {compatibleStableReleases.map((release, index) => (
                      <option key={release.tag} value={release.tag}>
                        {release.tag}{index === 0 ? " (latest)" : ""}
                      </option>
                    ))}
                  </select>
                  <ChevronDown aria-hidden="true" />
                </span>
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
                    <strong>{firmwareVariantLabel(variantId)}</strong>
                    <small>
                      {variant
                        ? `${firmwareVariantDetail(variantId)} · ${(variant.size / 1024 / 1024).toFixed(1)} MB`
                        : selectedStableRelease
                          ? "Unavailable"
                          : stableReleases.length > 0
                            ? "Unavailable"
                            : "Loading…"}
                    </small>
                  </button>
                );
              })}
            </div>
            {compatiblePrereleaseReleases.length > 0 && (
              <div className="flash-prerelease-section">
                <hr />
                <label className="field flash-version-field">
                  <span id="pr-label">Pre-Release Cross<span className="serif">I</span>nk builds</span>
                  <span className="select-control">
                    <select
                      value={selectedPrereleaseRelease?.tag || ""}
                      disabled={running}
                      onChange={(event) => {
                        setSelectedReleaseTag(event.target.value);
                        setFirmwareChoice(null);
                        setSteps([]);
                        setStepStates([]);
                        setProgress(0);
                        setStatus(null);
                        setDownloadError("");
                      }}
                    >
                      {compatiblePrereleaseReleases.map((release, index) => (
                        <option key={release.tag} value={release.tag}>
                          {release.tag}{index === 0 ? " (latest)" : ""}
                        </option>
                      ))}
                    </select>
                    <ChevronDown aria-hidden="true" />
                  </span>
                </label>
                <div className="flash-firmware-grid">
                  {prereleaseVariantIds.map((variantId) => {
                    const variant = selectedPrereleaseRelease?.variants.find((item) => item.id === variantId);
                    return (
                      <button
                        key={variantId}
                        type="button"
                        className={selectedRelease?.channel === "prerelease" && firmwareChoice === variantId ? "selected" : ""}
                        disabled={running || !variant}
                        onClick={() => {
                          if (selectedPrereleaseRelease) setSelectedReleaseTag(selectedPrereleaseRelease.tag);
                          selectFirmware(variantId);
                        }}
                      >
                        <strong>{firmwareVariantLabel(variantId)}</strong>
                        <small>
                          {variant
                            ? `${firmwareVariantDetail(variantId)} · ${(variant.size / 1024 / 1024).toFixed(1)} MB`
                            : "Unavailable"}
                        </small>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            {device === "sticky" && !stableReleaseError && stableReleases.length > 0 && compatibleStableReleases.length === 0 && compatiblePrereleaseReleases.length === 0 && (
              <div className="flash-message warning">
                No Sticky firmware is currently available from GitHub.
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
              {lockedDevice
                ? <p>
                  <strong>Steps when Flashing from Stock Xteink Firmware:</strong>
                  <ol>
                    <li>Download the <code>update.bin</code> file</li>
                    <li>Copy it to the root of your SD card (not inside any folders)</li>
                    <li>Re-insert the SD card into the device and restart it</li>
                    <li>Plug your device into USB power</li>
                    <li>Hold the power + up buttons at the same time for 3+ seconds until you see the device begin installation. Note: On the X3, the "Up" button is on the left side.</li>
                  </ol>
                  <strong>Steps when Updating from Cross<span className="serif">I</span>nk</strong>
                  <ol>
                    <li>Download the <code>update.bin</code> file (note when updating from Cross<span className="serif">I</span>nk, the filename does not matter)</li>
                    <li>Copy it anywhere on your SD card</li>
                    <li>Re-insert the SD card into the device and restart it</li>
                    <li>In CrossInk, go to <code>Settings {`>`} System {`>`} SD Card Firmware Update</code></li>
                    <li>Navigate to the downloaded <code>update.bin</code> file. The device will validate the firmware and begin installation.</li>
                  </ol>
                </p>

                : "Keep the device awake at its home screen and leave the USB cable connected until flashing completes."}
            </div>
            {lockedDevice ? (
              <button
                className="primary icon-text flash-action"
                type="button"
                disabled={running || downloading}
                onClick={() => downloadFirmware("update.bin")}
              >
                <Download size={16} />
                {downloading ? "Downloading…" : "Download update.bin"}
              </button>
            ) : (
              <>
                <button
                  className="primary icon-text flash-action"
                  type="button"
                  disabled={running || downloading || !serialSupported}
                  onClick={flashFirmware}
                >
                  <Zap size={16} />
                  {running ? "Flashing…" : `Flash ${selectedFirmwareName}`}
                </button>
                <aside className="flash-optional-download" aria-label="Optional firmware download">
                  <strong>Optional: manual SD card download</strong>
                  <p>
                    This is not required for USB flashing. Download the firmware file only if you plan to install it
                    manually from an SD card.
                  </p>
                  <button
                    className="icon-text flash-download-action"
                    type="button"
                    disabled={running || downloading}
                    onClick={() => downloadFirmware(selectedFirmwareName)}
                  >
                    <Download size={16} />
                    {downloading ? "Downloading…" : `Download ${selectedFirmwareName}`}
                  </button>
                </aside>
              </>
            )}
            {downloadError && <div className="flash-message error">{downloadError}</div>}
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
