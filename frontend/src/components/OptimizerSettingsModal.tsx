import { ArrowLeftRight, CircleHelp, Save, X } from "lucide-react";
import type { RefObject } from "react";
import { defaultOptimizerSettings } from "../appConstants";
import type { OptimizerSettings } from "../appTypes";

type OptimizerSettingsModalProps = {
  optimizerSettings: OptimizerSettings;
  effectiveEinkQuantize: boolean;
  standaloneMode: boolean;
  qualityDraft: string;
  contrastFactorDraft: string;
  sectionSplitThresholdDraft: string;
  referencePageCharactersDraft: string;
  sectionSplitTooltipButtonRef: RefObject<HTMLButtonElement | null>;
  stablePageTooltipButtonRef: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  onSwapFilenameRenderFields: () => void;
  onResetFilenameRenderFields: () => void;
  onUpdateOptimizerSetting: <K extends keyof OptimizerSettings>(key: K, value: OptimizerSettings[K]) => void;
  onUpdateQualityFromSlider: (value: string) => void;
  onUpdateQualityDraft: (value: string) => void;
  onCommitQualityDraft: () => void;
  onUpdateContrastFactorFromSlider: (value: string) => void;
  onUpdateContrastFactorDraft: (value: string) => void;
  onCommitContrastFactorDraft: () => void;
  onUpdateSectionSplitThresholdDraft: (value: string) => void;
  onCommitSectionSplitThresholdDraft: () => void;
  onUpdateReferencePageCharactersDraft: (value: string) => void;
  onCommitReferencePageCharactersDraft: () => void;
  onShowSectionSplitTooltip: () => void;
  onHideSectionSplitTooltip: () => void;
  onShowStablePageTooltip: () => void;
  onHideStablePageTooltip: () => void;
  onResetOptimizerSettings: () => void;
};

export function OptimizerSettingsModal({
  optimizerSettings,
  effectiveEinkQuantize,
  standaloneMode,
  qualityDraft,
  contrastFactorDraft,
  sectionSplitThresholdDraft,
  referencePageCharactersDraft,
  sectionSplitTooltipButtonRef,
  stablePageTooltipButtonRef,
  onClose,
  onSwapFilenameRenderFields,
  onResetFilenameRenderFields,
  onUpdateOptimizerSetting,
  onUpdateQualityFromSlider,
  onUpdateQualityDraft,
  onCommitQualityDraft,
  onUpdateContrastFactorFromSlider,
  onUpdateContrastFactorDraft,
  onCommitContrastFactorDraft,
  onUpdateSectionSplitThresholdDraft,
  onCommitSectionSplitThresholdDraft,
  onUpdateReferencePageCharactersDraft,
  onCommitReferencePageCharactersDraft,
  onShowSectionSplitTooltip,
  onHideSectionSplitTooltip,
  onShowStablePageTooltip,
  onHideStablePageTooltip,
  onResetOptimizerSettings
}: OptimizerSettingsModalProps) {
  const filenameRenderEdited =
    optimizerSettings.filename_render_first !== defaultOptimizerSettings.filename_render_first ||
    optimizerSettings.filename_render_second !== defaultOptimizerSettings.filename_render_second;

  return (
    <div className="modal-backdrop" role="presentation">
      <section
        className="panel form-panel modal-card optimizer-modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="optimizer-modal-title"
      >
        <div className="panel-header">
          <h2 id="optimizer-modal-title">EPUB Optimizer Settings</h2>
          <button type="button" onClick={onClose} title="Close" aria-label="Close optimizer settings">
            <X size={16} />
          </button>
        </div>
        <div className="settings-grid">
          <label className="toggle-field plain-toggle-field full-width-field">
            <input
              type="checkbox"
              checked={optimizerSettings.use_original_filename}
              onChange={(event) => onUpdateOptimizerSetting("use_original_filename", event.target.checked)}
            />
            <span>Use Original Filename</span>
          </label>
          <div className="field filename-render-field">
            <div className="field-label">
              <label htmlFor="filename-render-first">Filename render</label>
              {filenameRenderEdited && (
                <button
                  className="filename-render-reset-button"
                  type="button"
                  onClick={onResetFilenameRenderFields}
                >
                  Reset
                </button>
              )}
            </div>
            <div className="filename-render-control">
              <input
                id="filename-render-first"
                className="filename-render-input"
                value={optimizerSettings.filename_render_first}
                disabled={optimizerSettings.use_original_filename}
                onChange={(event) => onUpdateOptimizerSetting("filename_render_first", event.target.value)}
                placeholder={defaultOptimizerSettings.filename_render_first}
              />
              <button
                type="button"
                onClick={onSwapFilenameRenderFields}
                title="Swap filename fields"
                aria-label="Swap filename fields"
                disabled={optimizerSettings.use_original_filename}
              >
                <ArrowLeftRight size={16} />
              </button>
              <input
                className="filename-render-input"
                value={optimizerSettings.filename_render_second}
                disabled={optimizerSettings.use_original_filename}
                onChange={(event) => onUpdateOptimizerSetting("filename_render_second", event.target.value)}
                placeholder={defaultOptimizerSettings.filename_render_second}
                aria-label="Second filename field"
              />
            </div>
          </div>
          <label className="field">
            <span>JPEG quality</span>
            <div className="range-field">
              <input
                type="range"
                min="1"
                max="100"
                step="1"
                value={optimizerSettings.quality}
                onChange={(event) => onUpdateQualityFromSlider(event.target.value)}
              />
              <input
                type="number"
                min="1"
                max="100"
                value={qualityDraft}
                onChange={(event) => onUpdateQualityDraft(event.target.value)}
                onBlur={onCommitQualityDraft}
                aria-label="JPEG quality"
              />
            </div>
          </label>
          <label className="field">
            <span>Contrast multiplier</span>
            <div className="range-field">
              <input
                type="range"
                min="0.5"
                max="3"
                step="0.1"
                value={optimizerSettings.contrast_factor}
                disabled={!optimizerSettings.contrast_boost}
                onChange={(event) => onUpdateContrastFactorFromSlider(event.target.value)}
              />
              <input
                type="number"
                min="0.5"
                max="3"
                step="0.1"
                value={contrastFactorDraft}
                disabled={!optimizerSettings.contrast_boost}
                onChange={(event) => onUpdateContrastFactorDraft(event.target.value)}
                onBlur={onCommitContrastFactorDraft}
                aria-label="Contrast multiplier"
              />
            </div>
          </label>
          <label className="toggle-field">
            <input
              type="checkbox"
              checked={optimizerSettings.grayscale}
              onChange={(event) => onUpdateOptimizerSetting("grayscale", event.target.checked)}
            />
            <span>Convert images to grayscale</span>
          </label>
          <label className="toggle-field">
            <input
              type="checkbox"
              checked={optimizerSettings.contrast_boost}
              onChange={(event) => onUpdateOptimizerSetting("contrast_boost", event.target.checked)}
            />
            <span>Boost image contrast</span>
          </label>
          <label className="toggle-field">
            <input
              type="checkbox"
              checked={effectiveEinkQuantize}
              disabled={!optimizerSettings.grayscale}
              onChange={(event) => onUpdateOptimizerSetting("eink_quantize", event.target.checked)}
            />
            <span>Use 4-level e-ink grayscale</span>
          </label>
          {!standaloneMode && (
            <label className="toggle-field">
              <input
                type="checkbox"
                checked={optimizerSettings.light_novel}
                onChange={(event) => onUpdateOptimizerSetting("light_novel", event.target.checked)}
              />
              <span>Rotate and split landscape images</span>
            </label>
          )}

          <label className="toggle-field">
            <input
              type="checkbox"
              checked={optimizerSettings.split_long_sections}
              onChange={(event) => onUpdateOptimizerSetting("split_long_sections", event.target.checked)}
            />
            <span>Split long EPUB sections</span>
          </label>
          <div className="field">
            <div className="field-label">
              <label htmlFor="reference-page-characters">Stable Page Numbers: Characters per page</label>
              <span className="advanced-tooltip">
                <button
                  ref={stablePageTooltipButtonRef}
                  type="button"
                  aria-describedby="stable-page-numbers-tooltip"
                  aria-label="Stable Page Numbers help"
                  onBlur={onHideStablePageTooltip}
                  onFocus={onShowStablePageTooltip}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      onHideStablePageTooltip();
                    }
                  }}
                  onMouseEnter={onShowStablePageTooltip}
                  onMouseLeave={onHideStablePageTooltip}
                >
                  <CircleHelp size={14} />
                </button>
              </span>
            </div>
            <input
              id="reference-page-characters"
              type="number"
              min="1"
              max="10000"
              step="1"
              value={referencePageCharactersDraft}
              onChange={(event) => onUpdateReferencePageCharactersDraft(event.target.value)}
              onBlur={onCommitReferencePageCharactersDraft}
            />
          </div>
        </div>
        <div className="modal-actions">
          <button type="button" onClick={onResetOptimizerSettings}>
            Reset Defaults
          </button>
          <button className="primary" type="button" onClick={onClose}>
            <Save size={16} />
            Save Settings
          </button>
        </div>
      </section>
    </div>
  );
}
