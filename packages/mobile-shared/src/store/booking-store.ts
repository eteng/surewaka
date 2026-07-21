import { create } from 'zustand';
import type { Location, PackageDetails, RecipientDetails, VehicleType, DeliveryMode } from '@surewaka/shared';

type BookingState = {
  step: number;
  pickup: Partial<Location> | null;
  dropoff: Partial<Location> | null;
  packageDetails: Partial<PackageDetails> | null;
  recipientDetails: Partial<RecipientDetails> | null;
  selectedCarrier: string | null;
  /** Vehicle type for on-demand legs — determines driver pool and price multiplier */
  vehicleType: VehicleType;
  /** Delivery mode set when user picks a service from the carriers screen */
  mode: DeliveryMode | null;
  deliveryId: string | null;
  quoteExpiresAt: string | null;
  setStep: (step: number) => void;
  setPickup: (pickup: Partial<Location>) => void;
  setDropoff: (dropoff: Partial<Location>) => void;
  setPackageDetails: (details: Partial<PackageDetails>) => void;
  setRecipientDetails: (details: Partial<RecipientDetails>) => void;
  setSelectedCarrier: (carrier: string | null) => void;
  setVehicleType: (vehicleType: VehicleType) => void;
  setMode: (mode: DeliveryMode | null) => void;
  setDeliveryId: (id: string | null) => void;
  setQuoteExpiresAt: (expiresAt: string | null) => void;
  reset: () => void;
};

export const useBookingStore = create<BookingState>((set) => ({
  step: 0,
  pickup: null,
  dropoff: null,
  packageDetails: null,
  recipientDetails: null,
  selectedCarrier: null,
  vehicleType: 'motorcycle',
  mode: null,
  deliveryId: null,
  quoteExpiresAt: null,

  setStep: (step) => set({ step }),
  setPickup: (pickup) => set({ pickup }),
  setDropoff: (dropoff) => set({ dropoff }),
  setPackageDetails: (packageDetails) => set({ packageDetails }),
  setRecipientDetails: (recipientDetails) => set({ recipientDetails }),
  setSelectedCarrier: (selectedCarrier) => set({ selectedCarrier }),
  setVehicleType: (vehicleType) => set({ vehicleType }),
  setMode: (mode) => set({ mode }),
  setDeliveryId: (deliveryId) => set({ deliveryId }),
  setQuoteExpiresAt: (quoteExpiresAt) => set({ quoteExpiresAt }),

  reset: () =>
    set({
      step: 0,
      pickup: null,
      dropoff: null,
      packageDetails: null,
      recipientDetails: null,
      selectedCarrier: null,
      vehicleType: 'motorcycle',
      mode: null,
      deliveryId: null,
      quoteExpiresAt: null,
    }),
}));
