import { useEffect, useRef } from "react";

let _io: IntersectionObserver | null = null;
function getIO() {
  if (!_io && typeof IntersectionObserver !== "undefined") {
    _io = new IntersectionObserver(
      entries => entries.forEach(e => {
        if (e.isIntersecting) { e.target.classList.add("in"); _io!.unobserve(e.target); }
      }),
      { threshold: 0.12 }
    );
  }
  return _io;
}

export function useScrollReveal(extraClass?: string) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    const io = getIO();
    if (!el || !io) return;
    el.classList.add("ld-sr");
    if (extraClass) el.classList.add(extraClass);
    io.observe(el);
    return () => { io.unobserve(el); };
  }, [extraClass]);
  return ref;
}
