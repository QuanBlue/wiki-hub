"use client";

import { useEffect, useState, useRef } from "react";
import { ArrowUp } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function ScrollToTop() {
  const [isVisible, setIsVisible] = useState(false);
  const scrollTargetRef = useRef<HTMLElement | Window | null>(null);

  useEffect(() => {
    const handleScroll = (e: Event) => {
      const target = e.target;
      let scrollTop = 0;
      let isValidTarget = false;

      if (target === document || target === window) {
        scrollTop = window.scrollY;
        isValidTarget = true;
        scrollTargetRef.current = window;
      } else if (target instanceof HTMLElement) {
        // Ignore sidebars and small elements
        const isSidebar = target.tagName === "ASIDE" || target.closest("aside");
        if (!isSidebar && target.clientHeight >= window.innerHeight * 0.5) {
          scrollTop = target.scrollTop;
          isValidTarget = true;
          scrollTargetRef.current = target;
        }
      }

      if (isValidTarget) {
        setIsVisible(scrollTop > 300);
      }
    };

    window.addEventListener("scroll", handleScroll, {
      passive: true,
      capture: true,
    });

    return () => {
      window.removeEventListener("scroll", handleScroll, { capture: true });
    };
  }, []);

  const scrollToTop = () => {
    const target = scrollTargetRef.current || window;
    target.scrollTo({
      top: 0,
      behavior: "smooth",
    });
    setIsVisible(false);
  };

  return (
    <Button
      variant="secondary"
      size="icon"
      className={cn(
        "fixed bottom-8 right-8 z-50 rounded-full shadow-md transition-all duration-300",
        isVisible
          ? "opacity-100 translate-y-0"
          : "opacity-0 translate-y-4 pointer-events-none",
      )}
      onClick={scrollToTop}
      aria-label="Scroll to top"
    >
      <ArrowUp className="h-5 w-5" />
    </Button>
  );
}
