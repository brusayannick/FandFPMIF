import { ImportForm } from "@/components/processes/import-form";

export default function ImportPage() {
  return (
    <section className="mx-auto max-w-3xl px-6 py-8">
      <header className="space-y-1 pb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Import event log</h1>
        <p className="text-sm text-muted-foreground">
          Drop a XES (preferred), XES.gz, or CSV file. CSV columns can be mapped
          to the canonical schema below.
        </p>
      </header>
      <ImportForm />
    </section>
  );
}
