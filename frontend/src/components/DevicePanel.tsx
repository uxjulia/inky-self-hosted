import { ChevronDown, Download, RefreshCw, SlidersHorizontal, TabletSmartphone, Usb, Wifi, X } from "lucide-react";
import { useEffect, useRef } from "react";
import type { DeviceTarget, Job, RecentOptimizedDownload, TransferMode } from "../appTypes";
import { readableError } from "../appUtils";
import { DEVICE_TARGET_OPTIONS, deviceTargetDefinition } from "../deviceTargets";
import { JobLog } from "./JobLog";

type DevicePanelProps = {
  testingDevice: boolean;
  transferMode: TransferMode;
  canUseWifiTransfer: boolean;
  deviceError: string;
  deviceStatus: string;
  deviceUrl: string;
  deviceHostPlaceholder: string;
  destinationPath: string;
  device: DeviceTarget;
  recentOptimizedDownloads: RecentOptimizedDownload[];
  jobs: Job[];
  canCancelUsbSend: boolean;
  onProbeDevice: () => void;
  onSetDeviceError: (value: string) => void;
  onSetDeviceStatus: (value: string) => void;
  onSetTransferMode: (value: TransferMode) => void;
  onSetDeviceUrl: (value: string) => void;
  onSetDestinationPath: (value: string) => void;
  onSetDevice: (value: DeviceTarget) => void;
  onOpenOptimizerSettings: () => void;
  onDownloadRecentOptimizedFile: () => void;
  onCancelUsbSend: () => void;
};

export function DevicePanel({
  testingDevice,
  transferMode,
  canUseWifiTransfer,
  deviceError,
  deviceStatus,
  deviceUrl,
  deviceHostPlaceholder,
  destinationPath,
  device,
  recentOptimizedDownloads,
  jobs,
  canCancelUsbSend,
  onProbeDevice,
  onSetDeviceError,
  onSetDeviceStatus,
  onSetTransferMode,
  onSetDeviceUrl,
  onSetDestinationPath,
  onSetDevice,
  onOpenOptimizerSettings,
  onDownloadRecentOptimizedFile,
  onCancelUsbSend
}: DevicePanelProps) {
  const optimizedDownloadButtonRef = useRef<HTMLButtonElement | null>(null);
  const previousOptimizedDownloadCount = useRef(recentOptimizedDownloads.length);

  useEffect(() => {
    const previousCount = previousOptimizedDownloadCount.current;
    previousOptimizedDownloadCount.current = recentOptimizedDownloads.length;
    if (previousCount !== 0 || recentOptimizedDownloads.length === 0) return;
    if (!window.matchMedia("(max-width: 760px)").matches) return;

    window.requestAnimationFrame(() => {
      optimizedDownloadButtonRef.current?.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
        block: "center"
      });
    });
  }, [recentOptimizedDownloads.length]);

  return (
    <section className="panel device-panel">
      <div className="panel-header">
        <div className="heading-line">
          <TabletSmartphone size={16} />
          <h2>Device</h2>
        </div>
        <button type="button" onClick={onProbeDevice} title="Test Connection" disabled={testingDevice}>
          {testingDevice ? (
            <RefreshCw className="spin" size={15} />
          ) : transferMode === "usb" ? (
            <Usb size={15} />
          ) : (
            <Wifi size={15} />
          )}
          {testingDevice ? "Searching" : "Test Connection"}
        </button>
      </div>
      {deviceError && (
        <div className="empty-state status-state error-state">
          <span>{readableError(deviceError)}</span>
          <button
            className="border-0"
            type="button"
            onClick={() => onSetDeviceError("")}
            title="Dismiss device error"
            aria-label="Dismiss device error"
          >
            <X size={16} />
          </button>
        </div>
      )}
      {deviceStatus && (
        <div className="empty-state status-state success-state">
          <span>{deviceStatus}</span>
          <button
            type="button"
            onClick={() => onSetDeviceStatus("")}
            title="Dismiss connection status"
            aria-label="Dismiss connection status"
          >
            <X size={16} />
          </button>
        </div>
      )}
      <label className="field">
        <span>Transfer method</span>
        {canUseWifiTransfer ? (
          <div className="segmented transfer-mode-segmented">
            <button
              type="button"
              className={transferMode === "wifi" ? "active" : ""}
              onClick={() => onSetTransferMode("wifi")}
            >
              <Wifi size={14} />
              Wi-Fi
            </button>
            <button
              type="button"
              className={transferMode === "usb" ? "active" : ""}
              onClick={() => onSetTransferMode("usb")}
            >
              <Usb size={14} />
              USB
            </button>
          </div>
        ) : (
          <div className="segmented transfer-mode-segmented">
            <span className="active selected-option">
              <Usb size={14} />
              USB
            </span>
          </div>
        )}
      </label>
      {canUseWifiTransfer && transferMode === "wifi" && (
        <label className="field">
          <span>Device host</span>
          <input
            value={deviceUrl}
            onChange={(event) => {
              onSetDeviceError("");
              onSetDeviceStatus("");
              onSetDeviceUrl(event.target.value);
            }}
            placeholder={deviceHostPlaceholder}
          />
        </label>
      )}
      <label className="field">
        <span>Destination folder (created if needed)</span>
        <input value={destinationPath} onChange={(event) => onSetDestinationPath(event.target.value)} placeholder="/" />
      </label>
      <label className="field">
        <span>Optimize for</span>
        <span className="select-control">
          <select id="device-selection" value={device} onChange={(event) => onSetDevice(event.target.value as DeviceTarget)}>
            {DEVICE_TARGET_OPTIONS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
          <ChevronDown aria-hidden="true" />
        </span>
        <small className="device-profile-help">{deviceTargetDefinition(device).profile.displayLabel}</small>
      </label>
      <button
        className="icon-text optimizer-settings-button"
        type="button"
        onClick={onOpenOptimizerSettings}
        title="EPUB Optimizer Settings"
      >
        <SlidersHorizontal size={16} />
        EPUB Optimizer Settings
      </button>
      {recentOptimizedDownloads.length > 0 && (
        <button
          ref={optimizedDownloadButtonRef}
          className="icon-text recent-download-button optimized-download-button"
          type="button"
          onClick={onDownloadRecentOptimizedFile}
          title={
            recentOptimizedDownloads.length === 1
              ? `Download ${recentOptimizedDownloads[0].filename}`
              : `Download ${recentOptimizedDownloads.length} optimized EPUBs`
          }
        >
          <Download size={16} />
          {recentOptimizedDownloads.length === 1
            ? "Download Optimized EPUB"
            : `Download ${recentOptimizedDownloads.length} Optimized EPUBs`}
        </button>
      )}
      {canCancelUsbSend && (
        <button
          className="icon-text cancel-send-button"
          type="button"
          onClick={onCancelUsbSend}
          title="Cancel USB Send"
        >
          <X size={16} />
          Cancel USB Send
        </button>
      )}
      <JobLog jobs={jobs} />
    </section>
  );
}
