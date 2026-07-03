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
  referencePageWordsDraft: string;
  sectionSplitTooltipButtonRef: RefObject<HTMLButtonElement | null>;
  stablePageTooltipButtonRef: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  onSwapFilenameRenderFields: () => void;
  onUpdateOptimizerSetting: <K extends keyof OptimizerSettings>(key: K, value: OptimizerSettings[K]) => void;
  onUpdateQualityFromSlider: (value: string) => void;
  onUpdateQualityDraft: (value: string) => void;
  onCommitQualityDraft: () => void;
  onUpdateContrastFactorFromSlider: (value: string) => void;
  onUpdateContrastFactorDraft: (value: string) => void;
  onCommitContrastFactorDraft: () => void;
  onUpdateSectionSplitThresholdDraft: (value: string) => void;
  onCommitSectionSplitThresholdDraft: () => void;
  onUpdateReferencePageWordsDraft: (value: string) => void;
  onCommitReferencePageWordsDraft: () => void;
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
  referencePageWordsDraft,
  sectionSplitTooltipButtonRef,
  stablePageTooltipButtonRef,
  onClose,
  onSwapFilenameRenderFields,
  onUpdateOptimizerSetting,
  onUpdateQualityFromSlider,
  onUpdateQualityDraft,
  onCommitQualityDraft,
  onUpdateContrastFactorFromSlider,
  onUpdateContrastFactorDraft,
  onCommitContrastFactorDraft,
  onUpdateSectionSplitThresholdDraft,
  onCommitSectionSplitThresholdDraft,
  onUpdateReferencePageWordsDraft,
  onCommitReferencePageWordsDraft,
  onShowSectionSplitTooltip,
  onHideSectionSplitTooltip,
  onShowStablePageTooltip,
  onHideStablePageTooltip,
  onResetOptimizerSettings
}: OptimizerSettingsModalProps) {
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
          <label className="field filename-render-field">
            <span>Filename render</span>
            <div className="filename-render-control">
              <span className="filename-render-value">{optimizerSettings.filename_render_first}</span>
              <button
                type="button"
                onClick={onSwapFilenameRenderFields}
                title="Swap filename fields"
                aria-label="Swap filename fields"
                disabled={optimizerSettings.use_original_filename}
              >
                <ArrowLeftRight size={16} />
              </button>
              <span className="filename-render-value">{optimizerSettings.filename_render_second}</span>
            </div>
          </label>
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
          {/* <div className="field">
            <div className="field-label">
              <label htmlFor="section-split-word-threshold">Words before section split</label>
              <span className="advanced-tooltip">
                <button
                  ref={sectionSplitTooltipButtonRef}
                  type="button"
                  aria-describedby="section-split-threshold-tooltip"
                  aria-label="Section split threshold help"
                  onBlur={onHideSectionSplitTooltip}
                  onFocus={onShowSectionSplitTooltip}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      onHideSectionSplitTooltip();
                    }
                  }}
                  onMouseEnter={onShowSectionSplitTooltip}
                  onMouseLeave={onHideSectionSplitTooltip}
                >
                  <CircleHelp size={14} />
                </button>
              </span>
            </div>
            <input
              id="section-split-word-threshold"
              type="number"
              min="1"
              max="10000"
              step="1"
              placeholder={String(
                optimizerSettings.section_split_word_threshold ?? defaultOptimizerSettings.section_split_word_threshold
              )}
              value={sectionSplitThresholdDraft}
              disabled={!optimizerSettings.split_long_sections}
              onChange={(event) => onUpdateSectionSplitThresholdDraft(event.target.value)}
              onBlur={onCommitSectionSplitThresholdDraft}
            />
          </div> */}
          <div className="field">
            <div className="field-label">
              <label htmlFor="reference-page-words">Stable Page Numbers: Words per page</label>
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
              id="reference-page-words"
              type="number"
              min="1"
              max="10000"
              step="1"
              value={referencePageWordsDraft}
              onChange={(event) => onUpdateReferencePageWordsDraft(event.target.value)}
              onBlur={onCommitReferencePageWordsDraft}
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
