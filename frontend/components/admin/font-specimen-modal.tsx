"use client";

import { useState } from "react";
import {
  Check,
  Code2,
  Eye,
  Keyboard,
  PenLine,
  RotateCcw,
  Sliders,
  Sparkles,
  Type,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { FontPreset } from "@/lib/font-presets";
import { cn } from "@/lib/utils";

const SAMPLE_TEXT_PRESETS = [
  "The quick brown fox jumps over the lazy dog.",
  "WikiHub Engineering & Architecture Documentation 2026.",
  "High-performance self-hosted knowledge base for agile teams.",
  "1234567890 • !@#$%^&*()_+=-[]{};:'\"<>?,./",
];

const FONT_SIZES = [
  { label: "14px", size: "14px" },
  { label: "16px", size: "16px" },
  { label: "20px", size: "20px" },
  { label: "28px", size: "28px" },
  { label: "36px", size: "36px" },
];

export function FontSpecimenModal({
  font,
  isOpen,
  isSelected,
  onClose,
  onSelect,
}: {
  font: FontPreset | null;
  isOpen: boolean;
  isSelected?: boolean;
  onClose: () => void;
  onSelect: (fontId: string) => void;
}) {
  const [customText, setCustomText] = useState(
    "High-performance self-hosted documentation for engineering teams.",
  );
  const [selectedSizeIndex, setSelectedSizeIndex] = useState(2); // 20px

  if (!font) return null;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        title={`${font.name} Typography Specimen`}
        description={font.description}
        className="max-w-3xl max-h-[88vh] overflow-y-auto"
      >
        <div className="space-y-6">
          {/* Header Card */}
          <div className="rounded-xl border border-border bg-surface-sunken/40 p-4.5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="size-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center font-bold text-xl">
                  <span style={{ fontFamily: font.cssFamily }}>Aa</span>
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3
                      className="text-xl font-bold text-foreground"
                      style={{ fontFamily: font.cssFamily }}
                    >
                      {font.name}
                    </h3>
                    <span className="text-[10px] uppercase font-semibold tracking-wider px-2 py-0.5 rounded-full bg-surface border border-border text-primary">
                      {font.category}
                    </span>
                    <span className="text-[10px] uppercase font-medium px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                      Self-Hosted Google Font
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {font.description}
                  </p>
                </div>
              </div>

              {isSelected ? (
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary bg-primary/10 px-2.5 py-1 rounded-md border border-primary/20">
                  <Check className="size-3.5" />
                  Currently Active
                </span>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  variant="primary"
                  className="text-xs h-8 gap-1.5"
                  onClick={() => {
                    onSelect(font.id);
                    onClose();
                  }}
                >
                  <Check className="size-3.5" />
                  Apply This Font
                </Button>
              )}
            </div>
          </div>

          {/* Clean Type Tester */}
          <div className="space-y-3.5 rounded-xl border border-border p-4 bg-surface">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
              <div className="flex items-center gap-2">
                <Sliders className="size-4 text-primary" />
                <span className="text-xs font-semibold text-foreground">Interactive Type Tester</span>
              </div>

              {/* Font Size Pills */}
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] text-muted-foreground">Size:</span>
                <div className="flex items-center gap-0.5 bg-surface-sunken p-0.5 rounded-md border border-border/70">
                  {FONT_SIZES.map((s, idx) => (
                    <button
                      key={s.size}
                      type="button"
                      onClick={() => setSelectedSizeIndex(idx)}
                      className={cn(
                        "px-2 py-0.5 text-[11px] rounded font-medium transition-colors cursor-pointer",
                        selectedSizeIndex === idx
                          ? "bg-primary text-primary-foreground shadow-2xs font-semibold"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {s.size}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Custom Input */}
            <div className="space-y-2">
              <div className="relative">
                <Input
                  value={customText}
                  onChange={(e) => setCustomText(e.target.value)}
                  placeholder="Type custom text to preview font glyphs..."
                  className="text-xs h-9 bg-surface-sunken/30 pr-8"
                />
                {customText ? (
                  <button
                    type="button"
                    onClick={() => setCustomText("")}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-0.5 rounded cursor-pointer"
                    title="Clear text"
                  >
                    <X className="size-3.5" />
                  </button>
                ) : null}
              </div>

              {/* Presets row */}
              <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                <span className="text-muted-foreground text-[10px]">Presets:</span>
                {SAMPLE_TEXT_PRESETS.map((sample) => (
                  <button
                    key={sample}
                    type="button"
                    onClick={() => setCustomText(sample)}
                    className="text-[10px] text-muted-foreground hover:text-foreground bg-surface-sunken px-2 py-0.5 rounded border border-border/60 truncate max-w-[210px] transition-colors cursor-pointer"
                    title={sample}
                  >
                    {sample}
                  </button>
                ))}
              </div>
            </div>

            {/* Clean Specimen Display */}
            <div
              className="p-5 rounded-lg bg-surface-sunken/40 border border-border/70 min-h-[90px] flex items-center justify-center text-center transition-all overflow-hidden"
              style={{
                fontFamily: font.cssFamily,
                fontSize: FONT_SIZES[selectedSizeIndex].size,
                lineHeight: "1.45",
              }}
            >
              <span className="text-foreground transition-all break-words max-w-full font-normal">
                {customText || "Type something above to test this font..."}
              </span>
            </div>
          </div>

          {/* Typographic Hierarchy & Sample Document */}
          <div className="space-y-3 rounded-xl border border-border p-4 bg-surface">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground border-b border-border pb-2.5">
              <Type className="size-3.5 text-primary" />
              <span>Document Hierarchy &amp; Reading Sample</span>
            </div>

            <div
              className="space-y-3 text-foreground leading-relaxed pt-1"
              style={{ fontFamily: font.cssFamily }}
            >
              <h1 className="text-2xl font-bold tracking-tight text-foreground border-b border-border/60 pb-1.5">
                System Architecture &amp; Engineering Handbook
              </h1>

              <h2 className="text-lg font-semibold text-foreground">
                1. Overview and Core Principles
              </h2>

              <p className="text-sm text-foreground/90 leading-relaxed">
                WikiHub provides high-performance, self-hosted internal documentation. All workspace pages render using <strong className="font-semibold text-foreground">{font.name}</strong> to deliver effortless readability, crisp letter spacing, and balanced typographic contrast.
              </p>

              <blockquote className="border-l-3 border-primary pl-3 text-xs italic text-muted-foreground my-2">
                &ldquo;Clear documentation and thoughtful typography significantly reduce cognitive load during complex architectural investigations.&rdquo;
              </blockquote>

              <h3 className="text-sm font-semibold text-foreground pt-1">
                2. Code Block Isolation Guarantee
              </h3>

              {/* Code Block with Monokai Pro (Filter Octagon) Theme */}
              <div
                className="rounded-lg border text-xs overflow-hidden shadow-xs"
                style={{
                  backgroundColor: "var(--wh-code-bg, #282a3a)",
                  borderColor: "var(--wh-code-border, #3d4056)",
                  color: "var(--wh-code-fg, #eaf2f1)",
                  fontFamily: 'var(--font-jetbrains-mono), "JetBrains Mono", Consolas, Menlo, Monaco, monospace',
                }}
              >
                <div
                  className="flex items-center justify-between px-3 py-1.5 border-b text-[11px]"
                  style={{
                    backgroundColor: "var(--wh-code-bg-inset, #2f3247)",
                    borderColor: "var(--wh-code-border, #3d4056)",
                  }}
                >
                  <span className="flex items-center gap-1.5 text-neutral-300 font-medium">
                    <Code2 className="size-3.5 text-[#9cd1bb]" />
                    <span style={{ fontFamily: 'var(--font-jetbrains-mono), "JetBrains Mono", monospace' }}>
                      system.config.ts
                    </span>
                  </span>
                  <span
                    className="text-[9px] uppercase px-1.5 py-0.5 rounded font-semibold tracking-wider"
                    style={{
                      backgroundColor: "#3d4056",
                      color: "#ffd76d",
                    }}
                  >
                    Monokai Pro &bull; JetBrains Mono
                  </span>
                </div>

                <pre
                  className="p-3.5 text-[11px] leading-relaxed overflow-x-auto"
                  style={{
                    fontFamily: 'var(--font-jetbrains-mono), "JetBrains Mono", Consolas, Menlo, Monaco, monospace',
                    color: "var(--wh-code-fg, #eaf2f1)",
                  }}
                >
                  <code>
                    <span style={{ color: "#ff657a" }}>export </span>
                    <span style={{ color: "#ff657a" }}>const </span>
                    <span style={{ color: "#9cd1bb" }}>typography </span>
                    <span style={{ color: "#ff657a" }}>= </span>
                    <span style={{ color: "#eaf2f1" }}>{"{\n"}</span>
                    <span style={{ color: "#eaf2f1" }}>  pageFont</span>
                    <span style={{ color: "#ff657a" }}>: </span>
                    <span style={{ color: "#ffd76d" }}>&quot;{font.name}&quot;</span>
                    <span style={{ color: "#eaf2f1" }}>{",\n"}</span>
                    <span style={{ color: "#eaf2f1" }}>  category</span>
                    <span style={{ color: "#ff657a" }}>: </span>
                    <span style={{ color: "#ffd76d" }}>&quot;{font.category}&quot;</span>
                    <span style={{ color: "#eaf2f1" }}>{",\n"}</span>
                    <span style={{ color: "#eaf2f1" }}>  codeFont</span>
                    <span style={{ color: "#ff657a" }}>: </span>
                    <span style={{ color: "#ffd76d" }}>&quot;JetBrains Mono&quot;</span>
                    <span style={{ color: "#eaf2f1" }}>{", "}</span>
                    <span style={{ color: "#9195ab", fontStyle: "italic" }}>{"// strictly isolated\n"}</span>
                    <span style={{ color: "#eaf2f1" }}>{"};"}</span>
                  </code>
                </pre>
              </div>
            </div>
          </div>

          {/* Glyph Specimen Matrix */}
          <div className="space-y-2 rounded-xl border border-border p-4 bg-surface">
            <p className="text-xs font-semibold text-foreground">
              Complete Character Set &amp; Numerals
            </p>
            <div
              className="space-y-1 text-xs text-foreground/80 leading-relaxed bg-surface-sunken/40 p-3 rounded-lg border border-border/50"
              style={{ fontFamily: font.cssFamily }}
            >
              <p className="tracking-widest font-medium">
                A B C D E F G H I J K L M N O P Q R S T U V W X Y Z
              </p>
              <p className="tracking-widest">
                a b c d e f g h i j k l m n o p q r s t u v w x y z
              </p>
              <p className="tracking-wider text-muted-foreground">
                0 1 2 3 4 5 6 7 8 9 &bull; ! @ # $ % ^ &amp; * ( ) _ + - = [ ] &#123; &#125; ; : &apos; &quot; , . / &lt; &gt; ?
              </p>
            </div>
          </div>
        </div>

        <DialogFooter className="pt-3 border-t border-border flex items-center justify-between">
          <span className="text-muted-foreground text-xs">
            {font.name} &bull; {font.category}
          </span>
          <div className="flex items-center gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={onClose}>
              Close
            </Button>
            <Button
              type="button"
              variant="primary"
              size="sm"
              className="gap-1.5"
              onClick={() => {
                onSelect(font.id);
                onClose();
              }}
            >
              <Check className="size-3.5" />
              {isSelected ? "Keep Selected" : `Select ${font.name}`}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
