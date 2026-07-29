import Image from "next/image";
import { cn } from "@/lib/utils";

function ImageIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className={className} aria-hidden>
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <circle cx="8.5" cy="9.5" r="1.6" />
      <path d="M21 15.5l-5-5L5 20.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export type FeatureCardProps = {
  lead: string;
  rest: string;
  /** Tailwind aspect-ratio class for the image frame, e.g. "aspect-[3/2]" */
  aspect: string;
  align?: "left" | "center";
  large?: boolean;
  /** Small label chip over the image. */
  tag?: string;
  /** Optional image src (under /public). Falls back to the placeholder when absent. */
  image?: string;
  imageAlt?: string;
  /** Custom media node rendered in the frame instead of the image (e.g. an interactive visual). */
  media?: React.ReactNode;
  /** Extra classes for the image frame (e.g. a dark backdrop behind a transparent image). */
  frameClassName?: string;
};

export function FeatureCard({
  lead,
  rest,
  aspect,
  align = "center",
  large = false,
  tag,
  image,
  imageAlt = "",
  media,
  frameClassName,
}: FeatureCardProps) {
  const centered = align === "center";

  return (
    <article className="group relative h-full overflow-hidden rounded-[22px] bg-white p-3 ring-1 ring-border shadow-[0_1px_2px_rgba(16,24,40,0.05)] transition-[box-shadow] duration-300 hover:ring-brand/20">
      {/* image frame — zooms only on hover */}
      <div className={cn("relative w-full overflow-hidden rounded-[16px] bg-[#131316]", aspect, frameClassName)}>
        {media ? (
          media
        ) : image ? (
          <Image
            src={image}
            alt={imageAlt}
            fill
            sizes="(max-width: 768px) 100vw, 33vw"
            className="absolute inset-0 h-full w-full object-cover transition-transform duration-[600ms] ease-out group-hover:scale-[1.06] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
          />
        ) : (
          <div className="grid h-full w-full place-items-center">
            <ImageIcon className="size-9 text-[#cbd0d8]" />
          </div>
        )}

        {tag ? (
          <span className="absolute left-3 top-3 rounded-full border border-white/50 bg-white/75 px-2.5 py-1 text-[11px] font-medium tracking-tight text-text-primary backdrop-blur-md">
            {tag}
          </span>
        ) : null}
      </div>

      {/* copy */}
      <div className={cn("px-2 pb-2 pt-4", centered ? "text-center" : "text-left")}>
        <h3
          className={cn(
            "inline-block font-semibold text-text-primary transition-transform duration-300 group-hover:scale-[1.04] motion-reduce:group-hover:scale-100",
            centered ? "origin-center" : "origin-left",
            large ? "text-[17px]" : "text-[15px]",
          )}
        >
          {lead}
        </h3>
        {/* revealed on hover (always visible on touch / reduced-motion) */}
        <p
          className={cn(
            "leading-[1.55] text-text-secondary transition duration-300",
            "[@media(hover:hover)]:translate-y-1 [@media(hover:hover)]:opacity-0",
            "group-hover:translate-y-0 group-hover:opacity-100",
            "motion-reduce:translate-y-0 motion-reduce:opacity-100",
            large ? "mt-1.5 text-[14px]" : "mt-1.5 text-[13px]",
          )}
        >
          {rest}
        </p>
      </div>
    </article>
  );
}
