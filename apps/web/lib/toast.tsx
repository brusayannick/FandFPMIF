"use client";

import { Copy } from "lucide-react";
import { toast } from "sonner";

function ErrorContent({ message }: { message: string }) {
  return (
    <div className="flex min-w-0 items-start gap-2">
      <span className="min-w-0 flex-1 break-words">{message}</span>
      <button
        type="button"
        aria-label="Copy error message"
        className="mt-0.5 shrink-0 opacity-60 hover:opacity-100 transition-opacity cursor-pointer"
        onClick={(e) => {
          e.stopPropagation();
          navigator.clipboard.writeText(message).catch(() => null);
        }}
      >
        <Copy className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export function toastError(
  message: string,
  options?: Parameters<typeof toast.error>[1],
) {
  toast.error(<ErrorContent message={message} />, options);
}
