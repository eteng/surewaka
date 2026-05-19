import { create } from 'zustand';
import type { Location, PackageDetails } from '@surewaka/shared';

type BookingState = {
  step: number;
  pickup: Partial<Location> | null;
  dropoff: Partial<Location> | null;
  packageDetails: Partial<PackageDetails> | null;
  selectedCarrier: string | null;
  setStep: (step: number) => void;
  setPickup: (pickup: Partial<Location>) => void;
  setDropoff: (dropoff: Partial<Location>) => void;
  setPackageDetails: (details: Partial<PackageDetails>) => void;
  setSelectedCarrier: (carrier: string | null) => void;
  reset: () => void;
};

export const useBookingStore = create<BookingState>((set) => ({
  step: 0,
  pickup: null,
  dropoff: null,
  packageDetails: null,
  selectedCarrier: null,

  setStep: (step) => set({ step }),
  setPickup: (pickup) => set({ pickup }),
  setDropoff: (dropoff) => set({ dropoff }),
  setPackageDetails: (packageDetails) => set({ packageDetails }),
  setSelectedCarrier: (selectedCarrier) => set({ selectedCarrier }),

  reset: () =>
    set({
      step: 0,
      pickup: null,
      dropoff: null,
      packageDetails: null,
      selectedCarrier: null,
    }),
}));
