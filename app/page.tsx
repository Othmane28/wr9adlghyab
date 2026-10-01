import BarcodeScanner from "./components/BarcodeScanner";

export default function Home() {
  return (
    <div className="flex min-h-full flex-1 flex-col items-center justify-center bg-zinc-50 py-8 font-sans dark:bg-black">
      <main className="flex w-full max-w-3xl flex-col items-center justify-center gap-8 px-4">
        <div className="flex flex-col items-center gap-2 text-center">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Barcode Scanner</h1>
          <p className="max-w-md text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            Scan a barcode to find the name assigned to that ID in the database.
          </p>
        </div>
        <BarcodeScanner />
      </main>
    </div>
  );
}
