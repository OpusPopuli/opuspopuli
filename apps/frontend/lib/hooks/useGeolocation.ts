"use client";

import { useState, useCallback, useEffect, useRef } from "react";

export type GeolocationPermissionState =
  | "prompt"
  | "granted"
  | "denied"
  | "unsupported";

export interface GeolocationError {
  type: "permission" | "unavailable" | "timeout" | "unsupported" | "unknown";
  message: string;
}

export interface GeoCoordinates {
  latitude: number;
  longitude: number;
  accuracy: number;
}

export interface UseGeolocationOptions {
  timeout?: number;
  maximumAge?: number;
  enableHighAccuracy?: boolean;
}

export interface UseGeolocationReturn {
  coordinates: GeoCoordinates | null;
  isLoading: boolean;
  error: GeolocationError | null;
  permissionState: GeolocationPermissionState;
  requestLocation: () => Promise<GeoCoordinates | null>;
  clearLocation: () => void;
}

function getInitialPermissionState(): GeolocationPermissionState {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    return "unsupported";
  }
  return "prompt";
}

function classifyError(err: GeolocationPositionError): GeolocationError {
  switch (err.code) {
    case err.PERMISSION_DENIED:
      return { type: "permission", message: "Location permission denied" };
    case err.POSITION_UNAVAILABLE:
      return {
        type: "unavailable",
        message: "Location information unavailable",
      };
    case err.TIMEOUT:
      return { type: "timeout", message: "Location request timed out" };
    default:
      return {
        type: "unknown",
        message: "An unexpected location error occurred",
      };
  }
}

export function useGeolocation(
  options: UseGeolocationOptions = {},
): UseGeolocationReturn {
  const {
    timeout = 10000,
    maximumAge = 60000,
    enableHighAccuracy = false,
  } = options;

  const [coordinates, setCoordinates] = useState<GeoCoordinates | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<GeolocationError | null>(null);
  const [permissionState, setPermissionState] =
    useState<GeolocationPermissionState>(getInitialPermissionState);
  const hasRequestedRef = useRef(false);

  // Query browser permission state on mount
  useEffect(() => {
    if (permissionState === "unsupported") return;

    if (navigator.permissions?.query) {
      navigator.permissions
        .query({ name: "geolocation" })
        .then((status) => {
          if (!hasRequestedRef.current) {
            setPermissionState(
              status.state === "granted"
                ? "granted"
                : status.state === "denied"
                  ? "denied"
                  : "prompt",
            );
          }
          status.addEventListener("change", () => {
            if (!hasRequestedRef.current) {
              setPermissionState(
                status.state === "granted"
                  ? "granted"
                  : status.state === "denied"
                    ? "denied"
                    : "prompt",
              );
            }
          });
        })
        .catch(() => {
          // Permission query not supported (e.g. iOS Safari)
        });
    }
  }, [permissionState]);

  const requestLocation =
    useCallback(async (): Promise<GeoCoordinates | null> => {
      if (typeof navigator === "undefined" || !navigator.geolocation) {
        setError({
          type: "unsupported",
          message: "Geolocation not supported in this browser",
        });
        return null;
      }

      setIsLoading(true);
      setError(null);

      return new Promise<GeoCoordinates | null>((resolve) => {
        navigator.geolocation.getCurrentPosition(
          (position) => {
            const coords: GeoCoordinates = {
              latitude: position.coords.latitude,
              longitude: position.coords.longitude,
              accuracy: position.coords.accuracy,
            };
            hasRequestedRef.current = true;
            setCoordinates(coords);
            setPermissionState("granted");
            setIsLoading(false);
            resolve(coords);
          },
          (positionError) => {
            const geoError = classifyError(positionError);
            hasRequestedRef.current = true;
            setError(geoError);
            if (geoError.type === "permission") {
              setPermissionState("denied");
            }
            setIsLoading(false);
            resolve(null);
          },
          {
            enableHighAccuracy,
            timeout,
            maximumAge,
          },
        );
      });
    }, [enableHighAccuracy, timeout, maximumAge]);

  const clearLocation = useCallback(() => {
    setCoordinates(null);
    setError(null);
  }, []);

  return {
    coordinates,
    isLoading,
    error,
    permissionState,
    requestLocation,
    clearLocation,
  };
}
