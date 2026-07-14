"use client";

import { BookOpen, ExternalLink, Info, User } from "lucide-react";

import type { ManifestAuthor, ManifestPaper } from "@/lib/api-types";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/cn";

/** Hard ceiling mirroring the manifest schema (`MAX_AUTHORS`/`MAX_PAPERS`). */
const MAX_CREDITS = 20;

export interface ModuleAboutProps {
  name: string;
  /** Short one-liner from the manifest `description`. */
  description?: string | null;
  /** Longer "with this module you can …" text from the manifest `about`. */
  about?: string | null;
  author?: string | null;
  /** Upstream repo / homepage of the author (manifest `author_url`). */
  authorUrl?: string | null;
  /** DOI / paper link the module implements (manifest `paper_url`). */
  paperUrl?: string | null;
  /** All credited authors (manifest `authors[]`); preferred over `author`. */
  authors?: ManifestAuthor[] | null;
  /** All cited papers (manifest `papers[]`); preferred over `paperUrl`. */
  papers?: ManifestPaper[] | null;
  license?: string | null;
  version?: string | null;
  className?: string;
}

/**
 * Resolve the authors/papers to render: prefer the plural manifest lists, fall
 * back to the singular `author`/`paperUrl` (which the server also folds into the
 * lists) so this works whether the caller passes one form or the other. Capped
 * at 20 each to mirror the manifest schema.
 */
export function resolveCredits({
  author,
  authorUrl,
  authors,
  paperUrl,
  papers,
}: Pick<ModuleAboutProps, "author" | "authorUrl" | "authors" | "paperUrl" | "papers">): {
  authorList: ManifestAuthor[];
  paperList: ManifestPaper[];
} {
  const authorList = (
    authors?.length ? authors : author ? [{ name: author, url: authorUrl ?? null }] : []
  ).slice(0, MAX_CREDITS);
  const paperList = (
    papers?.length ? papers : paperUrl ? [{ title: null, url: paperUrl }] : []
  ).slice(0, MAX_CREDITS);
  return { authorList, paperList };
}

/**
 * "About this module" info popover for module detail headers.
 *
 * Platform-side (not module-authored): every module gets it for free from its
 * manifest fields - `description`, `about` (what-you-can-do text), `author` /
 * `author_url`, and `paper_url` (the cited paper, DOI link preferred).
 */
export function ModuleAboutInfo({ name, className, ...content }: ModuleAboutProps) {
  const { description, about } = content;
  const { authorList, paperList } = resolveCredits(content);
  const hasBody = Boolean(about || description);
  if (!hasBody && authorList.length === 0 && paperList.length === 0) return null;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={`About ${name}`}
          className={cn("cursor-pointer text-muted-foreground hover:text-foreground", className)}
        >
          <Info className="h-3.5 w-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-96 max-w-[calc(100vw-2rem)] space-y-3">
        <ModuleAboutContent {...content} />
      </PopoverContent>
    </Popover>
  );
}

/**
 * Body of the module "About" popover — header, what-you-can-do, author/paper,
 * and the version · license footer. Split out so it can render inside any
 * popover shell (the in-page {@link ModuleAboutInfo} button and the topbar ⓘ).
 */
export function ModuleAboutContent({
  description,
  about,
  license,
  version,
  ...credits
}: Omit<ModuleAboutProps, "name" | "className">) {
  const meta = [version ? `v${version}` : null, license].filter(Boolean).join(" · ");
  const { authorList, paperList } = resolveCredits(credits);

  return (
    <>
      <PopoverHeader>
        <PopoverTitle>About this module</PopoverTitle>
        {description && (
          <p className="text-xs leading-relaxed text-muted-foreground">{description}</p>
        )}
      </PopoverHeader>

      {about && (
        <div className="space-y-1">
          <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            What you can do
          </div>
          <p className="text-xs leading-relaxed text-foreground/90">{about}</p>
        </div>
      )}

      {(authorList.length > 0 || paperList.length > 0) && (
        <div className="space-y-1.5 border-t border-white/10 pt-2.5 text-xs">
          {authorList.map((a, i) => (
            <div
              key={`${a.name}-${i}`}
              className="flex items-center gap-1.5 text-muted-foreground"
            >
              <User className="h-3 w-3 shrink-0" />
              {a.url ? (
                <a
                  href={a.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 hover:text-foreground hover:underline"
                >
                  {a.name}
                  <ExternalLink className="h-2.5 w-2.5" />
                </a>
              ) : (
                <span>{a.name}</span>
              )}
            </div>
          ))}
          {paperList.map((p, i) => (
            <div
              key={`${p.url}-${i}`}
              className="flex items-center gap-1.5 text-muted-foreground"
            >
              <BookOpen className="h-3 w-3 shrink-0" />
              <a
                href={p.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 hover:text-foreground hover:underline"
              >
                {p.title ?? "Read the paper"}
                <ExternalLink className="h-2.5 w-2.5" />
              </a>
            </div>
          ))}
        </div>
      )}

      {meta && <div className="text-[10px] text-muted-foreground/70">{meta}</div>}
    </>
  );
}
