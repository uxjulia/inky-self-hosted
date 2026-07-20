export type FlashStepState = "pending" | "running" | "done" | "error";

export type FlashCallbacks = {
  onStepChange?: (index: number, name: string, state: FlashStepState) => void;
  onProgress?: (step: string, current: number, total: number) => void;
  skipReset?: boolean;
};

export type Partition = {
  type: string;
  offset: number;
  size: number;
};

export class BrowserFirmwareFlasher {
  constructor(port?: unknown, options?: { baudrate?: number });
  static requestPort(filters?: Array<{ usbVendorId: number; usbProductId?: number }> | null): Promise<unknown>;
  flashFirmware(firmwareData: Uint8Array, callbacks?: FlashCallbacks): Promise<{ partition: string; success: boolean }>;
  repairBootRegion(
    table: Partition[],
    options: FlashCallbacks & {
      bootloaderData?: Uint8Array | null;
      firmwareData?: Uint8Array | null;
      otadataData?: Uint8Array | null;
    }
  ): Promise<{ partitions: Partition[] }>;
}

export const STICKY_PARTITION_TABLE: Partition[];
export function fetchStickyBootloader(): Promise<Uint8Array>;
export function fetchStickyBootApp0(): Promise<Uint8Array>;
