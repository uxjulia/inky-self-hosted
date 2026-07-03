import { BookOpen, Download, RefreshCw, SlidersHorizontal, TabletSmartphone, Usb, Wifi, X } from "lucide-react";
import type { DeviceTarget, Job, PreparedDictionaryDownload, RecentOptimizedDownload, TransferMode } from "../appTypes";
import { readableError } from "../appUtils";
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
  canPrepareDictionaries: boolean;
  recentOptimizedDownload: RecentOptimizedDownload | null;
  recentPreparedDictionaryDownload: PreparedDictionaryDownload | null;
  jobs: Job[];
  onProbeDevice: () => void;
  onSetDeviceError: (value: string) => void;
  onSetDeviceStatus: (value: string) => void;
  onSetTransferMode: (value: TransferMode) => void;
  onSetDeviceUrl: (value: string) => void;
  onSetDestinationPath: (value: string) => void;
  onSetDevice: (value: DeviceTarget) => void;
  onOpenOptimizerSettings: () => void;
  onOpenDictionaryTools: () => void;
  onDownloadRecentOptimizedFile: () => void;
  onDownloadPreparedDictionaryFile: () => void;
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
  canPrepareDictionaries,
  recentOptimizedDownload,
  recentPreparedDictionaryDownload,
  jobs,
  onProbeDevice,
  onSetDeviceError,
  onSetDeviceStatus,
  onSetTransferMode,
  onSetDeviceUrl,
  onSetDestinationPath,
  onSetDevice,
  onOpenOptimizerSettings,
  onOpenDictionaryTools,
  onDownloadRecentOptimizedFile,
  onDownloadPreparedDictionaryFile
}: DevicePanelProps) {
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
        <div className="segmented">
          <button type="button" className={device === "x4" ? "active" : ""} onClick={() => onSetDevice("x4")}>
            X4
          </button>
          <button type="button" className={device === "x3" ? "active" : ""} onClick={() => onSetDevice("x3")}>
            X3
          </button>
        </div>
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
      {canPrepareDictionaries && (
        <button
          className="icon-text dictionary-tools-button"
          type="button"
          onClick={onOpenDictionaryTools}
          title="Dictionary Tools"
        >
          <BookOpen size={16} />
          Dictionary Tools
        </button>
      )}
      {recentOptimizedDownload && (
        <button
          className="icon-text recent-download-button"
          type="button"
          onClick={onDownloadRecentOptimizedFile}
          title={`Download ${recentOptimizedDownload.filename}`}
        >
          <Download size={16} />
          Download Optimized EPUB
        </button>
      )}
      {recentPreparedDictionaryDownload && (
        <button
          className="icon-text recent-download-button"
          type="button"
          onClick={onDownloadPreparedDictionaryFile}
          title={`Download ${recentPreparedDictionaryDownload.filename}`}
        >
          <Download size={16} />
          Download Prepared Dictionary
        </button>
      )}
      <JobLog jobs={jobs} />
    </section>
  );
}
