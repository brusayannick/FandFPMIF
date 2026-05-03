"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowLeft, FileBox, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useInstallModule } from "@/lib/queries";
import { cn } from "@/lib/cn";

/**
 * Wires the install flow to POST /api/v1/modules/install. The progress + final
 * 'module installed' toast are driven by the global Jobs UI (phase 8) — the
 * /install endpoint returns {job_id} and the dock/drawer take it from there.
 */
export default function ImportModulePage() {
  const router = useRouter();
  const install = useInstallModule();

  const [archive, setArchive] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [gitUrl, setGitUrl] = useState("");
  const [ref, setRef] = useState("");

  const submitArchive = async () => {
    if (!archive) return;
    try {
      await install.mutateAsync({ file: archive });
      toast.success("Install queued — watch progress in the Jobs drawer");
      router.push("/settings/modules");
    } catch (err: unknown) {
      toast.error(`Install failed: ${(err as Error).message}`);
    }
  };

  const submitGit = async () => {
    if (!gitUrl) return;
    try {
      await install.mutateAsync({ gitUrl, ref: ref || undefined });
      toast.success("Clone queued — watch progress in the Jobs drawer");
      router.push("/settings/modules");
    } catch (err: unknown) {
      toast.error(`Install failed: ${(err as Error).message}`);
    }
  };

  return (
    <div className="space-y-4">
      <Button asChild variant="ghost" size="sm" className="cursor-pointer -ml-2 gap-1">
        <Link href="/settings/modules">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to modules
        </Link>
      </Button>

      <Tabs defaultValue="zip" className="space-y-4">
        <TabsList>
          <TabsTrigger value="zip" className="cursor-pointer">Upload archive</TabsTrigger>
          <TabsTrigger value="git" className="cursor-pointer">From git URL</TabsTrigger>
          <TabsTrigger value="registry" className="cursor-pointer" disabled>
            From PyPI / npm
          </TabsTrigger>
        </TabsList>

        <TabsContent value="zip">
          <Card>
            <CardContent className="space-y-3 p-6 text-sm">
              {archive ? (
                <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-card px-3 py-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{archive.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {(archive.size / 1024).toFixed(1)} KB
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setArchive(null)}
                    className="cursor-pointer"
                  >
                    Change
                  </Button>
                </div>
              ) : (
                <label
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOver(true);
                  }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragOver(false);
                    const f = e.dataTransfer.files?.[0];
                    if (f) setArchive(f);
                  }}
                  className={cn(
                    "flex h-32 cursor-pointer flex-col items-center justify-center gap-1 rounded-md border border-dashed bg-muted/40 text-muted-foreground transition-colors",
                    dragOver
                      ? "border-primary/60 bg-accent/40"
                      : "border-border hover:border-primary/40 hover:bg-accent/30",
                  )}
                >
                  <FileBox className="h-5 w-5" />
                  <span className="text-xs">Drop a .zip or .tar.gz</span>
                  <span className="text-[10px] text-muted-foreground/70">
                    Or click to choose a file
                  </span>
                  <input
                    type="file"
                    accept=".zip,.tar.gz,.tgz,application/zip,application/gzip"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) setArchive(f);
                    }}
                    className="sr-only"
                  />
                </label>
              )}
              <Button
                onClick={submitArchive}
                disabled={!archive || install.isPending}
                className="cursor-pointer gap-2"
              >
                {install.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                Install
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="git">
          <Card>
            <CardContent className="space-y-3 p-6 text-sm">
              <div className="grid gap-2">
                <Label>Repository URL</Label>
                <Input
                  value={gitUrl}
                  onChange={(e) => setGitUrl(e.target.value)}
                  placeholder="https://github.com/example/ff-mod-discovery.git"
                />
              </div>
              <div className="grid gap-2">
                <Label>Ref or tag (optional)</Label>
                <Input
                  value={ref}
                  onChange={(e) => setRef(e.target.value)}
                  placeholder="main"
                />
              </div>
              <Button
                onClick={submitGit}
                disabled={!gitUrl || install.isPending}
                className="cursor-pointer gap-2"
              >
                {install.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                Clone &amp; install
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
