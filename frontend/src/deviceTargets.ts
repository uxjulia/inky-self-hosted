import type { DeviceTarget } from "./appTypes";

export type OptimizationProfile = {
  width: number;
  height: number;
  displayLabel: string;
};

export type DeviceTargetDefinition = {
  id: DeviceTarget;
  label: string;
  profile: OptimizationProfile;
};

const PROFILE_480_X_800: OptimizationProfile = {
  width: 800,
  height: 480,
  displayLabel: "480 × 800 display"
};

const PROFILE_528_X_792: OptimizationProfile = {
  width: 792,
  height: 528,
  displayLabel: "528 × 792 display"
};

export const DEVICE_TARGETS: Record<DeviceTarget, DeviceTargetDefinition> = {
  x4: { id: "x4", label: "Xteink X4 / X4 Pro", profile: PROFILE_480_X_800 },
  x3: { id: "x3", label: "Xteink X3", profile: PROFILE_528_X_792 },
  sticky: { id: "sticky", label: "Seeed Studio Sticky", profile: PROFILE_480_X_800 }
};

export const DEVICE_TARGET_OPTIONS = [
  DEVICE_TARGETS.x4,
  DEVICE_TARGETS.x3,
  DEVICE_TARGETS.sticky
];

export function deviceTargetDefinition(device: DeviceTarget) {
  return DEVICE_TARGETS[device];
}
