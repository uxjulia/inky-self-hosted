from dataclasses import dataclass
from typing import Literal


DeviceTarget = Literal["x4", "x3", "sticky"]


@dataclass(frozen=True)
class OptimizationTarget:
    width: int
    height: int


PROFILE_480_X_800 = OptimizationTarget(width=800, height=480)
PROFILE_528_X_792 = OptimizationTarget(width=792, height=528)

OPTIMIZATION_TARGETS: dict[DeviceTarget, OptimizationTarget] = {
    "x4": PROFILE_480_X_800,
    "x3": PROFILE_528_X_792,
    "sticky": PROFILE_480_X_800,
}


def optimization_target_for(device: DeviceTarget) -> OptimizationTarget:
    return OPTIMIZATION_TARGETS[device]
