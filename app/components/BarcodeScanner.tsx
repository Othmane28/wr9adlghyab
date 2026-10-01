"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BrowserCodeReader, BrowserMultiFormatReader } from "@zxing/browser";
import type { IScannerControls } from "@zxing/browser";
import { BarcodeFormat, DecodeHintType } from "@zxing/library";
import type { Result } from "@zxing/library";

type LookupResult =
  | { found: true; id: string; name: string }
  | { found: false; id: string; error?: string };

const decodeHints = new Map<DecodeHintType, unknown>();
decodeHints.set(DecodeHintType.POSSIBLE_FORMATS, [
  BarcodeFormat.CODE_128,
  BarcodeFormat.CODE_39,
  BarcodeFormat.CODE_93,
  BarcodeFormat.EAN_13,
  BarcodeFormat.EAN_8,
  BarcodeFormat.UPC_A,
  BarcodeFormat.UPC_E,
  BarcodeFormat.ITF,
  BarcodeFormat.CODABAR,
  BarcodeFormat.QR_CODE,
  BarcodeFormat.DATA_MATRIX,
  BarcodeFormat.PDF_417,
  BarcodeFormat.AZTEC,
]);

const readerOptions = {
  delayBetweenScanAttempts: 120,
  delayBetweenScanSuccess: 800,
  tryPlayVideoTimeout: 8000,
};

function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

export default function BarcodeScanner() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const readerRef = useRef<BrowserMultiFormatReader | null>(null);
  const lastValueRef = useRef<{ value: string; at: number } | null>(null);
  const torchRef = useRef(false);
  const cancelledRef = useRef(false);
  const cameraIdRef = useRef<string | null>(null);
  const startingRef = useRef(false);

  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [cameraId, setCameraId] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [isLookingUp, setIsLookingUp] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<LookupResult | null>(null);
  const [manualId, setManualId] = useState("");

  const isInsecure =
    typeof window !== "undefined" && !window.isSecureContext && window.location.hostname !== "localhost";

  const stopScanner = useCallback(() => {
    controlsRef.current?.stop();
    controlsRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    readerRef.current = null;
    setIsScanning(false);
    setTorchOn(false);
    torchRef.current = false;
  }, []);

  const lookup = useCallback(async (rawValue: string) => {
    const id = rawValue.trim();
    if (!id) return;

    const now = Date.now();
    const last = lastValueRef.current;
    if (last && last.value.toLowerCase() === id.toLowerCase() && now - last.at < 3000) return;
    lastValueRef.current = { value: id, at: now };

    setIsLookingUp(true);
    try {
      const response = await fetch(`/api/lookup?id=${encodeURIComponent(id)}`, { cache: "no-store" });
      const data = (await response.json()) as LookupResult;
      setResult(data);
    } catch {
      setResult({ found: false, id, error: "Could not reach the server" });
    } finally {
      setIsLookingUp(false);
    }
  }, []);

  const loadCameras = useCallback(async () => {
    if (typeof navigator.mediaDevices?.enumerateDevices !== "function") return [];
    try {
      const devices = (await BrowserCodeReader.listVideoInputDevices()) as MediaDeviceInfo[];
      setCameras(devices);
      return devices;
    } catch {
      return [];
    }
  }, []);

  const startScanner = useCallback(async (deviceIdOverride?: string | null) => {
    if (!videoRef.current || startingRef.current) return;
    startingRef.current = true;
    setIsStarting(true);
    setError(null);

    try {
      if (typeof navigator.mediaDevices?.getUserMedia !== "function") {
        throw new Error("Camera access is not available in this browser.");
      }

      // iOS Safari only exposes camera labels/ids after a permission grant, and
      // home-screen (PWA) installs need an explicit getUserMedia call before
      // enumerateDevices or decoding will show a black preview.
      // See zxing-js/browser#122 and #560.
      let warmup: MediaStream | null = null;
      if (isIOS()) {
        try {
          warmup = await navigator.mediaDevices.getUserMedia({ video: true });
        } catch {
          warmup = null;
          throw new Error("Camera permission was denied.");
        }
      }

      const devices = await loadCameras();

      const wanted = deviceIdOverride ?? cameraIdRef.current;
      const preferred =
        (wanted ? devices.find((device) => device.deviceId === wanted) : undefined) ??
        devices.find((device) => /back|rear|environment/i.test(device.label)) ??
        devices[0];
      const deviceId = preferred?.deviceId ?? null;
      if (deviceId !== cameraIdRef.current) {
        cameraIdRef.current = deviceId;
        setCameraId(deviceId);
      }

      const constraints: MediaStreamConstraints = {
        audio: false,
        video: deviceId
          ? { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }
          : { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
      };

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia(constraints);
      } catch (err) {
        warmup?.getTracks().forEach((track) => track.stop());
        throw err;
      }
      warmup?.getTracks().forEach((track) => track.stop());
      streamRef.current = stream;

      const reader = new BrowserMultiFormatReader(decodeHints, readerOptions);
      readerRef.current = reader;

      controlsRef.current = await reader.decodeFromStream(
        stream,
        videoRef.current,
        (result: Result | undefined) => {
          if (cancelledRef.current || !result) return;
          void lookup(result.getText());
        }
      );

      setIsScanning(true);
    } catch (err) {
      stopScanner();
      setError(
        err instanceof Error
          ? err.message
          : "Could not start the camera. Check browser permissions and that the page is served over HTTPS."
      );
    } finally {
      startingRef.current = false;
      setIsStarting(false);
    }
  }, [loadCameras, lookup, stopScanner]);

  const toggleTorch = useCallback(async () => {
    const controls = controlsRef.current;
    if (!controls?.switchTorch) return;
    const next = !torchRef.current;
    try {
      await controls.switchTorch(next);
      torchRef.current = next;
      setTorchOn(next);
    } catch {
      setTorchOn(false);
    }
  }, []);

  const handleCameraChange = useCallback(
    (nextId: string) => {
      const wasScanning = isScanning;
      stopScanner();
      cameraIdRef.current = nextId;
      setCameraId(nextId);
      if (wasScanning) {
        void startScanner(nextId);
      }
    },
    [isScanning, startScanner, stopScanner]
  );

  const restartScanner = useCallback(() => {
    if (isScanning) {
      void startScanner();
    }
  }, [isScanning, startScanner]);

  useEffect(() => {
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
      controlsRef.current?.stop();
      controlsRef.current = null;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, []);

  const resetResult = () => {
    lastValueRef.current = null;
    setResult(null);
    restartScanner();
  };

  return (
    <div className="flex w-full max-w-xl flex-col gap-5">
      <div className="relative aspect-[3/4] w-full overflow-hidden rounded-2xl bg-black sm:aspect-video">
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          className="h-full w-full object-cover"
          aria-label="Camera preview"
        />

        {isScanning && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="h-32 w-[85%] rounded-xl border-2 border-emerald-400/90 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
          </div>
        )}

        {!isScanning && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center text-white">
            <p className="text-sm text-white/70">
              {isStarting ? "Starting camera..." : "Camera is off"}
            </p>
            <button
              type="button"
              onClick={() => void startScanner()}
              disabled={isStarting || isInsecure}
              className="rounded-full bg-emerald-500 px-6 py-3 text-base font-semibold text-black transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isStarting ? "Starting..." : "Start scanner"}
            </button>
            {isInsecure && (
              <p className="max-w-xs text-xs text-amber-300">
                Camera access needs a secure connection. Run <code>npm run dev:https</code> and open the
                HTTPS URL, then accept the certificate warning.
              </p>
            )}
          </div>
        )}

        {isScanning && (
          <button
            type="button"
            onClick={stopScanner}
            className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-4 py-2 text-sm font-medium text-white backdrop-blur"
          >
            Stop camera
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {cameras.length > 1 && (
          <label className="flex items-center gap-2 text-sm">
            <span className="opacity-70">Camera</span>
            <select
              value={cameraId ?? ""}
              onChange={(event) => handleCameraChange(event.target.value)}
              className="rounded-md border border-black/10 bg-transparent px-2 py-1.5 dark:border-white/20"
            >
              {cameras.map((camera) => (
                <option key={camera.deviceId} value={camera.deviceId}>
                  {camera.label || `Camera ${camera.deviceId.slice(0, 6)}`}
                </option>
              ))}
            </select>
          </label>
        )}

        {isScanning && (
          <button
            type="button"
            onClick={() => void toggleTorch()}
            className="rounded-md border border-black/10 px-3 py-1.5 text-sm dark:border-white/20"
          >
            Flash: {torchOn ? "on" : "off"}
          </button>
        )}
      </div>

      {error && (
        <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      <div
        aria-live="polite"
        className="rounded-2xl border border-black/10 bg-white p-6 text-center dark:bg-white/5 dark:border-white/15"
      >
        {isLookingUp && <p className="text-sm opacity-70">Looking up the ID...</p>}

        {!isLookingUp && result?.found && (
          <div className="flex flex-col gap-1">
            <p className="text-3xl font-bold text-emerald-600 dark:text-emerald-400">Welcome {result.name}</p>
            <p className="text-sm opacity-60">ID {result.id}</p>
          </div>
        )}

        {!isLookingUp && result && !result.found && (
          <p className="text-xl font-semibold text-red-600 dark:text-red-400">
            (this id is not available)
            <span className="mt-1 block text-sm font-normal opacity-60">{result.id}</span>
          </p>
        )}

        {!isLookingUp && !result && (
          <p className="text-sm opacity-70">Scan a barcode to look up the ID in the database.</p>
        )}
      </div>

      <button
        type="button"
        onClick={resetResult}
        className="self-center rounded-full border border-black/10 px-5 py-2 text-sm font-medium dark:border-white/20"
      >
        Scan next
      </button>

      <details className="self-center text-sm">
        <summary className="cursor-pointer opacity-70">Enter an ID manually</summary>
        <form
          className="mt-2 flex items-center justify-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const value = manualId.trim();
            if (value) void lookup(value);
          }}
        >
          <input
            value={manualId}
            onChange={(event) => setManualId(event.target.value)}
            placeholder="e.g. m131534316"
            className="w-44 rounded-md border border-black/10 bg-transparent px-3 py-1.5 font-mono dark:border-white/20"
          />
          <button
            type="submit"
            className="rounded-md border border-black/10 px-3 py-1.5 font-medium dark:border-white/20"
          >
            Look up
          </button>
        </form>
      </details>
    </div>
  );
}
