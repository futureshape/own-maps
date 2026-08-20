import { createElement } from "react";

/**
 * The single boundary around Google's experimental Places UI Kit details API.
 * If the custom elements change, only this adapter should need updating.
 */
export function PlaceCard({ placeId }: { placeId: string }) {
  return createElement(
    "gmp-place-details-compact",
    {
      key: placeId,
      // Vertical is the UI Kit default. Do not pass the property through React:
      // React 19 assigns known custom-element properties directly, and some beta
      // Maps builds reject the string even though the equivalent HTML attribute
      // is documented as valid.
      "truncation-preferred": "",
      style: {
        width: "286px",
        padding: "0",
        margin: "0",
        border: "none",
        backgroundColor: "transparent",
        colorScheme: "light",
        "--gmp-mat-color-primary": "#d9572f",
      },
    },
    createElement("gmp-place-details-place-request", { place: placeId }),
    createElement("gmp-place-standard-content"),
  );
}
